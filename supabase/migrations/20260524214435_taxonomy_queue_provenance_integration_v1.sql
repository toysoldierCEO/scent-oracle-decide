begin;

create or replace view public.taxonomy_provenance_queue_evidence_v1
with (security_invoker = true)
as
select
  q.fragrance_id,
  q.name,
  q.brand,
  q.family_key,
  q.legacy_family_key,
  q.universal_family_key,
  q.evidence_quality_state,
  q.queue_state as v2_3_queue_state,
  q.queue_lane as v2_3_queue_lane,
  q.blocker_reason as v2_3_blocker_reason,
  q.recommended_next_action as v2_3_recommended_next_action,
  q.product_priority_score as v2_3_product_priority_score,
  q.product_priority_reason as v2_3_product_priority_reason,
  q.taxonomy_missing_summary as v2_3_taxonomy_missing_summary,
  q.evidence_summary as v2_3_evidence_summary,
  q.resolver_evidence_summary as v2_3_resolver_evidence_summary,
  q.canonical_identity_evidence_summary as v2_3_canonical_identity_evidence_summary,
  q.canonical_identity_decision_summary as v2_3_canonical_identity_decision_summary,
  q.alias_policy_summary as v2_3_alias_policy_summary,
  q.queue_model_version as v2_3_queue_model_version,
  q.generated_at as v2_3_generated_at,
  pr.latest_review_id is not null as has_provenance_review,
  pr.latest_review_id as provenance_review_id,
  pr.review_status as provenance_review_status,
  pr.provenance_category,
  pr.review_reason as provenance_review_reason,
  pr.recommended_next_action as provenance_recommended_next_action,
  pr.actor_label as provenance_actor_label,
  pr.created_at as provenance_created_at,
  pr.updated_at as provenance_updated_at,
  jsonb_strip_nulls(jsonb_build_object(
    'has_provenance_review', pr.latest_review_id is not null,
    'provenance_review_id', pr.latest_review_id,
    'provenance_review_status', pr.review_status,
    'provenance_category', pr.provenance_category,
    'provenance_review_reason', pr.review_reason,
    'provenance_recommended_next_action', pr.recommended_next_action,
    'provenance_actor_label', pr.actor_label,
    'provenance_created_at', pr.created_at,
    'provenance_updated_at', pr.updated_at,
    'provenance_refresh_run_id', pr.refresh_run_id,
    'provenance_source_queue_model_version', pr.source_queue_model_version,
    'has_source_snapshot', pr.source_snapshot is not null,
    'has_performance_snapshot', pr.performance_snapshot is not null,
    'has_taxonomy_snapshot', pr.taxonomy_snapshot is not null,
    'has_reference_gap_summary', pr.reference_gap_summary is not null
  )) as provenance_evidence_summary,
  pr.source_snapshot as provenance_source_snapshot,
  pr.performance_snapshot as provenance_performance_snapshot,
  pr.taxonomy_snapshot as provenance_taxonomy_snapshot,
  pr.reference_gap_summary,
  pr.refresh_run_id as provenance_refresh_run_id,
  pr.source_queue_model_version as provenance_source_queue_model_version
from public.taxonomy_operationalization_queue_v2_3 q
left join public.fragrance_provenance_review_latest_v1 pr
  on pr.fragrance_id = q.fragrance_id;

comment on view public.taxonomy_provenance_queue_evidence_v1 is
  'Provenance-aware queue evidence read model. It preserves Queue v2.3 routing evidence and adds latest provenance review memory only; provenance fields are operational routing inputs, not source truth, taxonomy truth, classifier output, or frontend payload.';

create or replace view public.taxonomy_operationalization_queue_v2_4
with (security_invoker = true)
as
with classified as (
  select
    e.*,
    case
      when e.v2_3_queue_state in (
        'blocked_rejected_match',
        'contaminated_data',
        'canonical_alias_policy_blocked',
        'resolver_identity_conflict',
        'provider_duplicate_reuse',
        'canonical_selection_deferred',
        'already_complete'
      ) then e.v2_3_queue_state
      when e.provenance_review_status = 'ready_for_classifier' then 'provenance_ready_for_classifier'
      when e.provenance_review_status = 'provenance_accepted' then 'provenance_accepted_pending_classifier_review'
      when e.provenance_review_status = 'payload_inconsistent' then 'provenance_payload_inconsistent'
      when e.provenance_review_status = 'identity_review_needed' then 'provenance_identity_review_needed'
      when e.provenance_review_status = 'needs_source_backfill' then 'provenance_needs_source_backfill'
      when e.provenance_review_status = 'reference_gap' then 'provenance_reference_gap'
      when e.provenance_review_status = 'needs_review' then 'provenance_review_pending'
      when e.provenance_review_status = 'rejected' then 'provenance_rejected'
      else e.v2_3_queue_state
    end as queue_state_v2_4
  from public.taxonomy_provenance_queue_evidence_v1 e
)
select
  c.fragrance_id,
  c.name,
  c.brand,
  c.family_key,
  c.legacy_family_key,
  c.universal_family_key,
  c.evidence_quality_state,
  c.queue_state_v2_4 as queue_state,
  case
    when c.queue_state_v2_4 in (
      'provenance_ready_for_classifier',
      'provenance_accepted_pending_classifier_review',
      'provenance_payload_inconsistent',
      'provenance_identity_review_needed',
      'provenance_needs_source_backfill',
      'provenance_reference_gap',
      'provenance_review_pending',
      'provenance_rejected'
    ) then nullif(concat_ws(
      ';',
      case
        when c.provenance_review_status is not null
          then 'provenance_review_status=' || c.provenance_review_status
      end,
      case
        when c.provenance_category is not null
          then 'provenance_category=' || c.provenance_category
      end,
      case
        when c.provenance_review_id is not null
          then 'provenance_review_id=' || c.provenance_review_id::text
      end
    ), '')
    else c.v2_3_blocker_reason
  end as blocker_reason,
  case
    when c.queue_state_v2_4 = 'provenance_ready_for_classifier' then coalesce(
      c.provenance_recommended_next_action,
      'ready_for_controlled_classifier_review'
    )
    when c.queue_state_v2_4 = 'provenance_accepted_pending_classifier_review' then coalesce(
      c.provenance_recommended_next_action,
      'controlled_classifier_review_candidate'
    )
    when c.queue_state_v2_4 = 'provenance_payload_inconsistent' then coalesce(
      c.provenance_recommended_next_action,
      'manual_payload_consistency_review'
    )
    when c.queue_state_v2_4 = 'provenance_identity_review_needed' then coalesce(
      c.provenance_recommended_next_action,
      'manual_identity_variant_review'
    )
    when c.queue_state_v2_4 = 'provenance_needs_source_backfill' then coalesce(
      c.provenance_recommended_next_action,
      'manual_source_backfill_review'
    )
    when c.queue_state_v2_4 = 'provenance_reference_gap' then coalesce(
      c.provenance_recommended_next_action,
      'manual_reference_gap_review'
    )
    when c.queue_state_v2_4 = 'provenance_review_pending' then coalesce(
      c.provenance_recommended_next_action,
      'manual_provenance_review_required'
    )
    when c.queue_state_v2_4 = 'provenance_rejected' then coalesce(
      c.provenance_recommended_next_action,
      'manual_provenance_reassessment_required'
    )
    else c.v2_3_recommended_next_action
  end as recommended_next_action,
  case
    when c.queue_state_v2_4 in (
      'provenance_ready_for_classifier',
      'provenance_accepted_pending_classifier_review'
    ) then 'controlled_classifier_review'
    when c.queue_state_v2_4 = 'provenance_payload_inconsistent' then 'manual_payload_review'
    when c.queue_state_v2_4 = 'provenance_identity_review_needed' then 'identity_review'
    when c.queue_state_v2_4 = 'provenance_needs_source_backfill' then 'source_backfill_review'
    when c.queue_state_v2_4 = 'provenance_reference_gap' then 'reference_gap_review'
    when c.queue_state_v2_4 in ('provenance_review_pending', 'provenance_rejected') then 'provenance_review'
    else c.v2_3_queue_lane
  end as queue_lane,
  coalesce(c.v2_3_product_priority_score, 0)::integer as product_priority_score,
  nullif(concat_ws(
    ', ',
    c.v2_3_product_priority_reason,
    case
      when c.queue_state_v2_4 in (
        'provenance_ready_for_classifier',
        'provenance_accepted_pending_classifier_review',
        'provenance_payload_inconsistent',
        'provenance_identity_review_needed',
        'provenance_needs_source_backfill',
        'provenance_reference_gap',
        'provenance_review_pending',
        'provenance_rejected'
      ) then 'provenance_review_status=' || c.provenance_review_status
    end
  ), '') as product_priority_reason,
  c.v2_3_taxonomy_missing_summary as taxonomy_missing_summary,
  jsonb_strip_nulls(
    coalesce(c.v2_3_evidence_summary, '{}'::jsonb)
    || jsonb_build_object(
      'provenance',
      coalesce(
        c.provenance_evidence_summary,
        jsonb_build_object('has_provenance_review', false)
      )
    )
  ) as evidence_summary,
  c.v2_3_resolver_evidence_summary as resolver_evidence_summary,
  c.v2_3_canonical_identity_evidence_summary as canonical_identity_evidence_summary,
  c.v2_3_canonical_identity_decision_summary as canonical_identity_decision_summary,
  c.v2_3_alias_policy_summary as alias_policy_summary,
  'taxonomy_operationalization_queue_v2_4_provenance_2026_05_24'::text as queue_model_version,
  statement_timestamp() as generated_at
from classified c;

comment on view public.taxonomy_operationalization_queue_v2_4 is
  'Provenance-aware operational queue. It preserves Queue v2.3 hard blockers first, then routes explicit provenance review decisions into controlled classifier review or manual provenance follow-up lanes without mutating public.fragrances, creating classifier proposals, writing taxonomy, promoting evidence, or changing frontend payload behavior.';

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
    'taxonomy_operationalization_queue_v2_4',
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
      'taxonomy_operationalization_queue_v2_4'::text as source_view_name,
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
        )
      ) as source_snapshot_summary,
      v_refresh_run_id as refresh_run_id,
      v_refreshed_at as refreshed_at,
      v_refreshed_at as created_at,
      v_refreshed_at as updated_at
    from public.taxonomy_operationalization_queue_v2_4 q;

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
          'message', 'Queue v2.4 returned more than one source queue model version during refresh.'
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
      source_view_name = 'taxonomy_operationalization_queue_v2_4',
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
        'source_view_name', 'taxonomy_operationalization_queue_v2_4'
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
        source_view_name = 'taxonomy_operationalization_queue_v2_4',
        warning_count = v_warning_count,
        error_count = v_error_count,
        warnings = v_warnings,
        errors = v_errors,
        metadata = metadata || jsonb_build_object(
          'expected_count', v_expected_count,
          'staged_count', v_staged_count,
          'final_status', 'failed',
          'queue_model_version', 'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24',
          'source_view_name', 'taxonomy_operationalization_queue_v2_4'
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
  'Rebuilds the fast current queue snapshot from taxonomy_operationalization_queue_v2_4. It preserves Hybrid Queue Snapshot v1 audit behavior while including provenance routing details in snapshot JSON summaries only; it does not mutate public.fragrances, write taxonomy, or create classifier proposals.';

revoke all on public.taxonomy_provenance_queue_evidence_v1 from public, anon, authenticated;
revoke all on public.taxonomy_operationalization_queue_v2_4 from public, anon, authenticated;

grant select on public.taxonomy_provenance_queue_evidence_v1 to service_role;
grant select on public.taxonomy_operationalization_queue_v2_4 to service_role;

commit;
