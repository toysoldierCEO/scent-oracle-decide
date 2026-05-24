begin;

create or replace function public.decide_fragrance_provenance_reviews_v1(
  p_decisions jsonb,
  p_actor_label text default 'codex_provenance_review_decisions_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_provenance_review_decisions_v1');
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_would_decide_count integer := 0;
  v_decided_count integer := 0;
  v_skipped_count integer := 0;
  v_rejected_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_decision record;
  v_new_review_id uuid;
  v_result_status text;
  v_blocker_reason text;
begin
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'array' then
    raise exception 'decide_fragrance_provenance_reviews_v1 requires a non-empty jsonb array of explicit decisions';
  end if;

  v_requested_count := jsonb_array_length(p_decisions);

  if v_requested_count = 0 then
    raise exception 'decide_fragrance_provenance_reviews_v1 requires a non-empty jsonb array of explicit decisions';
  end if;

  if v_requested_count > 25 then
    raise exception 'decide_fragrance_provenance_reviews_v1 accepts at most 25 explicit decisions per call';
  end if;

  for v_decision in
    with raw_decisions as (
      select
        ordinality as decision_ordinal,
        value as decision_payload
      from jsonb_array_elements(p_decisions) with ordinality
    ),
    parsed_decisions as (
      select
        r.decision_ordinal,
        r.decision_payload,
        nullif(btrim(r.decision_payload ->> 'fragrance_id'), '') as fragrance_id_text,
        case
          when nullif(btrim(r.decision_payload ->> 'fragrance_id'), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (r.decision_payload ->> 'fragrance_id')::uuid
          else null
        end as fragrance_id,
        nullif(btrim(r.decision_payload ->> 'review_status'), '') as requested_review_status,
        nullif(btrim(r.decision_payload ->> 'provenance_category'), '') as requested_provenance_category,
        nullif(btrim(r.decision_payload ->> 'decision_reason'), '') as decision_reason,
        nullif(btrim(r.decision_payload ->> 'recommended_next_action'), '') as requested_next_action
      from raw_decisions r
    ),
    duplicate_decisions as (
      select
        fragrance_id_text,
        count(*)::int as duplicate_count
      from parsed_decisions
      where fragrance_id_text is not null
      group by fragrance_id_text
    )
    select
      p.decision_ordinal,
      p.decision_payload,
      p.fragrance_id_text,
      p.fragrance_id,
      p.requested_review_status,
      p.requested_provenance_category,
      p.decision_reason,
      p.requested_next_action,
      coalesce(d.duplicate_count, 0) as duplicate_count,
      current_review.id as current_review_id,
      current_review.review_status as current_review_status,
      current_review.provenance_category as current_provenance_category,
      current_review.review_reason as current_review_reason,
      current_review.recommended_next_action as current_recommended_next_action,
      current_review.queue_state as current_queue_state,
      current_review.queue_lane as current_queue_lane,
      current_review.blocker_reason as current_blocker_reason,
      current_review.evidence_quality_state as current_evidence_quality_state,
      current_review.product_priority_score as current_product_priority_score,
      current_review.product_priority_reason as current_product_priority_reason,
      current_review.notes_count,
      current_review.accords_count,
      current_review.has_source_url,
      current_review.source_confidence,
      current_review.has_text_enrichment_row,
      current_review.has_promoted_text_evidence,
      current_review.has_revert_history,
      current_review.performance_signal_count,
      current_review.performance_source_count,
      current_review.beast_mode_band,
      current_review.recommended_spray_caution,
      current_review.facet_count,
      current_review.role_count,
      current_review.has_taxonomy_review,
      current_review.has_taxonomy_proposal,
      current_review.refresh_run_id,
      current_review.source_queue_model_version,
      current_review.evidence_snapshot,
      current_review.queue_snapshot,
      current_review.source_snapshot,
      current_review.performance_snapshot,
      current_review.taxonomy_snapshot,
      current_review.reference_gap_summary,
      f.name,
      f.brand,
      f.family_key,
      coalesce(q.queue_state, current_review.queue_state) as live_queue_state,
      coalesce(q.queue_lane, current_review.queue_lane) as live_queue_lane,
      q.blocker_reason as live_blocker_reason,
      q.alias_policy_summary,
      q.canonical_identity_decision_summary,
      q.resolver_evidence_summary,
      exists (
        select 1
        from public.family_key_reference_v1 fk
        where fk.family_key = f.family_key
          and fk.active
      ) as family_key_active,
      coalesce(
        (
          select count(*)::int
          from public.fragrances f2
          where lower(f2.name) = lower(f.name)
            and f2.id <> f.id
            and lower(coalesce(f2.brand, '')) <> lower(coalesce(f.brand, ''))
        ),
        0
      ) as brand_variant_name_count
    from parsed_decisions p
    left join duplicate_decisions d
      on d.fragrance_id_text = p.fragrance_id_text
    left join public.fragrance_provenance_review_latest_v1 latest
      on latest.fragrance_id = p.fragrance_id
    left join public.fragrance_provenance_reviews_v1 current_review
      on current_review.id = latest.latest_review_id
    left join public.fragrances f
      on f.id = p.fragrance_id
    left join public.taxonomy_operationalization_queue_current_v1 q
      on q.fragrance_id = p.fragrance_id
    order by p.decision_ordinal
  loop
    v_new_review_id := null;
    v_result_status := null;
    v_blocker_reason := null;

    if v_decision.current_review_id is not null then
      v_picked_count := v_picked_count + 1;
    end if;

    if v_decision.fragrance_id_text is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_fragrance_id';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.fragrance_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'invalid_fragrance_id';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.duplicate_count > 1 then
      v_result_status := 'rejected';
      v_blocker_reason := 'duplicate_decision_for_fragrance_id';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.current_review_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'active_latest_review_not_found';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.current_review_status <> 'needs_review' then
      v_result_status := 'skipped';
      v_blocker_reason := 'review_status_not_needs_review';
      v_skipped_count := v_skipped_count + 1;
    elseif v_decision.requested_review_status is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_requested_review_status';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status not in (
      'provenance_accepted',
      'needs_source_backfill',
      'payload_inconsistent',
      'identity_review_needed',
      'reference_gap',
      'ready_for_classifier',
      'rejected'
    ) then
      v_result_status := 'rejected';
      v_blocker_reason := 'invalid_requested_review_status';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_provenance_category is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_requested_provenance_category';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_provenance_category not in (
      'structured_but_untrusted',
      'missing_source_provenance',
      'partial_canonical_but_untrusted',
      'payload_inconsistent',
      'identity_risk',
      'reference_gap',
      'truly_insufficient',
      'unknown'
    ) then
      v_result_status := 'rejected';
      v_blocker_reason := 'invalid_requested_provenance_category';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.decision_reason is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_decision_reason';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_next_action is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_recommended_next_action';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.live_queue_state is null or v_decision.live_queue_lane is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_current_queue_row';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.live_queue_state in (
      'already_complete',
      'blocked_rejected_match',
      'resolver_identity_conflict',
      'provider_duplicate_reuse',
      'canonical_alias_policy_blocked',
      'canonical_selection_deferred',
      'canonical_selection_needed',
      'unknown'
    ) then
      v_result_status := 'rejected';
      v_blocker_reason := 'live_queue_state_blocked';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.live_queue_lane in (
      'complete_no_action',
      'canonical_alias_policy',
      'product_critical_blocker',
      'resolver_conflict_review',
      'canonical_identity_resolved',
      'unknown'
    ) then
      v_result_status := 'rejected';
      v_blocker_reason := 'live_queue_lane_blocked';
      v_rejected_count := v_rejected_count + 1;
    elseif coalesce((v_decision.alias_policy_summary ->> 'is_alias_row')::boolean, false)
      or coalesce((v_decision.alias_policy_summary ->> 'has_active_alias_mapping')::boolean, false) then
      v_result_status := 'rejected';
      v_blocker_reason := 'alias_policy_blocked';
      v_rejected_count := v_rejected_count + 1;
    elseif coalesce((v_decision.resolver_evidence_summary ->> 'has_resolver_attempt')::boolean, false)
      and v_decision.live_queue_lane = 'resolver_conflict_review' then
      v_result_status := 'rejected';
      v_blocker_reason := 'resolver_conflict_review';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status = 'payload_inconsistent'
      and v_decision.requested_provenance_category <> 'payload_inconsistent' then
      v_result_status := 'rejected';
      v_blocker_reason := 'payload_inconsistent_requires_matching_category';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status = 'identity_review_needed'
      and v_decision.requested_provenance_category <> 'identity_risk' then
      v_result_status := 'rejected';
      v_blocker_reason := 'identity_review_needed_requires_identity_risk_category';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status = 'reference_gap'
      and v_decision.requested_provenance_category <> 'reference_gap' then
      v_result_status := 'rejected';
      v_blocker_reason := 'reference_gap_requires_matching_category';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status in ('provenance_accepted', 'ready_for_classifier')
      and coalesce(v_decision.notes_count, 0) <= 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'insufficient_notes_for_acceptance';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status in ('provenance_accepted', 'ready_for_classifier')
      and coalesce(v_decision.accords_count, 0) <= 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'insufficient_accords_for_acceptance';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status in ('provenance_accepted', 'ready_for_classifier')
      and not coalesce(v_decision.family_key_active, false) then
      v_result_status := 'rejected';
      v_blocker_reason := 'inactive_family_key';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status in ('provenance_accepted', 'ready_for_classifier')
      and coalesce(v_decision.performance_signal_count, 0) <= 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_performance_signal_support';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status in ('provenance_accepted', 'ready_for_classifier')
      and v_decision.current_provenance_category = 'payload_inconsistent' then
      v_result_status := 'rejected';
      v_blocker_reason := 'payload_inconsistent_current_review';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status in ('provenance_accepted', 'ready_for_classifier')
      and v_decision.requested_provenance_category not in (
        'structured_but_untrusted',
        'partial_canonical_but_untrusted'
      ) then
      v_result_status := 'rejected';
      v_blocker_reason := 'provenance_accepted_requires_structured_category';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status in ('provenance_accepted', 'ready_for_classifier')
      and coalesce(v_decision.brand_variant_name_count, 0) > 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'possible_identity_variant_conflict';
      v_rejected_count := v_rejected_count + 1;
    elseif v_decision.requested_review_status = 'ready_for_classifier'
      and (
        not v_decision.has_source_url
        and not v_decision.has_promoted_text_evidence
        and coalesce(v_decision.source_confidence, 0) = 0
      ) then
      v_result_status := 'rejected';
      v_blocker_reason := 'ready_for_classifier_requires_stricter_provenance_support';
      v_rejected_count := v_rejected_count + 1;
    else
      if p_dry_run then
        v_would_decide_count := v_would_decide_count + 1;
        v_result_status := 'would_decide';
      else
        update public.fragrance_provenance_reviews_v1
        set
          review_status = 'superseded',
          superseded_at = statement_timestamp()
        where id = v_decision.current_review_id
          and superseded_at is null
          and review_status <> 'superseded';

        insert into public.fragrance_provenance_reviews_v1 (
          fragrance_id,
          review_status,
          provenance_category,
          actor_label,
          review_reason,
          recommended_next_action,
          queue_state,
          queue_lane,
          blocker_reason,
          evidence_quality_state,
          product_priority_score,
          product_priority_reason,
          notes_count,
          accords_count,
          has_source_url,
          source_confidence,
          has_text_enrichment_row,
          has_promoted_text_evidence,
          has_revert_history,
          performance_signal_count,
          performance_source_count,
          beast_mode_band,
          recommended_spray_caution,
          facet_count,
          role_count,
          has_taxonomy_review,
          has_taxonomy_proposal,
          refresh_run_id,
          source_queue_model_version,
          evidence_snapshot,
          queue_snapshot,
          source_snapshot,
          performance_snapshot,
          taxonomy_snapshot,
          reference_gap_summary,
          supersedes_review_id
        )
        values (
          v_decision.fragrance_id,
          v_decision.requested_review_status,
          v_decision.requested_provenance_category,
          v_actor_label,
          v_decision.decision_reason,
          v_decision.requested_next_action,
          v_decision.current_queue_state,
          v_decision.current_queue_lane,
          v_decision.current_blocker_reason,
          v_decision.current_evidence_quality_state,
          v_decision.current_product_priority_score,
          v_decision.current_product_priority_reason,
          v_decision.notes_count,
          v_decision.accords_count,
          v_decision.has_source_url,
          v_decision.source_confidence,
          v_decision.has_text_enrichment_row,
          v_decision.has_promoted_text_evidence,
          v_decision.has_revert_history,
          v_decision.performance_signal_count,
          v_decision.performance_source_count,
          v_decision.beast_mode_band,
          v_decision.recommended_spray_caution,
          v_decision.facet_count,
          v_decision.role_count,
          v_decision.has_taxonomy_review,
          v_decision.has_taxonomy_proposal,
          v_decision.refresh_run_id,
          v_decision.source_queue_model_version,
          v_decision.evidence_snapshot,
          v_decision.queue_snapshot,
          v_decision.source_snapshot,
          v_decision.performance_snapshot,
          v_decision.taxonomy_snapshot,
          v_decision.reference_gap_summary,
          v_decision.current_review_id
        )
        returning id into v_new_review_id;

        v_decided_count := v_decided_count + 1;
        v_result_status := 'decided';
      end if;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_strip_nulls(
        jsonb_build_object(
          'fragrance_id', coalesce(v_decision.fragrance_id, null),
          'name', v_decision.name,
          'brand', v_decision.brand,
          'old_review_id', v_decision.current_review_id,
          'new_review_id', v_new_review_id,
          'old_review_status', v_decision.current_review_status,
          'old_provenance_category', v_decision.current_provenance_category,
          'new_review_status', case
            when v_result_status in ('would_decide', 'decided') then v_decision.requested_review_status
            else null
          end,
          'new_provenance_category', case
            when v_result_status in ('would_decide', 'decided') then v_decision.requested_provenance_category
            else null
          end,
          'decision_reason', v_decision.decision_reason,
          'recommended_next_action', v_decision.requested_next_action,
          'result_status', v_result_status,
          'blocker_reason', v_blocker_reason,
          'family_key', v_decision.family_key,
          'family_key_active', v_decision.family_key_active,
          'brand_variant_name_count', v_decision.brand_variant_name_count
        )
      )
    );
  end loop;

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'would_decide_count', v_would_decide_count,
    'decided_count', v_decided_count,
    'skipped_count', v_skipped_count,
    'rejected_count', v_rejected_count,
    'dry_run', p_dry_run,
    'actor_label', v_actor_label,
    'results', v_results
  );
end;
$function$;

comment on function public.decide_fragrance_provenance_reviews_v1(jsonb, text, boolean) is
  'Creates or previews explicit provenance-review decisions for selected fragrance ids only. It supersedes active needs_review records and inserts decision memory into fragrance_provenance_reviews_v1 without mutating public.fragrances, writing taxonomy, creating classifier proposals, staging/promoting enrichment, refreshing performance, or refreshing the queue.';

revoke all on function public.decide_fragrance_provenance_reviews_v1(jsonb, text, boolean)
  from public, anon, authenticated;
grant execute on function public.decide_fragrance_provenance_reviews_v1(jsonb, text, boolean)
  to service_role;

commit;
