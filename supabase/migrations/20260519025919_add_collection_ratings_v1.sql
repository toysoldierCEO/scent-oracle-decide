create table if not exists public.user_fragrance_ratings_v1 (
  user_id uuid not null references auth.users(id) on delete cascade,
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  rating_source text not null default 'collection',
  rating_context text not null default 'solo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, fragrance_id, rating_source, rating_context)
);

create index if not exists idx_user_fragrance_ratings_v1_user_scope
  on public.user_fragrance_ratings_v1 (user_id, rating_source, rating_context, updated_at desc);

create index if not exists idx_user_fragrance_ratings_v1_fragrance
  on public.user_fragrance_ratings_v1 (fragrance_id);

alter table public.user_fragrance_ratings_v1 enable row level security;

drop policy if exists user_fragrance_ratings_v1_select_self on public.user_fragrance_ratings_v1;
create policy user_fragrance_ratings_v1_select_self
on public.user_fragrance_ratings_v1
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists user_fragrance_ratings_v1_insert_self on public.user_fragrance_ratings_v1;
create policy user_fragrance_ratings_v1_insert_self
on public.user_fragrance_ratings_v1
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists user_fragrance_ratings_v1_update_self on public.user_fragrance_ratings_v1;
create policy user_fragrance_ratings_v1_update_self
on public.user_fragrance_ratings_v1
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_fragrance_ratings_v1_delete_self on public.user_fragrance_ratings_v1;
create policy user_fragrance_ratings_v1_delete_self
on public.user_fragrance_ratings_v1
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.user_fragrance_ratings_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.user_fragrance_ratings_v1 to service_role;

create table if not exists public.user_fragrance_rating_reasons_v1 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  reason_key text not null check (
    reason_key = any (array[
      'too_sharp',
      'too_sweet',
      'too_green',
      'too_smoky',
      'too_floral',
      'too_powdery',
      'too_synthetic',
      'too_boring',
      'bad_drydown',
      'bad_in_heat',
      'good_layer_only',
      'not_for_me'
    ]::text[])
  ),
  rating_source text not null default 'collection',
  rating_context text not null default 'solo',
  created_at timestamptz not null default now()
);

create index if not exists idx_user_fragrance_rating_reasons_v1_user
  on public.user_fragrance_rating_reasons_v1 (user_id, created_at desc);

create index if not exists idx_user_fragrance_rating_reasons_v1_fragrance
  on public.user_fragrance_rating_reasons_v1 (fragrance_id, created_at desc);

alter table public.user_fragrance_rating_reasons_v1 enable row level security;

drop policy if exists user_fragrance_rating_reasons_v1_select_self on public.user_fragrance_rating_reasons_v1;
create policy user_fragrance_rating_reasons_v1_select_self
on public.user_fragrance_rating_reasons_v1
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists user_fragrance_rating_reasons_v1_insert_self on public.user_fragrance_rating_reasons_v1;
create policy user_fragrance_rating_reasons_v1_insert_self
on public.user_fragrance_rating_reasons_v1
for insert
to authenticated
with check (auth.uid() = user_id);

revoke all on table public.user_fragrance_rating_reasons_v1 from public, anon, authenticated;
grant select, insert on public.user_fragrance_rating_reasons_v1 to service_role;

create or replace function public.log_fragrance_rating_v1(
  p_fragrance_id uuid,
  p_rating integer,
  p_rating_source text default 'collection'::text,
  p_rating_context text default 'solo'::text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_source text := coalesce(nullif(trim(p_rating_source), ''), 'collection');
  v_context text := coalesce(nullif(trim(p_rating_context), ''), 'solo');
  v_rating smallint := p_rating::smallint;
begin
  if v_auth_user is null then
    raise exception 'Signed-in rating write requires auth.uid().';
  end if;

  if p_fragrance_id is null then
    raise exception 'p_fragrance_id is required.';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'p_rating must be between 1 and 5.';
  end if;

  insert into public.user_fragrance_ratings_v1 (
    user_id,
    fragrance_id,
    rating,
    rating_source,
    rating_context,
    created_at,
    updated_at
  )
  values (
    v_auth_user,
    p_fragrance_id,
    v_rating,
    v_source,
    v_context,
    now(),
    now()
  )
  on conflict (user_id, fragrance_id, rating_source, rating_context)
  do update
  set
    rating = excluded.rating,
    updated_at = now();

  return (
    with current_row as (
      select
        rating,
        rating_source,
        rating_context,
        updated_at
      from public.user_fragrance_ratings_v1
      where user_id = v_auth_user
        and fragrance_id = p_fragrance_id
        and rating_source = v_source
        and rating_context = v_context
    ),
    ratings_rollup as (
      select count(*) as rated_count
      from public.user_fragrance_ratings_v1
      where user_id = v_auth_user
        and rating_source = 'collection'
        and rating_context = 'solo'
    )
    select jsonb_build_object(
      'fragrance_id', p_fragrance_id,
      'rating', coalesce((select rating from current_row), v_rating),
      'rating_source', coalesce((select rating_source from current_row), v_source),
      'rating_context', coalesce((select rating_context from current_row), v_context),
      'updated_at', coalesce((select updated_at from current_row), now()),
      'rated_count', coalesce((select rated_count from ratings_rollup), 0)
    )
  );
end;
$function$;

grant execute on function public.log_fragrance_rating_v1(uuid, integer, text, text) to authenticated, service_role;

create or replace function public.log_fragrance_rating_reason_v1(
  p_fragrance_id uuid,
  p_rating integer,
  p_reason_key text,
  p_rating_source text default 'collection'::text,
  p_rating_context text default 'solo'::text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_source text := coalesce(nullif(trim(p_rating_source), ''), 'collection');
  v_context text := coalesce(nullif(trim(p_rating_context), ''), 'solo');
  v_reason_key text := coalesce(nullif(trim(p_reason_key), ''), '');
  v_rating smallint := p_rating::smallint;
begin
  if v_auth_user is null then
    raise exception 'Signed-in rating-reason write requires auth.uid().';
  end if;

  if p_fragrance_id is null then
    raise exception 'p_fragrance_id is required.';
  end if;

  if p_rating is null or p_rating not in (1, 2) then
    raise exception 'Low-rating reasons only support ratings of 1 or 2.';
  end if;

  if v_reason_key = '' or v_reason_key <> all (array[
    'too_sharp',
    'too_sweet',
    'too_green',
    'too_smoky',
    'too_floral',
    'too_powdery',
    'too_synthetic',
    'too_boring',
    'bad_drydown',
    'bad_in_heat',
    'good_layer_only',
    'not_for_me'
  ]::text[]) then
    raise exception 'p_reason_key is not supported.';
  end if;

  if not exists(
    select 1
    from public.user_fragrance_ratings_v1
    where user_id = v_auth_user
      and fragrance_id = p_fragrance_id
      and rating_source = v_source
      and rating_context = v_context
      and rating = v_rating
  ) then
    raise exception 'Low-rating reason requires a matching saved rating.';
  end if;

  insert into public.user_fragrance_rating_reasons_v1 (
    user_id,
    fragrance_id,
    rating,
    reason_key,
    rating_source,
    rating_context,
    created_at
  )
  values (
    v_auth_user,
    p_fragrance_id,
    v_rating,
    v_reason_key,
    v_source,
    v_context,
    now()
  );

  return jsonb_build_object(
    'fragrance_id', p_fragrance_id,
    'rating', v_rating,
    'reason_key', v_reason_key,
    'rating_source', v_source,
    'rating_context', v_context,
    'created_at', now()
  );
end;
$function$;

grant execute on function public.log_fragrance_rating_reason_v1(uuid, integer, text, text, text) to authenticated, service_role;

create or replace function public.get_user_collection_preferences_v1(
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
    raise exception 'Signed-in collection requires p_user_id or auth.uid().';
  end if;

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and v_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user_id must match auth.uid().';
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
      select
        fragrance_id,
        preference_state
      from public.user_fragrance_preferences_v1
      where user_id = v_user_id
    ),
    rotation_preferences as (
      select
        fragrance_id,
        true as wear_more
      from public.user_fragrance_rotation_preferences_v1
      where user_id = v_user_id
    ),
    retirement_preferences as (
      select
        fragrance_id,
        true as retired
      from public.user_fragrance_retirement_preferences_v1
      where user_id = v_user_id
    ),
    ratings as (
      select
        fragrance_id,
        rating
      from public.user_fragrance_ratings_v1
      where user_id = v_user_id
        and rating_source = 'collection'
        and rating_context = 'solo'
    ),
    items as (
      select
        c.fragrance_id,
        c.name,
        c.brand,
        c.family_key,
        c.family_label,
        ia.image_url,
        ia.thumbnail_url,
        c.collection_status,
        c.default_rank,
        coalesce(p.preference_state, 'neutral') as preference_state,
        coalesce(rp.wear_more, false) as wear_more,
        coalesce(rp.wear_more, false) as favorite,
        coalesce(rt.retired, false) as retired,
        r.rating
      from collection c
      left join image_assets ia
        on ia.fragrance_id = c.fragrance_id
      left join preferences p
        on p.fragrance_id = c.fragrance_id
      left join rotation_preferences rp
        on rp.fragrance_id = c.fragrance_id
      left join retirement_preferences rt
        on rt.fragrance_id = c.fragrance_id
      left join ratings r
        on r.fragrance_id = c.fragrance_id
    ),
    summary as (
      select
        count(*) as owned_count,
        count(*) filter (where collection_status = 'signature') as signature_count,
        count(*) filter (where preference_state = 'liked') as liked_count,
        count(*) filter (where preference_state = 'loved') as loved_count,
        count(*) filter (where preference_state in ('liked', 'loved')) as preference_count,
        count(*) filter (where wear_more) as wear_more_count,
        count(*) filter (where retired) as retired_count,
        count(*) filter (where rating is not null) as rated_count
      from items
    )
    select jsonb_build_object(
      'collection_contract_version', 'collection_preferences_v1',
      'surface_type', 'signed_in',
      'read_only', false,
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'fragrance_id', i.fragrance_id,
              'name', i.name,
              'brand', i.brand,
              'family_key', i.family_key,
              'family_label', i.family_label,
              'image_url', i.image_url,
              'thumbnail_url', i.thumbnail_url,
              'collection_status', i.collection_status,
              'preference_state', i.preference_state,
              'wear_more', i.wear_more,
              'favorite', i.favorite,
              'retired', i.retired,
              'rating', i.rating,
              'default_rank', i.default_rank
            )
            order by i.default_rank
          )
          from items i
        ),
        '[]'::jsonb
      ),
      'summary', jsonb_build_object(
        'owned_count', coalesce((select owned_count from summary), 0),
        'signature_count', coalesce((select signature_count from summary), 0),
        'liked_count', coalesce((select liked_count from summary), 0),
        'loved_count', coalesce((select loved_count from summary), 0),
        'preference_count', coalesce((select preference_count from summary), 0),
        'wear_more_count', coalesce((select wear_more_count from summary), 0),
        'favorite_count', coalesce((select wear_more_count from summary), 0),
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

grant execute on function public.get_user_collection_preferences_v1(uuid) to authenticated, service_role;

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
        ia.image_url,
        ia.thumbnail_url,
        'guest_demo'::text as collection_status,
        row_number() over (
          order by
            gb.display_rank nulls last,
            lower(coalesce(gb.brand, '')),
            lower(coalesce(gb.name, ''))
        ) as default_rank
      from guest_bottles gb
      left join image_assets ia
        on ia.fragrance_id = gb.fragrance_id
    ),
    summary as (
      select count(*) as owned_count
      from guest_items
    )
    select jsonb_build_object(
      'collection_contract_version', 'collection_preferences_v1',
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
              'image_url', gi.image_url,
              'thumbnail_url', gi.thumbnail_url,
              'collection_status', gi.collection_status,
              'preference_state', 'neutral',
              'wear_more', false,
              'favorite', false,
              'retired', false,
              'rating', null,
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
        'signature_count', 0,
        'liked_count', 0,
        'loved_count', 0,
        'preference_count', 0,
        'wear_more_count', 0,
        'favorite_count', 0,
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
