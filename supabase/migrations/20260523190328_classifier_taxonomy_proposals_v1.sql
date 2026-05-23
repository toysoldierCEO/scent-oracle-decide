begin;

create table if not exists public.fragrance_taxonomy_proposals_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances (id) on delete cascade,
  proposal_status text not null,
  proposed_universal_family_key text,
  proposed_facets jsonb not null default '[]'::jsonb,
  proposed_wardrobe_roles jsonb not null default '[]'::jsonb,
  proposed_confidence numeric,
  proposed_review_status text,
  blocker_reason text,
  evidence_summary jsonb not null default '{}'::jsonb,
  source_summary jsonb not null default '{}'::jsonb,
  performance_summary jsonb not null default '{}'::jsonb,
  classifier_model_version text not null,
  source_model_version text,
  queue_model_version text,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fragrance_taxonomy_proposals_v1_status_check check (
    proposal_status = any (
      array[
        'proposed'::text,
        'needs_manual_review'::text,
        'blocked_insufficient_evidence'::text,
        'blocked_conflict'::text,
        'accepted_later'::text,
        'rejected_later'::text,
        'superseded'::text
      ]
    )
  ),
  constraint fragrance_taxonomy_proposals_v1_confidence_check check (
    proposed_confidence is null
    or (
      proposed_confidence >= 0::numeric
      and proposed_confidence <= 1::numeric
    )
  ),
  constraint fragrance_taxonomy_proposals_v1_review_status_check check (
    proposed_review_status is null
    or proposed_review_status = any (
      array[
        'confirmed'::text,
        'medium_confidence'::text,
        'low_confidence'::text,
        'taxonomy_gap'::text,
        'needs_wear_test'::text,
        'source_gap'::text
      ]
    )
  )
);

comment on table public.fragrance_taxonomy_proposals_v1 is
  'Read-write backend proposal lane for classifier outputs. Proposal rows are auditable suggestions only and do not write final taxonomy truth.';

comment on column public.fragrance_taxonomy_proposals_v1.proposed_facets is
  'JSONB proposal payload using only active live facet reference keys.';

comment on column public.fragrance_taxonomy_proposals_v1.proposed_wardrobe_roles is
  'JSONB proposal payload using only active live wardrobe role reference keys.';

create unique index if not exists fragrance_taxonomy_proposals_v1_fragrance_model_uq
  on public.fragrance_taxonomy_proposals_v1 (fragrance_id, classifier_model_version);

create index if not exists fragrance_taxonomy_proposals_v1_status_updated_idx
  on public.fragrance_taxonomy_proposals_v1 (proposal_status, updated_at desc);

alter table public.fragrance_taxonomy_proposals_v1 enable row level security;

revoke all on public.fragrance_taxonomy_proposals_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.fragrance_taxonomy_proposals_v1 to service_role;

create or replace function public.propose_fragrance_taxonomy_v1(
  p_fragrance_ids uuid[],
  p_actor_label text default 'codex_classifier_proposal_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_distinct_ids uuid[];
  v_missing_ids uuid[];
  v_requested_count integer := coalesce(array_length(p_fragrance_ids, 1), 0);
  v_distinct_requested_count integer := 0;
  v_picked_count integer := 0;
  v_proposed_count integer := 0;
  v_blocked_count integer := 0;
  v_max_ids constant integer := 10;
  v_classifier_model_version constant text := 'taxonomy_classifier_proposal_v1_rule_based_2026_05_23';
  v_results jsonb := '[]'::jsonb;
  v_proposal_status text;
  v_proposed_universal_family_key text;
  v_proposed_facets jsonb;
  v_proposed_roles jsonb;
  v_proposed_confidence numeric;
  v_proposed_review_status text;
  v_blocker_reason text;
  v_evidence_summary jsonb;
  v_source_summary jsonb;
  v_performance_summary jsonb;
  v_facet_keys text[];
  v_primary_role text;
  v_secondary_role text;
  v_primary_role_confidence numeric;
  v_secondary_role_confidence numeric;
  v_facet_count integer;
  v_role_count integer;
  v_has_manual_review_penalty boolean;
  v_role_rationale text[];
  r record;
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

  select coalesce(array_agg(id order by id), array[]::uuid[])
  into v_missing_ids
  from unnest(v_distinct_ids) as id
  where not exists (
    select 1
    from public.fragrances f
    where f.id = id
  );

  for r in
    with latest_promotion as (
      select distinct on (p.fragrance_id)
        p.fragrance_id,
        p.function_version,
        p.source_confidence,
        p.match_name,
        p.match_brand,
        p.source_url
      from public.fragrance_text_enrichment_promotions_v1 p
      where p.fragrance_id = any (v_distinct_ids)
      order by p.fragrance_id, p.promoted_at desc nulls last, p.created_at desc, p.id desc
    )
    select
      ids.id as input_id,
      f.id as fragrance_id,
      f.name,
      f.brand,
      f.family_key,
      coalesce(tr.universal_family_key, fkr.universal_equivalent) as universal_family_key,
      coalesce(tes.evidence_quality_state, '') as evidence_quality_state,
      coalesce(tes.has_promoted_text_evidence, false) as has_promoted_text_evidence,
      coalesce(tes.has_rejected_match, false) as has_rejected_match,
      coalesce(tes.has_revert_history, false) as has_revert_history,
      coalesce(tes.notes_count, 0) as notes_count,
      coalesce(tes.accords_count, 0) as accords_count,
      coalesce(tes.facet_count, 0) as facet_count,
      coalesce(tes.role_count, 0) as role_count,
      coalesce(tes.has_taxonomy_review, false) as has_taxonomy_review,
      coalesce(toq.queue_state, '') as queue_state,
      coalesce(toq.queue_lane, '') as queue_lane,
      toq.queue_model_version,
      tes.evidence_model_version,
      f.notes,
      f.accords,
      te.status as enrichment_status,
      coalesce(lp.source_confidence, te.source_confidence) as source_confidence,
      coalesce(lp.source_url, te.source_url) as source_url,
      coalesce(lp.match_name, te.match_name) as match_name,
      coalesce(lp.match_brand, te.match_brand) as match_brand,
      lp.function_version as source_model_version,
      coalesce(pf.signal_count, 0) as signal_count,
      coalesce(pf.source_count, 0) as source_count,
      pf.beast_mode_band,
      pf.recommended_spray_caution
    from unnest(v_distinct_ids) ids(id)
    join public.fragrances f
      on f.id = ids.id
    left join public.fragrance_taxonomy_resolved_v1 tr
      on tr.fragrance_id = f.id
    left join public.family_key_reference_v1 fkr
      on fkr.family_key = f.family_key
    left join public.taxonomy_evidence_status_v1 tes
      on tes.fragrance_id = f.id
    left join public.taxonomy_operationalization_queue_v1 toq
      on toq.fragrance_id = f.id
    left join public.fragrance_text_enrichment te
      on te.fragrance_id = f.id
    left join latest_promotion lp
      on lp.fragrance_id = f.id
    left join public.fragrance_performance_features_v1 pf
      on pf.fragrance_id = f.id
    order by f.name
  loop
    v_picked_count := v_picked_count + 1;
    v_proposal_status := null;
    v_proposed_universal_family_key := r.universal_family_key;
    v_proposed_facets := '[]'::jsonb;
    v_proposed_roles := '[]'::jsonb;
    v_proposed_confidence := null;
    v_proposed_review_status := null;
    v_blocker_reason := null;
    v_evidence_summary := '{}'::jsonb;
    v_source_summary := '{}'::jsonb;
    v_performance_summary := '{}'::jsonb;
    v_facet_keys := array[]::text[];
    v_primary_role := null;
    v_secondary_role := null;
    v_primary_role_confidence := null;
    v_secondary_role_confidence := null;
    v_facet_count := 0;
    v_role_count := 0;
    v_has_manual_review_penalty := false;
    v_role_rationale := array[]::text[];

    if r.evidence_quality_state <> 'promoted_enrichment_evidence' then
      v_proposal_status := 'blocked_insufficient_evidence';
      v_blocker_reason := 'evidence_not_promoted';
    elsif not r.has_promoted_text_evidence then
      v_proposal_status := 'blocked_insufficient_evidence';
      v_blocker_reason := 'missing_promoted_text_evidence';
    elsif r.queue_state <> 'ready_existing_evidence' or r.queue_lane <> 'safe_classifier_candidate' then
      v_proposal_status := 'blocked_insufficient_evidence';
      v_blocker_reason := 'not_safe_classifier_candidate';
    elsif r.notes_count = 0 or r.accords_count = 0 then
      v_proposal_status := 'blocked_insufficient_evidence';
      v_blocker_reason := 'missing_canonical_notes_or_accords';
    elsif r.has_rejected_match or r.has_revert_history then
      v_proposal_status := 'blocked_conflict';
      v_blocker_reason := 'rejected_or_reverted_source_history';
    elsif r.facet_count > 0 or r.role_count > 0 or r.has_taxonomy_review then
      v_proposal_status := 'blocked_conflict';
      v_blocker_reason := 'existing_final_taxonomy_present';
    end if;

    if v_proposal_status is null then
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'facet_key', facet_key,
              'display_label', display_label,
              'confidence', facet_confidence,
              'score', score,
              'matched_terms', to_jsonb(matched_terms)
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
          select unnest(coalesce(r.notes, array[]::text[])) as token
          union all
          select unnest(coalesce(r.accords, array[]::text[])) as token
        ),
        normalized_tokens as (
          select public.taxonomy_norm_text_v1(token) as token
          from raw_tokens
          where token is not null
        ),
        token_terms as (
          select token
          from normalized_tokens
          where token <> ''
          union
          select term
          from normalized_tokens
          cross join lateral regexp_split_to_table(token, '\s+') as term
          where term <> ''
        ),
        active_facets as (
          select facet_key, display_label, definition, coalesce(evidence_notes, '[]'::jsonb) as evidence_notes
          from public.facet_key_reference_v1
          where active is true
        ),
        evidence_terms as (
          select af.facet_key, af.display_label, af.definition, public.taxonomy_norm_text_v1(af.facet_key) as term, 3 as weight
          from active_facets af
          union all
          select af.facet_key, af.display_label, af.definition, public.taxonomy_norm_text_v1(af.display_label) as term, 2 as weight
          from active_facets af
          union all
          select af.facet_key, af.display_label, af.definition, public.taxonomy_norm_text_v1(en.term) as term, 2 as weight
          from active_facets af
          cross join lateral jsonb_array_elements_text(af.evidence_notes) as en(term)
        ),
        matched_terms as (
          select
            et.facet_key,
            et.display_label,
            et.definition,
            tt.token as matched_term,
            et.weight as matched_weight
          from evidence_terms et
          join token_terms tt
            on tt.token = et.term
          where et.term <> ''
        ),
        scored as (
          select
            facet_key,
            display_label,
            definition,
            array_agg(distinct matched_term order by matched_term) as matched_terms,
            sum(matched_weight) as score,
            case
              when sum(matched_weight) >= 7 then 0.90
              when sum(matched_weight) >= 6 then 0.86
              when sum(matched_weight) >= 5 then 0.82
              else 0.76
            end as facet_confidence
          from matched_terms
          group by facet_key, display_label, definition
        )
        select
          facet_key,
          display_label,
          definition,
          matched_terms,
          score,
          facet_confidence
        from scored
        where score >= 4
        order by score desc, facet_key
        limit 6
      ) ranked_facets;

      if coalesce(v_facet_keys, array[]::text[]) && array['citrus', 'marine', 'salty', 'aromatic']::text[]
         and coalesce(r.beast_mode_band, '') in ('LOW', 'MODERATE') then
        v_primary_role := 'brightener';
        v_secondary_role := 'bridge';
        v_primary_role_confidence := 0.82;
        v_secondary_role_confidence := 0.74;
        v_role_rationale := array['fresh_lift_facets', 'lighter_projection_profile'];
        v_has_manual_review_penalty := r.beast_mode_band = 'LOW';
      elsif coalesce(r.beast_mode_band, '') in ('HIGH', 'EXTREME')
         or coalesce(r.recommended_spray_caution, '') = 'avoid_stacking_loud' then
        v_primary_role := 'soloist';
        v_secondary_role := 'accent';
        v_primary_role_confidence := 0.90;
        v_secondary_role_confidence := 0.82;
        v_role_rationale := array['high_projection_or_spray_caution', 'statement_profile'];
      elsif coalesce(v_facet_keys, array[]::text[]) @> array['leather']::text[] then
        v_primary_role := 'anchor';
        v_secondary_role := 'accent';
        v_primary_role_confidence := 0.80;
        v_secondary_role_confidence := 0.73;
        v_role_rationale := array['structured_leather_profile', 'moderate_density_supports_core_slot'];
        v_has_manual_review_penalty := true;
      elsif coalesce(v_facet_keys, array[]::text[]) && array['musk', 'powdery', 'creamy']::text[]
         and coalesce(r.beast_mode_band, '') in ('LOW', 'MODERATE') then
        v_primary_role := 'softener';
        v_secondary_role := 'aura';
        v_primary_role_confidence := 0.78;
        v_secondary_role_confidence := 0.71;
        v_role_rationale := array['soft_diffusive_texture', 'gentler_projection_profile'];
        v_has_manual_review_penalty := true;
      else
        v_primary_role := 'anchor';
        v_secondary_role := null;
        v_primary_role_confidence := 0.72;
        v_secondary_role_confidence := null;
        v_role_rationale := array['fallback_structural_role'];
        v_has_manual_review_penalty := true;
      end if;

      if not exists (
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
        jsonb_agg(role_obj order by ((role_obj ->> 'role_priority')::integer)),
        '[]'::jsonb
      )
      into v_proposed_roles
      from (
        select jsonb_build_object(
          'role_key', v_primary_role,
          'role_priority', 1,
          'confidence', v_primary_role_confidence,
          'rationale', to_jsonb(v_role_rationale)
        ) as role_obj
        where v_primary_role is not null
        union all
        select jsonb_build_object(
          'role_key', v_secondary_role,
          'role_priority', 2,
          'confidence', v_secondary_role_confidence,
          'rationale', to_jsonb(v_role_rationale)
        ) as role_obj
        where v_secondary_role is not null
          and v_secondary_role <> v_primary_role
      ) role_payload;

      v_role_count := jsonb_array_length(v_proposed_roles);

      v_proposed_confidence := least(
        0.92,
        0.56
        + least(greatest(v_facet_count - 2, 0) * 0.03, 0.12)
        + case when v_role_count >= 2 then 0.05 when v_role_count = 1 then 0.03 else 0 end
        + case when coalesce(r.source_confidence, 0) >= 0.90 then 0.06 when coalesce(r.source_confidence, 0) >= 0.75 then 0.04 else 0 end
        + case when coalesce(r.signal_count, 0) >= 10 and coalesce(r.source_count, 0) >= 4 then 0.04 else 0.02 end
        + case when r.queue_lane = 'safe_classifier_candidate' then 0.03 else 0 end
        - case when v_has_manual_review_penalty then 0.05 else 0 end
      );

      if v_facet_count < 3 then
        v_proposal_status := 'needs_manual_review';
        v_blocker_reason := 'too_few_supported_facets';
      elsif v_role_count = 0 then
        v_proposal_status := 'needs_manual_review';
        v_blocker_reason := 'no_supported_role_mapping';
      elsif v_proposed_confidence >= 0.72 then
        v_proposal_status := 'proposed';
      else
        v_proposal_status := 'needs_manual_review';
        v_blocker_reason := 'low_proposal_confidence';
      end if;

      v_proposed_review_status := case
        when v_proposed_confidence >= 0.82 then 'confirmed'
        when v_proposed_confidence >= 0.65 then 'medium_confidence'
        else 'low_confidence'
      end;
    end if;

    v_source_summary := jsonb_build_object(
      'enrichment_status', r.enrichment_status,
      'has_promoted_text_evidence', r.has_promoted_text_evidence,
      'source_confidence', r.source_confidence,
      'source_url', r.source_url,
      'match_name', r.match_name,
      'match_brand', r.match_brand,
      'source_model_version', coalesce(r.source_model_version, 'unknown')
    );

    v_performance_summary := jsonb_build_object(
      'signal_count', r.signal_count,
      'source_count', r.source_count,
      'beast_mode_band', r.beast_mode_band,
      'recommended_spray_caution', r.recommended_spray_caution
    );

    v_evidence_summary := jsonb_build_object(
      'family_key', r.family_key,
      'proposed_universal_family_key', v_proposed_universal_family_key,
      'evidence_quality_state', r.evidence_quality_state,
      'queue_state', r.queue_state,
      'queue_lane', r.queue_lane,
      'notes_count', r.notes_count,
      'accords_count', r.accords_count,
      'facet_keys', to_jsonb(coalesce(v_facet_keys, array[]::text[])),
      'notes', to_jsonb(coalesce(r.notes, array[]::text[])),
      'accords', to_jsonb(coalesce(r.accords, array[]::text[])),
      'role_rationale', to_jsonb(coalesce(v_role_rationale, array[]::text[]))
    );

    if v_proposal_status in ('proposed', 'needs_manual_review') then
      v_proposed_count := v_proposed_count + 1;
    else
      v_blocked_count := v_blocked_count + 1;
    end if;

    if not p_dry_run then
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
        r.fragrance_id,
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
        coalesce(r.source_model_version, 'unknown'),
        r.queue_model_version,
        p_actor_label,
        now(),
        now()
      )
      on conflict (fragrance_id, classifier_model_version)
      do update
      set
        proposal_status = excluded.proposal_status,
        proposed_universal_family_key = excluded.proposed_universal_family_key,
        proposed_facets = excluded.proposed_facets,
        proposed_wardrobe_roles = excluded.proposed_wardrobe_roles,
        proposed_confidence = excluded.proposed_confidence,
        proposed_review_status = excluded.proposed_review_status,
        blocker_reason = excluded.blocker_reason,
        evidence_summary = excluded.evidence_summary,
        source_summary = excluded.source_summary,
        performance_summary = excluded.performance_summary,
        source_model_version = excluded.source_model_version,
        queue_model_version = excluded.queue_model_version,
        created_by = excluded.created_by,
        updated_at = now();
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'fragrance_id', r.fragrance_id,
        'name', r.name,
        'brand', r.brand,
        'proposal_status', v_proposal_status,
        'proposed_universal_family_key', v_proposed_universal_family_key,
        'proposed_facets', v_proposed_facets,
        'proposed_wardrobe_roles', v_proposed_roles,
        'proposed_confidence', v_proposed_confidence,
        'proposed_review_status', v_proposed_review_status,
        'blocker_reason', v_blocker_reason,
        'classifier_model_version', v_classifier_model_version,
        'source_model_version', coalesce(r.source_model_version, 'unknown'),
        'queue_model_version', r.queue_model_version,
        'evidence_summary', v_evidence_summary,
        'source_summary', v_source_summary,
        'performance_summary', v_performance_summary
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'function_version', v_classifier_model_version,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'distinct_requested_count', v_distinct_requested_count,
    'missing_ids', to_jsonb(coalesce(v_missing_ids, array[]::uuid[])),
    'picked', v_picked_count,
    'proposed_count', v_proposed_count,
    'blocked_count', v_blocked_count,
    'results', v_results
  );
end;
$$;

comment on function public.propose_fragrance_taxonomy_v1(uuid[], text, boolean) is
  'Proposal-only classifier lane. Reads promoted canonical evidence for explicit fragrance IDs and stores auditable taxonomy proposals without writing final taxonomy truth.';

revoke all on function public.propose_fragrance_taxonomy_v1(uuid[], text, boolean) from public, anon, authenticated;
grant execute on function public.propose_fragrance_taxonomy_v1(uuid[], text, boolean) to service_role;

commit;
