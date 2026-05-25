begin;

create or replace function public.propose_fragrance_taxonomy_v4_official_source_queue(
  p_fragrance_ids uuid[],
  p_actor_label text default 'codex_classifier_proposal_v4_official_source_queue',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_distinct_ids uuid[];
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_classifier_proposal_v4_official_source_queue');
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_eligible_count integer := 0;
  v_would_propose_count integer := 0;
  v_proposed_count integer := 0;
  v_rejected_count integer := 0;
  v_skipped_count integer := 0;
  v_max_ids constant integer := 25;
  v_classifier_model_version constant text := 'taxonomy_classifier_proposal_v4_official_source_queue_2026_05_25';
  v_source_model_version constant text := 'official_source_backfill_v1_2026_05_25';
  v_results jsonb := '[]'::jsonb;
  v_invalid_facet_keys jsonb := '[]'::jsonb;
  v_invalid_role_keys jsonb := '[]'::jsonb;
  v_row record;
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
begin
  select array_agg(distinct fragrance_id order by fragrance_id)
  into v_distinct_ids
  from unnest(coalesce(p_fragrance_ids, array[]::uuid[])) as fragrance_id
  where fragrance_id is not null;

  v_requested_count := coalesce(cardinality(v_distinct_ids), 0);

  if v_requested_count = 0 then
    raise exception 'propose_fragrance_taxonomy_v4_official_source_queue requires explicit non-empty fragrance ids';
  end if;

  if v_requested_count > v_max_ids then
    raise exception 'propose_fragrance_taxonomy_v4_official_source_queue accepts at most % fragrance ids per call', v_max_ids;
  end if;

  for v_row in
    with requested as (
      select unnest(v_distinct_ids) as fragrance_id
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
    ),
    existing_v4 as (
      select fragrance_id, id as proposal_id
      from public.fragrance_taxonomy_proposals_v1
      where classifier_model_version = v_classifier_model_version
        and fragrance_id = any (v_distinct_ids)
    ),
    latest_prior_proposal as (
      select distinct on (fragrance_id)
        fragrance_id,
        id as prior_proposal_id,
        classifier_model_version as prior_classifier_model_version,
        proposal_status as prior_proposal_status,
        blocker_reason as prior_blocker_reason,
        proposed_confidence as prior_proposed_confidence,
        proposed_universal_family_key as prior_proposed_universal_family_key,
        proposed_facets as prior_proposed_facets,
        proposed_wardrobe_roles as prior_proposed_wardrobe_roles,
        created_by as prior_created_by,
        created_at as prior_created_at
      from public.fragrance_taxonomy_proposals_v1
      where fragrance_id = any (v_distinct_ids)
        and classifier_model_version <> v_classifier_model_version
      order by fragrance_id, created_at desc, id desc
    )
    select
      req.fragrance_id as requested_fragrance_id,
      f.id as fragrance_id,
      coalesce(q.name, f.name) as name,
      coalesce(q.brand, f.brand) as brand,
      q.queue_state,
      q.queue_lane,
      q.blocker_reason as queue_blocker_reason,
      q.recommended_next_action as queue_recommended_next_action,
      q.evidence_summary as queue_evidence_summary,
      q.source_snapshot_summary,
      q.queue_model_version as queue_snapshot_model_version,
      q.source_queue_model_version as queue_source_model_version,
      q.source_view_name,
      f.family_key,
      fkr.universal_equivalent as universal_family_key,
      f.notes,
      f.accords,
      f.top_notes,
      f.heart_notes,
      f.base_notes,
      f.source_url,
      f.source_confidence,
      coalesce(cardinality(f.notes), 0) as notes_count,
      coalesce(cardinality(f.accords), 0) as accords_count,
      coalesce(cardinality(f.top_notes), 0) as top_notes_count,
      coalesce(cardinality(f.heart_notes), 0) as heart_notes_count,
      coalesce(cardinality(f.base_notes), 0) as base_notes_count,
      pr.latest_review_id as provenance_review_id,
      pr.review_status as provenance_review_status,
      pr.provenance_category,
      pr.review_reason as provenance_review_reason,
      pr.recommended_next_action as provenance_recommended_next_action,
      pr.actor_label as provenance_actor_label,
      pr.evidence_snapshot as provenance_evidence_snapshot,
      pr.source_snapshot as provenance_source_snapshot,
      pr.performance_snapshot as provenance_performance_snapshot,
      pr.taxonomy_snapshot as provenance_taxonomy_snapshot,
      pr.reference_gap_summary,
      pr.source_queue_model_version as provenance_source_queue_model_version,
      coalesce(pf.signal_count, 0) as signal_count,
      coalesce(pf.source_count, 0) as source_count,
      pf.beast_mode_band,
      pf.recommended_spray_caution,
      pf.model_version as performance_model_version,
      pf.updated_at as performance_updated_at,
      coalesce(ff.facet_count, 0) as existing_final_facet_count,
      coalesce(fr.role_count, 0) as existing_final_role_count,
      coalesce(rv.review_count, 0) as existing_review_count,
      ex.proposal_id as existing_v4_proposal_id,
      pp.prior_proposal_id,
      pp.prior_classifier_model_version,
      pp.prior_proposal_status,
      pp.prior_blocker_reason,
      pp.prior_proposed_confidence,
      pp.prior_proposed_universal_family_key,
      pp.prior_proposed_facets,
      pp.prior_proposed_wardrobe_roles,
      pp.prior_created_by,
      pp.prior_created_at,
      e.selected_official_source_backfill_audit_id as backfill_audit_id,
      e.official_source_type,
      e.official_source_url as audit_source_url,
      e.audit_source_confidence,
      e.official_source_backfill_actor_label,
      e.official_source_backfill_reason,
      e.official_source_changed_fields as backfill_changed_fields,
      e.official_source_accords_preserved,
      e.performance_refresh_required,
      e.official_source_before_snapshot,
      e.official_source_after_snapshot,
      e.official_source_payload as backfill_source_payload,
      e.official_source_verification_summary as source_verification_summary,
      e.official_source_backfill_created_at as backfill_created_at,
      e.duplicate_audit_count,
      e.source_confidence_numeric,
      e.has_matching_official_source_backfill,
      e.has_official_note_pyramid,
      e.official_source_performance_refresh_satisfied,
      e.performance_refresh_run_id,
      e.performance_refresh_status,
      e.performance_refresh_started_at,
      e.performance_refresh_finished_at,
      e.performance_refresh_model_version as refresh_run_model_version,
      e.performance_refresh_row_count,
      e.performance_refresh_signal_count,
      e.performance_refresh_feature_update_count,
      e.performance_refresh_warning_count,
      e.performance_refresh_error_count,
      e.performance_refresh_notes,
      e.performance_refresh_metadata,
      e.official_source_evidence_summary
    from requested req
    left join public.fragrances f
      on f.id = req.fragrance_id
    left join public.taxonomy_operationalization_queue_current_v1 q
      on q.fragrance_id = req.fragrance_id
    left join public.taxonomy_official_source_queue_evidence_v1 e
      on e.fragrance_id = req.fragrance_id
    left join public.fragrance_provenance_review_latest_v1 pr
      on pr.fragrance_id = req.fragrance_id
    left join public.family_key_reference_v1 fkr
      on fkr.family_key = f.family_key
     and fkr.active is true
    left join public.fragrance_performance_features_v1 pf
      on pf.fragrance_id = req.fragrance_id
    left join final_facets ff
      on ff.fragrance_id = req.fragrance_id
    left join final_roles fr
      on fr.fragrance_id = req.fragrance_id
    left join final_reviews rv
      on rv.fragrance_id = req.fragrance_id
    left join existing_v4 ex
      on ex.fragrance_id = req.fragrance_id
    left join latest_prior_proposal pp
      on pp.fragrance_id = req.fragrance_id
    order by coalesce(q.name, f.name), coalesce(q.brand, f.brand), req.fragrance_id
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
    elsif v_row.queue_state <> 'official_source_pending_classifier_review'
       or v_row.queue_lane <> 'controlled_classifier_review' then
      v_result_status := 'rejected';
      v_blocker_reason := 'not_official_source_classifier_review_candidate';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.queue_recommended_next_action <> 'controlled_classifier_review_candidate' then
      v_result_status := 'rejected';
      v_blocker_reason := 'not_controlled_classifier_review_candidate';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.notes_count, 0) = 0 or coalesce(v_row.accords_count, 0) = 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_notes_or_accords';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.top_notes_count, 0) = 0
       or coalesce(v_row.heart_notes_count, 0) = 0
       or coalesce(v_row.base_notes_count, 0) = 0
       or coalesce(v_row.has_official_note_pyramid, false) is false then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_official_note_pyramid';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(nullif(v_row.family_key, ''), '') = '' then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_family_key';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(nullif(v_row.source_url, ''), '') = '' or coalesce(nullif(v_row.source_confidence, ''), '') = '' then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_official_source_fields';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.backfill_audit_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'official_source_backfill_missing';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.has_matching_official_source_backfill, false) is false
       or v_row.audit_source_url is distinct from v_row.source_url
       or v_row.audit_source_confidence is distinct from v_row.source_confidence then
      v_result_status := 'rejected';
      v_blocker_reason := 'official_source_audit_mismatch';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.source_confidence_numeric, 0) < 0.95 then
      v_result_status := 'rejected';
      v_blocker_reason := 'official_source_confidence_below_threshold';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.official_source_performance_refresh_satisfied, false) is false then
      v_result_status := 'rejected';
      v_blocker_reason := 'official_source_performance_refresh_missing';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.existing_final_facet_count, 0) > 0
       or coalesce(v_row.existing_final_role_count, 0) > 0
       or coalesce(v_row.existing_review_count, 0) > 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'existing_final_taxonomy_present';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.existing_v4_proposal_id is not null then
      v_result_status := 'skipped';
      v_blocker_reason := 'existing_model_version_proposal';
      v_skipped_count := v_skipped_count + 1;
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
          select unnest(coalesce(v_row.accords, array[]::text[])) as token, 'payload_accords'::text as source_kind
          union all
          select v_row.family_key as token, 'family'::text as source_kind
          union all
          select v_row.universal_family_key as token, 'family'::text as source_kind
          union all
          select nullif(btrim(coalesce(v_row.source_verification_summary ->> 'official_family_direction', '')), '') as token, 'official_family'::text as source_kind
        ),
        normalized_tokens as (
          select
            public.taxonomy_norm_text_v1(token) as token,
            source_kind
          from raw_tokens
          where token is not null
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
              when tt.source_kind = 'official_family' then et.evidence_weight + 2
              when tt.source_kind = 'official_notes' then et.evidence_weight + 1
              else et.evidence_weight + 1
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
              when sum(matched_weight) >= 8 then 0.82
              when sum(matched_weight) >= 6 then 0.77
              when sum(matched_weight) >= 4 then 0.72
              else 0.67
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
        v_primary_role_confidence := 0.76;
        v_secondary_role_confidence := 0.70;
        v_role_rationale := array['fresh_or_airy_facet_cluster', 'lighter_projection_profile', 'official_source_supported'];
      elsif coalesce(v_row.signal_count, 0) >= 8
         and coalesce(v_row.beast_mode_band, '') in ('MODERATE', 'HIGH', 'EXTREME')
         and coalesce(v_facet_keys, array[]::text[]) @> array['gourmand']::text[]
         and coalesce(v_facet_keys, array[]::text[]) && array['spicy', 'amber']::text[] then
        v_primary_role := 'soloist';
        v_secondary_role := 'anchor';
        v_primary_role_confidence := 0.78;
        v_secondary_role_confidence := 0.70;
        v_role_rationale := array['dense_gourmand_profile', 'higher_signal_statement_candidate', 'official_source_supported'];
      elsif coalesce(v_row.beast_mode_band, '') in ('HIGH', 'EXTREME')
         or coalesce(v_row.recommended_spray_caution, '') in ('one_spray_anchor', 'avoid_stacking_loud') then
        v_primary_role := 'anchor';
        v_secondary_role := case
          when coalesce(v_facet_keys, array[]::text[]) && array['powdery', 'creamy', 'musk']::text[] then 'softener'
          else 'accent'
        end;
        v_primary_role_confidence := 0.75;
        v_secondary_role_confidence := 0.67;
        v_role_rationale := array['high_projection_or_spray_caution', 'structured_core_use_case', 'official_source_supported'];
      elsif coalesce(v_facet_keys, array[]::text[]) && array['leather']::text[]
         and coalesce(v_facet_keys, array[]::text[]) && array['amber', 'spicy', 'woody']::text[] then
        v_primary_role := 'anchor';
        v_secondary_role := 'accent';
        v_primary_role_confidence := 0.73;
        v_secondary_role_confidence := 0.66;
        v_role_rationale := array['leather_structural_core', 'contrast_support_role', 'official_source_supported'];
      elsif (
           coalesce(v_facet_keys, array[]::text[]) && array['gourmand']::text[]
           or coalesce(v_proposed_universal_family_key, '') = 'gourmand'
         )
         and coalesce(v_facet_keys, array[]::text[]) && array['fruity', 'aromatic', 'floral']::text[]
         and coalesce(v_row.beast_mode_band, '') in ('LOW', 'MODERATE') then
        v_primary_role := 'accent';
        v_secondary_role := 'bridge';
        v_primary_role_confidence := 0.71;
        v_secondary_role_confidence := 0.66;
        v_role_rationale := array['sweet_color_role', 'connective_wear_flexibility', 'official_source_supported'];
      elsif coalesce(v_facet_keys, array[]::text[]) && array['powdery', 'creamy', 'musk']::text[]
         and coalesce(v_row.beast_mode_band, '') in ('LOW', 'MODERATE') then
        v_primary_role := 'softener';
        v_secondary_role := 'aura';
        v_primary_role_confidence := 0.70;
        v_secondary_role_confidence := 0.64;
        v_role_rationale := array['diffusive_texture_support', 'soft_halo_profile', 'official_source_supported'];
      else
        v_primary_role := 'anchor';
        v_secondary_role := null;
        v_primary_role_confidence := 0.65;
        v_secondary_role_confidence := null;
        v_role_rationale := array['fallback_structural_role', 'official_source_supported'];
      end if;

      if v_primary_role is not null
         and not exists (
           select 1
           from public.wardrobe_role_reference_v1
           where active is true
             and role_key = v_primary_role
         ) then
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
        0.88,
        0.47
        + least(greatest(coalesce(v_facet_count, 0) - 2, 0) * 0.04, 0.12)
        + case
            when v_role_count >= 2 then 0.05
            when v_role_count = 1 then 0.03
            else 0
          end
        + case
            when coalesce(v_row.signal_count, 0) >= 8 then 0.04
            when coalesce(v_row.signal_count, 0) >= 4 then 0.03
            when coalesce(v_row.signal_count, 0) > 0 then 0.02
            else 0
          end
        + case
            when coalesce(v_row.source_count, 0) >= 3 then 0.03
            when coalesce(v_row.source_count, 0) >= 2 then 0.02
            when coalesce(v_row.source_count, 0) = 1 then 0.01
            else 0
          end
        + case
            when coalesce(nullif(v_proposed_universal_family_key, ''), '') <> '' then 0.02
            else 0
          end
        + case
            when v_row.backfill_audit_id is not null
             and coalesce(v_row.source_confidence_numeric, 0) >= 0.95
            then 0.05
            else 0
          end
        + case
            when coalesce(v_row.official_source_performance_refresh_satisfied, false) then 0.03
            else 0
          end
        + case
            when coalesce(v_row.has_official_note_pyramid, false) then 0.03
            else 0
          end
        + case
            when v_row.queue_state = 'official_source_pending_classifier_review' then 0.02
            else 0
          end
        - case
            when coalesce(v_row.notes_count, 0) < 6 then 0.03
            else 0
          end
      );

      if v_facet_count < 3 then
        v_proposal_status := 'needs_manual_review';
        v_blocker_reason := 'too_few_supported_facets';
      elsif v_role_count = 0 then
        v_proposal_status := 'needs_manual_review';
        v_blocker_reason := 'no_supported_role_mapping';
      elsif v_proposed_confidence >= 0.68 then
        v_proposal_status := 'proposed';
        v_blocker_reason := null;
      else
        v_proposal_status := 'needs_manual_review';
        v_blocker_reason := 'low_proposal_confidence';
      end if;

      v_proposed_review_status := case
        when v_proposed_confidence >= 0.80 then 'confirmed'
        when v_proposed_confidence >= 0.66 then 'medium_confidence'
        else 'low_confidence'
      end;

      v_evidence_summary := jsonb_build_object(
        'family_key', v_row.family_key,
        'proposed_universal_family_key', v_proposed_universal_family_key,
        'queue_state', v_row.queue_state,
        'queue_lane', v_row.queue_lane,
        'queue_blocker_reason', v_row.queue_blocker_reason,
        'queue_recommended_next_action', v_row.queue_recommended_next_action,
        'queue_snapshot_model_version', v_row.queue_snapshot_model_version,
        'queue_source_model_version', v_row.queue_source_model_version,
        'queue_source_view_name', v_row.source_view_name,
        'notes_count', v_row.notes_count,
        'accords_count', v_row.accords_count,
        'notes_basis', to_jsonb(coalesce(v_row.notes, array[]::text[])),
        'accords_basis', to_jsonb(coalesce(v_row.accords, array[]::text[])),
        'top_notes_basis', to_jsonb(coalesce(v_row.top_notes, array[]::text[])),
        'heart_notes_basis', to_jsonb(coalesce(v_row.heart_notes, array[]::text[])),
        'base_notes_basis', to_jsonb(coalesce(v_row.base_notes, array[]::text[])),
        'facet_keys', to_jsonb(coalesce(v_facet_keys, array[]::text[])),
        'facet_count', v_facet_count,
        'role_count', v_role_count,
        'role_rationale', to_jsonb(coalesce(v_role_rationale, array[]::text[])),
        'official_source_url', v_row.source_url,
        'official_source_confidence', v_row.source_confidence,
        'official_source_backfill_audit_id', v_row.backfill_audit_id,
        'duplicate_audit_count', coalesce(v_row.duplicate_audit_count, 0),
        'official_source_backfill_actor_label', v_row.official_source_backfill_actor_label,
        'official_source_backfill_reason', v_row.official_source_backfill_reason,
        'official_source_verification_summary', coalesce(v_row.source_verification_summary, '{}'::jsonb),
        'official_source_evidence_summary', coalesce(v_row.official_source_evidence_summary, '{}'::jsonb),
        'performance_refresh_run_id', v_row.performance_refresh_run_id,
        'performance_refresh_status', v_row.performance_refresh_status,
        'previous_proposal_id', v_row.prior_proposal_id,
        'previous_proposal_status', v_row.prior_proposal_status,
        'previous_proposal_model_version', v_row.prior_classifier_model_version,
        'previous_proposal_confidence', v_row.prior_proposed_confidence,
        'provenance_review_id', v_row.provenance_review_id,
        'provenance_review_status', v_row.provenance_review_status,
        'provenance_category', v_row.provenance_category,
        'provenance_review_reason', v_row.provenance_review_reason,
        'reference_gap_summary', coalesce(v_row.reference_gap_summary, '{}'::jsonb),
        'queue_provenance_summary', coalesce(v_row.queue_evidence_summary -> 'provenance', '{}'::jsonb),
        'queue_official_source_summary', coalesce(v_row.queue_evidence_summary -> 'official_source', '{}'::jsonb),
        'provenance_evidence_snapshot', coalesce(v_row.provenance_evidence_snapshot, '{}'::jsonb)
      );

      v_source_summary := jsonb_build_object(
        'source_truth_accepted', true,
        'basis', 'official_brand_backfill_queue_routed',
        'source_type', 'official_brand',
        'source_url', v_row.source_url,
        'source_confidence', v_row.source_confidence,
        'official_source_backfill_audit_id', v_row.backfill_audit_id,
        'duplicate_audit_count', coalesce(v_row.duplicate_audit_count, 0),
        'official_source_backfill_actor_label', v_row.official_source_backfill_actor_label,
        'official_source_backfill_reason', v_row.official_source_backfill_reason,
        'official_source_backfill_created_at', v_row.backfill_created_at,
        'official_source_changed_fields', to_jsonb(coalesce(v_row.backfill_changed_fields, array[]::text[])),
        'accords_preserved', v_row.official_source_accords_preserved,
        'source_verification_summary', coalesce(v_row.source_verification_summary, '{}'::jsonb),
        'source_payload', coalesce(v_row.backfill_source_payload, '{}'::jsonb),
        'official_source_before_snapshot', coalesce(v_row.official_source_before_snapshot, '{}'::jsonb),
        'official_source_after_snapshot', coalesce(v_row.official_source_after_snapshot, '{}'::jsonb),
        'previous_proposal_id', v_row.prior_proposal_id,
        'previous_proposal_status', v_row.prior_proposal_status,
        'previous_proposal_model_version', v_row.prior_classifier_model_version,
        'provenance_review_id', v_row.provenance_review_id,
        'provenance_review_status', v_row.provenance_review_status,
        'provenance_category', v_row.provenance_category,
        'provenance_actor_label', v_row.provenance_actor_label,
        'provenance_recommended_next_action', v_row.provenance_recommended_next_action,
        'provenance_source_queue_model_version', v_row.provenance_source_queue_model_version,
        'provenance_source_snapshot', coalesce(v_row.provenance_source_snapshot, '{}'::jsonb),
        'queue_source_snapshot_summary', coalesce(v_row.source_snapshot_summary, '{}'::jsonb)
      );

      v_performance_summary := jsonb_build_object(
        'signal_count', v_row.signal_count,
        'source_count', v_row.source_count,
        'beast_mode_band', v_row.beast_mode_band,
        'recommended_spray_caution', v_row.recommended_spray_caution,
        'performance_model_version', v_row.performance_model_version,
        'performance_updated_at', v_row.performance_updated_at,
        'performance_refresh_run_id', v_row.performance_refresh_run_id,
        'performance_refresh_status', v_row.performance_refresh_status,
        'performance_refresh_started_at', v_row.performance_refresh_started_at,
        'performance_refresh_finished_at', v_row.performance_refresh_finished_at,
        'performance_refresh_model_version', v_row.refresh_run_model_version,
        'performance_refresh_row_count', v_row.performance_refresh_row_count,
        'performance_refresh_signal_count', v_row.performance_refresh_signal_count,
        'performance_refresh_feature_update_count', v_row.performance_refresh_feature_update_count,
        'performance_refresh_warning_count', v_row.performance_refresh_warning_count,
        'performance_refresh_error_count', v_row.performance_refresh_error_count,
        'performance_refresh_notes', v_row.performance_refresh_notes,
        'performance_refresh_metadata', coalesce(v_row.performance_refresh_metadata, '{}'::jsonb),
        'performance_snapshot', coalesce(v_row.provenance_performance_snapshot, '{}'::jsonb),
        'taxonomy_snapshot', coalesce(v_row.provenance_taxonomy_snapshot, '{}'::jsonb)
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
          v_source_model_version,
          v_row.queue_source_model_version,
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
        'source_model_version', v_source_model_version,
        'queue_model_version', v_row.queue_source_model_version,
        'prior_proposal_id', v_row.prior_proposal_id,
        'prior_proposal_status', v_row.prior_proposal_status,
        'prior_classifier_model_version', v_row.prior_classifier_model_version,
        'official_source_backfill_audit_id', v_row.backfill_audit_id,
        'official_source_url', v_row.source_url,
        'official_source_confidence', v_row.source_confidence,
        'duplicate_audit_count', coalesce(v_row.duplicate_audit_count, 0),
        'performance_refresh_run_id', v_row.performance_refresh_run_id,
        'provenance_review_id', v_row.provenance_review_id,
        'provenance_review_status', v_row.provenance_review_status,
        'provenance_category', v_row.provenance_category,
        'evidence_summary', v_evidence_summary,
        'source_summary', v_source_summary,
        'performance_summary', v_performance_summary
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'classifier_model_version', v_classifier_model_version,
    'source_model_version', v_source_model_version,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'eligible_count', v_eligible_count,
    'would_propose_count', v_would_propose_count,
    'proposed_count', v_proposed_count,
    'rejected_count', v_rejected_count,
    'skipped_count', v_skipped_count,
    'invalid_facet_keys', v_invalid_facet_keys,
    'invalid_role_keys', v_invalid_role_keys,
    'results', v_results
  );
end;
$function$;

revoke all on function public.propose_fragrance_taxonomy_v4_official_source_queue(uuid[], text, boolean) from public;
revoke all on function public.propose_fragrance_taxonomy_v4_official_source_queue(uuid[], text, boolean) from anon;
revoke all on function public.propose_fragrance_taxonomy_v4_official_source_queue(uuid[], text, boolean) from authenticated;
grant execute on function public.propose_fragrance_taxonomy_v4_official_source_queue(uuid[], text, boolean) to service_role;

comment on function public.propose_fragrance_taxonomy_v4_official_source_queue(uuid[], text, boolean) is
  'Generates proposal-only classifier rows for explicit official_source_pending_classifier_review candidates using official-brand backfill evidence, deduped official-source audit lineage, current queue gating, and refreshed performance summaries. Dry-run writes nothing. Live mode only inserts into public.fragrance_taxonomy_proposals_v1 and never writes final taxonomy, mutates public.fragrances, or refreshes queue/performance.';

commit;
