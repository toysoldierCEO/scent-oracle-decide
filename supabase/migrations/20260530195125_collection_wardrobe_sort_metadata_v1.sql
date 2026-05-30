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
    with owned_rows as (
      select
        uc.user_id,
        uc.fragrance_id,
        min(uc.created_at) as collection_created_at,
        max(uc.updated_at) as collection_updated_at
      from public.user_collection uc
      where uc.user_id = v_user_id
        and uc.status in ('owned', 'signature')
      group by uc.user_id, uc.fragrance_id
    ),
    collection_base as (
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
        f.primary_season,
        coalesce(
          timezone('UTC', owned.collection_created_at),
          item.last_updated_at
        ) as collection_created_at,
        coalesce(
          owned.collection_updated_at,
          item.last_updated_at
        ) as collection_updated_at,
        case
          when item.has_signature or item.effective_status = 'signature' then 'signature'
          else 'owned'
        end as collection_status
      from public.user_collection_effective_items_v2 item
      left join public.fragrances f
        on f.id = item.representative_fragrance_id
      left join owned_rows owned
        on owned.user_id = item.user_id
       and owned.fragrance_id = item.representative_fragrance_id
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
        c.primary_season,
        c.collection_created_at,
        c.collection_updated_at,
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
              'primary_season', o.primary_season,
              'collection_created_at', o.collection_created_at,
              'collection_updated_at', o.collection_updated_at,
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

create or replace function public.get_user_fragrance_preference_signals_v1(
  p_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_user_id uuid := coalesce(p_user_id, v_auth_user);
begin
  if v_user_id is null then
    raise exception 'Signed-in preference signals require p_user_id or auth.uid().';
  end if;

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and v_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user_id must match auth.uid().';
  end if;

  return jsonb_build_object(
    'preference_signal_contract_version', 'collection_preferences_v1',
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'fragrance_id', pref.fragrance_id,
            'preference_state', pref.preference_state,
            'source', pref.source,
            'created_at', pref.created_at,
            'updated_at', pref.updated_at,
            'last_event_at', pref.last_event_at
          )
          order by pref.updated_at desc nulls last, pref.created_at desc, pref.fragrance_id
        )
        from public.user_fragrance_preferences_v1 pref
        where pref.user_id = v_user_id
      ),
      '[]'::jsonb
    )
  );
end;
$function$;

grant execute on function public.get_user_fragrance_preference_signals_v1(uuid) to authenticated, service_role;
