begin;

create or replace view public.taxonomy_resolver_attempt_latest_v1
with (security_invoker = true)
as
select
  ranked.fragrance_id,
  ranked.id as latest_resolver_attempt_id,
  ranked.run_id as latest_resolver_run_id,
  ranked.created_at as latest_resolver_created_at,
  ranked.resolver_outcome,
  ranked.identity_match_status,
  ranked.identity_conflict_reason,
  ranked.selected_candidate_name,
  ranked.selected_candidate_brand,
  ranked.selected_source_url,
  ranked.selected_provider_key,
  ranked.meaningful_target_tokens,
  ranked.candidate_tokens,
  ranked.slug_tokens,
  ranked.matched_meaningful_tokens,
  ranked.missing_meaningful_tokens,
  ranked.duplicate_provider_key,
  ranked.duplicate_provider_reuse,
  ranked.duplicate_provider_affected_ids,
  ranked.source_confidence,
  ranked.provider_confidence_label,
  ranked.proposed_notes_count,
  ranked.proposed_accords_count,
  ranked.stage_review_allowed,
  ranked.stage_review_reason,
  ranked.would_stage_review,
  ranked.will_write,
  ranked.resolver_diagnostics,
  ranked.resolver_model_version,
  ranked.function_version
from (
  select
    a.*,
    row_number() over (
      partition by a.fragrance_id
      order by a.created_at desc nulls last, a.id desc
    ) as rn
  from public.fragrance_source_resolver_attempts_v1 a
) ranked
where ranked.rn = 1;

comment on view public.taxonomy_resolver_attempt_latest_v1 is
  'Latest resolver-attempt diagnostics per fragrance. Operational routing evidence only: not canonical source truth, not enrichment staging, not taxonomy, and not a frontend product payload.';

create or replace view public.taxonomy_evidence_status_v2
with (security_invoker = true)
as
select
  e.fragrance_id,
  e.name,
  e.brand,
  e.family_key,
  e.legacy_family_key,
  e.universal_family_key,
  e.created_at,
  e.updated_at,
  e.notes_count,
  e.accords_count,
  e.top_notes_count,
  e.heart_notes_count,
  e.base_notes_count,
  e.has_any_note_evidence,
  e.has_any_accord_evidence,
  e.has_structured_scent_evidence,
  e.has_text_enrichment_row,
  e.enrichment_status,
  e.enrichment_match_name,
  e.enrichment_match_brand,
  e.source_url,
  e.has_source_url,
  e.source_confidence,
  e.has_rejected_match,
  e.latest_reject_reason,
  e.has_promoted_text_evidence,
  e.has_notes_only_promotion,
  e.has_revert_history,
  e.performance_signal_count,
  e.performance_source_count,
  e.beast_mode_band,
  e.recommended_spray_caution,
  e.has_performance_features,
  e.has_family_assignment,
  e.has_universal_family,
  e.facet_count,
  e.role_count,
  e.has_taxonomy_review,
  e.taxonomy_review_status,
  e.taxonomy_confidence,
  e.resolved_taxonomy_available,
  e.is_owned_by_any_user,
  e.is_owned_by_target_user,
  e.is_signature_or_high_value,
  e.wear_event_count,
  e.wear_trial_count,
  e.decision_event_count,
  e.has_missing_core_evidence,
  e.has_contamination_risk,
  e.has_identity_conflict_risk,
  e.evidence_quality_state,
  e.evidence_blocker_reason,
  e.evidence_summary,
  (r.fragrance_id is not null) as has_resolver_attempt,
  r.latest_resolver_attempt_id,
  r.latest_resolver_run_id,
  r.latest_resolver_created_at,
  r.resolver_outcome as latest_resolver_outcome,
  r.identity_match_status as latest_identity_match_status,
  r.identity_conflict_reason as latest_identity_conflict_reason,
  (
    r.fragrance_id is not null
    and (
      r.identity_match_status = 'conflict'
      or r.resolver_outcome in ('identity_conflict', 'source_url_conflict', 'rejected_candidate', 'duplicate_provider_reuse')
    )
  ) as has_resolver_identity_conflict,
  coalesce(r.duplicate_provider_reuse, false) as has_duplicate_provider_reuse,
  r.missing_meaningful_tokens as latest_missing_meaningful_tokens,
  r.meaningful_target_tokens as latest_meaningful_target_tokens,
  r.candidate_tokens as latest_candidate_tokens,
  r.slug_tokens as latest_slug_tokens,
  r.matched_meaningful_tokens as latest_matched_meaningful_tokens,
  r.selected_candidate_name as latest_selected_candidate_name,
  r.selected_candidate_brand as latest_selected_candidate_brand,
  r.selected_source_url as latest_selected_source_url,
  r.selected_provider_key as latest_selected_provider_key,
  r.duplicate_provider_key as latest_duplicate_provider_key,
  r.duplicate_provider_affected_ids as latest_duplicate_provider_affected_ids,
  r.stage_review_allowed as latest_stage_review_allowed,
  r.stage_review_reason as latest_stage_review_reason,
  r.source_confidence as latest_source_confidence,
  r.provider_confidence_label as latest_provider_confidence_label,
  r.proposed_notes_count as latest_proposed_notes_count,
  r.proposed_accords_count as latest_proposed_accords_count,
  case
    when r.fragrance_id is null then null::text
    when coalesce(r.duplicate_provider_reuse, false) then 'duplicate_provider_product_reuse_in_request'::text
    when r.identity_conflict_reason is not null then r.identity_conflict_reason
    when jsonb_array_length(coalesce(r.missing_meaningful_tokens, '[]'::jsonb)) > 0 then 'missing_meaningful_target_tokens'::text
    when r.stage_review_allowed = false then coalesce(r.stage_review_reason, 'stage_review_blocked'::text)
    when r.resolver_outcome in ('no_match', 'manual_review_needed') then r.resolver_outcome
    else null::text
  end as resolver_blocker_reason,
  jsonb_strip_nulls(jsonb_build_object(
    'has_resolver_attempt', r.fragrance_id is not null,
    'latest_resolver_attempt_id', r.latest_resolver_attempt_id,
    'latest_resolver_run_id', r.latest_resolver_run_id,
    'latest_resolver_created_at', r.latest_resolver_created_at,
    'resolver_outcome', r.resolver_outcome,
    'identity_match_status', r.identity_match_status,
    'identity_conflict_reason', r.identity_conflict_reason,
    'selected_candidate_name', r.selected_candidate_name,
    'selected_candidate_brand', r.selected_candidate_brand,
    'selected_source_url', r.selected_source_url,
    'selected_provider_key', r.selected_provider_key,
    'meaningful_target_tokens', r.meaningful_target_tokens,
    'candidate_tokens', r.candidate_tokens,
    'slug_tokens', r.slug_tokens,
    'matched_meaningful_tokens', r.matched_meaningful_tokens,
    'missing_meaningful_tokens', r.missing_meaningful_tokens,
    'duplicate_provider_key', r.duplicate_provider_key,
    'duplicate_provider_reuse', r.duplicate_provider_reuse,
    'duplicate_provider_affected_ids', r.duplicate_provider_affected_ids,
    'source_confidence', r.source_confidence,
    'provider_confidence_label', r.provider_confidence_label,
    'proposed_notes_count', r.proposed_notes_count,
    'proposed_accords_count', r.proposed_accords_count,
    'stage_review_allowed', r.stage_review_allowed,
    'stage_review_reason', r.stage_review_reason,
    'would_stage_review', r.would_stage_review,
    'will_write', r.will_write,
    'resolver_blocker_reason',
      case
        when r.fragrance_id is null then null::text
        when coalesce(r.duplicate_provider_reuse, false) then 'duplicate_provider_product_reuse_in_request'::text
        when r.identity_conflict_reason is not null then r.identity_conflict_reason
        when jsonb_array_length(coalesce(r.missing_meaningful_tokens, '[]'::jsonb)) > 0 then 'missing_meaningful_target_tokens'::text
        when r.stage_review_allowed = false then coalesce(r.stage_review_reason, 'stage_review_blocked'::text)
        when r.resolver_outcome in ('no_match', 'manual_review_needed') then r.resolver_outcome
        else null::text
      end,
    'resolver_diagnostics', r.resolver_diagnostics,
    'resolver_model_version', r.resolver_model_version,
    'function_version', r.function_version
  )) as resolver_evidence_summary,
  'taxonomy_evidence_status_v2_resolver_aware_2026_05_24'::text as evidence_model_version,
  statement_timestamp() as generated_at
from public.taxonomy_evidence_status_v1 e
left join public.taxonomy_resolver_attempt_latest_v1 r
  on r.fragrance_id = e.fragrance_id;

comment on view public.taxonomy_evidence_status_v2 is
  'Resolver-aware evidence read model. It preserves taxonomy_evidence_status_v1 evidence and adds latest resolver-attempt diagnostics as operational blocker evidence only; resolver attempts do not create notes, accords, source truth, promoted evidence, or taxonomy.';

create or replace view public.taxonomy_operationalization_queue_v2
with (security_invoker = true)
as
with evidence as (
  select
    e.*,
    q.product_priority_score as v1_product_priority_score,
    q.product_priority_reason as v1_product_priority_reason,
    q.taxonomy_missing_summary as v1_taxonomy_missing_summary,
    q.queue_state as v1_queue_state,
    q.queue_lane as v1_queue_lane,
    q.blocker_reason as v1_blocker_reason,
    q.recommended_next_action as v1_recommended_next_action,
    nullif(array_to_string(array(
      select jsonb_array_elements_text(coalesce(e.latest_missing_meaningful_tokens, '[]'::jsonb))
    ), ', '), '') as latest_missing_tokens_text,
    (
      e.has_family_assignment
      and e.has_universal_family
      and e.facet_count > 0
      and e.role_count > 0
      and e.has_taxonomy_review
      and e.evidence_quality_state <> 'rejected_provider_match'
      and not e.has_contamination_risk
    ) as is_already_complete_v2,
    (
      e.evidence_quality_state in ('trusted_existing_evidence', 'promoted_enrichment_evidence')
      and e.has_family_assignment
      and e.has_universal_family
      and e.has_structured_scent_evidence
      and not e.has_contamination_risk
      and not (e.has_rejected_match and e.evidence_quality_state = 'rejected_provider_match')
    ) as is_ready_existing_evidence_v2,
    (
      e.evidence_quality_state in ('trusted_existing_evidence', 'promoted_enrichment_evidence')
      and not e.has_performance_features
      and (e.is_owned_by_any_user or e.wear_event_count > 0 or coalesce(e.wear_trial_count, 0) > 0)
    ) as is_wear_test_candidate_v2
  from public.taxonomy_evidence_status_v2 e
  left join public.taxonomy_operationalization_queue_v1 q
    on q.fragrance_id = e.fragrance_id
),
classified as (
  select
    e.*,
    case
      when e.has_rejected_match and e.evidence_quality_state = 'rejected_provider_match' then 'blocked_rejected_match'
      when e.has_contamination_risk then 'contaminated_data'
      when e.is_already_complete_v2 then 'already_complete'
      when e.has_duplicate_provider_reuse and e.latest_stage_review_allowed = false then 'provider_duplicate_reuse'
      when e.has_resolver_identity_conflict and e.latest_stage_review_allowed = false then 'resolver_identity_conflict'
      when e.has_resolver_attempt
        and e.latest_stage_review_allowed = false
        and coalesce(e.latest_source_confidence, 0) < 0.75
        and e.latest_resolver_outcome in ('rejected_candidate', 'source_url_conflict') then 'source_resolver_tuning_needed'
      when e.has_resolver_attempt
        and e.latest_resolver_outcome in ('no_match', 'manual_review_needed') then 'manual_source_needed'
      when e.evidence_quality_state = 'source_gap' and not e.has_resolver_attempt then 'source_gap_unattempted'
      when e.evidence_quality_state = 'source_gap' then 'source_gap'
      when e.evidence_quality_state in ('partial_canonical_evidence', 'insufficient_structured_evidence', 'low_confidence_source', 'wear_data_only') then 'insufficient_evidence'
      when e.is_ready_existing_evidence_v2 then 'ready_existing_evidence'
      when e.is_wear_test_candidate_v2 then 'needs_wear_test'
      when e.has_identity_conflict_risk then 'manual_review'
      else 'unknown'
    end as queue_state_v2
  from evidence e
)
select
  c.fragrance_id,
  c.name,
  c.brand,
  c.family_key,
  c.legacy_family_key,
  c.universal_family_key,
  c.evidence_quality_state,
  c.queue_state_v2 as queue_state,
  case c.queue_state_v2
    when 'blocked_rejected_match' then coalesce(c.latest_reject_reason, 'rejected_provider_match')
    when 'contaminated_data' then coalesce(c.evidence_blocker_reason, 'prose_contaminated_fields')
    when 'already_complete' then null::text
    when 'provider_duplicate_reuse' then nullif(concat_ws(
      ';',
      'duplicate_provider_product_reuse_in_request',
      case when c.latest_duplicate_provider_key is not null then 'provider_key=' || c.latest_duplicate_provider_key end,
      case when c.latest_missing_tokens_text is not null then 'missing_meaningful_tokens=' || c.latest_missing_tokens_text end,
      c.latest_identity_conflict_reason
    ), '')
    when 'resolver_identity_conflict' then nullif(concat_ws(
      ';',
      coalesce(c.latest_identity_conflict_reason, c.resolver_blocker_reason, 'resolver_identity_conflict'),
      case when c.latest_missing_tokens_text is not null then 'missing_meaningful_tokens=' || c.latest_missing_tokens_text end
    ), '')
    when 'source_resolver_tuning_needed' then coalesce(c.resolver_blocker_reason, 'source_resolver_tuning_needed')
    when 'manual_source_needed' then coalesce(c.resolver_blocker_reason, 'manual_source_needed')
    when 'source_gap_unattempted' then coalesce(c.evidence_blocker_reason, 'missing_notes_and_accords')
    when 'source_gap' then coalesce(c.resolver_blocker_reason, c.evidence_blocker_reason, 'missing_notes_and_accords')
    when 'insufficient_evidence' then coalesce(c.evidence_blocker_reason, 'insufficient_structured_evidence')
    when 'ready_existing_evidence' then null::text
    when 'needs_wear_test' then 'wear_data_needed'
    when 'manual_review' then coalesce(c.evidence_blocker_reason, c.resolver_blocker_reason, 'identity_conflict_risk')
    else coalesce(c.evidence_blocker_reason, c.resolver_blocker_reason, 'unknown_schema_gap')
  end as blocker_reason,
  case c.queue_state_v2
    when 'blocked_rejected_match' then 'manual_identity_repair'
    when 'contaminated_data' then 'source_repair_canonical_cleanup'
    when 'already_complete' then 'complete_no_action'
    when 'provider_duplicate_reuse' then 'review_resolver_duplicate_provider_reuse'
    when 'resolver_identity_conflict' then 'review_resolver_identity_conflict'
    when 'source_resolver_tuning_needed' then 'tune_source_resolver_or_acquire_manual_source'
    when 'manual_source_needed' then 'manual_source_acquisition'
    when 'source_gap_unattempted' then 'run_explicit_resolver_audit'
    when 'source_gap' then 'acquire_exact_source'
    when 'insufficient_evidence' then 'defer_until_structured_evidence'
    when 'ready_existing_evidence' then 'stage_classifier_proposal'
    when 'needs_wear_test' then 'collect_wear_trials'
    when 'manual_review' then 'manual_taxonomy_review'
    else 'investigate_queue_rule_gap'
  end as recommended_next_action,
  case
    when c.queue_state_v2 = 'already_complete' then 'complete_no_action'
    when c.queue_state_v2 in ('blocked_rejected_match', 'contaminated_data') and (c.is_owned_by_target_user or c.is_owned_by_any_user or c.is_signature_or_high_value) then 'product_critical_blocker'
    when c.queue_state_v2 = 'provider_duplicate_reuse' then 'resolver_conflict_review'
    when c.queue_state_v2 = 'resolver_identity_conflict' then 'resolver_conflict_review'
    when c.queue_state_v2 = 'source_resolver_tuning_needed' then 'source_resolver_tuning'
    when c.queue_state_v2 = 'manual_source_needed' then 'manual_source_repair'
    when c.queue_state_v2 in ('source_gap_unattempted', 'source_gap') then 'source_repair_candidate'
    when c.queue_state_v2 = 'ready_existing_evidence' then 'safe_classifier_candidate'
    when c.queue_state_v2 = 'needs_wear_test' then 'wear_test_needed'
    when c.queue_state_v2 = 'manual_review' then 'manual_review'
    when c.queue_state_v2 = 'unknown' then 'unknown_review'
    else 'manual_review'
  end as queue_lane,
  least(
    100,
    coalesce(c.v1_product_priority_score, 0)
    + case
        when c.queue_state_v2 in ('provider_duplicate_reuse', 'resolver_identity_conflict', 'source_resolver_tuning_needed', 'manual_source_needed') then 6
        else 0
      end
  )::integer as product_priority_score,
  nullif(concat_ws(
    ', ',
    c.v1_product_priority_reason,
    case
      when c.queue_state_v2 in ('provider_duplicate_reuse', 'resolver_identity_conflict', 'source_resolver_tuning_needed', 'manual_source_needed') then 'resolver_attempt_blocker'
    end
  ), '') as product_priority_reason,
  coalesce(
    c.v1_taxonomy_missing_summary,
    jsonb_strip_nulls(jsonb_build_object(
      'missing_family_assignment', not c.has_family_assignment,
      'missing_universal_family', not c.has_universal_family,
      'missing_facets', c.facet_count = 0,
      'missing_roles', c.role_count = 0,
      'missing_taxonomy_review', not c.has_taxonomy_review,
      'facet_count', c.facet_count,
      'role_count', c.role_count,
      'taxonomy_review_status', c.taxonomy_review_status
    ))
  ) as taxonomy_missing_summary,
  c.evidence_summary,
  c.resolver_evidence_summary,
  'taxonomy_operationalization_queue_v2_resolver_aware_2026_05_24'::text as queue_model_version,
  statement_timestamp() as generated_at
from classified c;

comment on view public.taxonomy_operationalization_queue_v2 is
  'Resolver-aware operational queue. Additive read model that does not replace Queue v1 destructively. Resolver attempts are operational blockers only and do not count as canonical source evidence, staged enrichment, taxonomy, or frontend product truth.';

revoke all on public.taxonomy_resolver_attempt_latest_v1 from public, anon, authenticated;
revoke all on public.taxonomy_evidence_status_v2 from public, anon, authenticated;
revoke all on public.taxonomy_operationalization_queue_v2 from public, anon, authenticated;

grant select on public.taxonomy_resolver_attempt_latest_v1 to service_role;
grant select on public.taxonomy_evidence_status_v2 to service_role;
grant select on public.taxonomy_operationalization_queue_v2 to service_role;

commit;
