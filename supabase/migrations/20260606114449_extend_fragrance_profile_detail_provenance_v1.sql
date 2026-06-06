create or replace function public.get_fragrance_profile_v1(
  p_user uuid default null,
  p_fragrance_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_user_id uuid := coalesce(p_user, v_auth_user);
  v_profile_card jsonb := null;
begin
  if p_fragrance_id is null then
    raise exception 'p_fragrance_id is required.';
  end if;

  if p_user is not null and not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user = v_auth_user)
  ) then
    raise exception 'Access denied: p_user must match auth.uid() for fragrance profile.';
  end if;

  if v_user_id is not null then
    begin
      select public.get_fragrance_profile_card_v1(v_user_id, p_fragrance_id)
      into v_profile_card;
    exception when others then
      v_profile_card := null;
    end;
  end if;

  return (
    with text_source as (
      select
        te.fragrance_id,
        nullif(btrim(coalesce(
          te.provider_payload -> 'source_evidence' ->> 'official_source_excerpt',
          te.provider_payload ->> 'official_source_excerpt',
          ''
        )), '') as official_source_excerpt,
        nullif(btrim(coalesce(
          te.provider_payload -> 'source_evidence' ->> 'official_description',
          te.provider_payload ->> 'official_description',
          ''
        )), '') as official_description,
        coalesce(te.notes, '{}'::text[]) as source_notes,
        coalesce(te.accords, '{}'::text[]) as source_accords,
        array(
          select jsonb_array_elements_text(coalesce(te.provider_payload -> 'top_notes', '[]'::jsonb))
        ) as source_top_notes,
        array(
          select jsonb_array_elements_text(coalesce(te.provider_payload -> 'heart_notes', '[]'::jsonb))
        ) as source_middle_notes,
        array(
          select jsonb_array_elements_text(coalesce(te.provider_payload -> 'base_notes', '[]'::jsonb))
        ) as source_base_notes,
        te.source_url,
        te.source_confidence::text as source_confidence
      from public.fragrance_text_enrichment te
      where te.fragrance_id = p_fragrance_id
      limit 1
    ),
    performance as (
      select
        pf.fragrance_id,
        pf.odor_impact_confidence,
        pf.density_score,
        pf.transparency_score,
        pf.beast_mode_score
      from public.fragrance_performance_features_v1 pf
      where pf.fragrance_id = p_fragrance_id
      limit 1
    ),
    base as (
      select
        f.id as fragrance_id,
        f.name,
        f.brand,
        f.family_key,
        case
          when f.family_key is not null and f.family_key <> 'unknown'
          then initcap(replace(f.family_key, '-', ' '))
          else null
        end as family_label,
        coalesce(f.family_key, 'neutral') as family_color_token,
        coalesce(nullif(f.notes, '{}'::text[]), ts.source_notes, '{}'::text[]) as notes,
        coalesce(nullif(f.accords, '{}'::text[]), ts.source_accords, '{}'::text[]) as accords,
        coalesce(nullif(f.top_notes, '{}'::text[]), ts.source_top_notes, '{}'::text[]) as top_notes,
        coalesce(nullif(f.heart_notes, '{}'::text[]), ts.source_middle_notes, '{}'::text[]) as middle_notes,
        coalesce(nullif(f.base_notes, '{}'::text[]), ts.source_base_notes, '{}'::text[]) as base_notes,
        f.release_year,
        f.concentration,
        f.perfumer,
        f.longevity_score,
        f.projection_score,
        p.odor_impact_confidence,
        p.density_score,
        p.transparency_score,
        p.beast_mode_score,
        coalesce(f.source_confidence::text, ts.source_confidence) as source_confidence,
        coalesce(f.source_url, ts.source_url) as source_url,
        case
          when ts.official_source_excerpt is not null then ts.official_source_excerpt
          when ts.official_description is not null then ts.official_description
          else null
        end as short_description,
        case
          when ts.official_source_excerpt is not null then 'official_source_excerpt'
          when ts.official_description is not null then 'official_source_description'
          else null
        end as description_source,
        f.updated_at,
        f.scent_role
      from public.fragrances f
      left join text_source ts
        on ts.fragrance_id = f.id
      left join performance p
        on p.fragrance_id = f.id
      where f.id = p_fragrance_id
    ),
    image_asset as (
      select distinct on (fia.fragrance_id)
        fia.fragrance_id,
        fia.image_url,
        fia.thumbnail_url
      from public.fragrance_image_assets fia
      where fia.fragrance_id = p_fragrance_id
      order by fia.fragrance_id, fia.updated_at desc nulls last, fia.created_at desc nulls last
    ),
    rating as (
      select rating
      from public.user_fragrance_ratings_v1
      where user_id = v_user_id
        and fragrance_id = p_fragrance_id
        and rating_source = 'collection'
        and rating_context = 'solo'
      limit 1
    ),
    retired as (
      select true as retired
      from public.user_fragrance_retirement_preferences_v1
      where user_id = v_user_id
        and fragrance_id = p_fragrance_id
      limit 1
    ),
    latest_reason as (
      select reason_key
      from public.user_fragrance_rating_reasons_v1
      where user_id = v_user_id
        and fragrance_id = p_fragrance_id
        and rating_source = 'collection'
        and rating_context = 'solo'
      order by created_at desc
      limit 1
    ),
    resolved as (
      select
        b.*,
        ia.image_url,
        ia.thumbnail_url,
        role_map.wardrobe_role_key,
        role_map.wardrobe_role_label,
        role_map.role_confidence,
        role_map.role_source
      from base b
      left join image_asset ia
        on ia.fragrance_id = b.fragrance_id
      left join lateral public.resolve_wardrobe_role_v1(
        b.scent_role,
        b.family_key,
        b.accords,
        b.notes,
        b.projection_score,
        b.longevity_score
      ) role_map on true
    )
    select
      case
        when not exists(select 1 from base) then jsonb_build_object(
          'found', false,
          'error', 'Fragrance not found.'
        )
        else (
          select jsonb_build_object(
            'found', true,
            'fragrance_id', r.fragrance_id,
            'name', r.name,
            'brand', r.brand,
            'image_url', r.image_url,
            'thumbnail_url', r.thumbnail_url,
            'family_key', r.family_key,
            'family_label', r.family_label,
            'family_color_token', r.family_color_token,
            'wardrobe_role_key', r.wardrobe_role_key,
            'wardrobe_role_label', r.wardrobe_role_label,
            'role_confidence', r.role_confidence,
            'role_source', r.role_source,
            'release_year', r.release_year,
            'concentration', r.concentration,
            'perfumer', r.perfumer,
            'short_description', r.short_description,
            'description_source', r.description_source,
            'notes', to_jsonb(r.notes),
            'accords', to_jsonb(r.accords),
            'top_notes', to_jsonb(r.top_notes),
            'middle_notes', to_jsonb(r.middle_notes),
            'base_notes', to_jsonb(r.base_notes),
            'longevity_score', r.longevity_score,
            'projection_score', r.projection_score,
            'odor_impact_score', r.odor_impact_confidence,
            'density_score', r.density_score,
            'transparency_score', r.transparency_score,
            'beast_mode_score', r.beast_mode_score,
            'rating', (select rating from rating),
            'is_rated', exists(select 1 from rating),
            'retired', exists(select 1 from retired),
            'latest_low_rating_reason', (select reason_key from latest_reason),
            'why_it_fits_wardrobe', case
              when v_profile_card is not null
                and jsonb_typeof(v_profile_card->'fit') = 'object'
                and coalesce(v_profile_card->'fit'->>'explanation', '') <> ''
              then v_profile_card->'fit'->>'explanation'
              else null
            end,
            'source_confidence', r.source_confidence,
            'source_url', r.source_url,
            'updated_at', r.updated_at
          )
          from resolved r
          limit 1
        )
      end
  );
end;
$function$;

grant execute on function public.get_fragrance_profile_v1(uuid, uuid) to anon, authenticated, service_role;
