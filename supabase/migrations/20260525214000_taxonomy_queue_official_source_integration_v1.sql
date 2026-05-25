begin;

create or replace view public.taxonomy_official_source_queue_evidence_v1
with (security_invoker = true)
as
with latest_valid_official_source_audit as (
  select distinct on (a.fragrance_id, a.source_url, a.source_type)
    a.fragrance_id,
    a.id as selected_official_source_backfill_audit_id,
    a.source_type,
    a.source_url,
    a.source_confidence as audit_source_confidence,
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
      partition by a.fragrance_id, a.source_url, a.source_type
    )::integer as duplicate_audit_count
  from public.fragrance_source_backfill_audit_v1 a
  where a.source_type = 'official_brand'
    and nullif(btrim(a.source_url), '') is not null
  order by a.fragrance_id, a.source_url, a.source_type, a.created_at desc, a.id desc
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
    coalesce(cardinality(f.notes), 0) > 0
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
  )) as official_source_evidence_summary
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
  'Official-source-aware queue evidence read model. It preserves Queue v2.4 routing evidence and adds the latest valid official_brand source-backfill audit that matches the current public.fragrances source_url plus the latest completed target performance refresh. Duplicate official-source audit rows are deduped by fragrance_id, source_url, and source_type for operational routing only; this view does not mutate public.fragrances, write taxonomy, create classifier proposals, or change frontend payload behavior.';

create or replace view public.taxonomy_operationalization_queue_v2_5
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
      else e.v2_4_queue_state
    end as queue_state_v2_5
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
  c.queue_state_v2_5 as queue_state,
  case
    when c.queue_state_v2_5 = 'official_source_pending_classifier_review' then nullif(concat_ws(
      ';',
      'official_source_backfill',
      case
        when c.official_source_type is not null
          then 'source_type=' || c.official_source_type
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
    else c.v2_4_blocker_reason
  end as blocker_reason,
  case
    when c.queue_state_v2_5 = 'official_source_pending_classifier_review' then 'controlled_classifier_review_candidate'
    else c.v2_4_recommended_next_action
  end as recommended_next_action,
  case
    when c.queue_state_v2_5 = 'official_source_pending_classifier_review' then 'controlled_classifier_review'
    else c.v2_4_queue_lane
  end as queue_lane,
  coalesce(c.v2_4_product_priority_score, 0)::integer as product_priority_score,
  nullif(concat_ws(
    ', ',
    c.v2_4_product_priority_reason,
    case
      when c.queue_state_v2_5 = 'official_source_pending_classifier_review'
        then 'official_source_backfill_verified'
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
  'taxonomy_operationalization_queue_v2_5_official_source_2026_05_25'::text as queue_model_version,
  statement_timestamp() as generated_at
from classified c;

comment on view public.taxonomy_operationalization_queue_v2_5 is
  'Official-source-aware operational queue. It preserves Queue v2.4 hard blockers and provenance routing first, then routes unblocked official-brand-source-backed rows with high source confidence, stored official note pyramid, and satisfied target performance refresh into controlled classifier review. It does not mutate public.fragrances, write taxonomy, create classifier proposals, accept proposals, refresh performance, or change frontend payload behavior.';

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
    'taxonomy_operationalization_queue_v2_5',
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
      'taxonomy_operationalization_queue_v2_5'::text as source_view_name,
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
    from public.taxonomy_operationalization_queue_v2_5 q;

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
          'message', 'Queue v2.5 returned more than one source queue model version during refresh.'
        )
      );
    end if;

    delete from public.taxonomy_operationalization_queue_current_v1;

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
      source_view_name = 'taxonomy_operationalization_queue_v2_5',
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
        'source_view_name', 'taxonomy_operationalization_queue_v2_5'
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
        source_view_name = 'taxonomy_operationalization_queue_v2_5',
        warning_count = v_warning_count,
        error_count = v_error_count,
        warnings = v_warnings,
        errors = v_errors,
        metadata = metadata || jsonb_build_object(
          'expected_count', v_expected_count,
          'staged_count', v_staged_count,
          'final_status', 'failed',
          'queue_model_version', 'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24',
          'source_view_name', 'taxonomy_operationalization_queue_v2_5'
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
  'Rebuilds the fast current queue snapshot from taxonomy_operationalization_queue_v2_5. It preserves Hybrid Queue Snapshot v1 audit behavior while including provenance and official-source routing details in snapshot JSON summaries only; it does not mutate public.fragrances, write taxonomy, create classifier proposals, or refresh performance.';

revoke all on public.taxonomy_official_source_queue_evidence_v1 from public, anon, authenticated;
revoke all on public.taxonomy_operationalization_queue_v2_5 from public, anon, authenticated;

grant select on public.taxonomy_official_source_queue_evidence_v1 to service_role;
grant select on public.taxonomy_operationalization_queue_v2_5 to service_role;

commit;
