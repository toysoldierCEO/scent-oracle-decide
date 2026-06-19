begin;

create or replace view public.fragrance_identity_metadata_approved_read_v1
with (security_invoker = true)
as
select
  r.id as metadata_evidence_id,
  r.fragrance_id,
  r.fragrance_name_snapshot as fragrance_name,
  r.brand_snapshot as brand,
  r.source_type,
  r.source_tier,
  r.source_name,
  r.evidence_status,
  r.review_status,
  r.release_year,
  r.perfumer_names,
  r.concentration,
  r.extraction_method,
  r.extraction_confidence,
  r.extraction_warnings,
  false as patch_safe_now,
  false as official_registry_eligible,
  case
    when r.source_tier in ('official_brand_product_page', 'official_brand_metadata')
      then 'Source-backed official metadata evidence. Approved for internal Vesper use, not yet catalog-patched.'
    when r.source_tier = 'community_provider_metadata'
      then 'Community provider metadata. Approved for internal Vesper use, not official brand confirmation.'
    when r.source_tier = 'retailer_structured_metadata'
      then 'Retailer structured metadata. Approved for internal Vesper use, not official brand confirmation.'
    when r.source_tier = 'professional_provider_metadata'
      then 'Professional provider metadata. Approved for internal Vesper use, not official brand confirmation.'
    else 'Approved metadata evidence for internal Vesper use only. Not a catalog patch authorization.'
  end as metadata_source_disclaimer,
  r.created_at,
  r.updated_at
from public.fragrance_identity_metadata_evidence_registry_v1 r
where r.review_status = 'approved_for_internal_use'
  and r.superseded_at is null
  and r.patch_safe_now = false
  and r.official_registry_eligible = false
  and r.evidence_status = 'active'
  and r.source_tier in (
    'official_brand_product_page',
    'official_brand_metadata',
    'retailer_structured_metadata',
    'professional_provider_metadata',
    'community_provider_metadata'
  )
  and (
    (r.source_type = 'official_brand' and r.source_tier in ('official_brand_metadata', 'official_brand_product_page'))
    or (r.source_type = 'retailer' and r.source_tier = 'retailer_structured_metadata')
    or (r.source_type = 'professional_provider' and r.source_tier = 'professional_provider_metadata')
    or (r.source_type = 'community_provider' and r.source_tier = 'community_provider_metadata')
  );

revoke all on public.fragrance_identity_metadata_approved_read_v1
  from public, anon, authenticated;

revoke all on public.fragrance_identity_metadata_approved_read_v1
  from service_role;

grant select on public.fragrance_identity_metadata_approved_read_v1
  to service_role;

create or replace function public.get_approved_fragrance_identity_metadata_v1(
  p_fragrance_ids uuid[] default null,
  p_limit integer default 50
)
returns table (
  metadata_evidence_id uuid,
  fragrance_id uuid,
  fragrance_name text,
  brand text,
  source_type text,
  source_tier text,
  source_name text,
  evidence_status text,
  review_status text,
  release_year integer,
  perfumer_names jsonb,
  concentration text,
  extraction_method text,
  extraction_confidence numeric,
  extraction_warnings jsonb,
  patch_safe_now boolean,
  official_registry_eligible boolean,
  metadata_source_disclaimer text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    v.metadata_evidence_id,
    v.fragrance_id,
    v.fragrance_name,
    v.brand,
    v.source_type,
    v.source_tier,
    v.source_name,
    v.evidence_status,
    v.review_status,
    v.release_year,
    v.perfumer_names,
    v.concentration,
    v.extraction_method,
    v.extraction_confidence,
    v.extraction_warnings,
    v.patch_safe_now,
    v.official_registry_eligible,
    v.metadata_source_disclaimer,
    v.created_at,
    v.updated_at
  from public.fragrance_identity_metadata_approved_read_v1 v
  where ($1 is null or v.fragrance_id = any($1))
  order by
    v.fragrance_name,
    v.brand,
    case v.source_tier
      when 'official_brand_metadata' then 1
      when 'official_brand_product_page' then 2
      when 'professional_provider_metadata' then 3
      when 'retailer_structured_metadata' then 4
      when 'community_provider_metadata' then 5
      else 9
    end,
    v.extraction_confidence desc nulls last,
    v.updated_at desc,
    v.metadata_evidence_id
  limit least(greatest(coalesce($2, 50), 1), 100);
$$;

revoke all on function public.get_approved_fragrance_identity_metadata_v1(uuid[], integer)
  from public, anon, authenticated;

revoke all on function public.get_approved_fragrance_identity_metadata_v1(uuid[], integer)
  from service_role;

grant execute on function public.get_approved_fragrance_identity_metadata_v1(uuid[], integer)
  to service_role;

comment on view public.fragrance_identity_metadata_approved_read_v1
  is 'Service-role-only sanitized read lane for approved fragrance identity metadata evidence. It exposes approved release year, perfumer names, and concentration evidence without raw payloads, source URLs, hashes, actor/batch labels, patch-safe claims, or catalog mutation.';

comment on function public.get_approved_fragrance_identity_metadata_v1(uuid[], integer)
  is 'Service-role-only bounded read helper for approved fragrance identity metadata evidence. It returns sanitized rows only and does not mutate public.fragrances, official registry, provider intelligence, or metadata evidence.';

commit;
