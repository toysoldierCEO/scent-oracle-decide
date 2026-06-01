begin;

create or replace function public.accept_fragrance_taxonomy_proposals_v2_provider_promoted(
  p_fragrance_ids uuid[],
  p_actor_label text default 'codex_provider_promoted_proposal_acceptance_v2',
  p_dry_run boolean default true,
  p_model_version text default 'taxonomy_classifier_proposal_v2_provider_promoted_family_calibrated_2026_06_01'
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_distinct_ids uuid[];
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_provider_promoted_proposal_acceptance_v2');
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_eligible_count integer := 0;
  v_would_accept_count integer := 0;
  v_accepted_count integer := 0;
  v_rejected_count integer := 0;
  v_skipped_count integer := 0;
  v_max_ids constant integer := 25;
  v_results jsonb := '[]'::jsonb;
  v_result_status text;
  v_blocker_reason text;
  v_missing_facet_keys text[];
  v_missing_role_keys text[];
  v_before_taxonomy_snapshot jsonb;
  v_after_taxonomy_snapshot jsonb;
  v_proposal_snapshot jsonb;
  v_final_facets_written jsonb;
  v_final_roles_written jsonb;
  v_final_review_snapshot jsonb;
  v_audit_id uuid;
  v_row record;
begin
  select array_agg(distinct fragrance_id order by fragrance_id)
  into v_distinct_ids
  from unnest(coalesce(p_fragrance_ids, array[]::uuid[])) as fragrance_id
  where fragrance_id is not null;

  v_requested_count := coalesce(cardinality(v_distinct_ids), 0);

  if v_requested_count = 0 then
    raise exception 'accept_fragrance_taxonomy_proposals_v2_provider_promoted requires explicit non-empty fragrance ids';
  end if;

  if v_requested_count > v_max_ids then
    raise exception 'accept_fragrance_taxonomy_proposals_v2_provider_promoted accepts at most % fragrance ids per call', v_max_ids;
  end if;

  if p_model_version is null or btrim(p_model_version) = '' then
    raise exception 'accept_fragrance_taxonomy_proposals_v2_provider_promoted requires a non-empty model version';
  end if;

  if p_model_version <> 'taxonomy_classifier_proposal_v2_provider_promoted_family_calibrated_2026_06_01' then
    raise exception 'accept_fragrance_taxonomy_proposals_v2_provider_promoted only accepts model version taxonomy_classifier_proposal_v2_provider_promoted_family_calibrated_2026_06_01';
  end if;

  for v_row in
    with requested as (
      select unnest(v_distinct_ids) as fragrance_id
    ),
    latest_notes_promotion as (
      select distinct on (p.fragrance_id)
        p.fragrance_id,
        p.id as notes_promotion_audit_id,
        p.actor_label as notes_promotion_actor_label,
        p.reason as notes_promotion_reason,
        p.result_status as notes_promotion_result_status,
        p.function_version as notes_promotion_function_version,
        p.promoted_at as notes_promoted_at
      from public.fragrance_text_enrichment_notes_promotions_v1 p
      where p.fragrance_id = any (v_distinct_ids)
      order by p.fragrance_id, p.promoted_at desc nulls last, p.created_at desc, p.id desc
    ),
    latest_full_promotion as (
      select distinct on (p.fragrance_id)
        p.fragrance_id,
        p.id as full_promotion_audit_id,
        p.actor_label as full_promotion_actor_label,
        p.action as full_promotion_action,
        p.function_version as full_promotion_function_version,
        p.promoted_at as full_promoted_at
      from public.fragrance_text_enrichment_promotions_v1 p
      where p.fragrance_id = any (v_distinct_ids)
      order by p.fragrance_id, p.promoted_at desc nulls last, p.created_at desc, p.id desc
    ),
    final_facets as (
      select fragrance_id, count(*)::integer as facet_count
      from public.fragrance_facets_v1
      where fragrance_id = any (v_distinct_ids)
      group by fragrance_id
    ),
    final_roles as (
      select fragrance_id, count(*)::integer as role_count
      from public.fragrance_wardrobe_roles_v1
      where fragrance_id = any (v_distinct_ids)
      group by fragrance_id
    ),
    final_reviews as (
      select fragrance_id, count(*)::integer as review_count
      from public.fragrance_taxonomy_review_v1
      where fragrance_id = any (v_distinct_ids)
      group by fragrance_id
    )
    select
      req.fragrance_id as requested_fragrance_id,
      f.id as fragrance_id,
      f.name,
      f.brand,
      f.family_key,
      cardinality(f.notes) as notes_count,
      cardinality(f.accords) as accords_count,
      f.source_url as canonical_source_url,
      f.source_confidence as canonical_source_confidence,
      f.updated_at as fragrance_updated_at,
      p.id as proposal_id,
      p.proposal_status,
      p.proposed_universal_family_key,
      p.proposed_facets,
      p.proposed_wardrobe_roles,
      p.proposed_confidence,
      p.proposed_review_status,
      p.blocker_reason as proposal_blocker_reason,
      p.evidence_summary,
      p.source_summary,
      p.performance_summary,
      p.classifier_model_version,
      p.source_model_version,
      p.queue_model_version,
      p.created_by as proposal_created_by,
      p.created_at as proposal_created_at,
      p.updated_at as proposal_updated_at,
      q.evidence_quality_state,
      q.queue_state,
      q.queue_lane,
      q.blocker_reason as queue_blocker_reason,
      q.recommended_next_action as queue_recommended_next_action,
      q.queue_model_version as current_queue_model_version,
      q.source_queue_model_version as current_source_queue_model_version,
      q.source_view_name as current_source_view_name,
      q.evidence_summary as queue_evidence_summary,
      q.source_snapshot_summary,
      e.provider,
      e.status as enrichment_status,
      np.notes_promotion_audit_id,
      np.notes_promotion_actor_label,
      np.notes_promotion_reason,
      np.notes_promotion_result_status,
      np.notes_promotion_function_version,
      np.notes_promoted_at,
      fp.full_promotion_audit_id,
      fp.full_promotion_actor_label,
      fp.full_promotion_action,
      fp.full_promotion_function_version,
      fp.full_promoted_at,
      coalesce(ff.facet_count, 0) as final_facet_count,
      coalesce(fr.role_count, 0) as final_role_count,
      coalesce(rv.review_count, 0) as final_review_count
    from requested req
    left join public.fragrances f
      on f.id = req.fragrance_id
    left join public.fragrance_taxonomy_proposals_v1 p
      on p.fragrance_id = req.fragrance_id
     and p.classifier_model_version = p_model_version
    left join public.taxonomy_operationalization_queue_current_v1 q
      on q.fragrance_id = req.fragrance_id
    left join public.fragrance_text_enrichment e
      on e.fragrance_id = req.fragrance_id
    left join latest_notes_promotion np
      on np.fragrance_id = req.fragrance_id
    left join latest_full_promotion fp
      on fp.fragrance_id = req.fragrance_id
    left join final_facets ff
      on ff.fragrance_id = req.fragrance_id
    left join final_roles fr
      on fr.fragrance_id = req.fragrance_id
    left join final_reviews rv
      on rv.fragrance_id = req.fragrance_id
    order by coalesce(q.name, f.name), coalesce(q.brand, f.brand), req.fragrance_id
  loop
    v_picked_count := v_picked_count + 1;
    v_result_status := null;
    v_blocker_reason := null;
    v_missing_facet_keys := array[]::text[];
    v_missing_role_keys := array[]::text[];
    v_before_taxonomy_snapshot := '{}'::jsonb;
    v_after_taxonomy_snapshot := '{}'::jsonb;
    v_proposal_snapshot := '{}'::jsonb;
    v_final_facets_written := '[]'::jsonb;
    v_final_roles_written := '[]'::jsonb;
    v_final_review_snapshot := '{}'::jsonb;
    v_audit_id := null;

    if v_row.fragrance_id is not null then
      select jsonb_build_object(
        'facet_count',
        (select count(*) from public.fragrance_facets_v1 ff where ff.fragrance_id = v_row.fragrance_id),
        'facets',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'facet_key', ff.facet_key,
                'confidence', ff.confidence,
                'evidence_source', ff.evidence_source
              )
              order by ff.facet_key
            )
            from public.fragrance_facets_v1 ff
            where ff.fragrance_id = v_row.fragrance_id
          ),
          '[]'::jsonb
        ),
        'role_count',
        (select count(*) from public.fragrance_wardrobe_roles_v1 wr where wr.fragrance_id = v_row.fragrance_id),
        'roles',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'role_key', wr.role_key,
                'role_priority', wr.role_priority,
                'confidence', wr.confidence,
                'evidence_source', wr.evidence_source
              )
              order by wr.role_priority, wr.role_key
            )
            from public.fragrance_wardrobe_roles_v1 wr
            where wr.fragrance_id = v_row.fragrance_id
          ),
          '[]'::jsonb
        ),
        'review',
        coalesce(
          (
            select jsonb_build_object(
              'fragrance_id', tr.fragrance_id,
              'legacy_family_key', tr.legacy_family_key,
              'universal_equivalent', tr.universal_equivalent,
              'confidence', tr.confidence,
              'review_status', tr.review_status,
              'evidence_source', tr.evidence_source,
              'reviewed_by', tr.reviewed_by
            )
            from public.fragrance_taxonomy_review_v1 tr
            where tr.fragrance_id = v_row.fragrance_id
          ),
          '{}'::jsonb
        )
      )
      into v_before_taxonomy_snapshot;
    end if;

    v_proposal_snapshot := jsonb_build_object(
      'proposal_id', v_row.proposal_id,
      'fragrance_id', v_row.fragrance_id,
      'name', v_row.name,
      'brand', v_row.brand,
      'proposal_status', v_row.proposal_status,
      'proposal_blocker_reason', v_row.proposal_blocker_reason,
      'proposed_universal_family_key', v_row.proposed_universal_family_key,
      'proposed_facets', coalesce(v_row.proposed_facets, '[]'::jsonb),
      'proposed_wardrobe_roles', coalesce(v_row.proposed_wardrobe_roles, '[]'::jsonb),
      'proposed_confidence', v_row.proposed_confidence,
      'proposed_review_status', v_row.proposed_review_status,
      'classifier_model_version', v_row.classifier_model_version,
      'source_model_version', v_row.source_model_version,
      'proposal_queue_model_version', v_row.queue_model_version,
      'proposal_created_by', v_row.proposal_created_by,
      'proposal_created_at', v_row.proposal_created_at,
      'proposal_updated_at', v_row.proposal_updated_at,
      'evidence_quality_state', v_row.evidence_quality_state,
      'queue_state', v_row.queue_state,
      'queue_lane', v_row.queue_lane,
      'queue_blocker_reason', v_row.queue_blocker_reason,
      'queue_recommended_next_action', v_row.queue_recommended_next_action,
      'current_queue_model_version', v_row.current_queue_model_version,
      'current_source_queue_model_version', v_row.current_source_queue_model_version,
      'current_source_view_name', v_row.current_source_view_name,
      'queue_evidence_summary', coalesce(v_row.queue_evidence_summary, '{}'::jsonb),
      'source_snapshot_summary', coalesce(v_row.source_snapshot_summary, '{}'::jsonb),
      'evidence_summary', coalesce(v_row.evidence_summary, '{}'::jsonb),
      'source_summary', coalesce(v_row.source_summary, '{}'::jsonb),
      'performance_summary', coalesce(v_row.performance_summary, '{}'::jsonb),
      'provider', v_row.provider,
      'enrichment_status', v_row.enrichment_status,
      'notes_promotion_audit_id', v_row.notes_promotion_audit_id,
      'notes_promotion_actor_label', v_row.notes_promotion_actor_label,
      'notes_promotion_reason', v_row.notes_promotion_reason,
      'notes_promotion_result_status', v_row.notes_promotion_result_status,
      'notes_promotion_function_version', v_row.notes_promotion_function_version,
      'notes_promoted_at', v_row.notes_promoted_at,
      'full_promotion_audit_id', v_row.full_promotion_audit_id,
      'full_promotion_actor_label', v_row.full_promotion_actor_label,
      'full_promotion_action', v_row.full_promotion_action,
      'full_promotion_function_version', v_row.full_promotion_function_version,
      'full_promoted_at', v_row.full_promoted_at
    );

    if v_row.fragrance_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_fragrance_row';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.proposal_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_model_version_proposal';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.proposal_status = 'accepted_later' then
      v_result_status := 'skipped';
      v_blocker_reason := 'already_accepted';
      v_skipped_count := v_skipped_count + 1;
    elsif v_row.proposal_status <> 'proposed' then
      v_result_status := 'rejected';
      v_blocker_reason := 'proposal_status_not_proposed';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.proposed_review_status = 'needs_manual_review' then
      v_result_status := 'rejected';
      v_blocker_reason := 'proposal_requires_manual_review';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.evidence_quality_state <> 'promoted_enrichment_evidence' then
      v_result_status := 'rejected';
      v_blocker_reason := 'evidence_not_promoted_enrichment';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.queue_state <> 'ready_existing_evidence'
       or v_row.queue_lane <> 'safe_classifier_candidate' then
      v_result_status := 'rejected';
      v_blocker_reason := 'queue_not_safe_classifier_candidate';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.queue_recommended_next_action is distinct from 'stage_classifier_proposal' then
      v_result_status := 'rejected';
      v_blocker_reason := 'queue_not_stage_classifier_proposal';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(nullif(v_row.queue_blocker_reason, ''), '') <> '' then
      v_result_status := 'rejected';
      v_blocker_reason := 'queue_blocker_present';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.provider, '') <> 'fragella' then
      v_result_status := 'rejected';
      v_blocker_reason := 'not_fragella_provider';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.enrichment_status not in ('notes_promoted', 'already_enriched') then
      v_result_status := 'rejected';
      v_blocker_reason := 'enrichment_not_provider_promoted';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.evidence_summary ->> 'proposal_basis', '') <> 'provider_promoted_notes_only_queue_routed_v2_family_calibrated' then
      v_result_status := 'rejected';
      v_blocker_reason := 'unexpected_provider_promoted_evidence_basis';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.evidence_summary ->> 'provider_promoted_limitation', '') <> 'provider_promoted_fragella_evidence_not_official_source' then
      v_result_status := 'rejected';
      v_blocker_reason := 'provider_promoted_limitation_missing';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.source_summary ->> 'source_type', '') <> 'provider_promoted_enrichment' then
      v_result_status := 'rejected';
      v_blocker_reason := 'unexpected_source_type';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.source_summary ->> 'provider', '') <> 'fragella' then
      v_result_status := 'rejected';
      v_blocker_reason := 'unexpected_source_provider';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.source_summary ->> 'basis', '') <> 'provider_promoted_enrichment_notes_only_v2_family_calibrated' then
      v_result_status := 'rejected';
      v_blocker_reason := 'unexpected_source_basis';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.notes_count, 0) = 0
       or coalesce(v_row.accords_count, 0) = 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_canonical_notes_or_accords';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.final_facet_count, 0) > 0
       or coalesce(v_row.final_role_count, 0) > 0
       or coalesce(v_row.final_review_count, 0) > 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'existing_final_taxonomy_present';
      v_rejected_count := v_rejected_count + 1;
    elsif jsonb_typeof(coalesce(v_row.proposed_facets, '[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(v_row.proposed_wardrobe_roles, '[]'::jsonb)) <> 'array' then
      v_result_status := 'rejected';
      v_blocker_reason := 'proposal_payload_not_array';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(jsonb_array_length(coalesce(v_row.proposed_facets, '[]'::jsonb)), 0) = 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'proposal_missing_facets';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(jsonb_array_length(coalesce(v_row.proposed_wardrobe_roles, '[]'::jsonb)), 0) = 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'proposal_missing_roles';
      v_rejected_count := v_rejected_count + 1;
    else
      select coalesce(array_agg(missing_key order by missing_key), array[]::text[])
      into v_missing_facet_keys
      from (
        select distinct coalesce(nullif(facet ->> 'facet_key', ''), '__missing_facet_key__') as missing_key
        from jsonb_array_elements(coalesce(v_row.proposed_facets, '[]'::jsonb)) facet
      ) proposed
      left join public.facet_key_reference_v1 ref
        on ref.facet_key = proposed.missing_key
       and ref.active is true
      where ref.facet_key is null;

      select coalesce(array_agg(missing_key order by missing_key), array[]::text[])
      into v_missing_role_keys
      from (
        select distinct coalesce(nullif(role ->> 'role_key', ''), '__missing_role_key__') as missing_key
        from jsonb_array_elements(coalesce(v_row.proposed_wardrobe_roles, '[]'::jsonb)) role
      ) proposed
      left join public.wardrobe_role_reference_v1 ref
        on ref.role_key = proposed.missing_key
       and ref.active is true
      where ref.role_key is null;

      if coalesce(array_length(v_missing_facet_keys, 1), 0) > 0 then
        v_result_status := 'rejected';
        v_blocker_reason := 'unsupported_facet_reference_keys';
        v_rejected_count := v_rejected_count + 1;
      elsif coalesce(array_length(v_missing_role_keys, 1), 0) > 0 then
        v_result_status := 'rejected';
        v_blocker_reason := 'unsupported_role_reference_keys';
        v_rejected_count := v_rejected_count + 1;
      elsif v_row.proposed_universal_family_key is not null
         and not exists (
           select 1
           from public.family_key_reference_v1 fkr
           where fkr.active is true
             and (
               fkr.family_key = v_row.proposed_universal_family_key
               or fkr.universal_equivalent = v_row.proposed_universal_family_key
             )
         ) then
        v_result_status := 'rejected';
        v_blocker_reason := 'unsupported_universal_family_reference';
        v_rejected_count := v_rejected_count + 1;
      else
        v_eligible_count := v_eligible_count + 1;

        if p_dry_run then
          v_result_status := 'would_accept';
          v_would_accept_count := v_would_accept_count + 1;
          v_after_taxonomy_snapshot := v_before_taxonomy_snapshot;
        else
          with inserted_facets as (
            insert into public.fragrance_facets_v1 (
              fragrance_id,
              facet_key,
              confidence,
              evidence_source,
              evidence_json,
              created_at,
              updated_at
            )
            select
              v_row.fragrance_id,
              facet ->> 'facet_key',
              coalesce((facet ->> 'confidence')::numeric, v_row.proposed_confidence),
              'taxonomy_proposal_acceptance_v2_provider_promoted',
              jsonb_build_object(
                'accepted_from_proposal_id', v_row.proposal_id,
                'actor_label', v_actor_label,
                'classifier_model_version', v_row.classifier_model_version,
                'source_model_version', v_row.source_model_version,
                'proposal_queue_model_version', v_row.queue_model_version,
                'current_source_queue_model_version', v_row.current_source_queue_model_version,
                'current_queue_model_version', v_row.current_queue_model_version,
                'current_source_view_name', v_row.current_source_view_name,
                'proposed_universal_family_key', v_row.proposed_universal_family_key,
                'proposal_confidence', v_row.proposed_confidence,
                'matched_terms', coalesce(facet -> 'matched_terms', '[]'::jsonb),
                'basis_sources', coalesce(facet -> 'basis_sources', '[]'::jsonb),
                'proposal_evidence_summary', coalesce(v_row.evidence_summary, '{}'::jsonb),
                'proposal_source_summary', coalesce(v_row.source_summary, '{}'::jsonb),
                'proposal_performance_summary', coalesce(v_row.performance_summary, '{}'::jsonb),
                'provider', v_row.provider,
                'enrichment_status', v_row.enrichment_status,
                'evidence_basis', 'provider_promoted_notes_only_queue_routed_v2_family_calibrated',
                'provider_limitation', 'provider_promoted_fragella_evidence_not_official_source',
                'notes_promotion_audit_id', v_row.notes_promotion_audit_id,
                'full_promotion_audit_id', v_row.full_promotion_audit_id,
                'notes_promotion_actor_label', v_row.notes_promotion_actor_label,
                'full_promotion_actor_label', v_row.full_promotion_actor_label,
                'notes_promotion_reason', v_row.notes_promotion_reason,
                'notes_promotion_result_status', v_row.notes_promotion_result_status,
                'notes_promotion_function_version', v_row.notes_promotion_function_version,
                'full_promotion_function_version', v_row.full_promotion_function_version,
                'notes_promoted_at', v_row.notes_promoted_at,
                'full_promoted_at', v_row.full_promoted_at,
                'performance_refresh_run_id', coalesce(v_row.performance_summary ->> 'performance_refresh_run_id', ''),
                'source_truth_accepted', false,
                'provider_promoted_only', true
              ),
              now(),
              now()
            from jsonb_array_elements(coalesce(v_row.proposed_facets, '[]'::jsonb)) facet
            on conflict (fragrance_id, facet_key) do nothing
            returning facet_key, confidence, evidence_source
          )
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'facet_key', facet_key,
                'confidence', confidence,
                'evidence_source', evidence_source
              )
              order by facet_key
            ),
            '[]'::jsonb
          )
          into v_final_facets_written
          from inserted_facets;

          with inserted_roles as (
            insert into public.fragrance_wardrobe_roles_v1 (
              fragrance_id,
              role_key,
              role_priority,
              confidence,
              evidence_source,
              evidence_json,
              created_at,
              updated_at
            )
            select
              v_row.fragrance_id,
              role ->> 'role_key',
              coalesce((role ->> 'role_priority')::integer, row_number() over (order by role ->> 'role_key')),
              coalesce((role ->> 'confidence')::numeric, v_row.proposed_confidence),
              'taxonomy_proposal_acceptance_v2_provider_promoted',
              jsonb_build_object(
                'accepted_from_proposal_id', v_row.proposal_id,
                'actor_label', v_actor_label,
                'classifier_model_version', v_row.classifier_model_version,
                'source_model_version', v_row.source_model_version,
                'proposal_queue_model_version', v_row.queue_model_version,
                'current_source_queue_model_version', v_row.current_source_queue_model_version,
                'current_queue_model_version', v_row.current_queue_model_version,
                'current_source_view_name', v_row.current_source_view_name,
                'proposed_universal_family_key', v_row.proposed_universal_family_key,
                'proposal_confidence', v_row.proposed_confidence,
                'role_rationale', coalesce(role -> 'rationale', '[]'::jsonb),
                'proposal_evidence_summary', coalesce(v_row.evidence_summary, '{}'::jsonb),
                'proposal_source_summary', coalesce(v_row.source_summary, '{}'::jsonb),
                'proposal_performance_summary', coalesce(v_row.performance_summary, '{}'::jsonb),
                'provider', v_row.provider,
                'enrichment_status', v_row.enrichment_status,
                'evidence_basis', 'provider_promoted_notes_only_queue_routed_v2_family_calibrated',
                'provider_limitation', 'provider_promoted_fragella_evidence_not_official_source',
                'notes_promotion_audit_id', v_row.notes_promotion_audit_id,
                'full_promotion_audit_id', v_row.full_promotion_audit_id,
                'notes_promotion_actor_label', v_row.notes_promotion_actor_label,
                'full_promotion_actor_label', v_row.full_promotion_actor_label,
                'notes_promotion_reason', v_row.notes_promotion_reason,
                'notes_promotion_result_status', v_row.notes_promotion_result_status,
                'notes_promotion_function_version', v_row.notes_promotion_function_version,
                'full_promotion_function_version', v_row.full_promotion_function_version,
                'notes_promoted_at', v_row.notes_promoted_at,
                'full_promoted_at', v_row.full_promoted_at,
                'performance_refresh_run_id', coalesce(v_row.performance_summary ->> 'performance_refresh_run_id', ''),
                'source_truth_accepted', false,
                'provider_promoted_only', true
              ),
              now(),
              now()
            from jsonb_array_elements(coalesce(v_row.proposed_wardrobe_roles, '[]'::jsonb)) role
            on conflict (fragrance_id, role_key) do nothing
            returning role_key, role_priority, confidence, evidence_source
          )
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'role_key', role_key,
                'role_priority', role_priority,
                'confidence', confidence,
                'evidence_source', evidence_source
              )
              order by role_priority, role_key
            ),
            '[]'::jsonb
          )
          into v_final_roles_written
          from inserted_roles;

          insert into public.fragrance_taxonomy_review_v1 (
            fragrance_id,
            legacy_family_key,
            universal_equivalent,
            confidence,
            review_status,
            evidence_source,
            evidence_json,
            reviewed_by,
            created_at,
            updated_at
          )
          values (
            v_row.fragrance_id,
            v_row.family_key,
            v_row.proposed_universal_family_key,
            v_row.proposed_confidence,
            coalesce(v_row.proposed_review_status, 'medium_confidence'),
            'taxonomy_proposal_acceptance_v2_provider_promoted',
            jsonb_build_object(
              'accepted_from_proposal_id', v_row.proposal_id,
              'actor_label', v_actor_label,
              'classifier_model_version', v_row.classifier_model_version,
              'source_model_version', v_row.source_model_version,
              'proposal_queue_model_version', v_row.queue_model_version,
              'current_source_queue_model_version', v_row.current_source_queue_model_version,
              'current_queue_model_version', v_row.current_queue_model_version,
              'current_source_view_name', v_row.current_source_view_name,
              'proposal_confidence', v_row.proposed_confidence,
              'proposed_universal_family_key', v_row.proposed_universal_family_key,
              'proposed_facets', coalesce(v_row.proposed_facets, '[]'::jsonb),
              'proposed_wardrobe_roles', coalesce(v_row.proposed_wardrobe_roles, '[]'::jsonb),
              'proposal_evidence_summary', coalesce(v_row.evidence_summary, '{}'::jsonb),
              'proposal_source_summary', coalesce(v_row.source_summary, '{}'::jsonb),
              'proposal_performance_summary', coalesce(v_row.performance_summary, '{}'::jsonb),
              'provider', v_row.provider,
              'enrichment_status', v_row.enrichment_status,
              'evidence_basis', 'provider_promoted_notes_only_queue_routed_v2_family_calibrated',
              'provider_limitation', 'provider_promoted_fragella_evidence_not_official_source',
              'notes_promotion_audit_id', v_row.notes_promotion_audit_id,
              'full_promotion_audit_id', v_row.full_promotion_audit_id,
              'notes_promotion_actor_label', v_row.notes_promotion_actor_label,
              'full_promotion_actor_label', v_row.full_promotion_actor_label,
              'notes_promotion_reason', v_row.notes_promotion_reason,
              'notes_promotion_result_status', v_row.notes_promotion_result_status,
              'notes_promotion_function_version', v_row.notes_promotion_function_version,
              'full_promotion_function_version', v_row.full_promotion_function_version,
              'notes_promoted_at', v_row.notes_promoted_at,
              'full_promoted_at', v_row.full_promoted_at,
              'performance_refresh_run_id', coalesce(v_row.performance_summary ->> 'performance_refresh_run_id', ''),
              'source_truth_accepted', false,
              'provider_promoted_only', true
            ),
            v_actor_label,
            now(),
            now()
          )
          on conflict (fragrance_id) do nothing
          returning jsonb_build_object(
            'fragrance_id', fragrance_id,
            'legacy_family_key', legacy_family_key,
            'universal_equivalent', universal_equivalent,
            'confidence', confidence,
            'review_status', review_status,
            'evidence_source', evidence_source,
            'reviewed_by', reviewed_by
          )
          into v_final_review_snapshot;

          update public.fragrance_taxonomy_proposals_v1
          set
            proposal_status = 'accepted_later',
            updated_at = now()
          where id = v_row.proposal_id
            and proposal_status = 'proposed';

          select jsonb_build_object(
            'facet_count',
            (select count(*) from public.fragrance_facets_v1 ff where ff.fragrance_id = v_row.fragrance_id),
            'facets',
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'facet_key', ff.facet_key,
                    'confidence', ff.confidence,
                    'evidence_source', ff.evidence_source
                  )
                  order by ff.facet_key
                )
                from public.fragrance_facets_v1 ff
                where ff.fragrance_id = v_row.fragrance_id
              ),
              '[]'::jsonb
            ),
            'role_count',
            (select count(*) from public.fragrance_wardrobe_roles_v1 wr where wr.fragrance_id = v_row.fragrance_id),
            'roles',
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'role_key', wr.role_key,
                    'role_priority', wr.role_priority,
                    'confidence', wr.confidence,
                    'evidence_source', wr.evidence_source
                  )
                  order by wr.role_priority, wr.role_key
                )
                from public.fragrance_wardrobe_roles_v1 wr
                where wr.fragrance_id = v_row.fragrance_id
              ),
              '[]'::jsonb
            ),
            'review',
            coalesce(
              (
                select jsonb_build_object(
                  'fragrance_id', tr.fragrance_id,
                  'legacy_family_key', tr.legacy_family_key,
                  'universal_equivalent', tr.universal_equivalent,
                  'confidence', tr.confidence,
                  'review_status', tr.review_status,
                  'evidence_source', tr.evidence_source,
                  'reviewed_by', tr.reviewed_by
                )
                from public.fragrance_taxonomy_review_v1 tr
                where tr.fragrance_id = v_row.fragrance_id
              ),
              '{}'::jsonb
            )
          )
          into v_after_taxonomy_snapshot;

          insert into public.fragrance_taxonomy_proposal_acceptance_audit_v1 (
            proposal_id,
            fragrance_id,
            action,
            result_status,
            actor_label,
            classifier_model_version,
            proposal_snapshot,
            final_facets_written,
            final_roles_written,
            final_review_snapshot,
            before_taxonomy_snapshot,
            after_taxonomy_snapshot,
            blocker_reason,
            created_at
          )
          values (
            v_row.proposal_id,
            v_row.fragrance_id,
            'accept',
            'accepted',
            v_actor_label,
            v_row.classifier_model_version,
            v_proposal_snapshot,
            v_final_facets_written,
            v_final_roles_written,
            coalesce(v_final_review_snapshot, '{}'::jsonb),
            coalesce(v_before_taxonomy_snapshot, '{}'::jsonb),
            coalesce(v_after_taxonomy_snapshot, '{}'::jsonb),
            null,
            now()
          )
          returning id into v_audit_id;

          v_result_status := 'accepted';
          v_accepted_count := v_accepted_count + 1;
        end if;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'fragrance_id', coalesce(v_row.fragrance_id, v_row.requested_fragrance_id),
        'name', v_row.name,
        'brand', v_row.brand,
        'proposal_id', v_row.proposal_id,
        'result_status', v_result_status,
        'blocker_reason', v_blocker_reason,
        'classifier_model_version', p_model_version,
        'provider', v_row.provider,
        'enrichment_status', v_row.enrichment_status,
        'evidence_quality_state', v_row.evidence_quality_state,
        'queue_state', v_row.queue_state,
        'queue_lane', v_row.queue_lane,
        'queue_recommended_next_action', v_row.queue_recommended_next_action,
        'proposed_universal_family_key', v_row.proposed_universal_family_key,
        'proposed_facets', coalesce(v_row.proposed_facets, '[]'::jsonb),
        'proposed_wardrobe_roles', coalesce(v_row.proposed_wardrobe_roles, '[]'::jsonb),
        'proposed_confidence', v_row.proposed_confidence,
        'proposed_review_status', v_row.proposed_review_status,
        'provider_limitation', 'provider_promoted_fragella_evidence_not_official_source',
        'missing_facet_keys', to_jsonb(coalesce(v_missing_facet_keys, array[]::text[])),
        'missing_role_keys', to_jsonb(coalesce(v_missing_role_keys, array[]::text[])),
        'before_taxonomy_snapshot', coalesce(v_before_taxonomy_snapshot, '{}'::jsonb),
        'final_facets_written', v_final_facets_written,
        'final_roles_written', v_final_roles_written,
        'final_review_snapshot', coalesce(v_final_review_snapshot, '{}'::jsonb),
        'after_taxonomy_snapshot', coalesce(v_after_taxonomy_snapshot, v_before_taxonomy_snapshot, '{}'::jsonb),
        'audit_id', v_audit_id
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'function_version', 'provider_promoted_proposal_acceptance_v2_2026_06_01',
    'dry_run', p_dry_run,
    'actor_label', v_actor_label,
    'model_version', p_model_version,
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'eligible_count', v_eligible_count,
    'would_accept_count', v_would_accept_count,
    'accepted_count', v_accepted_count,
    'rejected_count', v_rejected_count,
    'skipped_count', v_skipped_count,
    'results', v_results
  );
end;
$function$;

comment on function public.accept_fragrance_taxonomy_proposals_v2_provider_promoted(uuid[], text, boolean, text) is
  'Accepts explicit v2 family-calibrated provider-promoted Fragella taxonomy proposals into final taxonomy surfaces for the safe classifier lane without mutating fragrance truth or refreshing queue/performance.';

revoke all on function public.accept_fragrance_taxonomy_proposals_v2_provider_promoted(uuid[], text, boolean, text) from public;
revoke all on function public.accept_fragrance_taxonomy_proposals_v2_provider_promoted(uuid[], text, boolean, text) from anon;
revoke all on function public.accept_fragrance_taxonomy_proposals_v2_provider_promoted(uuid[], text, boolean, text) from authenticated;
grant execute on function public.accept_fragrance_taxonomy_proposals_v2_provider_promoted(uuid[], text, boolean, text) to service_role;

commit;
