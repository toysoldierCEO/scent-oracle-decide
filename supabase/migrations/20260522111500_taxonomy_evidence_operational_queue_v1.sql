begin;

create or replace function public.taxonomy_norm_text_v1(p_text text)
returns text
language sql
immutable
set search_path = public
as $function$
  select nullif(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '', 'g'), '');
$function$;

comment on function public.taxonomy_norm_text_v1(text)
  is 'Internal read-only helper for taxonomy operationalization views. Normalizes text for lightweight identity comparisons only.';

revoke all on function public.taxonomy_norm_text_v1(text) from public;
revoke all on function public.taxonomy_norm_text_v1(text) from anon;
revoke all on function public.taxonomy_norm_text_v1(text) from authenticated;
grant execute on function public.taxonomy_norm_text_v1(text) to service_role;

create or replace function public.taxonomy_relation_has_column_v1(
  p_schema text,
  p_table text,
  p_column text
)
returns boolean
language sql
stable
set search_path = pg_catalog
as $function$
  select exists (
    select 1
    from pg_namespace n
    join pg_class c
      on c.relnamespace = n.oid
    join pg_attribute a
      on a.attrelid = c.oid
    where n.nspname = p_schema
      and c.relname = p_table
      and a.attname = p_column
      and not a.attisdropped
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  );
$function$;

comment on function public.taxonomy_relation_has_column_v1(text, text, text)
  is 'Internal read-only helper for taxonomy operationalization views. Checks whether an optional relation exposes a specific column before attempting per-fragrance rollups.';

revoke all on function public.taxonomy_relation_has_column_v1(text, text, text) from public;
revoke all on function public.taxonomy_relation_has_column_v1(text, text, text) from anon;
revoke all on function public.taxonomy_relation_has_column_v1(text, text, text) from authenticated;
grant execute on function public.taxonomy_relation_has_column_v1(text, text, text) to service_role;

create or replace function public.taxonomy_user_wear_trial_counts_v1()
returns table (
  fragrance_id uuid,
  wear_trial_count bigint
)
language plpgsql
stable
set search_path = public, pg_catalog
as $function$
begin
  if to_regclass('public.user_wear_trials') is null then
    return;
  end if;

  if not public.taxonomy_relation_has_column_v1('public', 'user_wear_trials', 'fragrance_id') then
    return;
  end if;

  return query execute $sql$
    select
      uwt.fragrance_id::uuid as fragrance_id,
      count(*)::bigint as wear_trial_count
    from public.user_wear_trials uwt
    where uwt.fragrance_id is not null
    group by uwt.fragrance_id
  $sql$;
end;
$function$;

comment on function public.taxonomy_user_wear_trial_counts_v1()
  is 'Internal read-only helper for taxonomy operationalization views. Returns per-fragrance wear-trial counts only when the optional user_wear_trials surface exposes fragrance_id.';

revoke all on function public.taxonomy_user_wear_trial_counts_v1() from public;
revoke all on function public.taxonomy_user_wear_trial_counts_v1() from anon;
revoke all on function public.taxonomy_user_wear_trial_counts_v1() from authenticated;
grant execute on function public.taxonomy_user_wear_trial_counts_v1() to service_role;

create or replace function public.taxonomy_decision_event_counts_v1()
returns table (
  fragrance_id uuid,
  decision_event_count bigint
)
language plpgsql
stable
set search_path = public, pg_catalog
as $function$
begin
  if to_regclass('public.user_scent_decision_events') is null then
    return;
  end if;

  if not public.taxonomy_relation_has_column_v1('public', 'user_scent_decision_events', 'fragrance_id') then
    return;
  end if;

  return query execute $sql$
    select
      se.fragrance_id::uuid as fragrance_id,
      count(*)::bigint as decision_event_count
    from public.user_scent_decision_events se
    where se.fragrance_id is not null
    group by se.fragrance_id
  $sql$;
end;
$function$;

comment on function public.taxonomy_decision_event_counts_v1()
  is 'Internal read-only helper for taxonomy operationalization views. Returns per-fragrance decision-event counts only when the optional user_scent_decision_events surface exposes fragrance_id.';

revoke all on function public.taxonomy_decision_event_counts_v1() from public;
revoke all on function public.taxonomy_decision_event_counts_v1() from anon;
revoke all on function public.taxonomy_decision_event_counts_v1() from authenticated;
grant execute on function public.taxonomy_decision_event_counts_v1() to service_role;

create or replace view public.taxonomy_evidence_status_v1 as
with target_user as (
  select '330006e3-331c-4451-a321-d0e6f3ba454c'::uuid as user_id
),
support_flags as (
  select
    public.taxonomy_relation_has_column_v1('public', 'user_wear_trials', 'fragrance_id') as wear_trial_supported,
    public.taxonomy_relation_has_column_v1('public', 'user_scent_decision_events', 'fragrance_id') as decision_event_supported
),
enrichment_latest as (
  select distinct on (fte.fragrance_id)
    fte.fragrance_id,
    fte.status,
    fte.source_url,
    case
      when coalesce(fte.source_confidence::text, '') ~ '^[0-9]+(\\.[0-9]+)?$'
        then (fte.source_confidence::text)::numeric
      else null
    end as source_confidence_num,
    fte.match_name,
    fte.match_brand,
    fte.last_error,
    fte.updated_at
  from public.fragrance_text_enrichment fte
  order by fte.fragrance_id, fte.updated_at desc nulls last, fte.created_at desc nulls last
),
promoted_latest as (
  select distinct on (p.fragrance_id)
    p.fragrance_id,
    p.source_url,
    case
      when coalesce(p.source_confidence::text, '') ~ '^[0-9]+(\\.[0-9]+)?$'
        then (p.source_confidence::text)::numeric
      else null
    end as source_confidence_num,
    p.match_name,
    p.match_brand,
    coalesce(p.promoted_at, p.created_at) as promoted_at
  from public.fragrance_text_enrichment_promotions_v1 p
  where p.result_status = 'promoted'
  order by p.fragrance_id, coalesce(p.promoted_at, p.created_at) desc nulls last, p.created_at desc
),
notes_promoted_latest as (
  select distinct on (np.fragrance_id)
    np.fragrance_id,
    np.source_url,
    case
      when coalesce(np.source_confidence::text, '') ~ '^[0-9]+(\\.[0-9]+)?$'
        then (np.source_confidence::text)::numeric
      else null
    end as source_confidence_num,
    np.match_name,
    np.match_brand,
    coalesce(np.promoted_at, np.created_at) as promoted_at
  from public.fragrance_text_enrichment_notes_promotions_v1 np
  where np.result_status = 'notes_promoted'
  order by np.fragrance_id, coalesce(np.promoted_at, np.created_at) desc nulls last, np.created_at desc
),
promotion_rollup as (
  select
    x.fragrance_id,
    bool_or(x.has_promoted_text_evidence) as has_promoted_text_evidence,
    bool_or(x.has_notes_only_promotion) as has_notes_only_promotion
  from (
    select
      p.fragrance_id,
      true as has_promoted_text_evidence,
      false as has_notes_only_promotion
    from public.fragrance_text_enrichment_promotions_v1 p
    where p.result_status = 'promoted'

    union all

    select
      np.fragrance_id,
      true as has_promoted_text_evidence,
      true as has_notes_only_promotion
    from public.fragrance_text_enrichment_notes_promotions_v1 np
    where np.result_status = 'notes_promoted'
  ) x
  group by x.fragrance_id
),
reject_events as (
  select
    r.fragrance_id,
    coalesce(r.reverted_at, r.created_at) as event_at,
    coalesce(r.rejection_reason, r.reason, r.action) as reject_reason
  from public.fragrance_text_enrichment_reverts_v1 r
  where r.action = 'revert_wrong_match'
     or r.reason is not null
     or r.rejection_reason is not null

  union all

  select
    p.fragrance_id,
    coalesce(p.promoted_at, p.created_at) as event_at,
    coalesce(p.rejection_reason, p.action) as reject_reason
  from public.fragrance_text_enrichment_promotions_v1 p
  where p.rejection_reason is not null

  union all

  select
    np.fragrance_id,
    coalesce(np.promoted_at, np.created_at) as event_at,
    coalesce(np.rejection_reason, np.reason, np.action) as reject_reason
  from public.fragrance_text_enrichment_notes_promotions_v1 np
  where np.rejection_reason is not null
),
reject_latest as (
  select distinct on (re.fragrance_id)
    re.fragrance_id,
    re.reject_reason,
    re.event_at
  from reject_events re
  order by re.fragrance_id, re.event_at desc nulls last
),
reject_rollup as (
  select
    re.fragrance_id,
    true as has_rejected_match,
    max(re.event_at) as latest_reject_at
  from reject_events re
  group by re.fragrance_id
),
revert_rollup as (
  select
    r.fragrance_id,
    true as has_revert_history
  from public.fragrance_text_enrichment_reverts_v1 r
  group by r.fragrance_id
),
performance_rollup as (
  select
    pf.fragrance_id,
    pf.signal_count,
    pf.source_count,
    pf.beast_mode_band,
    pf.recommended_spray_caution,
    true as has_performance_features
  from public.fragrance_performance_features_v1 pf
),
material_signal_rollup as (
  select
    ms.fragrance_id,
    count(*)::bigint as material_signal_count
  from public.fragrance_material_signals_v1 ms
  where coalesce(ms.is_active, true)
  group by ms.fragrance_id
),
facet_rollup as (
  select
    ff.fragrance_id,
    count(*)::bigint as facet_count
  from public.fragrance_facets_v1 ff
  join public.facet_key_reference_v1 fkr
    on fkr.facet_key = ff.facet_key
   and fkr.active
  group by ff.fragrance_id
),
role_rollup as (
  select
    fr.fragrance_id,
    count(*)::bigint as role_count
  from public.fragrance_wardrobe_roles_v1 fr
  join public.wardrobe_role_reference_v1 wrr
    on wrr.role_key = fr.role_key
   and wrr.active
  group by fr.fragrance_id
),
review_rollup as (
  select
    ftr.fragrance_id,
    true as has_taxonomy_review,
    ftr.review_status,
    ftr.confidence,
    ftr.evidence_source
  from public.fragrance_taxonomy_review_v1 ftr
),
owned_rollup as (
  select
    uc.fragrance_id,
    count(*)::bigint as collection_row_count,
    count(distinct uc.user_id)::bigint as owning_user_count,
    bool_or(uc.status = 'signature') as is_signature_or_high_value,
    bool_or(uc.status = 'owned') as has_owned_status,
    bool_or(uc.status = 'liked') as has_liked_status,
    bool_or(uc.user_id = tu.user_id) as is_owned_by_target_user
  from public.user_collection uc
  cross join target_user tu
  group by uc.fragrance_id
),
wear_rollup as (
  select
    we.fragrance_id,
    count(*)::bigint as wear_event_count,
    max(we.worn_at) as last_worn_at
  from public.wear_events we
  group by we.fragrance_id
),
wear_trial_rollup as (
  select *
  from public.taxonomy_user_wear_trial_counts_v1()
),
decision_event_rollup as (
  select *
  from public.taxonomy_decision_event_counts_v1()
),
base as (
  select
    f.id as fragrance_id,
    f.name,
    f.brand,
    f.family_key,
    f.family_key as legacy_family_key,
    tx.universal_family_key,
    f.created_at,
    f.updated_at,
    f.notes as notes_raw,
    f.accords as accords_raw,
    coalesce(array_length(f.notes, 1), 0) as notes_count,
    coalesce(array_length(f.accords, 1), 0) as accords_count,
    coalesce(array_length(f.top_notes, 1), 0) as top_notes_count,
    coalesce(array_length(f.heart_notes, 1), 0) as heart_notes_count,
    coalesce(array_length(f.base_notes, 1), 0) as base_notes_count,
    (coalesce(array_length(f.notes, 1), 0) > 0
      or coalesce(array_length(f.top_notes, 1), 0) > 0
      or coalesce(array_length(f.heart_notes, 1), 0) > 0
      or coalesce(array_length(f.base_notes, 1), 0) > 0) as has_any_note_evidence,
    (coalesce(array_length(f.accords, 1), 0) > 0) as has_any_accord_evidence,
    (
      coalesce(array_length(f.notes, 1), 0) > 0
      or coalesce(array_length(f.accords, 1), 0) > 0
      or coalesce(array_length(f.top_notes, 1), 0) > 0
      or coalesce(array_length(f.heart_notes, 1), 0) > 0
      or coalesce(array_length(f.base_notes, 1), 0) > 0
    ) as has_structured_scent_evidence,
    (el.fragrance_id is not null) as has_text_enrichment_row,
    el.status as enrichment_status,
    el.match_name as enrichment_match_name,
    el.match_brand as enrichment_match_brand,
    coalesce(f.source_url, el.source_url, pl.source_url, npl.source_url, tx.source_url) as source_url,
    (
      coalesce(f.source_url, el.source_url, pl.source_url, npl.source_url, tx.source_url) is not null
      and btrim(coalesce(f.source_url, el.source_url, pl.source_url, npl.source_url, tx.source_url)) <> ''
    ) as has_source_url,
    coalesce(
      case
        when coalesce(f.source_confidence::text, '') ~ '^[0-9]+(\\.[0-9]+)?$'
          then (f.source_confidence::text)::numeric
        else null
      end,
      el.source_confidence_num,
      pl.source_confidence_num,
      npl.source_confidence_num
    ) as source_confidence,
    coalesce(rr.has_rejected_match, false) as has_rejected_match,
    rl.reject_reason as latest_reject_reason,
    coalesce(pr.has_promoted_text_evidence, false) as has_promoted_text_evidence,
    coalesce(pr.has_notes_only_promotion, false) as has_notes_only_promotion,
    coalesce(rv.has_revert_history, false) as has_revert_history,
    coalesce(pf.signal_count, ms.material_signal_count) as performance_signal_count,
    pf.source_count as performance_source_count,
    pf.beast_mode_band,
    pf.recommended_spray_caution,
    coalesce(pf.has_performance_features, false) as has_performance_features,
    (f.family_key is not null) as has_family_assignment,
    (tx.universal_family_key is not null) as has_universal_family,
    coalesce(fr.facet_count, 0) as facet_count,
    coalesce(rrr.role_count, 0) as role_count,
    coalesce(tr.has_taxonomy_review, false) as has_taxonomy_review,
    tr.review_status as taxonomy_review_status,
    tr.confidence as taxonomy_confidence,
    (tx.fragrance_id is not null) as resolved_taxonomy_available,
    coalesce(orw.owning_user_count, 0) > 0 as is_owned_by_any_user,
    coalesce(orw.is_owned_by_target_user, false) as is_owned_by_target_user,
    coalesce(orw.is_signature_or_high_value, false) as is_signature_or_high_value,
    coalesce(wr.wear_event_count, 0) as wear_event_count,
    case
      when sf.wear_trial_supported then coalesce(wtr.wear_trial_count, 0)
      else null
    end as wear_trial_count,
    case
      when sf.decision_event_supported then coalesce(der.decision_event_count, 0)
      else null
    end as decision_event_count,
    sf.wear_trial_supported,
    sf.decision_event_supported,
    coalesce(orw.collection_row_count, 0) as collection_row_count,
    coalesce(orw.has_owned_status, false) as has_owned_status,
    coalesce(orw.has_liked_status, false) as has_liked_status,
    wr.last_worn_at
  from public.fragrances f
  left join public.fragrance_taxonomy_resolved_v1 tx
    on tx.fragrance_id = f.id
  left join enrichment_latest el
    on el.fragrance_id = f.id
  left join promoted_latest pl
    on pl.fragrance_id = f.id
  left join notes_promoted_latest npl
    on npl.fragrance_id = f.id
  left join promotion_rollup pr
    on pr.fragrance_id = f.id
  left join reject_rollup rr
    on rr.fragrance_id = f.id
  left join reject_latest rl
    on rl.fragrance_id = f.id
  left join revert_rollup rv
    on rv.fragrance_id = f.id
  left join performance_rollup pf
    on pf.fragrance_id = f.id
  left join material_signal_rollup ms
    on ms.fragrance_id = f.id
  left join facet_rollup fr
    on fr.fragrance_id = f.id
  left join role_rollup rrr
    on rrr.fragrance_id = f.id
  left join review_rollup tr
    on tr.fragrance_id = f.id
  left join owned_rollup orw
    on orw.fragrance_id = f.id
  left join wear_rollup wr
    on wr.fragrance_id = f.id
  left join wear_trial_rollup wtr
    on wtr.fragrance_id = f.id
  left join decision_event_rollup der
    on der.fragrance_id = f.id
  cross join support_flags sf
),
derived as (
  select
    b.*,
    (
      not b.has_any_note_evidence
      and not b.has_any_accord_evidence
      and not b.has_structured_scent_evidence
      and not b.has_text_enrichment_row
      and not b.has_source_url
    ) as has_missing_core_evidence,
    (
      exists (
        select 1
        from unnest(coalesce(b.notes_raw, array[]::text[])) as n(note_value)
        where lower(note_value) like '%detailed note pyramid not available%'
           or lower(note_value) like '%search results%'
           or lower(note_value) like '%inspired by%'
           or lower(note_value) like '%looking for a fragrance%'
           or lower(note_value) like '%key features and benefits%'
           or lower(note_value) like '%transport you%'
           or lower(note_value) like 'http%'
           or length(note_value) > 120
      )
      or exists (
        select 1
        from unnest(coalesce(b.accords_raw, array[]::text[])) as a(accord_value)
        where lower(accord_value) like '%detailed note pyramid not available%'
           or lower(accord_value) like '%search results%'
           or lower(accord_value) like '%inspired by%'
           or lower(accord_value) like 'http%'
           or length(accord_value) > 80
      )
    ) as has_contamination_risk,
    (
      b.has_rejected_match
      or (
        b.enrichment_match_brand is not null
        and public.taxonomy_norm_text_v1(b.enrichment_match_brand) is not null
        and public.taxonomy_norm_text_v1(b.brand) is not null
        and public.taxonomy_norm_text_v1(b.enrichment_match_brand) <> public.taxonomy_norm_text_v1(b.brand)
      )
      or (
        b.enrichment_match_name is not null
        and public.taxonomy_norm_text_v1(b.enrichment_match_name) is not null
        and public.taxonomy_norm_text_v1(b.name) is not null
        and public.taxonomy_norm_text_v1(b.enrichment_match_name) <> public.taxonomy_norm_text_v1(b.name)
        and public.taxonomy_norm_text_v1(b.enrichment_match_name) not like public.taxonomy_norm_text_v1(b.name) || '%'
        and public.taxonomy_norm_text_v1(b.name) not like public.taxonomy_norm_text_v1(b.enrichment_match_name) || '%'
      )
    ) as has_identity_conflict_risk,
    (
      b.has_source_url
      and coalesce(b.source_confidence, 0) >= 0.75
    ) as has_trusted_source,
    (
      b.has_rejected_match
      and not (
        b.has_source_url
        and coalesce(b.source_confidence, 0) >= 0.75
        and (
          b.has_any_note_evidence
          or b.has_any_accord_evidence
          or b.has_structured_scent_evidence
          or b.has_promoted_text_evidence
        )
      )
    ) as has_active_rejected_match_blocker
  from base b
)
select
  d.fragrance_id,
  d.name,
  d.brand,
  d.family_key,
  d.legacy_family_key,
  d.universal_family_key,
  d.created_at,
  d.updated_at,
  d.notes_count,
  d.accords_count,
  d.top_notes_count,
  d.heart_notes_count,
  d.base_notes_count,
  d.has_any_note_evidence,
  d.has_any_accord_evidence,
  d.has_structured_scent_evidence,
  d.has_text_enrichment_row,
  d.enrichment_status,
  d.enrichment_match_name,
  d.enrichment_match_brand,
  d.source_url,
  d.has_source_url,
  d.source_confidence,
  d.has_rejected_match,
  d.latest_reject_reason,
  d.has_promoted_text_evidence,
  d.has_notes_only_promotion,
  d.has_revert_history,
  d.performance_signal_count,
  d.performance_source_count,
  d.beast_mode_band,
  d.recommended_spray_caution,
  d.has_performance_features,
  d.has_family_assignment,
  d.has_universal_family,
  d.facet_count,
  d.role_count,
  d.has_taxonomy_review,
  d.taxonomy_review_status,
  d.taxonomy_confidence,
  d.resolved_taxonomy_available,
  d.is_owned_by_any_user,
  d.is_owned_by_target_user,
  d.is_signature_or_high_value,
  d.wear_event_count,
  d.wear_trial_count,
  d.decision_event_count,
  d.has_missing_core_evidence,
  d.has_contamination_risk,
  d.has_identity_conflict_risk,
  case
    when d.has_contamination_risk then 'contaminated_or_suspicious'
    when d.has_active_rejected_match_blocker then 'rejected_provider_match'
    when d.has_source_url and d.source_confidence is not null and d.source_confidence < 0.75 then 'low_confidence_source'
    when d.has_promoted_text_evidence and (d.has_any_note_evidence or d.has_any_accord_evidence or d.has_structured_scent_evidence) then 'promoted_enrichment_evidence'
    when d.has_trusted_source and (d.has_any_note_evidence or d.has_any_accord_evidence or d.has_structured_scent_evidence) and not d.has_contamination_risk then 'trusted_existing_evidence'
    when d.has_missing_core_evidence then 'source_gap'
    when (d.wear_event_count > 0 or coalesce(d.wear_trial_count, 0) > 0) and not d.has_any_note_evidence and not d.has_any_accord_evidence then 'wear_data_only'
    when d.has_any_note_evidence or d.has_any_accord_evidence or d.has_text_enrichment_row or d.has_source_url then
      case
        when d.has_structured_scent_evidence then 'partial_canonical_evidence'
        else 'insufficient_structured_evidence'
      end
    else 'unknown'
  end as evidence_quality_state,
  case
    when d.has_active_rejected_match_blocker then coalesce(d.latest_reject_reason, 'rejected_provider_match')
    when d.has_contamination_risk then 'prose_contaminated_fields'
    when d.has_missing_core_evidence then 'missing_notes_and_accords'
    when d.has_source_url and d.source_confidence is not null and d.source_confidence < 0.75 then 'low_source_confidence'
    when d.has_identity_conflict_risk and not d.has_trusted_source then 'identity_conflict_risk'
    when not d.has_structured_scent_evidence and (d.has_any_note_evidence or d.has_any_accord_evidence or d.has_text_enrichment_row or d.has_source_url) then 'insufficient_structured_evidence'
    else null
  end as evidence_blocker_reason,
  jsonb_strip_nulls(
    jsonb_build_object(
      'canonical',
      jsonb_build_object(
        'notes_count', d.notes_count,
        'accords_count', d.accords_count,
        'top_notes_count', d.top_notes_count,
        'heart_notes_count', d.heart_notes_count,
        'base_notes_count', d.base_notes_count,
        'has_any_note_evidence', d.has_any_note_evidence,
        'has_any_accord_evidence', d.has_any_accord_evidence,
        'has_structured_scent_evidence', d.has_structured_scent_evidence
      ),
      'source',
      jsonb_build_object(
        'has_text_enrichment_row', d.has_text_enrichment_row,
        'enrichment_status', d.enrichment_status,
        'enrichment_match_name', d.enrichment_match_name,
        'enrichment_match_brand', d.enrichment_match_brand,
        'source_url', d.source_url,
        'source_confidence', d.source_confidence,
        'has_source_url', d.has_source_url,
        'has_promoted_text_evidence', d.has_promoted_text_evidence,
        'has_notes_only_promotion', d.has_notes_only_promotion,
        'has_revert_history', d.has_revert_history,
        'has_rejected_match', d.has_rejected_match,
        'latest_reject_reason', d.latest_reject_reason
      ),
      'performance',
      jsonb_build_object(
        'performance_signal_count', d.performance_signal_count,
        'performance_source_count', d.performance_source_count,
        'beast_mode_band', d.beast_mode_band,
        'recommended_spray_caution', d.recommended_spray_caution,
        'has_performance_features', d.has_performance_features
      ),
      'taxonomy',
      jsonb_build_object(
        'has_family_assignment', d.has_family_assignment,
        'has_universal_family', d.has_universal_family,
        'facet_count', d.facet_count,
        'role_count', d.role_count,
        'has_taxonomy_review', d.has_taxonomy_review,
        'taxonomy_review_status', d.taxonomy_review_status,
        'taxonomy_confidence', d.taxonomy_confidence,
        'resolved_taxonomy_available', d.resolved_taxonomy_available
      ),
      'importance',
      jsonb_build_object(
        'is_owned_by_any_user', d.is_owned_by_any_user,
        'is_owned_by_target_user', d.is_owned_by_target_user,
        'is_signature_or_high_value', d.is_signature_or_high_value,
        'wear_event_count', d.wear_event_count,
        'wear_trial_count', d.wear_trial_count,
        'decision_event_count', d.decision_event_count,
        'collection_row_count', d.collection_row_count,
        'has_owned_status', d.has_owned_status,
        'has_liked_status', d.has_liked_status,
        'last_worn_at', d.last_worn_at
      ),
      'risks',
      jsonb_build_object(
        'has_missing_core_evidence', d.has_missing_core_evidence,
        'has_contamination_risk', d.has_contamination_risk,
        'has_identity_conflict_risk', d.has_identity_conflict_risk,
        'has_active_rejected_match_blocker', d.has_active_rejected_match_blocker,
        'wear_trial_supported', d.wear_trial_supported,
        'decision_event_supported', d.decision_event_supported
      )
    )
  ) as evidence_summary,
  'taxonomy_evidence_status_v1'::text as evidence_model_version,
  statement_timestamp() as generated_at
from derived d;

comment on view public.taxonomy_evidence_status_v1
  is 'Read-only backend evidence surface for taxonomy operationalization. It answers what evidence exists for each fragrance, does not classify or write taxonomy, and intentionally separates evidence condition from next-action queue state.';

revoke all on table public.taxonomy_evidence_status_v1 from public;
revoke all on table public.taxonomy_evidence_status_v1 from anon;
revoke all on table public.taxonomy_evidence_status_v1 from authenticated;
grant select on table public.taxonomy_evidence_status_v1 to service_role;

create or replace view public.taxonomy_operationalization_queue_v1 as
with evidence as (
  select
    tes.*,
    (
      tes.has_family_assignment
      and tes.has_universal_family
      and tes.facet_count > 0
      and tes.role_count > 0
      and tes.has_taxonomy_review
      and tes.evidence_quality_state <> 'rejected_provider_match'
      and not tes.has_contamination_risk
    ) as is_already_complete,
    (
      tes.evidence_quality_state in ('trusted_existing_evidence', 'promoted_enrichment_evidence')
      and tes.has_family_assignment
      and tes.has_universal_family
      and tes.has_structured_scent_evidence
      and not tes.has_contamination_risk
      and not (tes.has_rejected_match and tes.evidence_quality_state = 'rejected_provider_match')
    ) as is_ready_existing_evidence,
    (
      tes.evidence_quality_state in ('trusted_existing_evidence', 'promoted_enrichment_evidence')
      and not tes.has_performance_features
      and (tes.is_owned_by_any_user or tes.wear_event_count > 0 or coalesce(tes.wear_trial_count, 0) > 0)
    ) as is_wear_test_candidate
  from public.taxonomy_evidence_status_v1 tes
),
queued as (
  select
    e.*,
    case
      when e.has_rejected_match and e.evidence_quality_state = 'rejected_provider_match' then 'blocked_rejected_match'
      when e.has_contamination_risk then 'contaminated_data'
      when e.is_already_complete then 'already_complete'
      when e.evidence_quality_state = 'source_gap' then 'source_gap'
      when e.evidence_quality_state in ('partial_canonical_evidence', 'insufficient_structured_evidence', 'low_confidence_source', 'wear_data_only') then 'insufficient_evidence'
      when e.is_ready_existing_evidence then 'ready_existing_evidence'
      when e.is_wear_test_candidate then 'needs_wear_test'
      when e.has_identity_conflict_risk then 'manual_review'
      else 'unknown'
    end as queue_state
  from evidence e
)
select
  q.fragrance_id,
  q.name,
  q.brand,
  q.family_key,
  q.legacy_family_key,
  q.universal_family_key,
  q.evidence_quality_state,
  q.queue_state,
  case q.queue_state
    when 'blocked_rejected_match' then coalesce(q.latest_reject_reason, 'rejected_provider_match')
    when 'contaminated_data' then coalesce(q.evidence_blocker_reason, 'prose_contaminated_fields')
    when 'already_complete' then null
    when 'source_gap' then coalesce(q.evidence_blocker_reason, 'missing_notes_and_accords')
    when 'insufficient_evidence' then coalesce(q.evidence_blocker_reason, 'insufficient_structured_evidence')
    when 'ready_existing_evidence' then null
    when 'needs_wear_test' then 'wear_data_needed'
    when 'manual_review' then coalesce(q.evidence_blocker_reason, 'identity_conflict_risk')
    else coalesce(q.evidence_blocker_reason, 'unknown_schema_gap')
  end as blocker_reason,
  case q.queue_state
    when 'blocked_rejected_match' then 'manual_identity_repair'
    when 'contaminated_data' then 'source_repair_canonical_cleanup'
    when 'already_complete' then 'complete_no_action'
    when 'source_gap' then 'acquire_exact_source'
    when 'insufficient_evidence' then 'defer_until_structured_evidence'
    when 'ready_existing_evidence' then 'stage_classifier_proposal'
    when 'needs_wear_test' then 'collect_wear_trials'
    when 'manual_review' then 'manual_taxonomy_review'
    else 'investigate_queue_rule_gap'
  end as recommended_next_action,
  case
    when q.queue_state = 'already_complete' then 'complete_no_action'
    when q.queue_state in ('blocked_rejected_match', 'contaminated_data', 'source_gap')
      and (q.is_owned_by_target_user or q.is_owned_by_any_user or q.is_signature_or_high_value) then 'product_critical_blocker'
    when q.queue_state = 'source_gap' then 'source_repair_candidate'
    when q.queue_state = 'ready_existing_evidence' then 'safe_classifier_candidate'
    when q.queue_state = 'needs_wear_test' then 'wear_test_needed'
    when q.queue_state = 'manual_review' then 'manual_review'
    when q.queue_state = 'unknown' then 'unknown_review'
    else 'manual_review'
  end as queue_lane,
  least(
    100,
    (case when q.is_owned_by_target_user then 45 else 0 end)
    + (case when q.is_owned_by_any_user then 20 else 0 end)
    + (case when q.is_signature_or_high_value then 15 else 0 end)
    + (case when q.has_promoted_text_evidence then 8 else 0 end)
    + (case when q.has_revert_history then 8 else 0 end)
    + (case when q.has_rejected_match then 6 else 0 end)
    + (case when q.has_performance_features then 4 else 0 end)
    + (case when q.queue_state in ('blocked_rejected_match', 'contaminated_data') then 6 else 0 end)
    + least(coalesce(q.wear_event_count, 0), 10) * 2
    + least(coalesce(q.wear_trial_count, 0), 10)
  )::integer as product_priority_score,
  nullif(
    array_to_string(
      array_remove(
        array[
          case when q.is_owned_by_target_user then 'target_user_owned' end,
          case when q.is_owned_by_any_user then 'owned_by_user' end,
          case when q.is_signature_or_high_value then 'signature_or_high_value' end,
          case when q.wear_event_count > 0 then 'wear_history' end,
          case when coalesce(q.wear_trial_count, 0) > 0 then 'wear_trials' end,
          case when q.has_promoted_text_evidence then 'promoted_evidence' end,
          case when q.has_revert_history then 'revert_history' end,
          case when q.has_rejected_match then 'rejected_match_history' end,
          case when q.has_performance_features then 'performance_profile_available' end
        ],
        null
      ),
      ', '
    ),
    ''
  ) as product_priority_reason,
  jsonb_strip_nulls(
    jsonb_build_object(
      'missing_family_assignment', not q.has_family_assignment,
      'missing_universal_family', not q.has_universal_family,
      'missing_facets', q.facet_count = 0,
      'missing_roles', q.role_count = 0,
      'missing_taxonomy_review', not q.has_taxonomy_review,
      'facet_count', q.facet_count,
      'role_count', q.role_count,
      'taxonomy_review_status', q.taxonomy_review_status
    )
  ) as taxonomy_missing_summary,
  q.evidence_summary,
  'taxonomy_operationalization_queue_v1'::text as queue_model_version,
  statement_timestamp() as generated_at
from queued q;

comment on view public.taxonomy_operationalization_queue_v1
  is 'Read-only backend operational queue for taxonomy work. It depends on taxonomy_evidence_status_v1, separates evidence state from next action, and keeps rejected or contaminated rows ahead of readiness so frontend code cannot infer taxonomy work from raw evidence alone.';

revoke all on table public.taxonomy_operationalization_queue_v1 from public;
revoke all on table public.taxonomy_operationalization_queue_v1 from anon;
revoke all on table public.taxonomy_operationalization_queue_v1 from authenticated;
grant select on table public.taxonomy_operationalization_queue_v1 to service_role;

commit;
