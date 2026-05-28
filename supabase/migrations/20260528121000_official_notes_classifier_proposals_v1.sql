begin;

create or replace function public.propose_fragrance_taxonomy_v1_official_notes_only(
  p_fragrance_ids uuid[],
  p_actor_label text default 'codex_official_notes_classifier_proposal_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_official_notes_classifier_proposal_v1');
  v_requested_count integer := coalesce(array_length(p_fragrance_ids, 1), 0);
  v_distinct_ids uuid[];
  v_distinct_requested_count integer := 0;
  v_picked_count integer := 0;
  v_eligible_count integer := 0;
  v_would_propose_count integer := 0;
  v_proposed_count integer := 0;
  v_rejected_count integer := 0;
  v_skipped_count integer := 0;
  v_max_ids constant integer := 25;
  v_classifier_model_version constant text := 'taxonomy_classifier_proposal_v1_official_notes_only_2026_05_28';
  v_results jsonb := '[]'::jsonb;
  v_invalid_family_keys text[] := array[]::text[];
  v_invalid_facet_keys text[] := array[]::text[];
  v_invalid_role_keys text[] := array[]::text[];
  v_result_status text;
  v_blocker_reason text;
  v_proposal_status text;
  v_proposed_universal_family_key text;
  v_proposed_facets jsonb;
  v_proposed_roles jsonb;
  v_proposed_confidence numeric;
  v_proposed_review_status text;
  v_evidence_summary jsonb;
  v_source_summary jsonb;
  v_performance_summary jsonb;
  v_facet_keys text[];
  v_facet_count integer;
  v_role_count integer;
  v_primary_role text;
  v_secondary_role text;
  v_primary_role_confidence numeric;
  v_secondary_role_confidence numeric;
  v_role_rationale text[];
  v_inserted_id uuid;
  v_row record;
begin
  if p_fragrance_ids is null or v_requested_count = 0 then
    raise exception 'p_fragrance_ids must be a non-empty explicit uuid[]';
  end if;

  select coalesce(array_agg(distinct x order by x), array[]::uuid[])
  into v_distinct_ids
  from unnest(p_fragrance_ids) as x
  where x is not null;

  v_distinct_requested_count := coalesce(array_length(v_distinct_ids, 1), 0);

  if v_distinct_requested_count = 0 then
    raise exception 'p_fragrance_ids must contain at least one non-null uuid';
  end if;

  if v_distinct_requested_count > v_max_ids then
    raise exception 'p_fragrance_ids exceeded max batch size of %', v_max_ids;
  end if;

  for v_row in
    with prior_proposals as (
      select distinct on (p.fragrance_id)
        p.fragrance_id,
        p.id as prior_proposal_id,
        p.classifier_model_version as prior_classifier_model_version,
        p.proposal_status as prior_proposal_status,
        p.proposed_confidence as prior_proposed_confidence,
        p.proposed_universal_family_key as prior_proposed_universal_family_key,
        p.proposed_facets as prior_proposed_facets,
        p.proposed_wardrobe_roles as prior_proposed_wardrobe_roles
      from public.fragrance_taxonomy_proposals_v1 p
      where p.fragrance_id = any (v_distinct_ids)
        and p.classifier_model_version <> v_classifier_model_version
      order by p.fragrance_id, p.updated_at desc nulls last, p.created_at desc, p.id desc
    ),
    same_model_proposals as (
      select
        p.fragrance_id,
        p.id as existing_model_proposal_id,
        p.proposal_status as existing_model_proposal_status
      from public.fragrance_taxonomy_proposals_v1 p
      where p.fragrance_id = any (v_distinct_ids)
        and p.classifier_model_version = v_classifier_model_version
    )
    select
      ids.id as requested_fragrance_id,
      f.id as fragrance_id,
      f.name,
      f.brand,
      f.family_key,
      fkr.universal_equivalent as universal_family_key,
      f.source_url,
      case
        when nullif(btrim(f.source_confidence), '') ~ '^[0-9]+([.][0-9]+)?$'
          then f.source_confidence::numeric
      end as source_confidence_numeric,
      f.notes,
      f.top_notes,
      f.heart_notes,
      f.base_notes,
      cardinality(f.notes) as notes_count,
      cardinality(f.top_notes) as top_notes_count,
      cardinality(f.heart_notes) as heart_notes_count,
      cardinality(f.base_notes) as base_notes_count,
      q.queue_state,
      q.queue_lane,
      q.blocker_reason as queue_blocker_reason,
      q.recommended_next_action as queue_recommended_next_action,
      q.queue_model_version,
      q.evidence_summary as queue_evidence_summary,
      r.latest_review_id,
      r.review_status,
      r.decision_reason as review_decision_reason,
      r.recommended_next_action as review_recommended_next_action,
      r.source_evidence_type,
      r.source_limitation_reason,
      r.performance_refresh_satisfied,
      r.selected_official_source_backfill_audit_id,
      r.source_queue_model_version as review_source_queue_model_version,
      r.evidence_snapshot as review_evidence_snapshot,
      r.queue_snapshot as review_queue_snapshot,
      r.source_snapshot as review_source_snapshot,
      pf.signal_count,
      pf.source_count,
      pf.beast_mode_band,
      pf.recommended_spray_caution,
      pf.model_version as performance_model_version,
      pf.updated_at as performance_updated_at,
      exists(select 1 from public.fragrance_facets_v1 ff where ff.fragrance_id = f.id) as has_final_facets,
      exists(select 1 from public.fragrance_wardrobe_roles_v1 wr where wr.fragrance_id = f.id) as has_final_roles,
      exists(select 1 from public.fragrance_taxonomy_review_v1 tr where tr.fragrance_id = f.id) as has_taxonomy_review,
      sm.existing_model_proposal_id,
      sm.existing_model_proposal_status,
      pp.prior_proposal_id,
      pp.prior_classifier_model_version,
      pp.prior_proposal_status,
      pp.prior_proposed_confidence,
      pp.prior_proposed_universal_family_key,
      pp.prior_proposed_facets,
      pp.prior_proposed_wardrobe_roles,
      audit.actor_label as backfill_actor_label,
      audit.backfill_reason,
      audit.created_at as backfill_created_at
    from unnest(v_distinct_ids) ids(id)
    left join public.fragrances f
      on f.id = ids.id
    left join public.family_key_reference_v1 fkr
      on fkr.family_key = f.family_key
     and fkr.active is true
    left join public.taxonomy_operationalization_queue_current_v1 q
      on q.fragrance_id = ids.id
    left join public.fragrance_official_notes_review_latest_v1 r
      on r.fragrance_id = ids.id
    left join public.fragrance_performance_features_v1 pf
      on pf.fragrance_id = ids.id
    left join same_model_proposals sm
      on sm.fragrance_id = ids.id
    left join prior_proposals pp
      on pp.fragrance_id = ids.id
    left join public.fragrance_source_backfill_audit_v1 audit
      on audit.id = r.selected_official_source_backfill_audit_id
    order by f.name nulls last, ids.id
  loop
    v_picked_count := v_picked_count + 1;
    v_result_status := null;
    v_blocker_reason := null;
    v_proposal_status := null;
    v_proposed_universal_family_key := v_row.universal_family_key;
    v_proposed_facets := '[]'::jsonb;
    v_proposed_roles := '[]'::jsonb;
    v_proposed_confidence := null;
    v_proposed_review_status := null;
    v_evidence_summary := '{}'::jsonb;
    v_source_summary := '{}'::jsonb;
    v_performance_summary := '{}'::jsonb;
    v_facet_keys := array[]::text[];
    v_facet_count := 0;
    v_role_count := 0;
    v_primary_role := null;
    v_secondary_role := null;
    v_primary_role_confidence := null;
    v_secondary_role_confidence := null;
    v_role_rationale := array[]::text[];
    v_inserted_id := null;

    if v_row.fragrance_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_fragrance_row';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.queue_state <> 'official_notes_accepted_pending_classifier_review'
       or v_row.queue_lane <> 'controlled_classifier_review' then
      v_result_status := 'rejected';
      v_blocker_reason := 'not_official_notes_classifier_review_candidate';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.queue_recommended_next_action <> 'controlled_classifier_review_candidate_notes_only' then
      v_result_status := 'rejected';
      v_blocker_reason := 'not_controlled_classifier_review_candidate_notes_only';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.review_status <> 'official_notes_accepted_for_classifier_review' then
      v_result_status := 'rejected';
      v_blocker_reason := 'official_notes_review_not_accepted';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.source_evidence_type <> 'official_notes_only' then
      v_result_status := 'rejected';
      v_blocker_reason := 'not_official_notes_only_evidence';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.source_limitation_reason <> 'no_official_note_pyramid_provided' then
      v_result_status := 'rejected';
      v_blocker_reason := 'unexpected_source_limitation_reason';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(nullif(btrim(v_row.source_url), ''), '') = '' or coalesce(v_row.source_confidence_numeric, 0) < 0.95 then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_or_low_confidence_official_source';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.notes_count, 0) = 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_official_notes';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.top_notes_count, 0) > 0
       or coalesce(v_row.heart_notes_count, 0) > 0
       or coalesce(v_row.base_notes_count, 0) > 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'unexpected_note_pyramid_present';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.performance_refresh_satisfied, false) is false then
      v_result_status := 'rejected';
      v_blocker_reason := 'performance_refresh_missing';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.has_final_facets, false)
       or coalesce(v_row.has_final_roles, false)
       or coalesce(v_row.has_taxonomy_review, false) then
      v_result_status := 'rejected';
      v_blocker_reason := 'existing_final_taxonomy_present';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.existing_model_proposal_id is not null then
      v_result_status := 'skipped';
      v_blocker_reason := 'existing_model_version_proposal';
      v_skipped_count := v_skipped_count + 1;
    elsif coalesce(nullif(v_row.family_key, ''), '') = '' then
      v_invalid_family_keys := array(
        select distinct x
        from unnest(v_invalid_family_keys || array['']) as t(x)
        where x <> ''
      );
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_family_key';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(nullif(v_row.universal_family_key, ''), '') = '' then
      v_invalid_family_keys := array(
        select distinct x
        from unnest(v_invalid_family_keys || array[v_row.family_key]) as t(x)
        where x <> ''
      );
      v_result_status := 'rejected';
      v_blocker_reason := 'inactive_or_unmapped_family_key';
      v_rejected_count := v_rejected_count + 1;
    else
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'facet_key', facet_key,
              'display_label', display_label,
              'confidence', facet_confidence,
              'score', score,
              'matched_terms', to_jsonb(matched_terms),
              'basis_sources', to_jsonb(basis_sources)
            )
            order by score desc, facet_key
          ),
          '[]'::jsonb
        ),
        coalesce(array_agg(facet_key order by score desc, facet_key), array[]::text[]),
        count(*)::integer
      into v_proposed_facets, v_facet_keys, v_facet_count
      from (
        with raw_tokens as (
          select unnest(coalesce(v_row.notes, array[]::text[])) as token, 'official_notes'::text as source_kind
          union all
          select v_row.family_key as token, 'family'::text as source_kind
          union all
          select v_row.universal_family_key as token, 'family'::text as source_kind
        ),
        normalized_tokens as (
          select
            public.taxonomy_norm_text_v1(token) as token,
            source_kind
          from raw_tokens
          where token is not null
        ),
        semantic_tokens as (
          select
            public.taxonomy_norm_text_v1(mapped_term) as token,
            nt.source_kind
          from normalized_tokens nt
          cross join lateral (
            values
              (case when nt.token like '%castoreum%' then 'leather' end),
              (case when nt.token like '%saffron%' then 'spicy' end),
              (case when nt.token like '%ginger%' then 'spicy' end),
              (case when nt.token like '%vetiver%' then 'woody' end),
              (case when nt.token like '%juniper%' then 'aromatic' end),
              (case when nt.token like '%white flowers%' then 'floral' end),
              (case when nt.token like '%oud%' then 'woody' end),
              (case when nt.token like '%wood%' then 'woody' end),
              (case when nt.token like '%woods%' then 'woody' end)
          ) mapped(mapped_term)
          where mapped_term is not null
        ),
        token_terms as (
          select token, source_kind
          from normalized_tokens
          where token <> ''
          union all
          select split_token.token, nt.source_kind
          from normalized_tokens nt
          cross join lateral regexp_split_to_table(nt.token, '\s+') as split_token(token)
          where nt.token <> ''
          union all
          select token, source_kind
          from semantic_tokens
          where token <> ''
        ),
        active_facets as (
          select
            facet_key,
            display_label,
            coalesce(evidence_notes, '[]'::jsonb) as evidence_notes
          from public.facet_key_reference_v1
          where active is true
        ),
        evidence_terms as (
          select af.facet_key, af.display_label, public.taxonomy_norm_text_v1(af.facet_key) as term, 3 as evidence_weight
          from active_facets af
          union all
          select af.facet_key, af.display_label, public.taxonomy_norm_text_v1(af.display_label) as term, 2 as evidence_weight
          from active_facets af
          union all
          select af.facet_key, af.display_label, public.taxonomy_norm_text_v1(en.term) as term, 2 as evidence_weight
          from active_facets af
          cross join lateral jsonb_array_elements_text(af.evidence_notes) as en(term)
        ),
        matched_terms as (
          select
            et.facet_key,
            et.display_label,
            tt.token as matched_term,
            tt.source_kind,
            case
              when tt.source_kind = 'family' then et.evidence_weight + 2
              when tt.source_kind = 'official_notes' then et.evidence_weight + 1
              else et.evidence_weight
            end as matched_weight
          from evidence_terms et
          join token_terms tt
            on tt.token = et.term
          where et.term <> ''
            and tt.token <> ''
        ),
        scored as (
          select
            facet_key,
            display_label,
            array_agg(distinct matched_term order by matched_term) as matched_terms,
            array_agg(distinct source_kind order by source_kind) as basis_sources,
            sum(matched_weight) as score,
            case
              when sum(matched_weight) >= 8 then 0.76
              when sum(matched_weight) >= 6 then 0.72
              when sum(matched_weight) >= 4 then 0.67
              else 0.62
            end as facet_confidence
          from matched_terms
          group by facet_key, display_label
        )
        select
          facet_key,
          display_label,
          matched_terms,
          basis_sources,
          score,
          facet_confidence
        from scored
        where score >= 4
        order by score desc, facet_key
        limit 6
      ) ranked_facets;

      if coalesce(v_facet_keys, array[]::text[]) && array['citrus', 'green', 'marine', 'ozonic']::text[]
         and coalesce(v_row.beast_mode_band, '') in ('LOW', 'MODERATE') then
        v_primary_role := 'brightener';
        v_secondary_role := 'bridge';
        v_primary_role_confidence := 0.68;
        v_secondary_role_confidence := 0.63;
        v_role_rationale := array['fresh_or_airy_notes_only_cluster', 'lighter_projection_profile', 'official_notes_only_supported'];
      elsif coalesce(v_facet_keys, array[]::text[]) && array['leather']::text[]
         and coalesce(v_facet_keys, array[]::text[]) && array['spicy', 'woody', 'amber']::text[] then
        v_primary_role := 'anchor';
        v_secondary_role := 'accent';
        v_primary_role_confidence := 0.66;
        v_secondary_role_confidence := 0.60;
        v_role_rationale := array['leather_structural_core', 'contrast_support_role', 'official_notes_only_supported'];
      elsif coalesce(v_facet_keys, array[]::text[]) && array['powdery', 'creamy', 'musk']::text[]
         and coalesce(v_row.beast_mode_band, '') in ('LOW', 'MODERATE') then
        v_primary_role := 'softener';
        v_secondary_role := 'aura';
        v_primary_role_confidence := 0.64;
        v_secondary_role_confidence := 0.59;
        v_role_rationale := array['diffusive_texture_support', 'soft_halo_profile', 'official_notes_only_supported'];
      elsif coalesce(v_facet_keys, array[]::text[]) && array['woody', 'spicy']::text[]
         and coalesce(v_row.beast_mode_band, '') in ('MODERATE', 'HIGH', 'EXTREME') then
        v_primary_role := 'anchor';
        v_secondary_role := 'accent';
        v_primary_role_confidence := 0.64;
        v_secondary_role_confidence := 0.58;
        v_role_rationale := array['structured_woody_spice_profile', 'official_notes_only_supported'];
      else
        v_primary_role := 'anchor';
        v_secondary_role := 'bridge';
        v_primary_role_confidence := 0.60;
        v_secondary_role_confidence := 0.55;
        v_role_rationale := array['fallback_structural_role', 'notes_only_lower_confidence'];
      end if;

      if v_primary_role is not null
         and not exists (
           select 1
           from public.wardrobe_role_reference_v1
           where active is true
             and role_key = v_primary_role
         ) then
        v_invalid_role_keys := array(
          select distinct x
          from unnest(v_invalid_role_keys || array[v_primary_role]) as t(x)
          where x <> ''
        );
        v_primary_role := null;
        v_primary_role_confidence := null;
      end if;

      if v_secondary_role is not null
         and not exists (
           select 1
           from public.wardrobe_role_reference_v1
           where active is true
             and role_key = v_secondary_role
         ) then
        v_invalid_role_keys := array(
          select distinct x
          from unnest(v_invalid_role_keys || array[v_secondary_role]) as t(x)
          where x <> ''
        );
        v_secondary_role := null;
        v_secondary_role_confidence := null;
      end if;

      select coalesce(
        jsonb_agg(role_payload order by ((role_payload ->> 'role_priority')::integer)),
        '[]'::jsonb
      )
      into v_proposed_roles
      from (
        select jsonb_build_object(
          'role_key', v_primary_role,
          'role_priority', 1,
          'confidence', v_primary_role_confidence,
          'rationale', to_jsonb(v_role_rationale)
        ) as role_payload
        where v_primary_role is not null
        union all
        select jsonb_build_object(
          'role_key', v_secondary_role,
          'role_priority', 2,
          'confidence', v_secondary_role_confidence,
          'rationale', to_jsonb(v_role_rationale)
        ) as role_payload
        where v_secondary_role is not null
          and v_secondary_role <> v_primary_role
      ) roles;

      v_role_count := jsonb_array_length(v_proposed_roles);

      v_proposed_confidence := least(
        0.74,
        0.34
        + case
            when coalesce(v_row.notes_count, 0) >= 7 then 0.09
            when coalesce(v_row.notes_count, 0) >= 5 then 0.07
            when coalesce(v_row.notes_count, 0) >= 4 then 0.05
            else 0.02
          end
        + least(greatest(coalesce(v_facet_count, 0) - 2, 0) * 0.04, 0.10)
        + case
            when v_role_count >= 2 then 0.04
            when v_role_count = 1 then 0.02
            else 0
          end
        + case
            when coalesce(v_row.signal_count, 0) >= 6 then 0.03
            when coalesce(v_row.signal_count, 0) >= 3 then 0.02
            when coalesce(v_row.signal_count, 0) > 0 then 0.01
            else 0
          end
        + case
            when coalesce(v_row.source_count, 0) >= 3 then 0.02
            when coalesce(v_row.source_count, 0) >= 2 then 0.01
            else 0
          end
        + case
            when coalesce(v_row.source_confidence_numeric, 0) >= 0.99 then 0.03
            when coalesce(v_row.source_confidence_numeric, 0) >= 0.95 then 0.02
            else 0
          end
        + case
            when coalesce(v_row.performance_refresh_satisfied, false) then 0.02
            else 0
          end
        - case
            when coalesce(v_row.notes_count, 0) < 5 then 0.02
            else 0
          end
      );

      if v_facet_count < 3 then
        v_proposal_status := 'needs_manual_review';
        v_blocker_reason := 'too_few_supported_facets';
      elsif v_role_count = 0 then
        v_proposal_status := 'needs_manual_review';
        v_blocker_reason := 'no_supported_role_mapping';
      elsif v_proposed_confidence >= 0.60 then
        v_proposal_status := 'proposed';
        v_blocker_reason := null;
      else
        v_proposal_status := 'needs_manual_review';
        v_blocker_reason := 'low_notes_only_proposal_confidence';
      end if;

      v_proposed_review_status := case
        when v_proposed_confidence >= 0.68 then 'medium_confidence'
        else 'low_confidence'
      end;

      v_evidence_summary := jsonb_build_object(
        'proposal_basis', 'official_notes_only_reviewed_queue_routed',
        'notes_only_limitations_preserved', true,
        'lower_confidence_than_official_pyramid', true,
        'source_evidence_type', 'official_notes_only',
        'source_limitation_reason', 'no_official_note_pyramid_provided',
        'queue_state', v_row.queue_state,
        'queue_lane', v_row.queue_lane,
        'queue_recommended_next_action', v_row.queue_recommended_next_action,
        'queue_model_version', v_row.queue_model_version,
        'official_notes_review_id', v_row.latest_review_id,
        'official_notes_review_status', v_row.review_status,
        'official_notes_review_reason', v_row.review_decision_reason,
        'official_source_url', v_row.source_url,
        'official_source_confidence', v_row.source_confidence_numeric,
        'official_notes', to_jsonb(coalesce(v_row.notes, array[]::text[])),
        'notes_count', v_row.notes_count,
        'top_notes_basis', to_jsonb(coalesce(v_row.top_notes, array[]::text[])),
        'heart_notes_basis', to_jsonb(coalesce(v_row.heart_notes, array[]::text[])),
        'base_notes_basis', to_jsonb(coalesce(v_row.base_notes, array[]::text[])),
        'facet_keys', to_jsonb(coalesce(v_facet_keys, array[]::text[])),
        'facet_count', v_facet_count,
        'role_count', v_role_count,
        'role_rationale', to_jsonb(coalesce(v_role_rationale, array[]::text[])),
        'selected_official_source_backfill_audit_id', v_row.selected_official_source_backfill_audit_id,
        'official_source_backfill_actor_label', v_row.backfill_actor_label,
        'official_source_backfill_reason', v_row.backfill_reason,
        'official_source_backfill_created_at', v_row.backfill_created_at,
        'review_source_snapshot', coalesce(v_row.review_source_snapshot, '{}'::jsonb),
        'review_evidence_snapshot', coalesce(v_row.review_evidence_snapshot, '{}'::jsonb),
        'review_queue_snapshot', coalesce(v_row.review_queue_snapshot, '{}'::jsonb),
        'queue_evidence_summary', coalesce(v_row.queue_evidence_summary, '{}'::jsonb),
        'previous_proposal_id', v_row.prior_proposal_id,
        'previous_proposal_status', v_row.prior_proposal_status,
        'previous_proposal_model_version', v_row.prior_classifier_model_version
      );

      v_source_summary := jsonb_build_object(
        'source_truth_accepted', true,
        'basis', 'official_notes_only_review_gate_v1',
        'source_type', 'official_brand',
        'source_url', v_row.source_url,
        'source_confidence', v_row.source_confidence_numeric,
        'source_evidence_type', 'official_notes_only',
        'source_limitation_reason', 'no_official_note_pyramid_provided',
        'official_notes_review_id', v_row.latest_review_id,
        'official_notes_review_status', v_row.review_status,
        'official_notes_review_recommended_next_action', v_row.review_recommended_next_action,
        'selected_official_source_backfill_audit_id', v_row.selected_official_source_backfill_audit_id,
        'official_source_backfill_actor_label', v_row.backfill_actor_label,
        'official_source_backfill_reason', v_row.backfill_reason,
        'official_notes_list', to_jsonb(coalesce(v_row.notes, array[]::text[])),
        'notes_only_classifier_model_limitation', 'proposal_only_lower_confidence_than_official_pyramid'
      );

      v_performance_summary := jsonb_build_object(
        'performance_refresh_satisfied', v_row.performance_refresh_satisfied,
        'signal_count', v_row.signal_count,
        'source_count', v_row.source_count,
        'beast_mode_band', v_row.beast_mode_band,
        'recommended_spray_caution', v_row.recommended_spray_caution,
        'performance_model_version', v_row.performance_model_version,
        'performance_updated_at', v_row.performance_updated_at
      );

      v_eligible_count := v_eligible_count + 1;

      if p_dry_run then
        v_result_status := 'would_propose';
        v_would_propose_count := v_would_propose_count + 1;
      else
        insert into public.fragrance_taxonomy_proposals_v1 (
          fragrance_id,
          proposal_status,
          proposed_universal_family_key,
          proposed_facets,
          proposed_wardrobe_roles,
          proposed_confidence,
          proposed_review_status,
          blocker_reason,
          evidence_summary,
          source_summary,
          performance_summary,
          classifier_model_version,
          source_model_version,
          queue_model_version,
          created_by,
          created_at,
          updated_at
        )
        values (
          v_row.fragrance_id,
          v_proposal_status,
          v_proposed_universal_family_key,
          v_proposed_facets,
          v_proposed_roles,
          v_proposed_confidence,
          v_proposed_review_status,
          v_blocker_reason,
          v_evidence_summary,
          v_source_summary,
          v_performance_summary,
          v_classifier_model_version,
          v_row.review_source_queue_model_version,
          v_row.queue_model_version,
          v_actor_label,
          now(),
          now()
        )
        on conflict (fragrance_id, classifier_model_version) do nothing
        returning id into v_inserted_id;

        if v_inserted_id is null then
          v_result_status := 'skipped';
          v_blocker_reason := coalesce(v_blocker_reason, 'existing_model_version_proposal');
          v_skipped_count := v_skipped_count + 1;
        else
          v_result_status := 'proposed';
          v_proposed_count := v_proposed_count + 1;
        end if;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'fragrance_id', coalesce(v_row.fragrance_id, v_row.requested_fragrance_id),
        'name', v_row.name,
        'brand', v_row.brand,
        'result_status', v_result_status,
        'proposal_id', v_inserted_id,
        'proposal_status', v_proposal_status,
        'proposed_universal_family_key', v_proposed_universal_family_key,
        'proposed_facets', v_proposed_facets,
        'proposed_wardrobe_roles', v_proposed_roles,
        'proposed_confidence', v_proposed_confidence,
        'proposed_review_status', v_proposed_review_status,
        'blocker_reason', v_blocker_reason,
        'classifier_model_version', v_classifier_model_version,
        'source_model_version', v_row.review_source_queue_model_version,
        'queue_model_version', v_row.queue_model_version,
        'official_notes_review_id', v_row.latest_review_id,
        'official_source_backfill_audit_id', v_row.selected_official_source_backfill_audit_id,
        'official_source_url', v_row.source_url,
        'official_source_confidence', v_row.source_confidence_numeric,
        'evidence_summary', v_evidence_summary,
        'source_summary', v_source_summary,
        'performance_summary', v_performance_summary
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'classifier_model_version', v_classifier_model_version,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'eligible_count', v_eligible_count,
    'would_propose_count', v_would_propose_count,
    'proposed_count', v_proposed_count,
    'rejected_count', v_rejected_count,
    'skipped_count', v_skipped_count,
    'invalid_family_keys', v_invalid_family_keys,
    'invalid_facet_keys', v_invalid_facet_keys,
    'invalid_role_keys', v_invalid_role_keys,
    'results', v_results
  );
end;
$function$;

revoke all on function public.propose_fragrance_taxonomy_v1_official_notes_only(uuid[], text, boolean) from public;
revoke all on function public.propose_fragrance_taxonomy_v1_official_notes_only(uuid[], text, boolean) from anon;
revoke all on function public.propose_fragrance_taxonomy_v1_official_notes_only(uuid[], text, boolean) from authenticated;
grant execute on function public.propose_fragrance_taxonomy_v1_official_notes_only(uuid[], text, boolean) to service_role;

comment on function public.propose_fragrance_taxonomy_v1_official_notes_only(uuid[], text, boolean) is
  'Generates proposal-only classifier rows for explicit official_notes_accepted_pending_classifier_review candidates using accepted official-notes-only review decisions, exact official_brand source lineage, live active family/facet/role keys, and refreshed performance features. Dry-run writes nothing. Live mode only inserts into public.fragrance_taxonomy_proposals_v1 and never writes final taxonomy, mutates public.fragrances, or refreshes queue/performance.';

commit;
