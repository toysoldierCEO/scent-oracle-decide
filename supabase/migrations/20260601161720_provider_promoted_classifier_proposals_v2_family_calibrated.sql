begin;

create or replace function public.propose_fragrance_taxonomy_v2_provider_promoted(
  p_fragrance_ids uuid[],
  p_actor_label text default 'codex_provider_promoted_classifier_proposal_v2',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_provider_promoted_classifier_proposal_v2');
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
  v_classifier_model_version constant text := 'taxonomy_classifier_proposal_v2_provider_promoted_family_calibrated_2026_06_01';
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
  v_family_scores jsonb;
  v_family_top_score numeric;
  v_family_second_score numeric;
  v_family_winning_margin numeric;
  v_family_note_hits integer;
  v_family_accord_hits integer;
  v_family_distinct_terms integer;
  v_family_support_terms text[];
  v_family_competitive_count integer;
  v_family_competition_status text;
  v_family_blocker_reason text;
  v_facet_keys text[];
  v_facet_count integer;
  v_role_count integer;
  v_primary_role text;
  v_secondary_role text;
  v_primary_role_confidence numeric;
  v_secondary_role_confidence numeric;
  v_role_rationale text[];
  v_inserted_id uuid;
  v_has_manual_review_penalty boolean;
  v_row record;
begin
  if p_fragrance_ids is null or v_requested_count = 0 then
    raise exception 'propose_fragrance_taxonomy_v2_provider_promoted requires explicit non-empty fragrance ids';
  end if;

  select coalesce(array_agg(distinct x order by x), array[]::uuid[])
  into v_distinct_ids
  from unnest(p_fragrance_ids) as x
  where x is not null;

  v_distinct_requested_count := coalesce(array_length(v_distinct_ids, 1), 0);

  if v_distinct_requested_count = 0 then
    raise exception 'propose_fragrance_taxonomy_v2_provider_promoted requires at least one non-null uuid';
  end if;

  if v_distinct_requested_count > v_max_ids then
    raise exception 'propose_fragrance_taxonomy_v2_provider_promoted accepts at most % fragrance ids per call', v_max_ids;
  end if;

  for v_row in
    with latest_notes_promotion as (
      select distinct on (p.fragrance_id)
        p.fragrance_id,
        p.id as notes_promotion_audit_id,
        p.actor_label as notes_promotion_actor_label,
        p.reason as notes_promotion_reason,
        p.source_url as promoted_source_url,
        p.source_confidence as promoted_source_confidence,
        p.match_name as promoted_match_name,
        p.match_brand as promoted_match_brand,
        p.canonical_notes_after,
        p.canonical_accords_after,
        p.function_version as notes_promotion_function_version,
        p.promoted_at as notes_promoted_at
      from public.fragrance_text_enrichment_notes_promotions_v1 p
      where p.fragrance_id = any (v_distinct_ids)
        and p.result_status = 'notes_promoted'
      order by p.fragrance_id, p.promoted_at desc nulls last, p.created_at desc, p.id desc
    ),
    latest_full_promotion as (
      select distinct on (p.fragrance_id)
        p.fragrance_id,
        p.id as full_promotion_audit_id,
        p.actor_label as full_promotion_actor_label,
        p.source_url as promoted_source_url,
        p.source_confidence as promoted_source_confidence,
        p.match_name as promoted_match_name,
        p.match_brand as promoted_match_brand,
        p.after_notes as canonical_notes_after,
        p.after_accords as canonical_accords_after,
        p.function_version as full_promotion_function_version,
        p.promoted_at as full_promoted_at
      from public.fragrance_text_enrichment_promotions_v1 p
      where p.fragrance_id = any (v_distinct_ids)
        and p.action = 'promote'
      order by p.fragrance_id, p.promoted_at desc nulls last, p.created_at desc, p.id desc
    ),
    latest_performance as (
      select distinct on (r.target_fragrance_id)
        r.target_fragrance_id as fragrance_id,
        r.id as performance_refresh_run_id,
        r.status as performance_refresh_status,
        r.error_count as performance_refresh_error_count,
        r.warning_count as performance_refresh_warning_count,
        r.inserted_signal_count as performance_refresh_inserted_signal_count,
        r.updated_feature_count as performance_refresh_updated_feature_count,
        r.run_started_at as performance_refresh_started_at,
        r.run_finished_at as performance_refresh_finished_at,
        r.metadata as performance_refresh_metadata
      from public.performance_feature_refresh_runs_v1 r
      where r.target_fragrance_id = any (v_distinct_ids)
      order by r.target_fragrance_id, r.run_started_at desc, r.id desc
    ),
    prior_proposals as (
      select distinct on (p.fragrance_id)
        p.fragrance_id,
        p.id as prior_proposal_id,
        p.classifier_model_version as prior_classifier_model_version,
        p.proposal_status as prior_proposal_status,
        p.proposed_confidence as prior_proposed_confidence,
        p.proposed_universal_family_key as prior_proposed_universal_family_key
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
      f.notes,
      f.accords,
      cardinality(f.notes) as notes_count,
      cardinality(f.accords) as accords_count,
      q.evidence_quality_state,
      q.queue_state,
      q.queue_lane,
      q.blocker_reason as queue_blocker_reason,
      q.recommended_next_action as queue_recommended_next_action,
      q.queue_model_version,
      q.source_queue_model_version,
      q.evidence_summary as queue_evidence_summary,
      q.source_snapshot_summary,
      e.provider,
      e.status as enrichment_status,
      e.source_url as enrichment_source_url,
      e.source_confidence as enrichment_source_confidence,
      e.match_name as enrichment_match_name,
      e.match_brand as enrichment_match_brand,
      np.notes_promotion_audit_id,
      np.notes_promotion_actor_label,
      np.notes_promotion_reason,
      np.promoted_source_url as notes_promoted_source_url,
      np.promoted_source_confidence as notes_promoted_source_confidence,
      np.promoted_match_name as notes_promoted_match_name,
      np.promoted_match_brand as notes_promoted_match_brand,
      np.canonical_notes_after as notes_promoted_notes_after,
      np.canonical_accords_after as notes_promoted_accords_after,
      np.notes_promotion_function_version,
      np.notes_promoted_at,
      fp.full_promotion_audit_id,
      fp.full_promotion_actor_label,
      fp.promoted_source_url as full_promoted_source_url,
      fp.promoted_source_confidence as full_promoted_source_confidence,
      fp.promoted_match_name as full_promoted_match_name,
      fp.promoted_match_brand as full_promoted_match_brand,
      fp.canonical_notes_after as full_promoted_notes_after,
      fp.canonical_accords_after as full_promoted_accords_after,
      fp.full_promotion_function_version,
      fp.full_promoted_at,
      pf.signal_count,
      pf.source_count,
      pf.beast_mode_band,
      pf.recommended_spray_caution,
      pf.opening_dominance_risk,
      pf.drydown_dominance_risk,
      pf.drydown_anchor_strength,
      pf.balancing_layer_strategy,
      pf.sweet_base_persistence_likelihood,
      pf.woody_amber_dominance_likelihood,
      pf.model_version as performance_model_version,
      pf.updated_at as performance_updated_at,
      lp.performance_refresh_run_id,
      lp.performance_refresh_status,
      lp.performance_refresh_error_count,
      lp.performance_refresh_warning_count,
      lp.performance_refresh_inserted_signal_count,
      lp.performance_refresh_updated_feature_count,
      lp.performance_refresh_started_at,
      lp.performance_refresh_finished_at,
      lp.performance_refresh_metadata,
      exists(select 1 from public.fragrance_facets_v1 ff where ff.fragrance_id = ids.id) as has_final_facets,
      exists(select 1 from public.fragrance_wardrobe_roles_v1 wr where wr.fragrance_id = ids.id) as has_final_roles,
      exists(select 1 from public.fragrance_taxonomy_review_v1 tr where tr.fragrance_id = ids.id) as has_taxonomy_review,
      sm.existing_model_proposal_id,
      sm.existing_model_proposal_status,
      pp.prior_proposal_id,
      pp.prior_classifier_model_version,
      pp.prior_proposal_status,
      pp.prior_proposed_confidence,
      pp.prior_proposed_universal_family_key
    from unnest(v_distinct_ids) ids(id)
    left join public.fragrances f
      on f.id = ids.id
    left join public.family_key_reference_v1 fkr
      on fkr.family_key = f.family_key
     and fkr.active is true
    left join public.taxonomy_operationalization_queue_current_v1 q
      on q.fragrance_id = ids.id
    left join public.fragrance_text_enrichment e
      on e.fragrance_id = ids.id
    left join latest_notes_promotion np
      on np.fragrance_id = ids.id
    left join latest_full_promotion fp
      on fp.fragrance_id = ids.id
    left join public.fragrance_performance_features_v1 pf
      on pf.fragrance_id = ids.id
    left join latest_performance lp
      on lp.fragrance_id = ids.id
    left join same_model_proposals sm
      on sm.fragrance_id = ids.id
    left join prior_proposals pp
      on pp.fragrance_id = ids.id
    order by f.name nulls last, ids.id
  loop
    v_picked_count := v_picked_count + 1;
    v_result_status := null;
    v_blocker_reason := null;
    v_proposal_status := null;
    v_proposed_universal_family_key := null;
    v_proposed_facets := '[]'::jsonb;
    v_proposed_roles := '[]'::jsonb;
    v_proposed_confidence := null;
    v_proposed_review_status := null;
    v_evidence_summary := '{}'::jsonb;
    v_source_summary := '{}'::jsonb;
    v_performance_summary := '{}'::jsonb;
    v_family_scores := '[]'::jsonb;
    v_family_top_score := null;
    v_family_second_score := null;
    v_family_winning_margin := null;
    v_family_note_hits := 0;
    v_family_accord_hits := 0;
    v_family_distinct_terms := 0;
    v_family_support_terms := array[]::text[];
    v_family_competitive_count := 0;
    v_family_competition_status := null;
    v_family_blocker_reason := null;
    v_facet_keys := array[]::text[];
    v_facet_count := 0;
    v_role_count := 0;
    v_primary_role := null;
    v_secondary_role := null;
    v_primary_role_confidence := null;
    v_secondary_role_confidence := null;
    v_role_rationale := array[]::text[];
    v_inserted_id := null;
    v_has_manual_review_penalty := false;

    if v_row.fragrance_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_fragrance_row';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.provider, '') <> 'fragella' then
      v_result_status := 'rejected';
      v_blocker_reason := 'not_fragella_provider';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.enrichment_status not in ('notes_promoted', 'already_enriched') then
      v_result_status := 'rejected';
      v_blocker_reason := 'enrichment_not_provider_promoted';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.evidence_quality_state <> 'promoted_enrichment_evidence' then
      v_result_status := 'rejected';
      v_blocker_reason := 'evidence_not_promoted_enrichment';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.queue_state <> 'ready_existing_evidence'
       or v_row.queue_lane <> 'safe_classifier_candidate' then
      v_result_status := 'rejected';
      v_blocker_reason := 'not_safe_classifier_candidate';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.queue_recommended_next_action <> 'stage_classifier_proposal' then
      v_result_status := 'rejected';
      v_blocker_reason := 'not_stage_classifier_proposal_action';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(nullif(v_row.queue_blocker_reason, ''), '') <> '' then
      v_result_status := 'rejected';
      v_blocker_reason := 'queue_blocker_present';
      v_rejected_count := v_rejected_count + 1;
    elsif coalesce(v_row.notes_count, 0) = 0 or coalesce(v_row.accords_count, 0) = 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_canonical_notes_or_accords';
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
    elsif v_row.enrichment_status = 'notes_promoted'
       and v_row.notes_promotion_audit_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_notes_promotion_audit';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.enrichment_status = 'already_enriched'
       and v_row.full_promotion_audit_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_full_promotion_audit';
      v_rejected_count := v_rejected_count + 1;
    elsif v_row.performance_refresh_run_id is null
       or coalesce(v_row.performance_refresh_status, '') <> 'completed'
       or coalesce(v_row.performance_refresh_error_count, 0) <> 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'performance_refresh_missing_or_failed';
      v_rejected_count := v_rejected_count + 1;
    else
      select
        decision.family_scores,
        decision.candidate_family,
        decision.proposal_status,
        decision.blocker_reason,
        decision.adjusted_score,
        decision.next_score,
        decision.winning_margin,
        decision.note_hits,
        decision.accord_hits,
        decision.distinct_terms,
        coalesce(decision.matched_terms, array[]::text[]),
        decision.competitive_count
      into
        v_family_scores,
        v_proposed_universal_family_key,
        v_family_competition_status,
        v_family_blocker_reason,
        v_family_top_score,
        v_family_second_score,
        v_family_winning_margin,
        v_family_note_hits,
        v_family_accord_hits,
        v_family_distinct_terms,
        v_family_support_terms,
        v_family_competitive_count
      from (
        with active_families as (
          select distinct universal_equivalent as family_key
          from public.family_key_reference_v1
          where active is true
            and universal_equivalent is not null
        ),
        raw_tokens as (
          select token, 'note'::text as source_kind
          from unnest(coalesce(v_row.notes, array[]::text[])) token
          union all
          select token, 'accord'::text as source_kind
          from unnest(coalesce(v_row.accords, array[]::text[])) token
        ),
        evidence_terms as (
          select
            rt.token as raw_token,
            rt.source_kind,
            public.taxonomy_norm_text_v1(rt.token) as evidence_term
          from raw_tokens rt
          where rt.token is not null
          union all
          select
            rt.token as raw_token,
            rt.source_kind,
            split_term as evidence_term
          from raw_tokens rt
          cross join lateral regexp_split_to_table(public.taxonomy_norm_text_v1(rt.token), '\s+') split_term
          where rt.token is not null
            and public.taxonomy_norm_text_v1(rt.token) <> ''
          union all
          select
            rt.token as raw_token,
            rt.source_kind,
            mapped_term as evidence_term
          from raw_tokens rt
          cross join lateral (
            values
              (case when public.taxonomy_norm_text_v1(rt.token) like '%warm spicy%' then 'spicy' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%fresh spicy%' then 'spicy' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%sea notes%' then 'marine' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%ambergris%' then 'ambergris' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%orange blossom%' then 'orange blossom' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%white musk%' then 'musk' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%ambrette%' then 'musk' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%madagascar vanilla%' then 'vanilla' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%tonka%' then 'tonka' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%almond%' then 'almond' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%benzoin%' then 'benzoin' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%labdanum%' then 'labdanum' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%myrrh%' then 'myrrh' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%olibanum%' then 'olibanum' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%opoponax%' then 'opoponax' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%styrax%' then 'styrax' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%sandalwood%' then 'sandalwood' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%cedar%' then 'cedar' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%vetiver%' then 'vetiver' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%guaiac%' then 'guaiac' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%oud%' then 'oud' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%agarwood%' then 'agarwood' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%oakmoss%' then 'oakmoss' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%patchouli%' then 'patchouli' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%leather%' then 'leather' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%suede%' then 'suede' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%birch%' then 'birch' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%saffron%' then 'saffron' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%animalic%' then 'animalic' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%smoky%' then 'smoky' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%tobacco%' then 'tobacco' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%citrus%' then 'citrus' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%bergamot%' then 'bergamot' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%lemon%' then 'lemon' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%mandarin%' then 'mandarin' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%grapefruit%' then 'grapefruit' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%neroli%' then 'neroli' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%orange%' then 'orange' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%petitgrain%' then 'petitgrain' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%verbena%' then 'verbena' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%aquatic%' then 'aquatic' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%ozonic%' then 'ozonic' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%fresh%' then 'fresh' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%gourmand%' then 'gourmand' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%sweet%' then 'sweet' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%vanilla%' then 'vanilla' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%coffee%' then 'coffee' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%caramel%' then 'caramel' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%honey%' then 'honey' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%fruit%' then 'fruity' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%apple%' then 'fruity' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%pear%' then 'fruity' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%berry%' then 'fruity' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%raspberry%' then 'fruity' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%blackberry%' then 'fruity' end),
              (case when public.taxonomy_norm_text_v1(rt.token) like '%fig%' then 'fruity' end)
          ) mapped(mapped_term)
          where mapped_term is not null
        ),
        family_term_map as (
          select family_key, matched_term, base_weight
          from (
            values
              ('amber-oriental','amber',4),
              ('amber-oriental','labdanum',4),
              ('amber-oriental','benzoin',4),
              ('amber-oriental','myrrh',4),
              ('amber-oriental','olibanum',4),
              ('amber-oriental','opoponax',4),
              ('amber-oriental','styrax',4),
              ('amber-oriental','resin',3),
              ('amber-oriental','balsamic',3),
              ('amber-oriental','incense',3),
              ('amber-oriental','spicy',1),
              ('amber-oriental','oud',2),
              ('amber-oriental','patchouli',2),
              ('citrus-cologne','citrus',4),
              ('citrus-cologne','bergamot',4),
              ('citrus-cologne','lemon',4),
              ('citrus-cologne','mandarin',4),
              ('citrus-cologne','grapefruit',4),
              ('citrus-cologne','orange',4),
              ('citrus-cologne','neroli',3),
              ('citrus-cologne','orange blossom',2),
              ('citrus-cologne','petitgrain',3),
              ('citrus-cologne','verbena',3),
              ('citrus-cologne','fresh',1),
              ('citrus-cologne','green',1),
              ('fresh-aquatic','marine',4),
              ('fresh-aquatic','aquatic',4),
              ('fresh-aquatic','ozonic',4),
              ('fresh-aquatic','ambergris',3),
              ('fresh-aquatic','fresh',2),
              ('fresh-aquatic','green',1),
              ('fresh-aquatic','salty',3),
              ('gourmand','gourmand',4),
              ('gourmand','vanilla',4),
              ('gourmand','tonka',4),
              ('gourmand','almond',4),
              ('gourmand','caramel',4),
              ('gourmand','honey',4),
              ('gourmand','coffee',4),
              ('gourmand','cacao',4),
              ('gourmand','chocolate',4),
              ('gourmand','sweet',2),
              ('gourmand','nutty',2),
              ('leather','leather',5),
              ('leather','suede',5),
              ('leather','birch',4),
              ('leather','castoreum',4),
              ('leather','animalic',3),
              ('leather','smoky',2),
              ('leather','saffron',2),
              ('leather','tobacco',2),
              ('woody','woody',4),
              ('woody','wood',4),
              ('woody','woods',4),
              ('woody','sandalwood',4),
              ('woody','cedar',4),
              ('woody','vetiver',3),
              ('woody','guaiac',3),
              ('woody','oud',3),
              ('woody','agarwood',3),
              ('woody','oakmoss',2),
              ('woody','patchouli',2)
          ) as t(family_key, matched_term, base_weight)
          where family_key in (select family_key from active_families)
        ),
        family_matches as (
          select distinct on (ftm.family_key, et.source_kind, et.raw_token, ftm.matched_term)
            ftm.family_key as candidate_family,
            ftm.matched_term,
            et.source_kind,
            et.raw_token,
            ftm.base_weight + case when et.source_kind = 'note' then 2 else 1 end as matched_weight
          from evidence_terms et
          join family_term_map ftm
            on ftm.matched_term = et.evidence_term
          order by ftm.family_key, et.source_kind, et.raw_token, ftm.matched_term, matched_weight desc
        ),
        family_scores as (
          select
            fm.candidate_family,
            sum(fm.matched_weight)
              + case when fm.candidate_family = v_row.universal_family_key then 1 else 0 end
              + case when fm.candidate_family = 'gourmand' and coalesce(v_row.sweet_base_persistence_likelihood, false) then 1 else 0 end
              + case when fm.candidate_family = 'leather' and coalesce(v_row.recommended_spray_caution, 'none') in ('start_light', 'one_spray_anchor') then 1 else 0 end
              + case when fm.candidate_family = 'citrus-cologne'
                        and coalesce(v_row.beast_mode_band, '') = 'LOW'
                        and coalesce(v_row.drydown_anchor_strength, '') = 'LOW'
                     then 1 else 0 end
              + case when fm.candidate_family = 'fresh-aquatic'
                        and coalesce(v_row.beast_mode_band, '') = 'LOW'
                     then 1 else 0 end
              - case when fm.candidate_family = 'woody'
                        and coalesce(v_row.woody_amber_dominance_likelihood, '') = 'LOW'
                     then 2 else 0 end
              - case when fm.candidate_family = 'woody'
                        and coalesce(v_row.drydown_anchor_strength, '') = 'LOW'
                     then 1 else 0 end
              as adjusted_score,
            count(*) filter (where fm.source_kind = 'note') as note_hits,
            count(*) filter (where fm.source_kind = 'accord') as accord_hits,
            count(distinct fm.matched_term) as distinct_terms,
            array_agg(distinct fm.matched_term order by fm.matched_term) as matched_terms
          from family_matches fm
          group by fm.candidate_family
        ),
        family_scored as (
          select
            fs.*,
            max(fs.adjusted_score) over () as top_score
          from family_scores fs
        ),
        family_ranked as (
          select
            fs.*,
            row_number() over (order by fs.adjusted_score desc, fs.note_hits desc, fs.distinct_terms desc, fs.candidate_family) as rn,
            lead(fs.adjusted_score) over (order by fs.adjusted_score desc, fs.note_hits desc, fs.distinct_terms desc, fs.candidate_family) as next_score,
            count(*) filter (where fs.adjusted_score >= greatest(fs.top_score - 4, 12)) over () as competitive_count
          from family_scored fs
        ),
        family_score_json as (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'candidate_family', candidate_family,
                'score', adjusted_score,
                'note_hits', note_hits,
                'accord_hits', accord_hits,
                'distinct_terms', distinct_terms,
                'matched_terms', to_jsonb(matched_terms)
              )
              order by adjusted_score desc, candidate_family
            ),
            '[]'::jsonb
          ) as family_scores
          from family_ranked
        )
        select
          fjson.family_scores,
          fr.candidate_family,
          case
            when fr.adjusted_score is null then 'needs_manual_review'
            when fr.adjusted_score < 8 then 'needs_manual_review'
            when fr.candidate_family = 'woody'
                 and (
                   fr.note_hits < 2
                   or fr.distinct_terms < 3
                   or coalesce(fr.next_score, 0) > fr.adjusted_score - 3
                 ) then 'needs_manual_review'
            when fr.candidate_family in ('citrus-cologne', 'fresh-aquatic')
                 and coalesce(v_row.sweet_base_persistence_likelihood, false)
                 and coalesce(fr.next_score, -999) >= fr.adjusted_score - 6 then 'needs_manual_review'
            when fr.candidate_family in ('amber-oriental', 'leather')
                 and coalesce(fr.next_score, -999) >= fr.adjusted_score - 4 then 'needs_manual_review'
            when fr.candidate_family in ('citrus-cologne', 'fresh-aquatic')
                 and coalesce(v_row.sweet_base_persistence_likelihood, false)
                 and coalesce(v_row.drydown_anchor_strength, '') in ('MODERATE', 'HIGH')
                 and coalesce(fr.next_score, -999) >= fr.adjusted_score - 10 then 'needs_manual_review'
            when fr.competitive_count >= 3 and fr.adjusted_score < 28 then 'needs_manual_review'
            when coalesce(fr.next_score, -999) >= fr.adjusted_score - 1 then 'needs_manual_review'
            else 'proposed'
          end as proposal_status,
          case
            when fr.adjusted_score is null then 'no_family_candidate'
            when fr.adjusted_score < 8 then 'insufficient_family_evidence'
            when fr.candidate_family = 'woody'
                 and (
                   fr.note_hits < 2
                   or fr.distinct_terms < 3
                   or coalesce(fr.next_score, 0) > fr.adjusted_score - 3
                 ) then 'woody_not_dominant_enough'
            when fr.candidate_family in ('citrus-cologne', 'fresh-aquatic')
                 and coalesce(v_row.sweet_base_persistence_likelihood, false)
                 and coalesce(fr.next_score, -999) >= fr.adjusted_score - 6 then 'mixed_fresh_and_sweet_competition'
            when fr.candidate_family in ('amber-oriental', 'leather')
                 and coalesce(fr.next_score, -999) >= fr.adjusted_score - 4 then 'mixed_heavy_family_competition'
            when fr.candidate_family in ('citrus-cologne', 'fresh-aquatic')
                 and coalesce(v_row.sweet_base_persistence_likelihood, false)
                 and coalesce(v_row.drydown_anchor_strength, '') in ('MODERATE', 'HIGH')
                 and coalesce(fr.next_score, -999) >= fr.adjusted_score - 10 then 'mixed_fresh_vs_sweet_structure'
            when fr.competitive_count >= 3 and fr.adjusted_score < 28 then 'too_many_competing_families'
            when coalesce(fr.next_score, -999) >= fr.adjusted_score - 1 then 'family_competition_too_close'
            else null
          end as blocker_reason,
          fr.adjusted_score,
          fr.next_score,
          coalesce(fr.adjusted_score - fr.next_score, fr.adjusted_score) as winning_margin,
          fr.note_hits,
          fr.accord_hits,
          fr.distinct_terms,
          fr.matched_terms,
          fr.competitive_count
        from family_ranked fr
        cross join family_score_json fjson
        where fr.rn = 1
      ) decision;

      if coalesce(nullif(v_proposed_universal_family_key, ''), '') = '' then
        v_result_status := 'rejected';
        v_blocker_reason := coalesce(v_family_blocker_reason, 'no_family_candidate');
        v_rejected_count := v_rejected_count + 1;
      elsif not exists (
        select 1
        from public.family_key_reference_v1 ref
        where ref.active is true
          and ref.universal_equivalent = v_proposed_universal_family_key
      ) then
        v_invalid_family_keys := array(
          select distinct x
          from unnest(v_invalid_family_keys || array[v_proposed_universal_family_key]) as t(x)
          where x <> ''
        );
        v_result_status := 'rejected';
        v_blocker_reason := 'invalid_generated_family_key';
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
                'basis_sources', to_jsonb(basis_sources),
                'note_hits', note_hits,
                'accord_hits', accord_hits
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
            select token, 'note'::text as source_kind
            from unnest(coalesce(v_row.notes, array[]::text[])) token
            union all
            select token, 'accord'::text as source_kind
            from unnest(coalesce(v_row.accords, array[]::text[])) token
          ),
          expanded_terms as (
            select
              rt.token as raw_token,
              rt.source_kind,
              public.taxonomy_norm_text_v1(rt.token) as token_term
            from raw_tokens rt
            where rt.token is not null
            union all
            select
              rt.token as raw_token,
              rt.source_kind,
              split_term as token_term
            from raw_tokens rt
            cross join lateral regexp_split_to_table(public.taxonomy_norm_text_v1(rt.token), '\s+') split_term
            where rt.token is not null
              and public.taxonomy_norm_text_v1(rt.token) <> ''
            union all
            select
              rt.token as raw_token,
              rt.source_kind,
              mapped_term as token_term
            from raw_tokens rt
            cross join lateral (
              values
                (case when public.taxonomy_norm_text_v1(rt.token) like '%warm spicy%' then 'spicy' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%fresh spicy%' then 'spicy' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%cinnamon%' then 'spicy' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%ginger%' then 'spicy' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%pepper%' then 'spicy' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%cardamom%' then 'spicy' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%nutmeg%' then 'spicy' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%coriander%' then 'spicy' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%saffron%' then 'spicy' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%gourmand%' then 'gourmand' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%vanilla%' then 'gourmand' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%tonka%' then 'gourmand' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%almond%' then 'gourmand' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%caramel%' then 'gourmand' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%coffee%' then 'gourmand' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%sweet%' then 'gourmand' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%amber%' then 'amber' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%balsamic%' then 'balsamic' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%resin%' then 'resin' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%olibanum%' then 'resin' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%benzoin%' then 'resin' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%labdanum%' then 'resin' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%opoponax%' then 'resin' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%styrax%' then 'resin' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%myrrh%' then 'balsamic' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%incense%' then 'incense' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%olibanum%' then 'incense' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%leather%' then 'leather' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%suede%' then 'leather' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%birch%' then 'leather' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%animalic%' then 'leather' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%marine%' then 'marine' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%aquatic%' then 'marine' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%sea%' then 'marine' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%ambergris%' then 'marine' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%ozonic%' then 'ozonic' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%musk%' then 'musk' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%ambrette%' then 'musk' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%powdery%' then 'powdery' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%iris%' then 'powdery' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%citrus%' then 'citrus' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%bergamot%' then 'citrus' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%grapefruit%' then 'citrus' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%mandarin%' then 'citrus' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%orange%' then 'citrus' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%lemon%' then 'citrus' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%neroli%' then 'citrus' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%verbena%' then 'citrus' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%petitgrain%' then 'citrus' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%rose%' then 'floral' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%jasmine%' then 'floral' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%orange blossom%' then 'floral' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%ylang%' then 'floral' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%mimosa%' then 'floral' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%lavender%' then 'aromatic' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%juniper%' then 'aromatic' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%sage%' then 'aromatic' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%rosemary%' then 'aromatic' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%green%' then 'green' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%violet leaf%' then 'green' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%tea%' then 'tea' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%tobacco%' then 'tobacco' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%woody%' then 'woody' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%wood%' then 'woody' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%sandalwood%' then 'woody' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%cedar%' then 'woody' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%vetiver%' then 'woody' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%guaiac%' then 'woody' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%oud%' then 'woody' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%agarwood%' then 'woody' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%patchouli%' then 'woody' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%oakmoss%' then 'woody' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%fruit%' then 'fruity' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%apple%' then 'fruity' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%pear%' then 'fruity' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%berry%' then 'fruity' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%raspberry%' then 'fruity' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%blackberry%' then 'fruity' end),
                (case when public.taxonomy_norm_text_v1(rt.token) like '%fig%' then 'fruity' end)
            ) mapped(mapped_term)
            where mapped_term is not null
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
            select distinct on (et.facet_key, xt.source_kind, xt.raw_token, et.term)
              et.facet_key,
              et.display_label,
              et.term as matched_term,
              xt.source_kind,
              xt.raw_token,
              case
                when xt.source_kind = 'note' then et.evidence_weight + 2
                when xt.source_kind = 'accord' then et.evidence_weight + 1
                else et.evidence_weight
              end as matched_weight
            from evidence_terms et
            join expanded_terms xt
              on xt.token_term = et.term
            where xt.token_term <> ''
              and et.term <> ''
            order by et.facet_key, xt.source_kind, xt.raw_token, et.term, matched_weight desc
          ),
          scored as (
            select
              facet_key,
              display_label,
              array_agg(distinct matched_term order by matched_term) as matched_terms,
              array_agg(distinct source_kind order by source_kind) as basis_sources,
              count(*) filter (where source_kind = 'note') as note_hits,
              count(*) filter (where source_kind = 'accord') as accord_hits,
              sum(matched_weight) as score,
              case
                when sum(matched_weight) >= 12 then 0.81
                when sum(matched_weight) >= 9 then 0.77
                when sum(matched_weight) >= 6 then 0.73
                else 0.68
              end as facet_confidence
            from matched_terms
            group by facet_key, display_label
          )
          select
            facet_key,
            display_label,
            matched_terms,
            basis_sources,
            note_hits,
            accord_hits,
            score,
            facet_confidence
          from scored
          where score >= 4
            and not (
              facet_key = 'fruity'
              and coalesce(note_hits, 0) = 0
              and coalesce(array_length(matched_terms, 1), 0) = 1
              and matched_terms[1] = 'fruity'
            )
            and not (
              facet_key = 'woody'
              and coalesce(note_hits, 0) = 0
              and score < 10
            )
          order by score desc, facet_key
          limit 6
        ) ranked_facets;

        if exists (
          select 1
          from unnest(coalesce(v_facet_keys, array[]::text[])) as fk(x)
          where not exists (
            select 1
            from public.facet_key_reference_v1 ref
            where ref.active is true
              and ref.facet_key = fk.x
          )
        ) then
          v_invalid_facet_keys := array(
            select distinct x
            from unnest(
              v_invalid_facet_keys
              || coalesce(
                array(
                  select fk.x
                  from unnest(coalesce(v_facet_keys, array[]::text[])) as fk(x)
                  where not exists (
                    select 1
                    from public.facet_key_reference_v1 ref
                    where ref.active is true
                      and ref.facet_key = fk.x
                  )
                ),
                array[]::text[]
              )
            ) as t(x)
            where x <> ''
          );
          v_result_status := 'rejected';
          v_blocker_reason := 'invalid_generated_facet_key';
          v_rejected_count := v_rejected_count + 1;
        else
          if v_family_competition_status = 'needs_manual_review' then
            v_has_manual_review_penalty := true;
          end if;

          if v_proposed_universal_family_key in ('citrus-cologne', 'fresh-aquatic')
             and coalesce(v_row.beast_mode_band, '') in ('LOW', 'MODERATE')
             and coalesce(v_row.drydown_anchor_strength, '') in ('LOW', 'MODERATE') then
            v_primary_role := 'brightener';
            v_secondary_role := 'bridge';
            v_primary_role_confidence := 0.68;
            v_secondary_role_confidence := 0.62;
            v_role_rationale := array['fresh_family_selected_from_evidence', 'lighter_projection_profile', 'provider_promoted_v2'];
          elsif v_proposed_universal_family_key = 'gourmand'
             and (coalesce(v_row.sweet_base_persistence_likelihood, false)
               or coalesce(v_facet_keys, array[]::text[]) && array['gourmand']::text[])
             and coalesce(v_row.drydown_anchor_strength, '') in ('LOW', 'MODERATE') then
            v_primary_role := 'softener';
            v_secondary_role := 'aura';
            v_primary_role_confidence := 0.67;
            v_secondary_role_confidence := 0.61;
            v_role_rationale := array['sweet_diffusive_profile', 'soft_rounding_performance', 'provider_promoted_v2'];
          elsif (
              v_proposed_universal_family_key in ('amber-oriental', 'leather')
              or coalesce(v_facet_keys, array[]::text[]) && array['leather', 'resin', 'incense', 'tobacco']::text[]
            )
             and (
               coalesce(v_row.drydown_anchor_strength, '') in ('MODERATE', 'HIGH')
               or coalesce(v_row.beast_mode_band, '') in ('MODERATE', 'HIGH', 'EXTREME')
               or coalesce(v_row.recommended_spray_caution, 'none') <> 'none'
             ) then
            v_primary_role := 'anchor';
            v_secondary_role := 'accent';
            v_primary_role_confidence := 0.67;
            v_secondary_role_confidence := 0.61;
            v_role_rationale := array['heavier_structural_family', 'anchor_weight_supported_by_performance', 'provider_promoted_v2'];
          elsif coalesce(v_facet_keys, array[]::text[]) && array['powdery', 'creamy', 'musk']::text[]
             and coalesce(v_row.beast_mode_band, '') = 'LOW'
             and coalesce(v_row.drydown_anchor_strength, '') in ('LOW', 'MODERATE') then
            v_primary_role := 'softener';
            v_secondary_role := 'aura';
            v_primary_role_confidence := 0.64;
            v_secondary_role_confidence := 0.58;
            v_role_rationale := array['powdery_or_musky_texture', 'low_anchor_profile', 'provider_promoted_v2'];
          elsif v_proposed_universal_family_key = 'woody'
             and coalesce(v_facet_keys, array[]::text[]) && array['woody', 'spicy', 'tobacco', 'leather']::text[]
             and coalesce(v_row.drydown_anchor_strength, '') in ('MODERATE', 'HIGH') then
            v_primary_role := 'anchor';
            v_secondary_role := 'accent';
            v_primary_role_confidence := 0.63;
            v_secondary_role_confidence := 0.57;
            v_role_rationale := array['woody_structure_supported', 'performance_confirms_anchor_use_case', 'provider_promoted_v2'];
          elsif coalesce(v_facet_keys, array[]::text[]) && array['citrus', 'green', 'marine', 'ozonic']::text[]
             and coalesce(v_row.beast_mode_band, '') in ('LOW', 'MODERATE') then
            v_primary_role := 'brightener';
            v_secondary_role := 'bridge';
            v_primary_role_confidence := 0.63;
            v_secondary_role_confidence := 0.58;
            v_role_rationale := array['fresh_facet_cluster', 'lighter_projection_profile', 'provider_promoted_v2'];
          elsif v_proposed_universal_family_key = 'gourmand'
             and coalesce(v_row.beast_mode_band, '') in ('MODERATE', 'HIGH', 'EXTREME') then
            v_primary_role := 'accent';
            v_secondary_role := 'anchor';
            v_primary_role_confidence := 0.61;
            v_secondary_role_confidence := 0.55;
            v_role_rationale := array['sweeter_statement_profile', 'heavier_projection_than_softener_lane', 'provider_promoted_v2'];
          elsif coalesce(v_row.drydown_anchor_strength, '') = 'LOW' then
            v_primary_role := 'bridge';
            v_secondary_role := null;
            v_primary_role_confidence := 0.54;
            v_secondary_role_confidence := null;
            v_role_rationale := array['fallback_low_anchor_role', 'provider_promoted_v2'];
            v_has_manual_review_penalty := true;
          else
            v_primary_role := 'accent';
            v_secondary_role := null;
            v_primary_role_confidence := 0.53;
            v_secondary_role_confidence := null;
            v_role_rationale := array['fallback_statement_role', 'provider_promoted_v2'];
            v_has_manual_review_penalty := true;
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

          if exists (
            select 1
            from unnest(coalesce(v_invalid_role_keys, array[]::text[])) as bad(x)
            where x <> ''
          ) and v_primary_role is null and v_secondary_role is null then
            v_result_status := 'rejected';
            v_blocker_reason := 'invalid_generated_role_key';
            v_rejected_count := v_rejected_count + 1;
          else
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
            ) ranked_roles;

            v_role_count := jsonb_array_length(v_proposed_roles);

            v_proposed_confidence := least(
              0.82,
              0.38
              + least(greatest(coalesce(v_family_top_score, 0) - 6, 0) * 0.015, 0.15)
              + least(greatest(coalesce(v_family_winning_margin, 0), 0) * 0.02, 0.12)
              + least(greatest(v_facet_count - 2, 0) * 0.02, 0.10)
              + case when v_role_count >= 2 then 0.04 when v_role_count = 1 then 0.02 else 0 end
              + case
                  when coalesce(v_row.enrichment_source_confidence, 0) >= 0.99 then 0.03
                  when coalesce(v_row.enrichment_source_confidence, 0) >= 0.95 then 0.02
                  when coalesce(v_row.enrichment_source_confidence, 0) >= 0.90 then 0.01
                  else 0
                end
              + case
                  when coalesce(v_row.signal_count, 0) >= 10 and coalesce(v_row.source_count, 0) >= 2 then 0.03
                  when coalesce(v_row.signal_count, 0) >= 5 then 0.02
                  else 0.01
                end
              - case when v_family_competition_status = 'needs_manual_review' then 0.10 else 0 end
              - case when v_has_manual_review_penalty then 0.04 else 0 end
            );

            v_proposal_status := v_family_competition_status;
            v_blocker_reason := v_family_blocker_reason;

            if v_facet_count < 3 then
              v_proposal_status := 'needs_manual_review';
              v_blocker_reason := 'too_few_supported_facets';
            elsif v_role_count = 0 then
              v_proposal_status := 'needs_manual_review';
              v_blocker_reason := 'no_supported_role_mapping';
            elsif v_proposal_status = 'proposed' and v_proposed_confidence < 0.62 then
              v_proposal_status := 'needs_manual_review';
              v_blocker_reason := 'low_provider_promoted_v2_confidence';
            end if;

            v_proposed_review_status := case
              when v_proposal_status = 'proposed' and v_proposed_confidence >= 0.68 then 'medium_confidence'
              else 'low_confidence'
            end;

            v_evidence_summary := jsonb_build_object(
              'proposal_basis', 'provider_promoted_notes_only_queue_routed_v2_family_calibrated',
              'provider_promoted_evidence', true,
              'not_official_source', true,
              'provider', v_row.provider,
              'enrichment_status', v_row.enrichment_status,
              'evidence_quality_state', v_row.evidence_quality_state,
              'queue_state', v_row.queue_state,
              'queue_lane', v_row.queue_lane,
              'queue_recommended_next_action', v_row.queue_recommended_next_action,
              'queue_model_version', v_row.queue_model_version,
              'source_queue_model_version', v_row.source_queue_model_version,
              'family_key', v_row.family_key,
              'prior_universal_family_key', v_row.universal_family_key,
              'previous_proposal_id', v_row.prior_proposal_id,
              'previous_proposal_status', v_row.prior_proposal_status,
              'previous_proposal_model_version', v_row.prior_classifier_model_version,
              'previous_proposed_universal_family_key', v_row.prior_proposed_universal_family_key,
              'proposed_universal_family_key', v_proposed_universal_family_key,
              'family_competition_scores', v_family_scores,
              'family_top_score', v_family_top_score,
              'family_second_score', v_family_second_score,
              'family_winning_margin', v_family_winning_margin,
              'family_competitive_count', v_family_competitive_count,
              'family_support_terms', to_jsonb(coalesce(v_family_support_terms, array[]::text[])),
              'family_competition_status', v_family_competition_status,
              'family_competition_blocker_reason', v_family_blocker_reason,
              'notes_count', v_row.notes_count,
              'accords_count', v_row.accords_count,
              'facet_keys', to_jsonb(coalesce(v_facet_keys, array[]::text[])),
              'facet_count', v_facet_count,
              'role_count', v_role_count,
              'role_rationale', to_jsonb(coalesce(v_role_rationale, array[]::text[])),
              'canonical_notes', to_jsonb(coalesce(v_row.notes, array[]::text[])),
              'canonical_accords', to_jsonb(coalesce(v_row.accords, array[]::text[])),
              'notes_promotion_audit_id', v_row.notes_promotion_audit_id,
              'full_promotion_audit_id', v_row.full_promotion_audit_id,
              'notes_promotion_function_version', v_row.notes_promotion_function_version,
              'full_promotion_function_version', v_row.full_promotion_function_version,
              'latest_performance_refresh_run_id', v_row.performance_refresh_run_id,
              'latest_performance_refresh_status', v_row.performance_refresh_status,
              'provider_promoted_limitation', 'provider_promoted_fragella_evidence_not_official_source',
              'queue_evidence_summary', coalesce(v_row.queue_evidence_summary, '{}'::jsonb),
              'source_snapshot_summary', coalesce(v_row.source_snapshot_summary, '{}'::jsonb)
            );

            v_source_summary := jsonb_build_object(
              'source_truth_accepted', false,
              'basis', 'provider_promoted_enrichment_notes_only_v2_family_calibrated',
              'source_type', 'provider_promoted_enrichment',
              'provider', v_row.provider,
              'source_url', coalesce(v_row.notes_promoted_source_url, v_row.full_promoted_source_url, v_row.enrichment_source_url),
              'source_confidence', coalesce(v_row.notes_promoted_source_confidence, v_row.full_promoted_source_confidence, v_row.enrichment_source_confidence),
              'match_name', coalesce(v_row.notes_promoted_match_name, v_row.full_promoted_match_name, v_row.enrichment_match_name),
              'match_brand', coalesce(v_row.notes_promoted_match_brand, v_row.full_promoted_match_brand, v_row.enrichment_match_brand),
              'notes_promotion_audit_id', v_row.notes_promotion_audit_id,
              'full_promotion_audit_id', v_row.full_promotion_audit_id,
              'notes_promotion_actor_label', v_row.notes_promotion_actor_label,
              'full_promotion_actor_label', v_row.full_promotion_actor_label,
              'notes_promotion_reason', v_row.notes_promotion_reason,
              'source_model_version', coalesce(v_row.notes_promotion_function_version, v_row.full_promotion_function_version, 'unknown'),
              'provider_promoted_limitation', 'proposal_only_provider_evidence_not_official_source',
              'notes_promoted_at', v_row.notes_promoted_at,
              'full_promoted_at', v_row.full_promoted_at
            );

            v_performance_summary := jsonb_build_object(
              'performance_refresh_run_id', v_row.performance_refresh_run_id,
              'performance_refresh_status', v_row.performance_refresh_status,
              'performance_refresh_error_count', v_row.performance_refresh_error_count,
              'performance_refresh_warning_count', v_row.performance_refresh_warning_count,
              'performance_refresh_inserted_signal_count', v_row.performance_refresh_inserted_signal_count,
              'performance_refresh_updated_feature_count', v_row.performance_refresh_updated_feature_count,
              'signal_count', v_row.signal_count,
              'source_count', v_row.source_count,
              'beast_mode_band', v_row.beast_mode_band,
              'recommended_spray_caution', v_row.recommended_spray_caution,
              'opening_dominance_risk', v_row.opening_dominance_risk,
              'drydown_dominance_risk', v_row.drydown_dominance_risk,
              'drydown_anchor_strength', v_row.drydown_anchor_strength,
              'balancing_layer_strategy', v_row.balancing_layer_strategy,
              'sweet_base_persistence_likelihood', v_row.sweet_base_persistence_likelihood,
              'woody_amber_dominance_likelihood', v_row.woody_amber_dominance_likelihood,
              'performance_model_version', v_row.performance_model_version,
              'performance_updated_at', v_row.performance_updated_at,
              'performance_refresh_started_at', v_row.performance_refresh_started_at,
              'performance_refresh_finished_at', v_row.performance_refresh_finished_at,
              'performance_refresh_metadata', coalesce(v_row.performance_refresh_metadata, '{}'::jsonb)
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
                coalesce(v_row.notes_promotion_function_version, v_row.full_promotion_function_version, 'unknown'),
                coalesce(v_row.source_queue_model_version, v_row.queue_model_version),
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
        'source_model_version', coalesce(v_row.notes_promotion_function_version, v_row.full_promotion_function_version, 'unknown'),
        'queue_model_version', coalesce(v_row.source_queue_model_version, v_row.queue_model_version),
        'prior_proposed_universal_family_key', v_row.prior_proposed_universal_family_key,
        'family_scores', v_family_scores,
        'family_winning_margin', v_family_winning_margin,
        'family_support_terms', to_jsonb(coalesce(v_family_support_terms, array[]::text[])),
        'notes_promotion_audit_id', v_row.notes_promotion_audit_id,
        'full_promotion_audit_id', v_row.full_promotion_audit_id,
        'performance_refresh_run_id', v_row.performance_refresh_run_id,
        'provider_limitation', 'provider_promoted_fragella_evidence_not_official_source',
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

revoke all on function public.propose_fragrance_taxonomy_v2_provider_promoted(uuid[], text, boolean) from public;
revoke all on function public.propose_fragrance_taxonomy_v2_provider_promoted(uuid[], text, boolean) from anon;
revoke all on function public.propose_fragrance_taxonomy_v2_provider_promoted(uuid[], text, boolean) from authenticated;
grant execute on function public.propose_fragrance_taxonomy_v2_provider_promoted(uuid[], text, boolean) to service_role;

comment on function public.propose_fragrance_taxonomy_v2_provider_promoted(uuid[], text, boolean) is
  'Generates proposal-only classifier rows for explicit provider-promoted safe_classifier_candidate queue rows using evidence-driven family competition, reduced family-key inheritance, calibrated facet/role scoring, promoted Fragella enrichment lineage, active family/facet/role keys, and completed targeted performance refresh runs. Dry-run writes nothing. Live mode only inserts into public.fragrance_taxonomy_proposals_v1 and never writes final taxonomy, mutates public.fragrances, or refreshes queue/performance.';

commit;
