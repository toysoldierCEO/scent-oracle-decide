begin;

alter table public.fragrance_source_backfill_audit_v1
  add column if not exists source_evidence_type text not null default 'official_pyramid';

alter table public.fragrance_source_backfill_audit_v1
  add column if not exists source_limitation_reason text;

update public.fragrance_source_backfill_audit_v1
set source_evidence_type = 'official_pyramid'
where source_evidence_type is null;

alter table public.fragrance_source_backfill_audit_v1
  drop constraint if exists fragrance_source_backfill_audit_v1_source_evidence_type_check;

alter table public.fragrance_source_backfill_audit_v1
  add constraint fragrance_source_backfill_audit_v1_source_evidence_type_check
  check (source_evidence_type in ('official_pyramid', 'official_notes_only'));

create index if not exists fragrance_source_backfill_audit_v1_exact_source_idx
  on public.fragrance_source_backfill_audit_v1 (
    fragrance_id,
    source_url,
    source_type,
    source_evidence_type,
    created_at desc
  );

comment on column public.fragrance_source_backfill_audit_v1.source_evidence_type is
  'Distinguishes official note-pyramid backfills from weaker official notes-only backfills. official_pyramid means the official page exposed structured top/heart/base notes. official_notes_only means the official page exposed exact product identity and official notes/prose without a structured pyramid.';

comment on column public.fragrance_source_backfill_audit_v1.source_limitation_reason is
  'Captures source limitations that matter for downstream routing, such as no_official_note_pyramid_provided for exact official notes-only pages.';

comment on column public.fragrance_source_backfill_audit_v1.source_payload is
  'Exact official-source payload submitted for the target row, including source evidence type, notes, optional note pyramid, and preserved-accord intent.';

create or replace function public.apply_fragrance_official_notes_backfill_v1(
  p_payload jsonb,
  p_actor_label text default 'codex_official_notes_backfill_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_official_notes_backfill_v1');
  v_fragrance_id uuid;
  v_source_type text;
  v_source_url text;
  v_source_confidence text;
  v_source_evidence_type text;
  v_source_limitation_reason text;
  v_expected_name text;
  v_expected_brand text;
  v_backfill_reason text;
  v_notes text[];
  v_top_notes text[];
  v_heart_notes text[];
  v_base_notes text[];
  v_official_accords text[];
  v_apply_official_accords boolean := false;
  v_source_verification_summary jsonb := '{}'::jsonb;
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_would_update_count integer := 0;
  v_updated_count integer := 0;
  v_would_write_audit_count integer := 0;
  v_audit_written_count integer := 0;
  v_rejected_count integer := 0;
  v_result_status text;
  v_blocker_reason text;
  v_before_snapshot jsonb := '{}'::jsonb;
  v_after_snapshot jsonb := '{}'::jsonb;
  v_changed_fields text[] := '{}'::text[];
  v_performance_refresh_required boolean := false;
  v_audit_id uuid;
  v_existing_audit_id uuid;
  v_duplicate_audit_count integer := 0;
  v_row record;
begin
  v_requested_count := 1;

  begin
    v_fragrance_id := nullif(p_payload ->> 'fragrance_id', '')::uuid;
  exception
    when others then
      raise exception 'apply_fragrance_official_notes_backfill_v1 requires a valid fragrance_id';
  end;

  v_source_type := nullif(btrim(p_payload ->> 'source_type'), '');
  v_source_url := nullif(btrim(p_payload ->> 'source_url'), '');
  v_source_confidence := nullif(btrim(p_payload ->> 'source_confidence'), '');
  v_source_evidence_type := nullif(btrim(p_payload ->> 'source_evidence_type'), '');
  v_source_limitation_reason := coalesce(
    nullif(btrim(p_payload ->> 'source_limitation_reason'), ''),
    'no_official_note_pyramid_provided'
  );
  v_expected_name := nullif(btrim(p_payload ->> 'expected_name'), '');
  v_expected_brand := nullif(btrim(p_payload ->> 'expected_brand'), '');
  v_backfill_reason := nullif(btrim(p_payload ->> 'backfill_reason'), '');
  v_apply_official_accords := coalesce((p_payload ->> 'apply_official_accords')::boolean, false);

  if v_fragrance_id is null then
    raise exception 'apply_fragrance_official_notes_backfill_v1 requires a valid fragrance_id';
  end if;

  if v_source_type is distinct from 'official_brand' then
    raise exception 'apply_fragrance_official_notes_backfill_v1 requires source_type=official_brand';
  end if;

  if v_source_evidence_type is distinct from 'official_notes_only' then
    raise exception 'apply_fragrance_official_notes_backfill_v1 requires source_evidence_type=official_notes_only';
  end if;

  if v_source_url is null then
    raise exception 'apply_fragrance_official_notes_backfill_v1 requires a non-empty source_url';
  end if;

  if v_source_confidence is null then
    raise exception 'apply_fragrance_official_notes_backfill_v1 requires a non-empty source_confidence';
  end if;

  select coalesce(array_agg(value order by ordinality), '{}'::text[])
  into v_notes
  from jsonb_array_elements_text(coalesce(p_payload -> 'notes', '[]'::jsonb)) with ordinality as t(value, ordinality);

  select coalesce(array_agg(value order by ordinality), '{}'::text[])
  into v_top_notes
  from jsonb_array_elements_text(coalesce(p_payload -> 'top_notes', '[]'::jsonb)) with ordinality as t(value, ordinality);

  select coalesce(array_agg(value order by ordinality), '{}'::text[])
  into v_heart_notes
  from jsonb_array_elements_text(coalesce(p_payload -> 'heart_notes', '[]'::jsonb)) with ordinality as t(value, ordinality);

  select coalesce(array_agg(value order by ordinality), '{}'::text[])
  into v_base_notes
  from jsonb_array_elements_text(coalesce(p_payload -> 'base_notes', '[]'::jsonb)) with ordinality as t(value, ordinality);

  select coalesce(array_agg(value order by ordinality), '{}'::text[])
  into v_official_accords
  from jsonb_array_elements_text(coalesce(p_payload -> 'accords', '[]'::jsonb)) with ordinality as t(value, ordinality);

  if coalesce(array_length(v_notes, 1), 0) = 0 then
    raise exception 'apply_fragrance_official_notes_backfill_v1 requires non-empty notes';
  end if;

  if coalesce(array_length(v_top_notes, 1), 0) > 0
     or coalesce(array_length(v_heart_notes, 1), 0) > 0
     or coalesce(array_length(v_base_notes, 1), 0) > 0 then
    raise exception 'apply_fragrance_official_notes_backfill_v1 rejects top_notes, heart_notes, and base_notes for official_notes_only evidence';
  end if;

  v_source_verification_summary := jsonb_strip_nulls(
    coalesce(p_payload -> 'source_verification_summary', '{}'::jsonb)
    || jsonb_build_object(
      'source_evidence_type', 'official_notes_only',
      'official_note_pyramid_present', false,
      'pyramid_absence_reason', v_source_limitation_reason,
      'top_notes_status', 'not_provided_by_official_source',
      'heart_notes_status', 'not_provided_by_official_source',
      'base_notes_status', 'not_provided_by_official_source'
    )
  );

  select
    f.id,
    f.name,
    f.brand,
    f.family_key,
    f.notes,
    f.accords,
    f.top_notes,
    f.heart_notes,
    f.base_notes,
    f.source_url,
    f.source_confidence,
    f.updated_at,
    q.queue_state,
    q.queue_lane,
    q.blocker_reason as queue_blocker_reason,
    q.recommended_next_action as queue_recommended_next_action,
    coalesce((q.alias_policy_summary ->> 'is_alias_row')::boolean, false) as is_alias_row,
    coalesce((q.evidence_summary -> 'provider_match' ->> 'has_rejected_match')::boolean, false) as has_rejected_match,
    coalesce((q.evidence_summary -> 'resolver' ->> 'has_resolver_attempt')::boolean, false) as has_resolver_attempt,
    exists(select 1 from public.fragrance_facets_v1 ff where ff.fragrance_id = f.id) as has_final_facets,
    exists(select 1 from public.fragrance_wardrobe_roles_v1 wr where wr.fragrance_id = f.id) as has_final_roles,
    exists(select 1 from public.fragrance_taxonomy_review_v1 tr where tr.fragrance_id = f.id) as has_taxonomy_review
  into v_row
  from public.fragrances f
  left join public.taxonomy_operationalization_queue_current_v1 q
    on q.fragrance_id = f.id
  where f.id = v_fragrance_id;

  if v_row.id is not null then
    select
      a.id,
      count(*) over ()::integer
    into v_existing_audit_id, v_duplicate_audit_count
    from public.fragrance_source_backfill_audit_v1 a
    where a.fragrance_id = v_fragrance_id
      and a.source_type = 'official_brand'
      and a.source_url = v_source_url
      and a.source_evidence_type = 'official_notes_only'
    order by a.created_at desc, a.id desc
    limit 1;
  end if;

  if v_row.id is null then
    v_result_status := 'rejected';
    v_blocker_reason := 'missing_fragrance_row';
    v_rejected_count := 1;
  elsif v_expected_name is not null and v_row.name is distinct from v_expected_name then
    v_result_status := 'rejected';
    v_blocker_reason := 'name_mismatch';
    v_rejected_count := 1;
  elsif v_expected_brand is not null and v_row.brand is distinct from v_expected_brand then
    v_result_status := 'rejected';
    v_blocker_reason := 'brand_mismatch';
    v_rejected_count := 1;
  elsif v_row.queue_state = 'already_complete'
        or v_row.queue_lane = 'complete_no_action' then
    v_result_status := 'rejected';
    v_blocker_reason := 'already_complete_not_allowed';
    v_rejected_count := 1;
  elsif coalesce(v_row.is_alias_row, false)
        or v_row.queue_state = 'canonical_alias_policy_blocked'
        or v_row.queue_lane = 'canonical_alias_policy' then
    v_result_status := 'rejected';
    v_blocker_reason := 'alias_row_not_allowed';
    v_rejected_count := 1;
  elsif coalesce(v_row.has_rejected_match, false)
        or v_row.queue_state = 'blocked_rejected_match'
        or v_row.queue_lane = 'product_critical_blocker' then
    v_result_status := 'rejected';
    v_blocker_reason := 'rejected_match_blocked';
    v_rejected_count := 1;
  elsif (
        coalesce(v_row.has_resolver_attempt, false)
        and v_row.queue_lane = 'resolver_conflict_review'
      )
      or v_row.queue_state in ('resolver_identity_conflict', 'provider_duplicate_reuse')
      or v_row.queue_lane = 'resolver_conflict_review' then
    v_result_status := 'rejected';
    v_blocker_reason := 'resolver_conflict_blocked';
    v_rejected_count := 1;
  elsif v_row.queue_state = 'provenance_identity_review_needed'
        or v_row.queue_lane = 'identity_review' then
    v_result_status := 'rejected';
    v_blocker_reason := 'identity_review_blocked';
    v_rejected_count := 1;
  elsif v_row.queue_state = 'provenance_payload_inconsistent'
        or v_row.queue_lane = 'manual_payload_review' then
    v_result_status := 'rejected';
    v_blocker_reason := 'payload_inconsistent_blocked';
    v_rejected_count := 1;
  elsif v_row.queue_state in ('canonical_selection_deferred', 'canonical_name_conflict', 'canonical_do_not_merge', 'canonical_separate_identity')
        or v_row.queue_lane in ('canonical_selection_needed', 'canonical_identity_review') then
    v_result_status := 'rejected';
    v_blocker_reason := 'canonical_blocked';
    v_rejected_count := 1;
  elsif coalesce(v_row.has_final_facets, false)
        or coalesce(v_row.has_final_roles, false)
        or coalesce(v_row.has_taxonomy_review, false) then
    v_result_status := 'rejected';
    v_blocker_reason := 'existing_final_taxonomy_present';
    v_rejected_count := 1;
  elsif v_existing_audit_id is not null then
    v_picked_count := 1;
    v_result_status := 'already_backfilled';
    v_blocker_reason := 'duplicate_official_notes_only_audit_exists';
  else
    v_picked_count := 1;

    v_before_snapshot := jsonb_build_object(
      'fragrance_id', v_row.id,
      'name', v_row.name,
      'brand', v_row.brand,
      'family_key', v_row.family_key,
      'source_url', v_row.source_url,
      'source_confidence', v_row.source_confidence,
      'notes', to_jsonb(coalesce(v_row.notes, '{}'::text[])),
      'accords', to_jsonb(coalesce(v_row.accords, '{}'::text[])),
      'top_notes', to_jsonb(coalesce(v_row.top_notes, '{}'::text[])),
      'heart_notes', to_jsonb(coalesce(v_row.heart_notes, '{}'::text[])),
      'base_notes', to_jsonb(coalesce(v_row.base_notes, '{}'::text[])),
      'updated_at', v_row.updated_at,
      'queue_state', v_row.queue_state,
      'queue_lane', v_row.queue_lane,
      'queue_blocker_reason', v_row.queue_blocker_reason,
      'queue_recommended_next_action', v_row.queue_recommended_next_action
    );

    if v_row.source_url is distinct from v_source_url then
      v_changed_fields := array_append(v_changed_fields, 'source_url');
    end if;
    if v_row.source_confidence is distinct from v_source_confidence then
      v_changed_fields := array_append(v_changed_fields, 'source_confidence');
    end if;
    if coalesce(v_row.notes, '{}'::text[]) is distinct from coalesce(v_notes, '{}'::text[]) then
      v_changed_fields := array_append(v_changed_fields, 'notes');
    end if;
    if v_apply_official_accords
       and coalesce(array_length(v_official_accords, 1), 0) > 0
       and coalesce(v_row.accords, '{}'::text[]) is distinct from coalesce(v_official_accords, '{}'::text[]) then
      v_changed_fields := array_append(v_changed_fields, 'accords');
    end if;

    v_performance_refresh_required := v_changed_fields && array['notes', 'accords']::text[];

    v_after_snapshot := jsonb_build_object(
      'fragrance_id', v_row.id,
      'name', v_row.name,
      'brand', v_row.brand,
      'family_key', v_row.family_key,
      'source_url', v_source_url,
      'source_confidence', v_source_confidence,
      'notes', to_jsonb(coalesce(v_notes, '{}'::text[])),
      'accords', to_jsonb(
        case
          when v_apply_official_accords and coalesce(array_length(v_official_accords, 1), 0) > 0 then coalesce(v_official_accords, '{}'::text[])
          else coalesce(v_row.accords, '{}'::text[])
        end
      ),
      'top_notes', to_jsonb(coalesce(v_row.top_notes, '{}'::text[])),
      'heart_notes', to_jsonb(coalesce(v_row.heart_notes, '{}'::text[])),
      'base_notes', to_jsonb(coalesce(v_row.base_notes, '{}'::text[])),
      'source_evidence_type', v_source_evidence_type,
      'source_limitation_reason', v_source_limitation_reason,
      'performance_refresh_required', v_performance_refresh_required
    );

    if p_dry_run then
      v_result_status := 'would_update';
      v_would_update_count := 1;
      v_would_write_audit_count := 1;
    else
      update public.fragrances
      set
        source_url = v_source_url,
        source_confidence = v_source_confidence,
        notes = v_notes,
        accords = case
          when v_apply_official_accords and coalesce(array_length(v_official_accords, 1), 0) > 0 then v_official_accords
          else accords
        end,
        updated_at = now()
      where id = v_fragrance_id;

      insert into public.fragrance_source_backfill_audit_v1 (
        fragrance_id,
        source_type,
        source_url,
        source_confidence,
        source_evidence_type,
        source_limitation_reason,
        actor_label,
        backfill_reason,
        changed_fields,
        accords_preserved,
        performance_refresh_required,
        before_snapshot,
        after_snapshot,
        source_payload,
        source_verification_summary
      )
      values (
        v_fragrance_id,
        v_source_type,
        v_source_url,
        v_source_confidence,
        v_source_evidence_type,
        v_source_limitation_reason,
        v_actor_label,
        v_backfill_reason,
        coalesce(v_changed_fields, '{}'::text[]),
        not (v_apply_official_accords and coalesce(array_length(v_official_accords, 1), 0) > 0),
        v_performance_refresh_required,
        v_before_snapshot,
        v_after_snapshot,
        coalesce(p_payload, '{}'::jsonb),
        v_source_verification_summary
      )
      returning id into v_audit_id;

      v_result_status := 'updated';
      v_updated_count := 1;
      v_audit_written_count := 1;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'would_update_count', v_would_update_count,
    'updated_count', v_updated_count,
    'would_write_audit_count', v_would_write_audit_count,
    'audit_written_count', v_audit_written_count,
    'rejected_count', v_rejected_count,
    'result_status', v_result_status,
    'blocker_reason', v_blocker_reason,
    'fragrance_id', v_fragrance_id,
    'actor_label', v_actor_label,
    'source_type', v_source_type,
    'source_url', v_source_url,
    'source_confidence', v_source_confidence,
    'source_evidence_type', v_source_evidence_type,
    'source_limitation_reason', v_source_limitation_reason,
    'changed_fields', to_jsonb(coalesce(v_changed_fields, '{}'::text[])),
    'performance_refresh_required', v_performance_refresh_required,
    'duplicate_audit_count', coalesce(v_duplicate_audit_count, 0),
    'existing_audit_id', v_existing_audit_id,
    'before_snapshot', v_before_snapshot,
    'after_snapshot', v_after_snapshot,
    'audit_id', v_audit_id
  );
end;
$function$;

revoke all on function public.apply_fragrance_official_notes_backfill_v1(jsonb, text, boolean) from public;
revoke all on function public.apply_fragrance_official_notes_backfill_v1(jsonb, text, boolean) from anon;
revoke all on function public.apply_fragrance_official_notes_backfill_v1(jsonb, text, boolean) from authenticated;
grant execute on function public.apply_fragrance_official_notes_backfill_v1(jsonb, text, boolean) to service_role;

comment on function public.apply_fragrance_official_notes_backfill_v1(jsonb, text, boolean) is
  'Applies an explicit official-brand notes-only source backfill for exactly one fragrance row, preserving family_key and note-pyramid emptiness, writing one auditable notes-only source row, and leaving performance and queue refresh as separate verified steps.';

create or replace view public.taxonomy_official_source_queue_evidence_v1
with (security_invoker = true)
as
with latest_valid_official_source_audit as (
  select distinct on (a.fragrance_id, a.source_url, a.source_type, a.source_evidence_type)
    a.fragrance_id,
    a.id as selected_official_source_backfill_audit_id,
    a.source_type,
    a.source_url,
    a.source_confidence as audit_source_confidence,
    a.source_evidence_type,
    a.source_limitation_reason,
    a.actor_label as official_source_backfill_actor_label,
    a.backfill_reason as official_source_backfill_reason,
    a.changed_fields as official_source_changed_fields,
    a.accords_preserved as official_source_accords_preserved,
    a.performance_refresh_required,
    a.before_snapshot as official_source_before_snapshot,
    a.after_snapshot as official_source_after_snapshot,
    a.source_payload as official_source_payload,
    a.source_verification_summary as official_source_verification_summary,
    a.created_at as official_source_backfill_created_at,
    count(*) over (
      partition by a.fragrance_id, a.source_url, a.source_type, a.source_evidence_type
    )::integer as duplicate_audit_count
  from public.fragrance_source_backfill_audit_v1 a
  where a.source_type = 'official_brand'
    and nullif(btrim(a.source_url), '') is not null
  order by a.fragrance_id, a.source_url, a.source_type, a.source_evidence_type, a.created_at desc, a.id desc
),
latest_completed_performance_refresh as (
  select distinct on (r.target_fragrance_id)
    r.target_fragrance_id as fragrance_id,
    r.id as performance_refresh_run_id,
    r.status as performance_refresh_status,
    r.run_started_at as performance_refresh_started_at,
    r.run_finished_at as performance_refresh_finished_at,
    r.model_version as performance_refresh_model_version,
    r.refreshed_fragrance_count as performance_refresh_row_count,
    r.inserted_signal_count as performance_refresh_signal_count,
    r.updated_feature_count as performance_refresh_feature_update_count,
    r.warning_count as performance_refresh_warning_count,
    r.error_count as performance_refresh_error_count,
    r.notes as performance_refresh_notes,
    coalesce(r.metadata, '{}'::jsonb) as performance_refresh_metadata
  from public.performance_feature_refresh_runs_v1 r
  where r.target_fragrance_id is not null
    and r.status = 'completed'
  order by r.target_fragrance_id, r.run_finished_at desc nulls last, r.run_started_at desc, r.id desc
)
select
  q.fragrance_id,
  q.name,
  q.brand,
  q.family_key,
  q.legacy_family_key,
  q.universal_family_key,
  q.evidence_quality_state,
  q.queue_state as v2_4_queue_state,
  q.queue_lane as v2_4_queue_lane,
  q.blocker_reason as v2_4_blocker_reason,
  q.recommended_next_action as v2_4_recommended_next_action,
  q.product_priority_score as v2_4_product_priority_score,
  q.product_priority_reason as v2_4_product_priority_reason,
  q.taxonomy_missing_summary as v2_4_taxonomy_missing_summary,
  q.evidence_summary as v2_4_evidence_summary,
  q.resolver_evidence_summary as v2_4_resolver_evidence_summary,
  q.canonical_identity_evidence_summary as v2_4_canonical_identity_evidence_summary,
  q.canonical_identity_decision_summary as v2_4_canonical_identity_decision_summary,
  q.alias_policy_summary as v2_4_alias_policy_summary,
  q.queue_model_version as v2_4_queue_model_version,
  q.generated_at as v2_4_generated_at,
  f.source_url,
  f.source_confidence,
  coalesce(cardinality(f.notes), 0) as notes_count,
  coalesce(cardinality(f.top_notes), 0) as top_notes_count,
  coalesce(cardinality(f.heart_notes), 0) as heart_notes_count,
  coalesce(cardinality(f.base_notes), 0) as base_notes_count,
  audit.selected_official_source_backfill_audit_id,
  audit.source_type as official_source_type,
  audit.source_url as official_source_url,
  audit.audit_source_confidence,
  audit.official_source_backfill_actor_label,
  audit.official_source_backfill_reason,
  audit.official_source_changed_fields,
  audit.official_source_accords_preserved,
  audit.performance_refresh_required,
  audit.official_source_before_snapshot,
  audit.official_source_after_snapshot,
  audit.official_source_payload,
  audit.official_source_verification_summary,
  audit.official_source_backfill_created_at,
  coalesce(audit.duplicate_audit_count, 0) as duplicate_audit_count,
  perf.performance_refresh_run_id,
  perf.performance_refresh_status,
  perf.performance_refresh_started_at,
  perf.performance_refresh_finished_at,
  perf.performance_refresh_model_version,
  perf.performance_refresh_row_count,
  perf.performance_refresh_signal_count,
  perf.performance_refresh_feature_update_count,
  perf.performance_refresh_warning_count,
  perf.performance_refresh_error_count,
  perf.performance_refresh_notes,
  perf.performance_refresh_metadata,
  case
    when nullif(btrim(f.source_confidence), '') ~ '^[0-9]+([.][0-9]+)?$'
      then f.source_confidence::numeric
  end as source_confidence_numeric,
  (
    audit.selected_official_source_backfill_audit_id is not null
    and f.source_url is not null
    and audit.source_url = f.source_url
    and audit.source_type = 'official_brand'
  ) as has_matching_official_source_backfill,
  (
    audit.source_evidence_type = 'official_pyramid'
    and coalesce(cardinality(f.notes), 0) > 0
    and coalesce(cardinality(f.top_notes), 0) > 0
    and coalesce(cardinality(f.heart_notes), 0) > 0
    and coalesce(cardinality(f.base_notes), 0) > 0
  ) as has_official_note_pyramid,
  case
    when audit.selected_official_source_backfill_audit_id is null then false
    when coalesce(audit.performance_refresh_required, false) is false then true
    when perf.performance_refresh_run_id is null then false
    when perf.performance_refresh_finished_at is null then false
    when perf.performance_refresh_finished_at >= audit.official_source_backfill_created_at then true
    else false
  end as official_source_performance_refresh_satisfied,
  jsonb_strip_nulls(jsonb_build_object(
    'has_official_source_backfill',
      audit.selected_official_source_backfill_audit_id is not null
      and f.source_url is not null
      and audit.source_url = f.source_url
      and audit.source_type = 'official_brand',
    'source_type', audit.source_type,
    'source_evidence_type', audit.source_evidence_type,
    'source_limitation_reason', audit.source_limitation_reason,
    'has_official_pyramid',
      audit.source_evidence_type = 'official_pyramid'
      and coalesce(cardinality(f.top_notes), 0) > 0
      and coalesce(cardinality(f.heart_notes), 0) > 0
      and coalesce(cardinality(f.base_notes), 0) > 0,
    'has_official_notes_only',
      audit.source_evidence_type = 'official_notes_only'
      and coalesce(cardinality(f.notes), 0) > 0,
    'source_url', f.source_url,
    'source_confidence', f.source_confidence,
    'source_confidence_numeric',
      case
        when nullif(btrim(f.source_confidence), '') ~ '^[0-9]+([.][0-9]+)?$'
          then f.source_confidence::numeric
      end,
    'selected_official_source_backfill_audit_id', audit.selected_official_source_backfill_audit_id,
    'duplicate_audit_count', coalesce(audit.duplicate_audit_count, 0),
    'official_source_backfill_actor_label', audit.official_source_backfill_actor_label,
    'official_source_backfill_reason', audit.official_source_backfill_reason,
    'official_source_backfill_created_at', audit.official_source_backfill_created_at,
    'official_source_changed_fields',
      to_jsonb(coalesce(audit.official_source_changed_fields, '{}'::text[])),
    'accords_preserved', audit.official_source_accords_preserved,
    'performance_refresh_required', audit.performance_refresh_required,
    'performance_refresh_satisfied',
      case
        when audit.selected_official_source_backfill_audit_id is null then false
        when coalesce(audit.performance_refresh_required, false) is false then true
        when perf.performance_refresh_run_id is null then false
        when perf.performance_refresh_finished_at is null then false
        when perf.performance_refresh_finished_at >= audit.official_source_backfill_created_at then true
        else false
      end,
    'official_notes_count', coalesce(cardinality(f.notes), 0),
    'official_top_notes_count', coalesce(cardinality(f.top_notes), 0),
    'official_heart_notes_count', coalesce(cardinality(f.heart_notes), 0),
    'official_base_notes_count', coalesce(cardinality(f.base_notes), 0),
    'source_verification_summary', coalesce(audit.official_source_verification_summary, '{}'::jsonb),
    'performance_refresh',
      case
        when perf.performance_refresh_run_id is not null then jsonb_build_object(
          'performance_refresh_run_id', perf.performance_refresh_run_id,
          'performance_refresh_status', perf.performance_refresh_status,
          'performance_refresh_started_at', perf.performance_refresh_started_at,
          'performance_refresh_finished_at', perf.performance_refresh_finished_at,
          'performance_refresh_model_version', perf.performance_refresh_model_version,
          'performance_refresh_row_count', perf.performance_refresh_row_count,
          'performance_refresh_signal_count', perf.performance_refresh_signal_count,
          'performance_refresh_feature_update_count', perf.performance_refresh_feature_update_count,
          'performance_refresh_warning_count', perf.performance_refresh_warning_count,
          'performance_refresh_error_count', perf.performance_refresh_error_count,
          'performance_refresh_notes', perf.performance_refresh_notes,
          'performance_refresh_metadata', perf.performance_refresh_metadata
        )
      end
  )) as official_source_evidence_summary,
  audit.source_evidence_type as official_source_evidence_type,
  audit.source_limitation_reason,
  (
    audit.source_evidence_type = 'official_notes_only'
    and coalesce(cardinality(f.notes), 0) > 0
  ) as has_official_notes_only
from public.taxonomy_operationalization_queue_v2_4 q
join public.fragrances f
  on f.id = q.fragrance_id
left join lateral (
  select l.*
  from latest_valid_official_source_audit l
  where l.fragrance_id = q.fragrance_id
    and l.source_url = f.source_url
    and l.source_type = 'official_brand'
  order by l.official_source_backfill_created_at desc, l.selected_official_source_backfill_audit_id desc
  limit 1
) audit on true
left join latest_completed_performance_refresh perf
  on perf.fragrance_id = q.fragrance_id;

comment on view public.taxonomy_official_source_queue_evidence_v1 is
  'Official-source-aware queue evidence read model. It preserves Queue v2.4 routing evidence and adds the latest valid official_brand source-backfill audit that matches the current public.fragrances source_url. It distinguishes official_pyramid from official_notes_only evidence, records source limitations, and links the latest completed target performance refresh. Duplicate audit rows are deduped by fragrance_id, source_url, source_type, and source_evidence_type for operational routing only; this view does not mutate public.fragrances, write taxonomy, create classifier proposals, or change frontend payload behavior.';

create or replace view public.taxonomy_operationalization_queue_v2_6
with (security_invoker = true)
as
with classified as (
  select
    e.*,
    case
      when e.v2_4_queue_state in (
        'already_complete',
        'blocked_rejected_match',
        'contaminated_data',
        'canonical_alias_policy_blocked',
        'canonical_selection_deferred',
        'canonical_identity_decided',
        'canonical_do_not_merge',
        'canonical_separate_identity',
        'canonical_name_conflict',
        'resolver_identity_conflict',
        'provider_duplicate_reuse',
        'source_resolver_tuning_needed',
        'provenance_ready_for_classifier',
        'provenance_accepted_pending_classifier_review',
        'provenance_payload_inconsistent',
        'provenance_identity_review_needed',
        'provenance_needs_source_backfill',
        'provenance_reference_gap',
        'provenance_review_pending',
        'provenance_rejected'
      ) then e.v2_4_queue_state
      when e.v2_4_queue_state in (
        'manual_source_needed',
        'source_gap_unattempted',
        'source_gap',
        'insufficient_evidence',
        'ready_existing_evidence',
        'needs_wear_test',
        'manual_review'
      )
        and e.has_matching_official_source_backfill
        and coalesce(e.source_confidence_numeric, 0) >= 0.95
        and e.has_official_note_pyramid
        and e.official_source_performance_refresh_satisfied
      then 'official_source_pending_classifier_review'
      when e.v2_4_queue_state in (
        'manual_source_needed',
        'source_gap_unattempted',
        'source_gap',
        'insufficient_evidence',
        'ready_existing_evidence',
        'needs_wear_test',
        'manual_review'
      )
        and e.has_matching_official_source_backfill
        and coalesce(e.source_confidence_numeric, 0) >= 0.95
        and e.has_official_notes_only
        and e.official_source_performance_refresh_satisfied
      then 'official_notes_pending_review'
      else e.v2_4_queue_state
    end as queue_state_v2_6
  from public.taxonomy_official_source_queue_evidence_v1 e
)
select
  c.fragrance_id,
  c.name,
  c.brand,
  c.family_key,
  c.legacy_family_key,
  c.universal_family_key,
  c.evidence_quality_state,
  c.queue_state_v2_6 as queue_state,
  case
    when c.queue_state_v2_6 = 'official_source_pending_classifier_review' then nullif(concat_ws(
      ';',
      'official_source_backfill',
      case
        when c.official_source_type is not null
          then 'source_type=' || c.official_source_type
      end,
      case
        when c.official_source_evidence_type is not null
          then 'source_evidence_type=' || c.official_source_evidence_type
      end,
      case
        when c.source_confidence is not null
          then 'source_confidence=' || c.source_confidence
      end,
      case
        when c.selected_official_source_backfill_audit_id is not null
          then 'official_source_backfill_audit_id=' || c.selected_official_source_backfill_audit_id::text
      end,
      case
        when c.duplicate_audit_count > 1
          then 'duplicate_audit_count=' || c.duplicate_audit_count::text
      end,
      case
        when c.performance_refresh_run_id is not null
          then 'performance_refresh_run_id=' || c.performance_refresh_run_id::text
      end
    ), '')
    when c.queue_state_v2_6 = 'official_notes_pending_review' then nullif(concat_ws(
      ';',
      'official_notes_only_source_backfill',
      case
        when c.official_source_type is not null
          then 'source_type=' || c.official_source_type
      end,
      case
        when c.official_source_evidence_type is not null
          then 'source_evidence_type=' || c.official_source_evidence_type
      end,
      case
        when c.source_confidence is not null
          then 'source_confidence=' || c.source_confidence
      end,
      case
        when c.source_limitation_reason is not null
          then 'source_limitation_reason=' || c.source_limitation_reason
      end,
      case
        when c.selected_official_source_backfill_audit_id is not null
          then 'official_source_backfill_audit_id=' || c.selected_official_source_backfill_audit_id::text
      end,
      case
        when c.performance_refresh_run_id is not null
          then 'performance_refresh_run_id=' || c.performance_refresh_run_id::text
      end
    ), '')
    else c.v2_4_blocker_reason
  end as blocker_reason,
  case
    when c.queue_state_v2_6 = 'official_source_pending_classifier_review' then 'controlled_classifier_review_candidate'
    when c.queue_state_v2_6 = 'official_notes_pending_review' then 'review_official_notes_source'
    else c.v2_4_recommended_next_action
  end as recommended_next_action,
  case
    when c.queue_state_v2_6 = 'official_source_pending_classifier_review' then 'controlled_classifier_review'
    when c.queue_state_v2_6 = 'official_notes_pending_review' then 'official_notes_review'
    else c.v2_4_queue_lane
  end as queue_lane,
  coalesce(c.v2_4_product_priority_score, 0)::integer as product_priority_score,
  nullif(concat_ws(
    ', ',
    c.v2_4_product_priority_reason,
    case
      when c.queue_state_v2_6 = 'official_source_pending_classifier_review'
        then 'official_source_backfill_verified'
      when c.queue_state_v2_6 = 'official_notes_pending_review'
        then 'official_notes_only_source_verified'
    end
  ), '') as product_priority_reason,
  c.v2_4_taxonomy_missing_summary as taxonomy_missing_summary,
  jsonb_strip_nulls(
    coalesce(c.v2_4_evidence_summary, '{}'::jsonb)
    || jsonb_build_object(
      'official_source',
      coalesce(
        c.official_source_evidence_summary,
        jsonb_build_object('has_official_source_backfill', false)
      )
    )
  ) as evidence_summary,
  c.v2_4_resolver_evidence_summary as resolver_evidence_summary,
  c.v2_4_canonical_identity_evidence_summary as canonical_identity_evidence_summary,
  c.v2_4_canonical_identity_decision_summary as canonical_identity_decision_summary,
  c.v2_4_alias_policy_summary as alias_policy_summary,
  'taxonomy_operationalization_queue_v2_6_official_notes_2026_05_27'::text as queue_model_version,
  statement_timestamp() as generated_at
from classified c;

comment on view public.taxonomy_operationalization_queue_v2_6 is
  'Official-source-aware operational queue v2.6. It preserves Queue v2.4 hard blockers and existing official pyramid routing first, then surfaces exact official-brand notes-only backfills with satisfied performance refresh into a separate official_notes_review lane instead of treating them as equivalent to note-pyramid-backed classifier candidates.';

create or replace function public.refresh_taxonomy_operationalization_queue_current_v1(
  p_actor_label text default 'codex_queue_current_refresh_v1',
  p_reason text default 'manual_refresh',
  p_refresh_scope text default 'full',
  p_fragrance_ids uuid[] default null
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_queue_current_refresh_v1');
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'manual_refresh');
  v_refresh_scope text := coalesce(nullif(btrim(p_refresh_scope), ''), 'full');
  v_requested_ids uuid[] := p_fragrance_ids;
  v_refresh_run_id uuid;
  v_expected_count integer := 0;
  v_staged_count integer := 0;
  v_affected_count integer := 0;
  v_warning_count integer := 0;
  v_error_count integer := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_source_queue_model_version text := null;
  v_refreshed_at timestamptz := statement_timestamp();
begin
  insert into public.taxonomy_queue_refresh_runs_v1 (
    actor_label,
    refresh_reason,
    refresh_scope,
    requested_ids,
    status,
    source_view_name,
    metadata
  )
  values (
    v_actor_label,
    v_reason,
    v_refresh_scope,
    v_requested_ids,
    'started',
    'taxonomy_operationalization_queue_v2_6',
    jsonb_build_object(
      'requested_ids_count', coalesce(cardinality(v_requested_ids), 0),
      'partial_refresh_supported', false
    )
  )
  returning id into v_refresh_run_id;

  if v_refresh_scope <> 'full' then
    v_error_count := 1;
    v_errors := jsonb_build_array(
      jsonb_build_object(
        'code', 'unsupported_refresh_scope',
        'message', 'Hybrid Queue Snapshot v1 supports full refresh only.',
        'requested_scope', v_refresh_scope
      )
    );

    update public.taxonomy_queue_refresh_runs_v1
    set
      status = 'failed',
      completed_at = statement_timestamp(),
      warning_count = v_warning_count,
      error_count = v_error_count,
      warnings = v_warnings,
      errors = v_errors,
      metadata = metadata || jsonb_build_object(
        'final_status', 'failed',
        'source_queue_model_version', v_source_queue_model_version
      )
    where id = v_refresh_run_id;

    return jsonb_build_object(
      'refresh_run_id', v_refresh_run_id,
      'status', 'failed',
      'refresh_scope', v_refresh_scope,
      'affected_count', 0,
      'source_queue_model_version', v_source_queue_model_version,
      'warnings', v_warnings,
      'errors', v_errors
    );
  end if;

  begin
    drop table if exists pg_temp.tmp_taxonomy_operationalization_queue_current_v1;

    create temporary table tmp_taxonomy_operationalization_queue_current_v1
    on commit drop
    as
    select
      q.fragrance_id,
      q.name,
      q.brand,
      q.family_key,
      q.legacy_family_key,
      q.universal_family_key,
      q.evidence_quality_state,
      q.queue_state,
      q.queue_lane,
      q.blocker_reason,
      q.recommended_next_action,
      coalesce(q.product_priority_score, 0)::integer as product_priority_score,
      q.product_priority_reason,
      coalesce(q.taxonomy_missing_summary, '{}'::jsonb) as taxonomy_missing_summary,
      coalesce(q.evidence_summary, '{}'::jsonb) as evidence_summary,
      coalesce(q.resolver_evidence_summary, '{}'::jsonb) as resolver_evidence_summary,
      coalesce(q.canonical_identity_evidence_summary, '{}'::jsonb) as canonical_identity_evidence_summary,
      coalesce(q.canonical_identity_decision_summary, '{}'::jsonb) as canonical_identity_decision_summary,
      coalesce(q.alias_policy_summary, '{}'::jsonb) as alias_policy_summary,
      'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24'::text as queue_model_version,
      q.queue_model_version as source_queue_model_version,
      'taxonomy_operationalization_queue_v2_6'::text as source_view_name,
      jsonb_build_object(
        'source_generated_at', q.generated_at,
        'source_queue_state', q.queue_state,
        'source_queue_lane', q.queue_lane,
        'has_taxonomy_missing_summary', q.taxonomy_missing_summary is not null,
        'has_evidence_summary', q.evidence_summary is not null,
        'has_resolver_evidence_summary', q.resolver_evidence_summary is not null,
        'has_canonical_identity_evidence_summary', q.canonical_identity_evidence_summary is not null,
        'has_canonical_identity_decision_summary', q.canonical_identity_decision_summary is not null,
        'has_alias_policy_summary', q.alias_policy_summary is not null,
        'has_provenance_summary', coalesce(q.evidence_summary ? 'provenance', false),
        'provenance_summary', coalesce(
          q.evidence_summary -> 'provenance',
          jsonb_build_object('has_provenance_review', false)
        ),
        'has_official_source_summary', coalesce(q.evidence_summary ? 'official_source', false),
        'official_source_summary', coalesce(
          q.evidence_summary -> 'official_source',
          jsonb_build_object('has_official_source_backfill', false)
        )
      ) as source_snapshot_summary,
      v_refresh_run_id as refresh_run_id,
      v_refreshed_at as refreshed_at,
      v_refreshed_at as created_at,
      v_refreshed_at as updated_at
    from public.taxonomy_operationalization_queue_v2_6 q;

    select count(*)::integer
    into v_expected_count
    from public.fragrances;

    select count(*)::integer
    into v_staged_count
    from tmp_taxonomy_operationalization_queue_current_v1;

    if v_staged_count = 0 then
      raise exception 'queue_current_refresh_empty_source';
    end if;

    if v_staged_count <> v_expected_count then
      raise exception 'queue_current_refresh_count_mismatch: expected %, staged %', v_expected_count, v_staged_count;
    end if;

    select min(source_queue_model_version)
    into v_source_queue_model_version
    from tmp_taxonomy_operationalization_queue_current_v1;

    if exists (
      select 1
      from tmp_taxonomy_operationalization_queue_current_v1
      group by source_queue_model_version
      having count(*) > 0
      offset 1
    ) then
      v_warning_count := 1;
      v_warnings := jsonb_build_array(
        jsonb_build_object(
          'code', 'multiple_source_queue_model_versions',
          'message', 'Queue v2.6 returned more than one source queue model version during refresh.'
        )
      );
    end if;

    delete from public.taxonomy_operationalization_queue_current_v1
    where true;

    insert into public.taxonomy_operationalization_queue_current_v1 (
      fragrance_id,
      name,
      brand,
      family_key,
      legacy_family_key,
      universal_family_key,
      evidence_quality_state,
      queue_state,
      queue_lane,
      blocker_reason,
      recommended_next_action,
      product_priority_score,
      product_priority_reason,
      taxonomy_missing_summary,
      evidence_summary,
      resolver_evidence_summary,
      canonical_identity_evidence_summary,
      canonical_identity_decision_summary,
      alias_policy_summary,
      queue_model_version,
      source_queue_model_version,
      source_view_name,
      source_snapshot_summary,
      refresh_run_id,
      refreshed_at,
      created_at,
      updated_at
    )
    select
      fragrance_id,
      name,
      brand,
      family_key,
      legacy_family_key,
      universal_family_key,
      evidence_quality_state,
      queue_state,
      queue_lane,
      blocker_reason,
      recommended_next_action,
      product_priority_score,
      product_priority_reason,
      taxonomy_missing_summary,
      evidence_summary,
      resolver_evidence_summary,
      canonical_identity_evidence_summary,
      canonical_identity_decision_summary,
      alias_policy_summary,
      queue_model_version,
      source_queue_model_version,
      source_view_name,
      source_snapshot_summary,
      refresh_run_id,
      refreshed_at,
      created_at,
      updated_at
    from tmp_taxonomy_operationalization_queue_current_v1;

    get diagnostics v_affected_count = row_count;

    update public.taxonomy_queue_refresh_runs_v1
    set
      status = case
        when v_warning_count > 0 then 'completed_with_warnings'
        else 'completed'
      end,
      completed_at = statement_timestamp(),
      affected_count = v_affected_count,
      source_queue_model_version = v_source_queue_model_version,
      source_view_name = 'taxonomy_operationalization_queue_v2_6',
      warning_count = v_warning_count,
      error_count = v_error_count,
      warnings = v_warnings,
      errors = v_errors,
      metadata = metadata || jsonb_build_object(
        'expected_count', v_expected_count,
        'staged_count', v_staged_count,
        'final_status', case
          when v_warning_count > 0 then 'completed_with_warnings'
          else 'completed'
        end,
        'queue_model_version', 'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24',
        'source_view_name', 'taxonomy_operationalization_queue_v2_6'
      )
    where id = v_refresh_run_id;
  exception
    when others then
      v_error_count := greatest(v_error_count, 1);
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object(
          'code', 'refresh_failed',
          'message', sqlerrm,
          'sqlstate', sqlstate
        )
      );

      update public.taxonomy_queue_refresh_runs_v1
      set
        status = 'failed',
        completed_at = statement_timestamp(),
        affected_count = 0,
        source_queue_model_version = v_source_queue_model_version,
        source_view_name = 'taxonomy_operationalization_queue_v2_6',
        warning_count = v_warning_count,
        error_count = v_error_count,
        warnings = v_warnings,
        errors = v_errors,
        metadata = metadata || jsonb_build_object(
          'expected_count', v_expected_count,
          'staged_count', v_staged_count,
          'final_status', 'failed',
          'queue_model_version', 'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24',
          'source_view_name', 'taxonomy_operationalization_queue_v2_6'
        )
      where id = v_refresh_run_id;

      return jsonb_build_object(
        'refresh_run_id', v_refresh_run_id,
        'status', 'failed',
        'refresh_scope', v_refresh_scope,
        'affected_count', 0,
        'source_queue_model_version', v_source_queue_model_version,
        'warnings', v_warnings,
        'errors', v_errors
      );
  end;

  return jsonb_build_object(
    'refresh_run_id', v_refresh_run_id,
    'status', case
      when v_warning_count > 0 then 'completed_with_warnings'
      else 'completed'
    end,
    'refresh_scope', v_refresh_scope,
    'affected_count', v_affected_count,
    'source_queue_model_version', v_source_queue_model_version,
    'warnings', v_warnings,
    'errors', v_errors
  );
end;
$function$;

comment on function public.refresh_taxonomy_operationalization_queue_current_v1(text, text, text, uuid[]) is
  'Refreshes the fast taxonomy operationalization queue snapshot from Queue v2.6, preserving hard blockers, official pyramid routing, and official notes-only review routing while recording a rebuild audit row.';

commit;
