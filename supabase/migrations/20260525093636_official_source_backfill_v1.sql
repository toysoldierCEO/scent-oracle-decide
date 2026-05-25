create table if not exists public.fragrance_source_backfill_audit_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id),
  source_type text not null,
  source_url text not null,
  source_confidence text not null,
  actor_label text not null,
  backfill_reason text,
  changed_fields text[] not null default '{}'::text[],
  accords_preserved boolean not null default true,
  performance_refresh_required boolean not null default false,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  source_verification_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (source_type in ('official_brand'))
);

create index if not exists fragrance_source_backfill_audit_v1_fragrance_id_idx
  on public.fragrance_source_backfill_audit_v1 (fragrance_id);

create index if not exists fragrance_source_backfill_audit_v1_created_at_desc_idx
  on public.fragrance_source_backfill_audit_v1 (created_at desc);

alter table public.fragrance_source_backfill_audit_v1 enable row level security;

revoke all on public.fragrance_source_backfill_audit_v1 from public;
revoke all on public.fragrance_source_backfill_audit_v1 from anon;
revoke all on public.fragrance_source_backfill_audit_v1 from authenticated;
grant select, insert, update, delete on public.fragrance_source_backfill_audit_v1 to service_role;

comment on table public.fragrance_source_backfill_audit_v1 is
  'Audit log for explicit official-source fragrance backfills. Records source-backed note and source field updates only; does not accept taxonomy, revise proposals, or refresh queue/performance.';

comment on column public.fragrance_source_backfill_audit_v1.source_payload is
  'Exact official-source payload submitted for the target row, including note pyramid and preserved-accord intent.';

create or replace function public.apply_fragrance_official_source_backfill_v1(
  p_payload jsonb,
  p_actor_label text default 'codex_official_source_backfill_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_official_source_backfill_v1');
  v_fragrance_id uuid;
  v_source_type text;
  v_source_url text;
  v_source_confidence text;
  v_expected_name text;
  v_expected_brand text;
  v_backfill_reason text;
  v_notes text[];
  v_top_notes text[];
  v_heart_notes text[];
  v_base_notes text[];
  v_source_verification_summary jsonb := coalesce(p_payload -> 'source_verification_summary', '{}'::jsonb);
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
  v_row record;
begin
  v_requested_count := 1;

  begin
    v_fragrance_id := nullif(p_payload ->> 'fragrance_id', '')::uuid;
  exception
    when others then
      raise exception 'apply_fragrance_official_source_backfill_v1 requires a valid fragrance_id';
  end;

  v_source_type := nullif(btrim(p_payload ->> 'source_type'), '');
  v_source_url := nullif(btrim(p_payload ->> 'source_url'), '');
  v_source_confidence := nullif(btrim(p_payload ->> 'source_confidence'), '');
  v_expected_name := nullif(btrim(p_payload ->> 'expected_name'), '');
  v_expected_brand := nullif(btrim(p_payload ->> 'expected_brand'), '');
  v_backfill_reason := nullif(btrim(p_payload ->> 'backfill_reason'), '');

  if v_fragrance_id is null then
    raise exception 'apply_fragrance_official_source_backfill_v1 requires a valid fragrance_id';
  end if;

  if v_source_type is distinct from 'official_brand' then
    raise exception 'apply_fragrance_official_source_backfill_v1 requires source_type=official_brand';
  end if;

  if v_source_url is null then
    raise exception 'apply_fragrance_official_source_backfill_v1 requires a non-empty source_url';
  end if;

  if v_source_confidence is null then
    raise exception 'apply_fragrance_official_source_backfill_v1 requires a non-empty source_confidence';
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

  if coalesce(array_length(v_notes, 1), 0) = 0 then
    raise exception 'apply_fragrance_official_source_backfill_v1 requires non-empty notes';
  end if;

  if coalesce(array_length(v_top_notes, 1), 0) = 0
     or coalesce(array_length(v_heart_notes, 1), 0) = 0
     or coalesce(array_length(v_base_notes, 1), 0) = 0 then
    raise exception 'apply_fragrance_official_source_backfill_v1 requires non-empty top_notes, heart_notes, and base_notes';
  end if;

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
  elsif coalesce(v_row.is_alias_row, false) then
    v_result_status := 'rejected';
    v_blocker_reason := 'alias_row_not_allowed';
    v_rejected_count := 1;
  elsif coalesce(v_row.has_rejected_match, false) then
    v_result_status := 'rejected';
    v_blocker_reason := 'rejected_match_blocked';
    v_rejected_count := 1;
  elsif coalesce(v_row.has_resolver_attempt, false)
        and v_row.queue_lane = 'resolver_conflict_review' then
    v_result_status := 'rejected';
    v_blocker_reason := 'resolver_conflict_blocked';
    v_rejected_count := 1;
  elsif v_row.queue_state in ('canonical_alias_policy_blocked', 'canonical_selection_deferred')
        or v_row.queue_lane in ('canonical_alias_policy', 'canonical_selection_needed') then
    v_result_status := 'rejected';
    v_blocker_reason := 'canonical_blocked';
    v_rejected_count := 1;
  elsif coalesce(v_row.has_final_facets, false)
        or coalesce(v_row.has_final_roles, false)
        or coalesce(v_row.has_taxonomy_review, false) then
    v_result_status := 'rejected';
    v_blocker_reason := 'existing_final_taxonomy_present';
    v_rejected_count := 1;
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
    if coalesce(v_row.top_notes, '{}'::text[]) is distinct from coalesce(v_top_notes, '{}'::text[]) then
      v_changed_fields := array_append(v_changed_fields, 'top_notes');
    end if;
    if coalesce(v_row.heart_notes, '{}'::text[]) is distinct from coalesce(v_heart_notes, '{}'::text[]) then
      v_changed_fields := array_append(v_changed_fields, 'heart_notes');
    end if;
    if coalesce(v_row.base_notes, '{}'::text[]) is distinct from coalesce(v_base_notes, '{}'::text[]) then
      v_changed_fields := array_append(v_changed_fields, 'base_notes');
    end if;

    v_performance_refresh_required := v_changed_fields && array['notes', 'top_notes', 'heart_notes', 'base_notes']::text[];

    v_after_snapshot := jsonb_build_object(
      'fragrance_id', v_row.id,
      'name', v_row.name,
      'brand', v_row.brand,
      'family_key', v_row.family_key,
      'source_url', v_source_url,
      'source_confidence', v_source_confidence,
      'notes', to_jsonb(coalesce(v_notes, '{}'::text[])),
      'accords', to_jsonb(coalesce(v_row.accords, '{}'::text[])),
      'top_notes', to_jsonb(coalesce(v_top_notes, '{}'::text[])),
      'heart_notes', to_jsonb(coalesce(v_heart_notes, '{}'::text[])),
      'base_notes', to_jsonb(coalesce(v_base_notes, '{}'::text[])),
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
        top_notes = v_top_notes,
        heart_notes = v_heart_notes,
        base_notes = v_base_notes,
        updated_at = now()
      where id = v_fragrance_id;

      insert into public.fragrance_source_backfill_audit_v1 (
        fragrance_id,
        source_type,
        source_url,
        source_confidence,
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
        v_actor_label,
        v_backfill_reason,
        coalesce(v_changed_fields, '{}'::text[]),
        true,
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
    'changed_fields', to_jsonb(coalesce(v_changed_fields, '{}'::text[])),
    'performance_refresh_required', v_performance_refresh_required,
    'before_snapshot', v_before_snapshot,
    'after_snapshot', v_after_snapshot,
    'audit_id', v_audit_id
  );
end;
$function$;

revoke all on function public.apply_fragrance_official_source_backfill_v1(jsonb, text, boolean) from public;
revoke all on function public.apply_fragrance_official_source_backfill_v1(jsonb, text, boolean) from anon;
revoke all on function public.apply_fragrance_official_source_backfill_v1(jsonb, text, boolean) from authenticated;
grant execute on function public.apply_fragrance_official_source_backfill_v1(jsonb, text, boolean) to service_role;

comment on function public.apply_fragrance_official_source_backfill_v1(jsonb, text, boolean) is
  'Applies an explicit official-brand source backfill for exactly one fragrance row, preserving accords and family_key, writing one audit row, and leaving performance and queue refresh as separate verified steps.';
