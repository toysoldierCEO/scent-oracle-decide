begin;

create or replace view public.fragrance_vesper_intelligence_resolver_v1
with (security_invoker = true)
as
with app_curated_candidates as (
  select
    f.id as fragrance_id,
    f.name as fragrance_name,
    f.brand,
    'curated_app_data'::text as intelligence_status,
    to_jsonb(coalesce(f.notes, '{}'::text[])) as primary_notes,
    jsonb_build_object(
      'top', to_jsonb(coalesce(f.top_notes, '{}'::text[])),
      'heart', to_jsonb(coalesce(f.heart_notes, '{}'::text[])),
      'base', to_jsonb(coalesce(f.base_notes, '{}'::text[]))
    ) as primary_pyramid,
    to_jsonb(coalesce(f.accords, '{}'::text[])) as primary_accords,
    'public_fragrances_curated'::text as intelligence_source_tier,
    'curated_app_data'::text as intelligence_source_type,
    coalesce(nullif(btrim(f.data_source), ''), 'public.fragrances') as intelligence_source_name,
    case
      when f.source_confidence ~ '^[0-9]+([.][0-9]+)?$'
        then least(greatest(f.source_confidence::numeric, 0), 1)
      when lower(coalesce(f.source_confidence, '')) = 'high'
        then 0.9
      else 0.82
    end as intelligence_confidence,
    '[]'::jsonb as intelligence_warnings,
    'Curated app fragrance profile. Useful for Vesper explanations; source URLs and raw source payloads are not exposed.'::text as source_disclaimer,
    false as official_registry_eligible,
    false as patch_safe_now,
    true as usable_for_vesper_intelligence,
    null::text as limited_intel_reason,
    f.updated_at,
    1 as priority_rank
  from public.fragrances f
  where (
      coalesce(cardinality(f.top_notes), 0)
      + coalesce(cardinality(f.heart_notes), 0)
      + coalesce(cardinality(f.base_notes), 0)
    ) > 0
    or (
      f.data_source is not null
      and length(btrim(f.data_source)) > 0
      and (
        coalesce(cardinality(f.notes), 0)
        + coalesce(cardinality(f.accords), 0)
        + coalesce(cardinality(f.top_notes), 0)
        + coalesce(cardinality(f.heart_notes), 0)
        + coalesce(cardinality(f.base_notes), 0)
      ) > 0
    )
),
official_candidates as (
  select
    r.fragrance_id,
    r.name_snapshot as fragrance_name,
    r.brand_snapshot as brand,
    'approved_official_evidence_available'::text as intelligence_status,
    case
      when coalesce(cardinality(r.official_notes), 0) > 0
        then to_jsonb(r.official_notes)
      else to_jsonb(
        coalesce(r.official_top_notes, '{}'::text[])
        || coalesce(r.official_heart_notes, '{}'::text[])
        || coalesce(r.official_base_notes, '{}'::text[])
      )
    end as primary_notes,
    jsonb_build_object(
      'top', to_jsonb(coalesce(r.official_top_notes, '{}'::text[])),
      'heart', to_jsonb(coalesce(r.official_heart_notes, '{}'::text[])),
      'base', to_jsonb(coalesce(r.official_base_notes, '{}'::text[]))
    ) as primary_pyramid,
    '[]'::jsonb as primary_accords,
    r.source_evidence_type as intelligence_source_tier,
    'official_brand'::text as intelligence_source_type,
    coalesce(nullif(btrim(r.source_domain), ''), 'official_source_registry') as intelligence_source_name,
    r.source_confidence as intelligence_confidence,
    case
      when nullif(btrim(coalesce(r.source_verification_summary, '')), '') is not null
        then jsonb_build_array(btrim(r.source_verification_summary))
      else '[]'::jsonb
    end as intelligence_warnings,
    'Official brand evidence summarized from the official source registry. Read-only Vesper context; not a patch authorization.'::text as source_disclaimer,
    true as official_registry_eligible,
    false as patch_safe_now,
    true as usable_for_vesper_intelligence,
    null::text as limited_intel_reason,
    r.updated_at,
    2 as priority_rank
  from (
    select
      r.*,
      row_number() over (
        partition by r.fragrance_id
        order by
          case r.source_evidence_type
            when 'official_pyramid' then 1
            when 'official_notes_only' then 2
            when 'official_key_notes' then 3
            else 9
          end,
          r.source_confidence desc nulls last,
          r.updated_at desc,
          r.id
      ) as rn
    from public.fragrance_official_source_evidence_registry_v1 r
    where r.evidence_status = 'active'
      and r.source_type = 'official_brand'
      and r.source_evidence_type in ('official_pyramid', 'official_notes_only', 'official_key_notes')
      and r.identity_match_status = 'exact'
      and r.duplicate_risk = 'none'
      and r.concentration_ambiguity = 'none'
      and (
        coalesce(cardinality(r.official_notes), 0)
        + coalesce(cardinality(r.official_top_notes), 0)
        + coalesce(cardinality(r.official_heart_notes), 0)
        + coalesce(cardinality(r.official_base_notes), 0)
      ) > 0
  ) r
  where r.rn = 1
),
provider_candidates as (
  select
    p.fragrance_id,
    p.fragrance_name,
    p.brand,
    case
      when p.source_tier = 'retailer_structured_notes'
        then 'approved_provider_structured_notes'
      when p.source_tier in ('retailer_pyramid_evidence', 'professional_provider_pyramid')
        then 'approved_provider_structured_pyramid'
      when p.source_tier = 'community_provider_consensus'
        then 'approved_provider_consensus'
      else 'approved_provider_intelligence'
    end as intelligence_status,
    p.normalized_notes as primary_notes,
    p.normalized_pyramid as primary_pyramid,
    p.normalized_accords as primary_accords,
    p.source_tier as intelligence_source_tier,
    p.source_type as intelligence_source_type,
    p.source_name as intelligence_source_name,
    p.extraction_confidence as intelligence_confidence,
    p.extraction_warnings as intelligence_warnings,
    'Non-official structured provider intelligence. Useful for Vesper explanations, not official brand confirmation.'::text as source_disclaimer,
    false as official_registry_eligible,
    false as patch_safe_now,
    true as usable_for_vesper_intelligence,
    null::text as limited_intel_reason,
    p.updated_at,
    3 as priority_rank
  from public.fragrance_provider_intelligence_approved_read_v1 p
  where p.review_status = 'approved_for_internal_use'
    and p.evidence_status = 'usable_non_official_intelligence'
    and p.usable_for_vesper_intelligence = true
    and p.official_registry_eligible = false
    and p.patch_safe_now = false
),
limited_candidates as (
  select
    f.id as fragrance_id,
    f.name as fragrance_name,
    f.brand,
    'limited_intel'::text as intelligence_status,
    '[]'::jsonb as primary_notes,
    '{"top":[],"heart":[],"base":[]}'::jsonb as primary_pyramid,
    '[]'::jsonb as primary_accords,
    'limited_intel'::text as intelligence_source_tier,
    'limited_intel'::text as intelligence_source_type,
    null::text as intelligence_source_name,
    0::numeric as intelligence_confidence,
    jsonb_build_array('No approved official, curated, or provider intelligence is available.') as intelligence_warnings,
    'Limited intelligence fallback. Vesper should keep explanations generic and avoid note-specific claims.'::text as source_disclaimer,
    false as official_registry_eligible,
    false as patch_safe_now,
    true as usable_for_vesper_intelligence,
    'No approved official, curated, or provider intelligence is available; use beginner-safe generic language only.'::text as limited_intel_reason,
    f.updated_at,
    4 as priority_rank
  from public.fragrances f
),
ranked_candidates as (
  select
    c.*,
    row_number() over (
      partition by c.fragrance_id
      order by
        c.priority_rank,
        c.intelligence_confidence desc nulls last,
        c.updated_at desc nulls last,
        c.intelligence_status
    ) as resolver_rank
  from (
    select * from app_curated_candidates
    union all
    select * from official_candidates
    union all
    select * from provider_candidates
    union all
    select * from limited_candidates
  ) c
)
select
  fragrance_id,
  fragrance_name,
  brand,
  intelligence_status,
  primary_notes,
  primary_pyramid,
  primary_accords,
  intelligence_source_tier,
  intelligence_source_type,
  intelligence_source_name,
  intelligence_confidence,
  intelligence_warnings,
  source_disclaimer,
  official_registry_eligible,
  patch_safe_now,
  usable_for_vesper_intelligence,
  limited_intel_reason,
  updated_at
from ranked_candidates
where resolver_rank = 1;

revoke all on public.fragrance_vesper_intelligence_resolver_v1
  from public, anon, authenticated;

revoke all on public.fragrance_vesper_intelligence_resolver_v1
  from service_role;

grant select on public.fragrance_vesper_intelligence_resolver_v1
  to service_role;

create or replace function public.get_fragrance_vesper_intelligence_v1(
  p_fragrance_ids uuid[] default null,
  p_limit integer default 50
)
returns table (
  fragrance_id uuid,
  fragrance_name text,
  brand text,
  intelligence_status text,
  primary_notes jsonb,
  primary_pyramid jsonb,
  primary_accords jsonb,
  intelligence_source_tier text,
  intelligence_source_type text,
  intelligence_source_name text,
  intelligence_confidence numeric,
  intelligence_warnings jsonb,
  source_disclaimer text,
  official_registry_eligible boolean,
  patch_safe_now boolean,
  usable_for_vesper_intelligence boolean,
  limited_intel_reason text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    v.fragrance_id,
    v.fragrance_name,
    v.brand,
    v.intelligence_status,
    v.primary_notes,
    v.primary_pyramid,
    v.primary_accords,
    v.intelligence_source_tier,
    v.intelligence_source_type,
    v.intelligence_source_name,
    v.intelligence_confidence,
    v.intelligence_warnings,
    v.source_disclaimer,
    v.official_registry_eligible,
    v.patch_safe_now,
    v.usable_for_vesper_intelligence,
    v.limited_intel_reason,
    v.updated_at
  from public.fragrance_vesper_intelligence_resolver_v1 v
  where ($1 is null or v.fragrance_id = any($1))
  order by
    v.fragrance_name,
    v.brand,
    v.fragrance_id
  limit least(greatest(coalesce($2, 50), 1), 100);
$$;

revoke all on function public.get_fragrance_vesper_intelligence_v1(uuid[], integer)
  from public, anon, authenticated;

grant execute on function public.get_fragrance_vesper_intelligence_v1(uuid[], integer)
  to service_role;

comment on view public.fragrance_vesper_intelligence_resolver_v1
  is 'Service-role-only sanitized resolver for Vesper fragrance intelligence. Prioritizes curated app data, safe official summaries, approved provider intelligence, then limited fallback without exposing raw provider payloads.';

comment on function public.get_fragrance_vesper_intelligence_v1(uuid[], integer)
  is 'Service-role-only read helper for sanitized Vesper fragrance intelligence. It is read-only, bounded to 100 rows, and does not mutate public.fragrances, provider intelligence, or official registry data.';

commit;
