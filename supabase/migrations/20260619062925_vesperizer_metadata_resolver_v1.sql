begin;

create or replace view public.fragrance_identity_metadata_resolver_v1
with (security_invoker = true)
as
with source_rows as (
  select
    metadata_evidence_id,
    fragrance_id,
    fragrance_name,
    brand,
    source_type,
    source_tier,
    source_name,
    release_year,
    perfumer_names,
    concentration,
    extraction_confidence,
    extraction_warnings,
    metadata_source_disclaimer,
    updated_at
  from public.fragrance_identity_metadata_approved_read_v1
), field_candidates as (
  select
    r.fragrance_id,
    r.fragrance_name,
    r.brand,
    'release_year'::text as field_name,
    r.release_year::text as value_key,
    to_jsonb(r.release_year) as value_json,
    r.release_year as value_int,
    null::jsonb as value_array,
    null::text as value_text,
    r.source_type,
    r.source_tier,
    r.source_name,
    r.extraction_confidence,
    r.extraction_warnings,
    r.metadata_source_disclaimer,
    r.updated_at,
    r.metadata_evidence_id
  from source_rows r
  where r.release_year is not null
  union all
  select
    r.fragrance_id,
    r.fragrance_name,
    r.brand,
    'perfumer_names'::text as field_name,
    r.perfumer_names::text as value_key,
    r.perfumer_names as value_json,
    null::integer as value_int,
    r.perfumer_names as value_array,
    null::text as value_text,
    r.source_type,
    r.source_tier,
    r.source_name,
    r.extraction_confidence,
    r.extraction_warnings,
    r.metadata_source_disclaimer,
    r.updated_at,
    r.metadata_evidence_id
  from source_rows r
  where jsonb_typeof(r.perfumer_names) = 'array'
    and jsonb_array_length(r.perfumer_names) > 0
  union all
  select
    r.fragrance_id,
    r.fragrance_name,
    r.brand,
    'concentration'::text as field_name,
    lower(btrim(r.concentration)) as value_key,
    to_jsonb(btrim(r.concentration)) as value_json,
    null::integer as value_int,
    null::jsonb as value_array,
    btrim(r.concentration) as value_text,
    r.source_type,
    r.source_tier,
    r.source_name,
    r.extraction_confidence,
    r.extraction_warnings,
    r.metadata_source_disclaimer,
    r.updated_at,
    r.metadata_evidence_id
  from source_rows r
  where nullif(btrim(coalesce(r.concentration, '')), '') is not null
), field_stats as (
  select
    fragrance_id,
    field_name,
    count(distinct value_key) as distinct_value_count,
    count(distinct value_key) filter (where source_type = 'official_brand') as official_distinct_value_count,
    count(distinct value_key) filter (where source_type <> 'official_brand') as non_official_distinct_value_count,
    bool_or(source_type = 'official_brand') as has_official_candidate,
    bool_or(source_type <> 'official_brand') as has_non_official_candidate
  from field_candidates
  group by fragrance_id, field_name
), ranked_field_candidates as (
  select
    c.*,
    s.distinct_value_count,
    s.official_distinct_value_count,
    s.non_official_distinct_value_count,
    s.has_official_candidate,
    s.has_non_official_candidate,
    row_number() over (
      partition by c.fragrance_id, c.field_name
      order by
        case c.source_tier
          when 'official_brand_metadata' then 1
          when 'official_brand_product_page' then 2
          when 'professional_provider_metadata' then 3
          when 'retailer_structured_metadata' then 4
          when 'community_provider_metadata' then 5
          else 9
        end,
        c.extraction_confidence desc nulls last,
        c.updated_at desc nulls last,
        c.metadata_evidence_id
    ) as field_rank
  from field_candidates c
  join field_stats s
    on s.fragrance_id = c.fragrance_id
   and s.field_name = c.field_name
), field_resolutions as (
  select
    *,
    (
      official_distinct_value_count > 1
      or (official_distinct_value_count = 0 and non_official_distinct_value_count > 1)
    ) as blocked_by_conflict,
    (
      official_distinct_value_count > 0
      and non_official_distinct_value_count > 0
      and distinct_value_count > 1
    ) as official_non_official_disagree
  from ranked_field_candidates
  where field_rank = 1
), fragrance_keys as (
  select
    fragrance_id,
    min(fragrance_name) as fragrance_name,
    min(brand) as brand
  from source_rows
  group by fragrance_id
), held_conflicts as (
  select
    r.fragrance_id,
    true as has_conflict_hold
  from public.fragrance_identity_metadata_evidence_registry_v1 r
  where r.review_status = 'proposed'
    and r.superseded_at is null
    and (
      r.extraction_warnings::text ilike '%conflict%'
      or r.reason ilike '%conflict%'
    )
  group by r.fragrance_id
), source_summary as (
  select
    fragrance_id,
    bool_or(source_type = 'official_brand') as has_official_metadata,
    bool_or(source_type = 'community_provider') as has_community_metadata,
    bool_or(source_type in ('retailer', 'professional_provider')) as has_other_non_official_metadata,
    max(updated_at) as updated_at
  from source_rows
  group by fragrance_id
)
select
  k.fragrance_id,
  k.fragrance_name,
  k.brand,
  release_year.value_int as resolved_release_year,
  coalesce(perfumer_names.value_array, '[]'::jsonb) as resolved_perfumer_names,
  concentration.value_text as resolved_concentration,
  release_year.source_type as release_year_source_type,
  release_year.source_tier as release_year_source_tier,
  release_year.source_name as release_year_source_name,
  perfumer_names.source_type as perfumer_source_type,
  perfumer_names.source_tier as perfumer_source_tier,
  perfumer_names.source_name as perfumer_source_name,
  concentration.source_type as concentration_source_type,
  concentration.source_tier as concentration_source_tier,
  concentration.source_name as concentration_source_name,
  jsonb_build_object(
    'release_year', release_year.extraction_confidence,
    'perfumer_names', perfumer_names.extraction_confidence,
    'concentration', concentration.extraction_confidence
  ) as metadata_confidence_summary,
  coalesce((
    select jsonb_agg(distinct warning order by warning)
    from (
      select jsonb_array_elements_text(r.extraction_warnings) as warning
      from source_rows r
      where r.fragrance_id = k.fragrance_id
      union all
      select concat(fr.field_name, ': multiple official approved values disagree; field suppressed for review.') as warning
      from field_resolutions fr
      where fr.fragrance_id = k.fragrance_id
        and fr.official_distinct_value_count > 1
      union all
      select concat(fr.field_name, ': multiple non-official approved values disagree; field suppressed for review.') as warning
      from field_resolutions fr
      where fr.fragrance_id = k.fragrance_id
        and fr.official_distinct_value_count = 0
        and fr.non_official_distinct_value_count > 1
      union all
      select concat(fr.field_name, ': official and non-official approved values disagree; official value selected for internal Vesper use only.') as warning
      from field_resolutions fr
      where fr.fragrance_id = k.fragrance_id
        and fr.official_non_official_disagree
      union all
      select 'Held/proposed metadata conflict exists and was excluded from resolver output.' as warning
      where coalesce(h.has_conflict_hold, false)
    ) warnings
    where nullif(btrim(warning), '') is not null
  ), '[]'::jsonb) as metadata_warnings,
  case
    when coalesce(s.has_official_metadata, false) and coalesce(s.has_community_metadata, false)
      then 'Mixed approved metadata evidence. Official fields remain source-backed official evidence; community fields are not official brand confirmation. Not catalog-patched.'
    when coalesce(s.has_official_metadata, false)
      then 'Source-backed official metadata evidence approved for internal Vesper use. Not catalog-patched.'
    when coalesce(s.has_community_metadata, false)
      then 'Community provider metadata approved for internal Vesper use. Not official brand confirmation and not catalog-patched.'
    when coalesce(s.has_other_non_official_metadata, false)
      then 'Non-official metadata approved for internal Vesper use. Not official brand confirmation and not catalog-patched.'
    else 'No approved metadata evidence resolved.'
  end as metadata_disclaimer,
  coalesce(s.has_official_metadata, false) as has_official_metadata,
  coalesce(s.has_community_metadata, false) as has_community_metadata,
  coalesce(h.has_conflict_hold, false) as has_conflict_hold,
  false as patch_safe_now,
  false as catalog_patch_ready,
  s.updated_at
from fragrance_keys k
left join source_summary s
  on s.fragrance_id = k.fragrance_id
left join held_conflicts h
  on h.fragrance_id = k.fragrance_id
left join field_resolutions release_year
  on release_year.fragrance_id = k.fragrance_id
 and release_year.field_name = 'release_year'
 and release_year.blocked_by_conflict = false
left join field_resolutions perfumer_names
  on perfumer_names.fragrance_id = k.fragrance_id
 and perfumer_names.field_name = 'perfumer_names'
 and perfumer_names.blocked_by_conflict = false
left join field_resolutions concentration
  on concentration.fragrance_id = k.fragrance_id
 and concentration.field_name = 'concentration'
 and concentration.blocked_by_conflict = false;

revoke all on public.fragrance_identity_metadata_resolver_v1
  from public, anon, authenticated;

revoke all on public.fragrance_identity_metadata_resolver_v1
  from service_role;

grant select on public.fragrance_identity_metadata_resolver_v1
  to service_role;

create or replace function public.get_fragrance_identity_metadata_resolver_v1(
  p_fragrance_ids uuid[] default null,
  p_limit integer default 50
)
returns table (
  fragrance_id uuid,
  fragrance_name text,
  brand text,
  resolved_release_year integer,
  resolved_perfumer_names jsonb,
  resolved_concentration text,
  release_year_source_type text,
  release_year_source_tier text,
  release_year_source_name text,
  perfumer_source_type text,
  perfumer_source_tier text,
  perfumer_source_name text,
  concentration_source_type text,
  concentration_source_tier text,
  concentration_source_name text,
  metadata_confidence_summary jsonb,
  metadata_warnings jsonb,
  metadata_disclaimer text,
  has_official_metadata boolean,
  has_community_metadata boolean,
  has_conflict_hold boolean,
  patch_safe_now boolean,
  catalog_patch_ready boolean,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with source_rows as (
    select
      a.metadata_evidence_id,
      a.fragrance_id,
      a.fragrance_name,
      a.brand,
      a.source_type,
      a.source_tier,
      a.source_name,
      a.release_year,
      a.perfumer_names,
      a.concentration,
      a.extraction_confidence,
      a.extraction_warnings,
      a.metadata_source_disclaimer,
      a.updated_at
    from public.fragrance_identity_metadata_approved_read_v1 a
    where ($1 is null or a.fragrance_id = any($1))
  ), field_candidates as (
    select
      r.fragrance_id,
      r.fragrance_name,
      r.brand,
      'release_year'::text as field_name,
      r.release_year::text as value_key,
      to_jsonb(r.release_year) as value_json,
      r.release_year as value_int,
      null::jsonb as value_array,
      null::text as value_text,
      r.source_type,
      r.source_tier,
      r.source_name,
      r.extraction_confidence,
      r.extraction_warnings,
      r.metadata_source_disclaimer,
      r.updated_at,
      r.metadata_evidence_id
    from source_rows r
    where r.release_year is not null
    union all
    select
      r.fragrance_id,
      r.fragrance_name,
      r.brand,
      'perfumer_names'::text as field_name,
      r.perfumer_names::text as value_key,
      r.perfumer_names as value_json,
      null::integer as value_int,
      r.perfumer_names as value_array,
      null::text as value_text,
      r.source_type,
      r.source_tier,
      r.source_name,
      r.extraction_confidence,
      r.extraction_warnings,
      r.metadata_source_disclaimer,
      r.updated_at,
      r.metadata_evidence_id
    from source_rows r
    where jsonb_typeof(r.perfumer_names) = 'array'
      and jsonb_array_length(r.perfumer_names) > 0
    union all
    select
      r.fragrance_id,
      r.fragrance_name,
      r.brand,
      'concentration'::text as field_name,
      lower(btrim(r.concentration)) as value_key,
      to_jsonb(btrim(r.concentration)) as value_json,
      null::integer as value_int,
      null::jsonb as value_array,
      btrim(r.concentration) as value_text,
      r.source_type,
      r.source_tier,
      r.source_name,
      r.extraction_confidence,
      r.extraction_warnings,
      r.metadata_source_disclaimer,
      r.updated_at,
      r.metadata_evidence_id
    from source_rows r
    where nullif(btrim(coalesce(r.concentration, '')), '') is not null
  ), field_stats as (
    select
      fragrance_id,
      field_name,
      count(distinct value_key) as distinct_value_count,
      count(distinct value_key) filter (where source_type = 'official_brand') as official_distinct_value_count,
      count(distinct value_key) filter (where source_type <> 'official_brand') as non_official_distinct_value_count,
      bool_or(source_type = 'official_brand') as has_official_candidate,
      bool_or(source_type <> 'official_brand') as has_non_official_candidate
    from field_candidates
    group by fragrance_id, field_name
  ), ranked_field_candidates as (
    select
      c.*,
      s.distinct_value_count,
      s.official_distinct_value_count,
      s.non_official_distinct_value_count,
      s.has_official_candidate,
      s.has_non_official_candidate,
      row_number() over (
        partition by c.fragrance_id, c.field_name
        order by
          case c.source_tier
            when 'official_brand_metadata' then 1
            when 'official_brand_product_page' then 2
            when 'professional_provider_metadata' then 3
            when 'retailer_structured_metadata' then 4
            when 'community_provider_metadata' then 5
            else 9
          end,
          c.extraction_confidence desc nulls last,
          c.updated_at desc nulls last,
          c.metadata_evidence_id
      ) as field_rank
    from field_candidates c
    join field_stats s
      on s.fragrance_id = c.fragrance_id
     and s.field_name = c.field_name
  ), field_resolutions as (
    select
      *,
      (
        official_distinct_value_count > 1
        or (official_distinct_value_count = 0 and non_official_distinct_value_count > 1)
      ) as blocked_by_conflict,
      (
        official_distinct_value_count > 0
        and non_official_distinct_value_count > 0
        and distinct_value_count > 1
      ) as official_non_official_disagree
    from ranked_field_candidates
    where field_rank = 1
  ), fragrance_keys as (
    select
      fragrance_id,
      min(fragrance_name) as fragrance_name,
      min(brand) as brand
    from source_rows
    group by fragrance_id
  ), held_conflicts as (
    select
      r.fragrance_id,
      true as has_conflict_hold
    from public.fragrance_identity_metadata_evidence_registry_v1 r
    where ($1 is null or r.fragrance_id = any($1))
      and r.review_status = 'proposed'
      and r.superseded_at is null
      and (
        r.extraction_warnings::text ilike '%conflict%'
        or r.reason ilike '%conflict%'
      )
    group by r.fragrance_id
  ), source_summary as (
    select
      fragrance_id,
      bool_or(source_type = 'official_brand') as has_official_metadata,
      bool_or(source_type = 'community_provider') as has_community_metadata,
      bool_or(source_type in ('retailer', 'professional_provider')) as has_other_non_official_metadata,
      max(updated_at) as updated_at
    from source_rows
    group by fragrance_id
  )
  select
    k.fragrance_id,
    k.fragrance_name,
    k.brand,
    release_year.value_int as resolved_release_year,
    coalesce(perfumer_names.value_array, '[]'::jsonb) as resolved_perfumer_names,
    concentration.value_text as resolved_concentration,
    release_year.source_type as release_year_source_type,
    release_year.source_tier as release_year_source_tier,
    release_year.source_name as release_year_source_name,
    perfumer_names.source_type as perfumer_source_type,
    perfumer_names.source_tier as perfumer_source_tier,
    perfumer_names.source_name as perfumer_source_name,
    concentration.source_type as concentration_source_type,
    concentration.source_tier as concentration_source_tier,
    concentration.source_name as concentration_source_name,
    jsonb_build_object(
      'release_year', release_year.extraction_confidence,
      'perfumer_names', perfumer_names.extraction_confidence,
      'concentration', concentration.extraction_confidence
    ) as metadata_confidence_summary,
    coalesce((
      select jsonb_agg(distinct warning order by warning)
      from (
        select jsonb_array_elements_text(r.extraction_warnings) as warning
        from source_rows r
        where r.fragrance_id = k.fragrance_id
        union all
        select concat(fr.field_name, ': multiple official approved values disagree; field suppressed for review.') as warning
        from field_resolutions fr
        where fr.fragrance_id = k.fragrance_id
          and fr.official_distinct_value_count > 1
        union all
        select concat(fr.field_name, ': multiple non-official approved values disagree; field suppressed for review.') as warning
        from field_resolutions fr
        where fr.fragrance_id = k.fragrance_id
          and fr.official_distinct_value_count = 0
          and fr.non_official_distinct_value_count > 1
        union all
        select concat(fr.field_name, ': official and non-official approved values disagree; official value selected for internal Vesper use only.') as warning
        from field_resolutions fr
        where fr.fragrance_id = k.fragrance_id
          and fr.official_non_official_disagree
        union all
        select 'Held/proposed metadata conflict exists and was excluded from resolver output.' as warning
        where coalesce(h.has_conflict_hold, false)
      ) warnings
      where nullif(btrim(warning), '') is not null
    ), '[]'::jsonb) as metadata_warnings,
    case
      when coalesce(s.has_official_metadata, false) and coalesce(s.has_community_metadata, false)
        then 'Mixed approved metadata evidence. Official fields remain source-backed official evidence; community fields are not official brand confirmation. Not catalog-patched.'
      when coalesce(s.has_official_metadata, false)
        then 'Source-backed official metadata evidence approved for internal Vesper use. Not catalog-patched.'
      when coalesce(s.has_community_metadata, false)
        then 'Community provider metadata approved for internal Vesper use. Not official brand confirmation and not catalog-patched.'
      when coalesce(s.has_other_non_official_metadata, false)
        then 'Non-official metadata approved for internal Vesper use. Not official brand confirmation and not catalog-patched.'
      else 'No approved metadata evidence resolved.'
    end as metadata_disclaimer,
    coalesce(s.has_official_metadata, false) as has_official_metadata,
    coalesce(s.has_community_metadata, false) as has_community_metadata,
    coalesce(h.has_conflict_hold, false) as has_conflict_hold,
    false as patch_safe_now,
    false as catalog_patch_ready,
    s.updated_at
  from fragrance_keys k
  left join source_summary s
    on s.fragrance_id = k.fragrance_id
  left join held_conflicts h
    on h.fragrance_id = k.fragrance_id
  left join field_resolutions release_year
    on release_year.fragrance_id = k.fragrance_id
   and release_year.field_name = 'release_year'
   and release_year.blocked_by_conflict = false
  left join field_resolutions perfumer_names
    on perfumer_names.fragrance_id = k.fragrance_id
   and perfumer_names.field_name = 'perfumer_names'
   and perfumer_names.blocked_by_conflict = false
  left join field_resolutions concentration
    on concentration.fragrance_id = k.fragrance_id
   and concentration.field_name = 'concentration'
   and concentration.blocked_by_conflict = false
  order by
    k.fragrance_name,
    k.brand,
    k.fragrance_id
  limit least(greatest(coalesce($2, 50), 1), 100);
$$;

revoke all on function public.get_fragrance_identity_metadata_resolver_v1(uuid[], integer)
  from public, anon, authenticated;

revoke all on function public.get_fragrance_identity_metadata_resolver_v1(uuid[], integer)
  from service_role;

grant execute on function public.get_fragrance_identity_metadata_resolver_v1(uuid[], integer)
  to service_role;

comment on view public.fragrance_identity_metadata_resolver_v1
  is 'Service-role-only sanitized metadata resolver for approved fragrance identity metadata evidence. It resolves release year, perfumer names, and concentration while preserving field-level provenance and never authorizing catalog patches.';

comment on function public.get_fragrance_identity_metadata_resolver_v1(uuid[], integer)
  is 'Service-role-only bounded read helper for resolved fragrance identity metadata. It filters requested fragrance IDs early, returns sanitized field-level provenance, and does not mutate public.fragrances, registries, provider intelligence, or metadata evidence.';

commit;
