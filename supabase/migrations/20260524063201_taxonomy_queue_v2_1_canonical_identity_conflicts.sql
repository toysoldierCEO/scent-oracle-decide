begin;

create or replace view public.taxonomy_canonical_identity_conflicts_v1
with (security_invoker = true)
as
with base as (
  select
    e.fragrance_id,
    e.name,
    e.brand,
    e.family_key,
    e.universal_family_key,
    e.notes_count,
    e.accords_count,
    e.has_structured_scent_evidence,
    q.queue_state,
    q.queue_lane,
    public.norm_identity_name_v1(e.name) as normalized_name_key,
    public.norm_identity_brand_v1(e.brand) as normalized_brand_key,
    nullif(
      btrim(regexp_replace(
        regexp_replace(
          public.norm_identity_brand_v1(e.brand),
          '(^| )(parfums|perfumes|perfume|fragrance|fragrances)( |$)',
          ' ',
          'g'
        ),
        '\s+',
        ' ',
        'g'
      )),
      ''
    ) as compatible_brand_key,
    coalesce(e.notes_count, 0) + coalesce(e.accords_count, 0) as evidence_item_count,
    (q.queue_state = 'already_complete') as is_already_complete
  from public.taxonomy_evidence_status_v2 e
  left join public.taxonomy_operationalization_queue_v2 q
    on q.fragrance_id = e.fragrance_id
),
clustered as (
  select
    b.normalized_name_key,
    b.compatible_brand_key,
    (b.normalized_name_key || '|' || b.compatible_brand_key) as canonical_identity_key,
    count(*)::integer as cluster_member_count,
    jsonb_agg(to_jsonb(b.fragrance_id) order by b.name, b.brand, b.fragrance_id) as member_fragrance_ids,
    jsonb_agg(to_jsonb(b.name) order by b.name, b.brand, b.fragrance_id) as member_names,
    jsonb_agg(to_jsonb(b.brand) order by b.name, b.brand, b.fragrance_id) as member_brands,
    jsonb_agg(to_jsonb(b.family_key) order by b.name, b.brand, b.fragrance_id) as member_family_keys,
    jsonb_agg(to_jsonb(b.universal_family_key) order by b.name, b.brand, b.fragrance_id) as member_universal_family_keys,
    jsonb_agg(jsonb_build_object(
      'fragrance_id', b.fragrance_id,
      'name', b.name,
      'brand', b.brand,
      'notes_count', b.notes_count
    ) order by b.name, b.brand, b.fragrance_id) as member_notes_counts,
    jsonb_agg(jsonb_build_object(
      'fragrance_id', b.fragrance_id,
      'name', b.name,
      'brand', b.brand,
      'accords_count', b.accords_count
    ) order by b.name, b.brand, b.fragrance_id) as member_accords_counts,
    jsonb_agg(jsonb_build_object(
      'fragrance_id', b.fragrance_id,
      'name', b.name,
      'brand', b.brand,
      'queue_state', b.queue_state,
      'queue_lane', b.queue_lane
    ) order by b.name, b.brand, b.fragrance_id) as member_queue_states,
    count(*) filter (where b.evidence_item_count > 0)::integer as evidenceful_member_count,
    count(*) filter (where b.evidence_item_count = 0)::integer as zero_evidence_member_count,
    count(*) filter (where b.is_already_complete)::integer as complete_member_count,
    count(*) filter (where not b.is_already_complete)::integer as incomplete_member_count,
    max(b.evidence_item_count)::integer as max_evidence_item_count,
    (count(*) filter (where b.evidence_item_count > 0) > 0 and count(*) filter (where b.evidence_item_count = 0) > 0) as has_evidence_asymmetry,
    (count(distinct b.normalized_brand_key) > 1) as has_brand_variant_conflict,
    (count(distinct lower(btrim(b.name))) > 1) as has_spelling_or_punctuation_variant,
    (
      count(distinct b.family_key) filter (where b.family_key is not null) <= 1
      and count(distinct b.universal_family_key) filter (where b.universal_family_key is not null) <= 1
    ) as has_family_universal_compatibility
  from base b
  where b.normalized_name_key is not null
    and b.compatible_brand_key is not null
  group by b.normalized_name_key, b.compatible_brand_key
  having count(*) > 1
),
members as (
  select
    b.*,
    c.canonical_identity_key,
    c.cluster_member_count,
    c.member_fragrance_ids,
    c.member_names,
    c.member_brands,
    c.member_family_keys,
    c.member_universal_family_keys,
    c.member_notes_counts,
    c.member_accords_counts,
    c.member_queue_states,
    c.evidenceful_member_count,
    c.zero_evidence_member_count,
    c.complete_member_count,
    c.incomplete_member_count,
    c.has_evidence_asymmetry,
    c.has_brand_variant_conflict,
    c.has_spelling_or_punctuation_variant,
    c.has_family_universal_compatibility,
    (
      not b.is_already_complete
      and c.has_family_universal_compatibility
      and (
        b.evidence_item_count = 0
        or c.complete_member_count > 0
        or (
          c.has_spelling_or_punctuation_variant
          and (coalesce(b.notes_count, 0) = 0 or coalesce(b.accords_count, 0) = 0)
        )
        or (
          c.has_brand_variant_conflict
          and c.has_evidence_asymmetry
          and b.evidence_item_count < c.max_evidence_item_count
        )
      )
    ) as canonical_identity_action_required
  from base b
  join clustered c
    on c.normalized_name_key = b.normalized_name_key
   and c.compatible_brand_key = b.compatible_brand_key
)
select
  m.fragrance_id,
  m.name,
  m.brand,
  m.canonical_identity_key,
  m.normalized_name_key,
  m.normalized_brand_key,
  m.compatible_brand_key,
  m.cluster_member_count,
  m.member_fragrance_ids,
  m.member_names,
  m.member_brands,
  m.member_family_keys,
  m.member_universal_family_keys,
  m.member_notes_counts,
  m.member_accords_counts,
  m.member_queue_states,
  m.evidenceful_member_count,
  m.zero_evidence_member_count,
  m.complete_member_count,
  m.incomplete_member_count,
  m.has_evidence_asymmetry,
  m.has_brand_variant_conflict,
  m.has_spelling_or_punctuation_variant,
  m.has_family_universal_compatibility,
  m.canonical_identity_action_required,
  nullif(concat_ws(
    ';',
    'duplicate_name_brand_variant',
    case when m.has_spelling_or_punctuation_variant then 'spelling_or_punctuation_variant' end,
    case when m.has_brand_variant_conflict then 'brand_suffix_variant' end,
    case when m.has_evidence_asymmetry then 'evidenceful_sibling_exists' end,
    case when m.complete_member_count > 0 then 'complete_sibling_exists' end,
    case when not m.has_family_universal_compatibility then 'family_or_universal_conflict' end,
    'unresolved_duplicate_identity'
  ), '') as conflict_reason,
  case
    when m.is_already_complete then 'complete_member_no_queue_action'
    when m.canonical_identity_action_required then 'review_canonical_identity_cluster'
    else 'canonical_identity_visible_no_queue_override'
  end as recommended_next_action,
  jsonb_strip_nulls(jsonb_build_object(
    'canonical_identity_key', m.canonical_identity_key,
    'normalized_name_key', m.normalized_name_key,
    'normalized_brand_key', m.normalized_brand_key,
    'compatible_brand_key', m.compatible_brand_key,
    'cluster_member_count', m.cluster_member_count,
    'member_fragrance_ids', m.member_fragrance_ids,
    'member_names', m.member_names,
    'member_brands', m.member_brands,
    'member_family_keys', m.member_family_keys,
    'member_universal_family_keys', m.member_universal_family_keys,
    'member_notes_counts', m.member_notes_counts,
    'member_accords_counts', m.member_accords_counts,
    'member_queue_states', m.member_queue_states,
    'evidenceful_member_count', m.evidenceful_member_count,
    'zero_evidence_member_count', m.zero_evidence_member_count,
    'complete_member_count', m.complete_member_count,
    'incomplete_member_count', m.incomplete_member_count,
    'has_evidence_asymmetry', m.has_evidence_asymmetry,
    'has_brand_variant_conflict', m.has_brand_variant_conflict,
    'has_spelling_or_punctuation_variant', m.has_spelling_or_punctuation_variant,
    'has_family_universal_compatibility', m.has_family_universal_compatibility,
    'canonical_identity_action_required', m.canonical_identity_action_required
  )) as canonical_identity_evidence_summary,
  statement_timestamp() as generated_at
from members m;

comment on view public.taxonomy_canonical_identity_conflicts_v1 is
  'Canonical identity conflict routing evidence. Operational only: not a merge, not dedupe, not source truth, not enrichment staging, not taxonomy, and does not copy notes, accords, source, family, or taxonomy between fragrance rows.';

create or replace view public.taxonomy_evidence_status_v2_1
with (security_invoker = true)
as
select
  e.*,
  (c.fragrance_id is not null) as has_canonical_identity_conflict,
  coalesce(c.canonical_identity_action_required, false) as canonical_identity_action_required,
  c.canonical_identity_key,
  c.cluster_member_count as canonical_identity_cluster_size,
  c.member_fragrance_ids as canonical_identity_member_ids,
  c.member_names as canonical_identity_member_names,
  c.member_brands as canonical_identity_member_brands,
  c.conflict_reason as canonical_identity_conflict_reason,
  c.recommended_next_action as canonical_identity_recommended_action,
  c.canonical_identity_evidence_summary,
  'taxonomy_evidence_status_v2_1_canonical_identity_2026_05_24'::text as canonical_identity_model_version
from public.taxonomy_evidence_status_v2 e
left join public.taxonomy_canonical_identity_conflicts_v1 c
  on c.fragrance_id = e.fragrance_id;

comment on view public.taxonomy_evidence_status_v2_1 is
  'Canonical-identity-aware evidence read model. It extends taxonomy_evidence_status_v2 with operational duplicate/canonical-name conflict evidence only; it does not count conflicts as canonical scent, source, enrichment, or taxonomy truth.';

create or replace view public.taxonomy_operationalization_queue_v2_1
with (security_invoker = true)
as
with base as (
  select
    e.*,
    q.queue_state as v2_queue_state,
    q.queue_lane as v2_queue_lane,
    q.blocker_reason as v2_blocker_reason,
    q.recommended_next_action as v2_recommended_next_action,
    q.product_priority_score as v2_product_priority_score,
    q.product_priority_reason as v2_product_priority_reason,
    q.taxonomy_missing_summary as v2_taxonomy_missing_summary,
    q.evidence_summary as v2_evidence_summary,
    q.resolver_evidence_summary as v2_resolver_evidence_summary
  from public.taxonomy_evidence_status_v2_1 e
  join public.taxonomy_operationalization_queue_v2 q
    on q.fragrance_id = e.fragrance_id
),
classified as (
  select
    b.*,
    case
      when b.v2_queue_state in ('blocked_rejected_match', 'contaminated_data', 'already_complete') then b.v2_queue_state
      when b.canonical_identity_action_required then 'canonical_name_conflict'
      else b.v2_queue_state
    end as queue_state_v2_1
  from base b
)
select
  c.fragrance_id,
  c.name,
  c.brand,
  c.family_key,
  c.legacy_family_key,
  c.universal_family_key,
  c.evidence_quality_state,
  c.queue_state_v2_1 as queue_state,
  case
    when c.queue_state_v2_1 = 'canonical_name_conflict' then nullif(concat_ws(
      ';',
      'canonical_identity_conflict',
      c.canonical_identity_conflict_reason
    ), '')
    else c.v2_blocker_reason
  end as blocker_reason,
  case
    when c.queue_state_v2_1 = 'canonical_name_conflict' then 'review_canonical_identity_cluster'
    else c.v2_recommended_next_action
  end as recommended_next_action,
  case
    when c.queue_state_v2_1 = 'canonical_name_conflict' then 'canonical_identity_review'
    else c.v2_queue_lane
  end as queue_lane,
  least(
    100,
    coalesce(c.v2_product_priority_score, 0)
    + case when c.queue_state_v2_1 = 'canonical_name_conflict' then 5 else 0 end
  )::integer as product_priority_score,
  nullif(concat_ws(
    ', ',
    c.v2_product_priority_reason,
    case when c.queue_state_v2_1 = 'canonical_name_conflict' then 'canonical_identity_conflict' end
  ), '') as product_priority_reason,
  c.v2_taxonomy_missing_summary as taxonomy_missing_summary,
  c.v2_evidence_summary as evidence_summary,
  c.v2_resolver_evidence_summary as resolver_evidence_summary,
  c.canonical_identity_evidence_summary,
  'taxonomy_operationalization_queue_v2_1_canonical_identity_2026_05_24'::text as queue_model_version,
  statement_timestamp() as generated_at
from classified c;

comment on view public.taxonomy_operationalization_queue_v2_1 is
  'Canonical-identity-aware operational queue. Additive read model that does not replace Queue v1 or Queue v2 destructively. Canonical identity conflicts are operational routing blockers only: not merges, not source truth, not taxonomy, and not a frontend product payload.';

revoke all on public.taxonomy_canonical_identity_conflicts_v1 from public, anon, authenticated;
revoke all on public.taxonomy_evidence_status_v2_1 from public, anon, authenticated;
revoke all on public.taxonomy_operationalization_queue_v2_1 from public, anon, authenticated;

grant select on public.taxonomy_canonical_identity_conflicts_v1 to service_role;
grant select on public.taxonomy_evidence_status_v2_1 to service_role;
grant select on public.taxonomy_operationalization_queue_v2_1 to service_role;

commit;
