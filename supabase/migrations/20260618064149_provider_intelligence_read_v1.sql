begin;

create or replace view public.fragrance_provider_intelligence_approved_read_v1
with (security_invoker = true)
as
select
  r.id as intelligence_id,
  r.fragrance_id,
  r.fragrance_name_snapshot as fragrance_name,
  r.brand_snapshot as brand,
  r.source_type,
  r.source_tier,
  r.source_name,
  r.evidence_type,
  r.evidence_status,
  r.review_status,
  r.extraction_method,
  r.extraction_confidence,
  r.extraction_warnings,
  r.normalized_notes,
  r.normalized_pyramid,
  r.normalized_accords,
  true as usable_for_vesper_intelligence,
  false as official_registry_eligible,
  false as patch_safe_now,
  'Non-official provider intelligence approved for internal Vesper use only. Not official brand evidence and not patch-safe.'::text as source_disclaimer,
  r.created_at,
  r.updated_at
from public.fragrance_provider_intelligence_registry_v1 r
where r.review_status = 'approved_for_internal_use'
  and r.evidence_status = 'usable_non_official_intelligence'
  and r.superseded_at is null
  and r.official_registry_eligible = false
  and r.patch_safe_now = false
  and r.source_type in ('retailer', 'professional_provider', 'community_provider')
  and r.source_tier in (
    'retailer_structured_notes',
    'retailer_pyramid_evidence',
    'professional_provider_pyramid',
    'community_provider_consensus'
  );

revoke all on public.fragrance_provider_intelligence_approved_read_v1
  from public, anon, authenticated;

revoke all on public.fragrance_provider_intelligence_approved_read_v1
  from service_role;

grant select on public.fragrance_provider_intelligence_approved_read_v1
  to service_role;

create or replace function public.get_approved_fragrance_provider_intelligence_v1(
  p_fragrance_ids uuid[] default null,
  p_limit integer default 50
)
returns table (
  intelligence_id uuid,
  fragrance_id uuid,
  fragrance_name text,
  brand text,
  source_type text,
  source_tier text,
  source_name text,
  evidence_type text,
  evidence_status text,
  review_status text,
  extraction_method text,
  extraction_confidence numeric,
  extraction_warnings jsonb,
  normalized_notes jsonb,
  normalized_pyramid jsonb,
  normalized_accords jsonb,
  usable_for_vesper_intelligence boolean,
  official_registry_eligible boolean,
  patch_safe_now boolean,
  source_disclaimer text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    v.intelligence_id,
    v.fragrance_id,
    v.fragrance_name,
    v.brand,
    v.source_type,
    v.source_tier,
    v.source_name,
    v.evidence_type,
    v.evidence_status,
    v.review_status,
    v.extraction_method,
    v.extraction_confidence,
    v.extraction_warnings,
    v.normalized_notes,
    v.normalized_pyramid,
    v.normalized_accords,
    v.usable_for_vesper_intelligence,
    v.official_registry_eligible,
    v.patch_safe_now,
    v.source_disclaimer,
    v.created_at,
    v.updated_at
  from public.fragrance_provider_intelligence_approved_read_v1 v
  where ($1 is null or v.fragrance_id = any($1))
  order by
    v.extraction_confidence desc,
    v.updated_at desc,
    v.created_at desc,
    v.intelligence_id
  limit least(greatest(coalesce($2, 50), 1), 100);
$$;

revoke all on function public.get_approved_fragrance_provider_intelligence_v1(uuid[], integer)
  from public, anon, authenticated;

grant execute on function public.get_approved_fragrance_provider_intelligence_v1(uuid[], integer)
  to service_role;

comment on view public.fragrance_provider_intelligence_approved_read_v1
  is 'Service-role-only sanitized read lane for approved non-official provider intelligence. Does not expose raw_evidence, provider_payload, source_url, patch-safe claims, or official brand confirmation.';

comment on function public.get_approved_fragrance_provider_intelligence_v1(uuid[], integer)
  is 'Service-role-only read helper for approved sanitized provider intelligence. It returns only approved non-official rows and does not mutate public.fragrances or official registry data.';

commit;
