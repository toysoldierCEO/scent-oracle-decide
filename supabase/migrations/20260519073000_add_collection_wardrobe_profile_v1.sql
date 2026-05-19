create or replace function public.resolve_wardrobe_role_v1(
  p_scent_role text default null,
  p_family_key text default null,
  p_accords text[] default null,
  p_notes text[] default null,
  p_projection_score numeric default null,
  p_longevity_score numeric default null
)
returns table (
  wardrobe_role_key text,
  wardrobe_role_label text,
  role_confidence text,
  role_source text
)
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_scent_role text := lower(coalesce(nullif(trim(p_scent_role), ''), ''));
  v_family_key text := lower(coalesce(nullif(trim(p_family_key), ''), ''));
  v_projection numeric := coalesce(p_projection_score, 0);
  v_longevity numeric := coalesce(p_longevity_score, 0);
  v_accords text[] := coalesce((
    select array_agg(lower(trim(token)))
    from unnest(coalesce(p_accords, '{}'::text[])) as token
    where trim(coalesce(token, '')) <> ''
  ), '{}'::text[]);
  v_notes text[] := coalesce((
    select array_agg(lower(trim(token)))
    from unnest(coalesce(p_notes, '{}'::text[])) as token
    where trim(coalesce(token, '')) <> ''
  ), '{}'::text[]);
begin
  if v_scent_role = 'anchor' then
    return query select 'anchor', 'Anchor', 'high', 'fragrances.scent_role';
    return;
  end if;

  if v_scent_role = 'lift' then
    return query select 'brightener', 'Brightener', 'high', 'fragrances.scent_role';
    return;
  end if;

  if v_scent_role = 'flex' then
    return query select 'layer_tool', 'Layer Tool', 'medium', 'fragrances.scent_role';
    return;
  end if;

  if v_scent_role = 'structure' then
    if v_projection >= 0.72 or v_longevity >= 0.86 then
      return query select 'anchor', 'Anchor', 'medium', 'fragrances.scent_role+performance';
    else
      return query select 'bridge', 'Bridge', 'medium', 'fragrances.scent_role';
    end if;
    return;
  end if;

  if v_scent_role = 'contrast' then
    if v_projection >= 0.70 then
      return query select 'accent', 'Accent', 'medium', 'fragrances.scent_role+performance';
    else
      return query select 'bridge', 'Bridge', 'medium', 'fragrances.scent_role';
    end if;
    return;
  end if;

  if v_family_key in ('tobacco-boozy', 'oud-amber', 'dark-leather')
    or v_longevity >= 0.88
    or v_projection >= 0.82 then
    return query select 'anchor', 'Anchor', 'low', 'family/performance fallback';
    return;
  end if;

  if v_accords && array['citrus', 'green', 'aromatic', 'tea', 'aldehydic']::text[]
    or v_notes && array['bergamot', 'lemon', 'grapefruit', 'mandarin', 'neroli', 'mint', 'green tea']::text[] then
    return query select 'brightener', 'Brightener', 'low', 'accord/note fallback';
    return;
  end if;

  if v_accords && array['powdery', 'musky', 'creamy', 'ambery', 'soft']::text[]
    or v_notes && array['iris', 'musk', 'vanilla', 'tonka', 'cashmere']::text[] then
    return query select 'softener', 'Softener', 'low', 'accord/note fallback';
    return;
  end if;

  if v_accords && array['smoky', 'leather', 'oud', 'boozy', 'incense', 'resinous']::text[]
    or v_notes && array['oud', 'smoke', 'leather', 'whiskey', 'rum', 'incense']::text[] then
    return query select 'accent', 'Accent', 'low', 'accord/note fallback';
    return;
  end if;

  if cardinality(v_accords) > 0 or cardinality(v_notes) > 0 then
    return query select 'layer_tool', 'Layer Tool', 'low', 'metadata fallback';
    return;
  end if;

  return query select null::text, null::text, null::text, null::text;
end;
$function$;

grant execute on function public.resolve_wardrobe_role_v1(text, text, text[], text[], numeric, numeric) to anon, authenticated, service_role;

create or replace function public.get_collection_wardrobe_v1(
  p_user uuid default null,
  p_filter text default 'all',
  p_sort text default 'role'
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
  v_filter text := lower(coalesce(nullif(trim(p_filter), ''), 'all'));
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'role'));
begin
  if v_user_id is null then
    raise exception 'Signed-in collection requires p_user or auth.uid().';
  end if;

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and v_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user must match auth.uid().';
  end if;

  return (
    with collection_base as (
      select
        item.representative_fragrance_id as fragrance_id,
        coalesce(item.representative_name, f.name) as name,
        coalesce(item.representative_brand, f.brand) as brand,
        coalesce(item.representative_family_key, f.family_key) as family_key,
        case
          when coalesce(item.representative_family_key, f.family_key) is not null
            and coalesce(item.representative_family_key, f.family_key) <> 'unknown'
          then initcap(replace(coalesce(item.representative_family_key, f.family_key), '-', ' '))
          else null
        end as family_label,
        coalesce(item.representative_family_key, f.family_key, 'neutral') as family_color_token,
        f.scent_role,
        coalesce(f.accords, '{}'::text[]) as accords,
        coalesce(f.notes, '{}'::text[]) as notes,
        f.projection_score,
        f.longevity_score,
        case
          when item.has_signature or item.effective_status = 'signature' then 'signature'
          else 'owned'
        end as collection_status
      from public.user_collection_effective_items_v2 item
      left join public.fragrances f
        on f.id = item.representative_fragrance_id
      where item.user_id = v_user_id
        and (item.has_owned or item.has_signature)
    ),
    collection as (
      select
        cb.*,
        row_number() over (
          order by
            case cb.collection_status
              when 'signature' then 0
              else 1
            end,
            lower(coalesce(cb.brand, '')),
            lower(coalesce(cb.name, '')),
            cb.fragrance_id
        ) as default_rank
      from collection_base cb
    ),
    image_assets as (
      select distinct on (fia.fragrance_id)
        fia.fragrance_id,
        fia.image_url,
        fia.thumbnail_url
      from public.fragrance_image_assets fia
      inner join collection c
        on c.fragrance_id = fia.fragrance_id
      order by fia.fragrance_id, fia.updated_at desc nulls last, fia.created_at desc nulls last
    ),
    preferences as (
      select fragrance_id, preference_state
      from public.user_fragrance_preferences_v1
      where user_id = v_user_id
    ),
    rotation_preferences as (
      select fragrance_id, true as favorite
      from public.user_fragrance_rotation_preferences_v1
      where user_id = v_user_id
    ),
    retirement_preferences as (
      select fragrance_id, true as retired
      from public.user_fragrance_retirement_preferences_v1
      where user_id = v_user_id
    ),
    ratings as (
      select fragrance_id, rating
      from public.user_fragrance_ratings_v1
      where user_id = v_user_id
        and rating_source = 'collection'
        and rating_context = 'solo'
    ),
    items_base as (
      select
        c.fragrance_id,
        c.name,
        c.brand,
        c.family_key,
        c.family_label,
        c.family_color_token,
        ia.image_url,
        ia.thumbnail_url,
        c.collection_status,
        c.default_rank,
        coalesce(pref.preference_state, 'neutral') as preference_state,
        coalesce(rot.favorite, false) as favorite,
        coalesce(rot.favorite, false) as wear_more,
        coalesce(ret.retired, false) as retired,
        rate.rating,
        (rate.rating is not null) as is_rated,
        role_map.wardrobe_role_key,
        role_map.wardrobe_role_label,
        role_map.role_confidence,
        role_map.role_source
      from collection c
      left join image_assets ia
        on ia.fragrance_id = c.fragrance_id
      left join preferences pref
        on pref.fragrance_id = c.fragrance_id
      left join rotation_preferences rot
        on rot.fragrance_id = c.fragrance_id
      left join retirement_preferences ret
        on ret.fragrance_id = c.fragrance_id
      left join ratings rate
        on rate.fragrance_id = c.fragrance_id
      left join lateral public.resolve_wardrobe_role_v1(
        c.scent_role,
        c.family_key,
        c.accords,
        c.notes,
        c.projection_score,
        c.longevity_score
      ) role_map on true
    ),
    summary as (
      select
        count(*) as owned_count,
        count(*) filter (where preference_state = 'liked') as liked_count,
        count(*) filter (where preference_state = 'loved') as loved_count,
        count(*) filter (where preference_state in ('liked', 'loved')) as preference_count,
        count(*) filter (where favorite) as favorite_count,
        count(*) filter (where retired) as retired_count,
        count(*) filter (where rating is not null) as rated_count
      from items_base
    ),
    filtered as (
      select *
      from items_base
      where case
        when v_filter = 'all' then true
        when v_filter = 'rated' then rating is not null
        when v_filter = 'unrated' then rating is null
        when v_filter = 'retired' then retired
        when v_filter in ('anchor', 'layer_tool', 'brightener', 'softener', 'bridge', 'accent', 'soloist')
          then wardrobe_role_key = v_filter
        else true
      end
    ),
    ordered as (
      select
        f.*,
        case f.wardrobe_role_key
          when 'anchor' then 0
          when 'layer_tool' then 1
          when 'brightener' then 2
          when 'softener' then 3
          when 'bridge' then 4
          when 'accent' then 5
          when 'soloist' then 6
          else 99
        end as role_rank,
        case
          when f.rating is not null then 6 - f.rating
          else 999
        end as rating_rank
      from filtered f
    )
    select jsonb_build_object(
      'collection_contract_version', 'collection_wardrobe_v1',
      'surface_type', 'signed_in',
      'read_only', false,
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'fragrance_id', o.fragrance_id,
              'name', o.name,
              'brand', o.brand,
              'family_key', o.family_key,
              'family_label', o.family_label,
              'family_color_token', o.family_color_token,
              'wardrobe_role_key', o.wardrobe_role_key,
              'wardrobe_role_label', o.wardrobe_role_label,
              'role_confidence', o.role_confidence,
              'role_source', o.role_source,
              'image_url', o.image_url,
              'thumbnail_url', o.thumbnail_url,
              'collection_status', o.collection_status,
              'preference_state', o.preference_state,
              'favorite', o.favorite,
              'wear_more', o.wear_more,
              'retired', o.retired,
              'rating', o.rating,
              'is_rated', o.is_rated,
              'default_rank', o.default_rank
            )
            order by
              case when v_sort = 'role' then o.role_rank end nulls last,
              case when v_sort = 'rating' then o.rating_rank end nulls last,
              case when v_sort = 'family' then lower(coalesce(o.family_label, '')) end nulls last,
              case when v_sort = 'name' then lower(coalesce(o.name, '')) end nulls last,
              case when v_sort = 'brand' then lower(coalesce(o.brand, '')) end nulls last,
              o.default_rank
          )
          from ordered o
        ),
        '[]'::jsonb
      ),
      'summary', jsonb_build_object(
        'owned_count', coalesce((select owned_count from summary), 0),
        'liked_count', coalesce((select liked_count from summary), 0),
        'loved_count', coalesce((select loved_count from summary), 0),
        'preference_count', coalesce((select preference_count from summary), 0),
        'favorite_count', coalesce((select favorite_count from summary), 0),
        'wear_more_count', coalesce((select favorite_count from summary), 0),
        'retired_count', coalesce((select retired_count from summary), 0),
        'rated_count', coalesce((select rated_count from summary), 0)
      ),
      'empty_reason', case
        when coalesce((select owned_count from summary), 0) > 0 then null
        else 'No owned bottles yet.'
      end
    )
  );
end;
$function$;

grant execute on function public.get_collection_wardrobe_v1(uuid, text, text) to authenticated, service_role;

create or replace function public.get_guest_collection_preview_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  return (
    with guest_bottles as (
      select distinct on (
        coalesce(
          gb.fragrance_id::text,
          gb.style_key || '|' || lower(coalesce(gb.bottle_name, '')) || '|' || lower(coalesce(gb.bottle_brand, ''))
        )
      )
        coalesce(
          gb.fragrance_id::text,
          gb.style_key || '|' || lower(coalesce(gb.bottle_name, '')) || '|' || lower(coalesce(gb.bottle_brand, ''))
        ) as bottle_key,
        gb.fragrance_id,
        coalesce(f.name, gb.bottle_name) as name,
        coalesce(f.brand, gb.bottle_brand) as brand,
        coalesce(f.family_key, gb.family_label_override, gsw.canonical_family_key) as family_key,
        case
          when coalesce(f.family_key, gb.family_label_override, gsw.canonical_family_key) is not null
            and coalesce(f.family_key, gb.family_label_override, gsw.canonical_family_key) <> 'unknown'
          then initcap(replace(coalesce(f.family_key, gb.family_label_override, gsw.canonical_family_key), '-', ' '))
          else null
        end as family_label,
        coalesce(f.family_key, gb.family_label_override, gsw.canonical_family_key, 'neutral') as family_color_token,
        f.scent_role,
        coalesce(f.accords, '{}'::text[]) as accords,
        coalesce(f.notes, '{}'::text[]) as notes,
        f.projection_score,
        f.longevity_score,
        gb.display_rank
      from public.guest_style_world_bottles gb
      left join public.fragrances f
        on f.id = gb.fragrance_id
      left join public.guest_style_worlds gsw
        on gsw.style_key = gb.style_key
      where gb.is_active
      order by
        coalesce(
          gb.fragrance_id::text,
          gb.style_key || '|' || lower(coalesce(gb.bottle_name, '')) || '|' || lower(coalesce(gb.bottle_brand, ''))
        ),
        gb.display_rank
    ),
    image_assets as (
      select distinct on (fia.fragrance_id)
        fia.fragrance_id,
        fia.image_url,
        fia.thumbnail_url
      from public.fragrance_image_assets fia
      inner join guest_bottles gb
        on gb.fragrance_id = fia.fragrance_id
      order by fia.fragrance_id, fia.updated_at desc nulls last, fia.created_at desc nulls last
    ),
    guest_items as (
      select
        gb.fragrance_id,
        gb.name,
        gb.brand,
        gb.family_key,
        gb.family_label,
        gb.family_color_token,
        ia.image_url,
        ia.thumbnail_url,
        'guest_demo'::text as collection_status,
        row_number() over (
          order by
            gb.display_rank nulls last,
            lower(coalesce(gb.brand, '')),
            lower(coalesce(gb.name, ''))
        ) as default_rank,
        role_map.wardrobe_role_key,
        role_map.wardrobe_role_label,
        role_map.role_confidence,
        role_map.role_source
      from guest_bottles gb
      left join image_assets ia
        on ia.fragrance_id = gb.fragrance_id
      left join lateral public.resolve_wardrobe_role_v1(
        gb.scent_role,
        gb.family_key,
        gb.accords,
        gb.notes,
        gb.projection_score,
        gb.longevity_score
      ) role_map on true
    ),
    summary as (
      select count(*) as owned_count
      from guest_items
    )
    select jsonb_build_object(
      'collection_contract_version', 'collection_wardrobe_v1',
      'surface_type', 'guest',
      'read_only', true,
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'fragrance_id', gi.fragrance_id,
              'name', gi.name,
              'brand', gi.brand,
              'family_key', gi.family_key,
              'family_label', gi.family_label,
              'family_color_token', gi.family_color_token,
              'wardrobe_role_key', gi.wardrobe_role_key,
              'wardrobe_role_label', gi.wardrobe_role_label,
              'role_confidence', gi.role_confidence,
              'role_source', gi.role_source,
              'image_url', gi.image_url,
              'thumbnail_url', gi.thumbnail_url,
              'collection_status', gi.collection_status,
              'preference_state', 'neutral',
              'favorite', false,
              'wear_more', false,
              'retired', false,
              'rating', null,
              'is_rated', false,
              'default_rank', gi.default_rank
            )
            order by gi.default_rank
          )
          from guest_items gi
        ),
        '[]'::jsonb
      ),
      'summary', jsonb_build_object(
        'owned_count', coalesce((select owned_count from summary), 0),
        'liked_count', 0,
        'loved_count', 0,
        'preference_count', 0,
        'favorite_count', 0,
        'wear_more_count', 0,
        'retired_count', 0,
        'rated_count', 0
      ),
      'empty_reason', case
        when coalesce((select owned_count from summary), 0) > 0 then null
        else 'No guest demo bottles are active yet.'
      end
    )
  );
end;
$function$;

grant execute on function public.get_guest_collection_preview_v1() to anon, authenticated, service_role;

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
    with base as (
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
        coalesce(f.notes, '{}'::text[]) as notes,
        coalesce(f.accords, '{}'::text[]) as accords,
        coalesce(f.top_notes, '{}'::text[]) as top_notes,
        coalesce(f.heart_notes, '{}'::text[]) as middle_notes,
        coalesce(f.base_notes, '{}'::text[]) as base_notes,
        f.longevity_score,
        f.projection_score,
        f.source_confidence,
        f.updated_at,
        f.scent_role
      from public.fragrances f
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
            'notes', to_jsonb(r.notes),
            'accords', to_jsonb(r.accords),
            'top_notes', to_jsonb(r.top_notes),
            'middle_notes', to_jsonb(r.middle_notes),
            'base_notes', to_jsonb(r.base_notes),
            'longevity_score', r.longevity_score,
            'projection_score', r.projection_score,
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
