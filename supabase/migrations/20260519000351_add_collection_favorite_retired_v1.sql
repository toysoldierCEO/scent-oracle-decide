create table if not exists public.user_fragrance_rotation_preferences_v1 (
  user_id uuid not null references auth.users(id) on delete cascade,
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  wear_more boolean not null default true,
  source text not null default 'collection',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, fragrance_id)
);

create index if not exists idx_user_fragrance_rotation_preferences_v1_user
  on public.user_fragrance_rotation_preferences_v1 (user_id, updated_at desc);

create index if not exists idx_user_fragrance_rotation_preferences_v1_fragrance
  on public.user_fragrance_rotation_preferences_v1 (fragrance_id);

alter table public.user_fragrance_rotation_preferences_v1 enable row level security;

drop policy if exists user_fragrance_rotation_preferences_v1_select_self on public.user_fragrance_rotation_preferences_v1;
create policy user_fragrance_rotation_preferences_v1_select_self
on public.user_fragrance_rotation_preferences_v1
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists user_fragrance_rotation_preferences_v1_insert_self on public.user_fragrance_rotation_preferences_v1;
create policy user_fragrance_rotation_preferences_v1_insert_self
on public.user_fragrance_rotation_preferences_v1
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists user_fragrance_rotation_preferences_v1_update_self on public.user_fragrance_rotation_preferences_v1;
create policy user_fragrance_rotation_preferences_v1_update_self
on public.user_fragrance_rotation_preferences_v1
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_fragrance_rotation_preferences_v1_delete_self on public.user_fragrance_rotation_preferences_v1;
create policy user_fragrance_rotation_preferences_v1_delete_self
on public.user_fragrance_rotation_preferences_v1
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.user_fragrance_rotation_preferences_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.user_fragrance_rotation_preferences_v1 to service_role;

create table if not exists public.user_fragrance_retirement_preferences_v1 (
  user_id uuid not null references auth.users(id) on delete cascade,
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  retired boolean not null default true,
  source text not null default 'collection',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, fragrance_id)
);

create index if not exists idx_user_fragrance_retirement_preferences_v1_user
  on public.user_fragrance_retirement_preferences_v1 (user_id, updated_at desc);

create index if not exists idx_user_fragrance_retirement_preferences_v1_fragrance
  on public.user_fragrance_retirement_preferences_v1 (fragrance_id);

alter table public.user_fragrance_retirement_preferences_v1 enable row level security;

drop policy if exists user_fragrance_retirement_preferences_v1_select_self on public.user_fragrance_retirement_preferences_v1;
create policy user_fragrance_retirement_preferences_v1_select_self
on public.user_fragrance_retirement_preferences_v1
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists user_fragrance_retirement_preferences_v1_insert_self on public.user_fragrance_retirement_preferences_v1;
create policy user_fragrance_retirement_preferences_v1_insert_self
on public.user_fragrance_retirement_preferences_v1
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists user_fragrance_retirement_preferences_v1_update_self on public.user_fragrance_retirement_preferences_v1;
create policy user_fragrance_retirement_preferences_v1_update_self
on public.user_fragrance_retirement_preferences_v1
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_fragrance_retirement_preferences_v1_delete_self on public.user_fragrance_retirement_preferences_v1;
create policy user_fragrance_retirement_preferences_v1_delete_self
on public.user_fragrance_retirement_preferences_v1
for delete
to authenticated
using (auth.uid() = user_id);

revoke all on table public.user_fragrance_retirement_preferences_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.user_fragrance_retirement_preferences_v1 to service_role;

create or replace function public.set_user_fragrance_wear_more_v1(
  p_fragrance_id uuid,
  p_wear_more boolean,
  p_source text default 'collection'::text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_source text := coalesce(nullif(trim(p_source), ''), 'collection');
begin
  if v_auth_user is null then
    raise exception 'Signed-in wear-more write requires auth.uid().';
  end if;

  if p_fragrance_id is null then
    raise exception 'p_fragrance_id is required.';
  end if;

  if coalesce(p_wear_more, false) then
    if exists(
      select 1
      from public.user_fragrance_retirement_preferences_v1
      where user_id = v_auth_user
        and fragrance_id = p_fragrance_id
    ) then
      raise exception 'Cannot favorite a retired bottle. Clear Retired first.';
    end if;

    insert into public.user_fragrance_rotation_preferences_v1 (
      user_id,
      fragrance_id,
      wear_more,
      source,
      created_at,
      updated_at
    )
    values (
      v_auth_user,
      p_fragrance_id,
      true,
      v_source,
      now(),
      now()
    )
    on conflict (user_id, fragrance_id)
    do update
    set
      wear_more = true,
      source = excluded.source,
      updated_at = now();
  else
    delete from public.user_fragrance_rotation_preferences_v1
    where user_id = v_auth_user
      and fragrance_id = p_fragrance_id;
  end if;

  return (
    with rotation_rollup as (
      select count(*) as wear_more_count
      from public.user_fragrance_rotation_preferences_v1
      where user_id = v_auth_user
    ),
    retirement_rollup as (
      select count(*) as retired_count
      from public.user_fragrance_retirement_preferences_v1
      where user_id = v_auth_user
    ),
    current_row as (
      select
        wear_more,
        source,
        updated_at
      from public.user_fragrance_rotation_preferences_v1
      where user_id = v_auth_user
        and fragrance_id = p_fragrance_id
    )
    select jsonb_build_object(
      'fragrance_id', p_fragrance_id,
      'wear_more', exists(select 1 from current_row),
      'favorite', exists(select 1 from current_row),
      'source', case
        when exists(select 1 from current_row) then (select source from current_row)
        else v_source
      end,
      'removed', not exists(select 1 from current_row),
      'updated_at', coalesce((select updated_at from current_row), now()),
      'wear_more_count', coalesce((select wear_more_count from rotation_rollup), 0),
      'favorite_count', coalesce((select wear_more_count from rotation_rollup), 0),
      'retired_count', coalesce((select retired_count from retirement_rollup), 0)
    )
  );
end;
$function$;

grant execute on function public.set_user_fragrance_wear_more_v1(uuid, boolean, text) to authenticated, service_role;

create or replace function public.set_user_fragrance_favorite_v1(
  p_fragrance_id uuid,
  p_favorite boolean,
  p_source text default 'collection'::text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
begin
  return public.set_user_fragrance_wear_more_v1(
    p_fragrance_id => p_fragrance_id,
    p_wear_more => p_favorite,
    p_source => p_source
  );
end;
$function$;

grant execute on function public.set_user_fragrance_favorite_v1(uuid, boolean, text) to authenticated, service_role;

create or replace function public.set_user_fragrance_retired_v1(
  p_fragrance_id uuid,
  p_retired boolean,
  p_source text default 'collection'::text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_source text := coalesce(nullif(trim(p_source), ''), 'collection');
begin
  if v_auth_user is null then
    raise exception 'Signed-in retired write requires auth.uid().';
  end if;

  if p_fragrance_id is null then
    raise exception 'p_fragrance_id is required.';
  end if;

  if coalesce(p_retired, false) then
    delete from public.user_fragrance_rotation_preferences_v1
    where user_id = v_auth_user
      and fragrance_id = p_fragrance_id;

    insert into public.user_fragrance_retirement_preferences_v1 (
      user_id,
      fragrance_id,
      retired,
      source,
      created_at,
      updated_at
    )
    values (
      v_auth_user,
      p_fragrance_id,
      true,
      v_source,
      now(),
      now()
    )
    on conflict (user_id, fragrance_id)
    do update
    set
      retired = true,
      source = excluded.source,
      updated_at = now();
  else
    delete from public.user_fragrance_retirement_preferences_v1
    where user_id = v_auth_user
      and fragrance_id = p_fragrance_id;
  end if;

  return (
    with rotation_rollup as (
      select count(*) as wear_more_count
      from public.user_fragrance_rotation_preferences_v1
      where user_id = v_auth_user
    ),
    retirement_rollup as (
      select count(*) as retired_count
      from public.user_fragrance_retirement_preferences_v1
      where user_id = v_auth_user
    ),
    current_row as (
      select
        retired,
        source,
        updated_at
      from public.user_fragrance_retirement_preferences_v1
      where user_id = v_auth_user
        and fragrance_id = p_fragrance_id
    )
    select jsonb_build_object(
      'fragrance_id', p_fragrance_id,
      'retired', exists(select 1 from current_row),
      'favorite', exists(
        select 1
        from public.user_fragrance_rotation_preferences_v1
        where user_id = v_auth_user
          and fragrance_id = p_fragrance_id
      ),
      'wear_more', exists(
        select 1
        from public.user_fragrance_rotation_preferences_v1
        where user_id = v_auth_user
          and fragrance_id = p_fragrance_id
      ),
      'source', case
        when exists(select 1 from current_row) then (select source from current_row)
        else v_source
      end,
      'removed', not exists(select 1 from current_row),
      'updated_at', coalesce((select updated_at from current_row), now()),
      'retired_count', coalesce((select retired_count from retirement_rollup), 0),
      'favorite_count', coalesce((select wear_more_count from rotation_rollup), 0),
      'wear_more_count', coalesce((select wear_more_count from rotation_rollup), 0)
    )
  );
end;
$function$;

grant execute on function public.set_user_fragrance_retired_v1(uuid, boolean, text) to authenticated, service_role;

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
        coalesce(rt.retired, false) as retired
      from collection c
      left join image_assets ia
        on ia.fragrance_id = c.fragrance_id
      left join preferences p
        on p.fragrance_id = c.fragrance_id
      left join rotation_preferences rp
        on rp.fragrance_id = c.fragrance_id
      left join retirement_preferences rt
        on rt.fragrance_id = c.fragrance_id
    ),
    summary as (
      select
        count(*) as owned_count,
        count(*) filter (where collection_status = 'signature') as signature_count,
        count(*) filter (where preference_state = 'liked') as liked_count,
        count(*) filter (where preference_state = 'loved') as loved_count,
        count(*) filter (where preference_state in ('liked', 'loved')) as preference_count,
        count(*) filter (where wear_more) as wear_more_count,
        count(*) filter (where retired) as retired_count
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
        'retired_count', coalesce((select retired_count from summary), 0)
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
        'retired_count', 0
      ),
      'empty_reason', case
        when coalesce((select owned_count from summary), 0) > 0 then null
        else 'Guest demo wardrobe is empty.'
      end
    )
  );
end;
$function$;

grant execute on function public.get_guest_collection_preview_v1() to anon, authenticated, service_role;

create or replace function public.get_odara_profile_dossier_v1(
  p_user_id uuid default null,
  p_surface text default 'signed_in'::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_surface text := case
    when lower(coalesce(nullif(p_surface, ''), 'signed_in')) = 'guest' then 'guest'
    else 'signed_in'
  end;
  v_auth_user uuid := auth.uid();
  v_user_id uuid := coalesce(p_user_id, v_auth_user);
  v_display_name text;
  v_initials text;
  v_payload jsonb := '{}'::jsonb;
begin
  if v_surface = 'signed_in' then
    if v_user_id is null then
      raise exception 'Signed-in dossier requires p_user_id or auth.uid().';
    end if;

    if not (
      auth.role() = 'service_role'
      or session_user = 'postgres'
      or (v_auth_user is not null and v_user_id = v_auth_user)
    ) then
      raise exception 'Access denied: p_user_id must match auth.uid() for signed-in dossier.';
    end if;

    v_display_name := coalesce(
      nullif(auth.jwt() #>> '{user_metadata,full_name}', ''),
      nullif(auth.jwt() #>> '{user_metadata,name}', ''),
      nullif(split_part(coalesce(auth.jwt()->>'email', ''), '@', 1), ''),
      'Signed in'
    );
    v_initials := upper(left(regexp_replace(v_display_name, '[^[:alnum:]]', '', 'g'), 2));

    with collection as (
      select
        item.representative_fragrance_id as fragrance_id,
        coalesce(item.representative_family_key, f.family_key) as family_key,
        coalesce(item.representative_brand, f.brand) as brand,
        coalesce(f.notes, '{}'::text[]) as notes,
        coalesce(f.accords, '{}'::text[]) as accords,
        item.effective_status,
        item.has_signature,
        item.has_owned
      from public.user_collection_effective_items_v2 item
      left join public.fragrances f
        on f.id = item.representative_fragrance_id
      where item.user_id = v_user_id
        and (item.has_owned or item.has_signature)
    ),
    collection_stats as (
      select
        count(*) as bottle_count,
        count(*) filter (where family_key is not null and family_key <> 'unknown') as classified_bottle_count,
        count(*) filter (where has_signature or effective_status = 'signature') as signature_count
      from collection
    ),
    family_counts as (
      select
        family_key,
        count(*) as cnt
      from collection
      where family_key is not null
        and family_key <> 'unknown'
      group by 1
      order by count(*) desc, family_key
    ),
    family_summary as (
      select
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'family_key', fc.family_key,
              'label', initcap(replace(fc.family_key, '-', ' ')),
              'count', fc.cnt,
              'pct', case
                when cs.classified_bottle_count > 0 then round((fc.cnt::numeric / cs.classified_bottle_count::numeric) * 100.0)
                else 0
              end
            )
            order by fc.cnt desc, fc.family_key
          ) filter (where fc.family_key is not null),
          '[]'::jsonb
        ) as family_counts,
        (select fc.family_key from family_counts fc order by fc.cnt desc, fc.family_key limit 1) as dominant_family_key,
        (select fc.cnt from family_counts fc order by fc.cnt desc, fc.family_key limit 1) as dominant_family_count
      from collection_stats cs
      left join family_counts fc
        on true
    ),
    taste as (
      select *
      from public.user_taste_profiles_v1
      where user_id = v_user_id
      limit 1
    ),
    saved as (
      select
        (select count(*) from public.saved_layers sl where sl.user_id = v_user_id) as saved_layers_count,
        (select count(*) from public.saved_layer_combos slc where slc.user_id = v_user_id) as saved_combo_count,
        (select count(*) from public.saved_recipes sr where sr.user_id = v_user_id) as saved_recipe_count
    ),
    history as (
      select
        (select count(*) from public.wear_events we where we.user_id = v_user_id) as wear_count,
        (select count(*) from public.user_scent_decision_events se where se.user_id = v_user_id) as decision_count,
        (select count(*) from public.user_wear_trials uwt where uwt.user_id = v_user_id) as wear_trial_count
    ),
    context_summary as (
      select
        coalesce(sum(cnt) filter (where context in ('daily', 'work')), 0) as day_count,
        coalesce(sum(cnt) filter (where context in ('hangout', 'date')), 0) as night_count,
        coalesce(sum(cnt), 0) as total_count
      from (
        select context, count(*) as cnt
        from public.wear_events
        where user_id = v_user_id
        group by 1
      ) ctx
    ),
    repeat_summary as (
      select coalesce(max(cnt), 0) as top_repeat_count
      from (
        select fragrance_id, count(*) as cnt
        from public.wear_events
        where user_id = v_user_id
        group by 1
      ) repeats
    ),
    layer_usage as (
      select count(*) as layer_memory_count
      from public.odara_signed_in_day_memory dm
      where dm.user_id = v_user_id
        and (
          dm.state_json->'lockedLayerCard' is not null
          or dm.state_json->'manualLayerCard' is not null
        )
    ),
    preference_rollup as (
      select
        count(*) filter (where preference_state = 'liked') as liked_count,
        count(*) filter (where preference_state = 'loved') as loved_count,
        count(*) as preference_count
      from public.user_fragrance_preferences_v1
      where user_id = v_user_id
    ),
    rotation_rollup as (
      select count(*) as wear_more_count
      from public.user_fragrance_rotation_preferences_v1
      where user_id = v_user_id
    ),
    retired_rollup as (
      select count(*) as retired_count
      from public.user_fragrance_retirement_preferences_v1
      where user_id = v_user_id
    ),
    favorite_family_counts as (
      select
        coalesce(f.family_key, c.family_key) as family_key,
        count(*) as cnt
      from public.user_fragrance_preferences_v1 pref
      left join public.fragrances f
        on f.id = pref.fragrance_id
      left join collection c
        on c.fragrance_id = pref.fragrance_id
      where pref.user_id = v_user_id
        and pref.preference_state in ('liked', 'loved')
        and coalesce(f.family_key, c.family_key) is not null
        and coalesce(f.family_key, c.family_key) <> 'unknown'
      group by 1
      order by count(*) desc, family_key
    ),
    favorite_brand_counts as (
      select
        lower(coalesce(f.brand, c.brand)) as brand_key,
        coalesce(f.brand, c.brand) as brand_label,
        count(*) as cnt
      from public.user_fragrance_preferences_v1 pref
      left join public.fragrances f
        on f.id = pref.fragrance_id
      left join collection c
        on c.fragrance_id = pref.fragrance_id
      where pref.user_id = v_user_id
        and pref.preference_state = 'loved'
        and coalesce(f.brand, c.brand) is not null
        and trim(coalesce(f.brand, c.brand)) <> ''
      group by 1, 2
      order by count(*) desc, brand_key
    ),
    favorite_summary as (
      select
        (select family_key from favorite_family_counts order by cnt desc, family_key limit 1) as favorite_family_key,
        (select cnt from favorite_family_counts order by cnt desc, family_key limit 1) as favorite_family_count,
        (select brand_label from favorite_brand_counts order by cnt desc, brand_key limit 1) as house_gravity_brand,
        (select cnt from favorite_brand_counts order by cnt desc, brand_key limit 1) as house_gravity_count
    ),
    mode_lock_counts as (
      select
        lower(state_json->>'lockedMood') as locked_mode,
        count(*) as cnt
      from public.odara_signed_in_day_memory
      where user_id = v_user_id
        and state_json->>'lockState' = 'locked'
        and coalesce(state_json->>'lockedMood', '') <> ''
      group by 1
      order by count(*) desc, locked_mode
    ),
    mode_lock_rollup as (
      select
        coalesce(jsonb_object_agg(locked_mode, cnt order by locked_mode), '{}'::jsonb) as mode_lock_counts,
        coalesce(sum(cnt), 0) as total_mode_locks,
        (select locked_mode from mode_lock_counts order by cnt desc, locked_mode limit 1) as most_locked_mode
      from mode_lock_counts
    ),
    context_lock_counts as (
      select
        lower(coalesce(state_json->>'lockedContext', context_key)) as locked_context,
        count(*) as cnt
      from public.odara_signed_in_day_memory
      where user_id = v_user_id
        and state_json->>'lockState' = 'locked'
        and coalesce(state_json->>'lockedContext', context_key, '') <> ''
      group by 1
      order by count(*) desc, locked_context
    ),
    context_lock_rollup as (
      select
        coalesce(jsonb_object_agg(locked_context, cnt order by locked_context), '{}'::jsonb) as context_lock_counts,
        coalesce(sum(cnt), 0) as total_context_locks,
        (select locked_context from context_lock_counts order by cnt desc, locked_context limit 1) as most_locked_context
      from context_lock_counts
    ),
    signed_in_payload as (
      select jsonb_build_object(
        'profile_contract_version', 'profile_dossier_v1',
        'surface_type', 'signed_in',
        'computed_at', now(),
        'profile_identity', jsonb_build_object(
          'display_name', v_display_name,
          'initials', coalesce(nullif(v_initials, ''), 'OD'),
          'status_label', 'Signed in'
        ),
        'collection_summary', jsonb_build_object(
          'bottle_count', cs.bottle_count,
          'source', 'user_collection_effective_items_v2',
          'enough_data', (cs.bottle_count > 0),
          'empty_reason', case
            when cs.bottle_count > 0 then null
            else 'No owned bottles yet.'
          end
        ),
        'family_balance', jsonb_build_object(
          'dominant_family', case
            when fs.dominant_family_key is not null then initcap(replace(fs.dominant_family_key, '-', ' '))
            else null
          end,
          'dominant_family_key', fs.dominant_family_key,
          'family_counts', fs.family_counts,
          'coverage_copy', case
            when cs.classified_bottle_count > 0 and fs.dominant_family_key is not null then
              format(
                'Strongest lane: %s (%s of %s classified bottles).',
                initcap(replace(fs.dominant_family_key, '-', ' ')),
                fs.dominant_family_count,
                cs.classified_bottle_count
              )
            when cs.bottle_count > 0 then
              'Collection is real, but family labeling is still thin.'
            else
              'No collection coverage yet.'
          end,
          'enough_data', (cs.classified_bottle_count > 0),
          'empty_reason', case
            when cs.bottle_count = 0 then 'Add real bottles to see family balance.'
            when cs.classified_bottle_count = 0 then 'Not enough labeled family metadata yet.'
            else null
          end
        ),
        'insights', jsonb_build_object(
          'lean', jsonb_build_object(
            'value', case
              when t.user_id is null then null
              when t.bright_dark <= 0.45 then 'Bright / airy'
              when t.bright_dark >= 0.55 then 'Dark / rich'
              else 'Balanced'
            end,
            'confidence', case
              when t.user_id is null then 'low'
              when coalesce(t.interaction_count, 0) >= 8 then 'high'
              when coalesce(t.interaction_count, 0) >= 1 then 'medium'
              else 'low'
            end,
            'source', case when t.user_id is null then null else 'user_taste_profiles_v1.bright_dark' end,
            'empty_reason', case
              when t.user_id is null then 'Not enough real taste signal yet.'
              else null
            end
          ),
          'texture', jsonb_build_object(
            'value', case
              when t.user_id is null then null
              when t.smooth_textured <= 0.45 then 'Smooth'
              when t.smooth_textured >= 0.55 then 'Textured'
              else 'Balanced'
            end,
            'confidence', case
              when t.user_id is null then 'low'
              when coalesce(t.interaction_count, 0) >= 8 then 'high'
              when coalesce(t.interaction_count, 0) >= 1 then 'medium'
              else 'low'
            end,
            'source', case when t.user_id is null then null else 'user_taste_profiles_v1.smooth_textured' end,
            'empty_reason', case
              when t.user_id is null then 'Not enough real texture signal yet.'
              else null
            end
          ),
          'dominant_family', jsonb_build_object(
            'value', case
              when fs.dominant_family_key is not null then initcap(replace(fs.dominant_family_key, '-', ' '))
              else null
            end,
            'confidence', case when fs.dominant_family_key is not null then 'medium' else 'low' end,
            'source', case when fs.dominant_family_key is not null then 'user_collection_effective_items_v2 + fragrances.family_key' else null end,
            'empty_reason', case
              when cs.bottle_count = 0 then 'No collection signal yet.'
              when fs.dominant_family_key is null then 'Not enough labeled family metadata yet.'
              else null
            end
          ),
          'layering', jsonb_build_object(
            'value', case
              when (sv.saved_layers_count + sv.saved_combo_count) >= 3 or lu.layer_memory_count >= 8 then 'Active'
              when (sv.saved_layers_count + sv.saved_combo_count) > 0 or lu.layer_memory_count > 0 then 'Emerging'
              else null
            end,
            'confidence', case
              when (sv.saved_layers_count + sv.saved_combo_count) >= 3 or lu.layer_memory_count >= 8 then 'medium'
              when (sv.saved_layers_count + sv.saved_combo_count) > 0 or lu.layer_memory_count > 0 then 'low'
              else 'low'
            end,
            'source', case
              when (sv.saved_layers_count + sv.saved_combo_count) > 0 or lu.layer_memory_count > 0 then 'saved_layer_combos + saved_layers + odara_signed_in_day_memory'
              else null
            end,
            'empty_reason', case
              when (sv.saved_layers_count + sv.saved_combo_count) > 0 or lu.layer_memory_count > 0 then null
              else 'No real layer activity yet.'
            end
          ),
          'day_night', jsonb_build_object(
            'value', case
              when hs.wear_count + hs.decision_count + hs.wear_trial_count < 3 then null
              when ctx.day_count >= greatest(ctx.night_count * 2, 4) then 'Day-leaning'
              when ctx.night_count >= greatest(ctx.day_count * 2, 4) then 'Night-leaning'
              else 'Balanced'
            end,
            'confidence', case
              when hs.wear_count + hs.decision_count + hs.wear_trial_count >= 10 then 'high'
              when hs.wear_count + hs.decision_count + hs.wear_trial_count >= 3 then 'medium'
              else 'low'
            end,
            'source', case
              when hs.wear_count + hs.decision_count + hs.wear_trial_count >= 3 then 'wear_events.context'
              else null
            end,
            'empty_reason', case
              when hs.wear_count + hs.decision_count + hs.wear_trial_count >= 3 then null
              else 'Not enough real day/night wear history yet.'
            end
          ),
          'signature_gravity', jsonb_build_object(
            'value', case
              when pr.loved_count >= 3 then 'High'
              when pr.loved_count >= 1 or pr.preference_count >= 3 then 'Defined'
              when rr.wear_more_count >= 4 then 'Defined'
              when cs.bottle_count = 0 then null
              when cs.signature_count >= 3 or rs.top_repeat_count >= 6 then 'High'
              when cs.signature_count >= 1 or rs.top_repeat_count >= 3 then 'Defined'
              else 'Open rotation'
            end,
            'confidence', case
              when pr.loved_count >= 3 then 'medium'
              when pr.loved_count >= 1 or pr.preference_count >= 3 then 'low'
              when rr.wear_more_count >= 4 then 'low'
              when cs.signature_count >= 3 or rs.top_repeat_count >= 6 then 'medium'
              when cs.signature_count >= 1 or rs.top_repeat_count >= 3 then 'low'
              when cs.bottle_count > 0 then 'low'
              else 'low'
            end,
            'source', case
              when pr.preference_count > 0 or rr.wear_more_count > 0 or rt.retired_count > 0 then 'user_fragrance_preferences_v1 + user_fragrance_rotation_preferences_v1 + user_fragrance_retirement_preferences_v1 + user_collection_effective_items_v2 + wear_events'
              when cs.bottle_count > 0 then 'user_collection_effective_items_v2 + wear_events'
              else null
            end,
            'empty_reason', case
              when pr.preference_count > 0 or rr.wear_more_count > 0 or rt.retired_count > 0 or cs.bottle_count > 0 then null
              else 'No repeat-wear, signature, or preference signal yet.'
            end
          )
        ),
        'preference_summary', jsonb_build_object(
          'liked_count', pr.liked_count,
          'loved_count', pr.loved_count,
          'wear_more_count', rr.wear_more_count,
          'favorite_count', rr.wear_more_count,
          'retired_count', rt.retired_count,
          'preference_count', pr.preference_count,
          'favorite_lane', case
            when pr.preference_count >= 3 and fav.favorite_family_key is not null then initcap(replace(fav.favorite_family_key, '-', ' '))
            else null
          end,
          'favorite_lane_confidence', case
            when pr.preference_count >= 5 and fav.favorite_family_key is not null then 'medium'
            when pr.preference_count >= 3 and fav.favorite_family_key is not null then 'low'
            else 'low'
          end,
          'favorite_lane_empty_reason', case
            when pr.preference_count >= 3 and fav.favorite_family_key is not null then null
            else 'Like or love bottles in Collection to sharpen this.'
          end,
          'house_gravity', case
            when pr.loved_count >= 2 and fav.house_gravity_brand is not null then fav.house_gravity_brand
            else null
          end,
          'house_gravity_confidence', case
            when pr.loved_count >= 3 and fav.house_gravity_brand is not null then 'medium'
            when pr.loved_count >= 2 and fav.house_gravity_brand is not null then 'low'
            else 'low'
          end,
          'house_gravity_empty_reason', case
            when pr.loved_count >= 2 and fav.house_gravity_brand is not null then null
            else 'Love a few bottles in Collection to reveal real house gravity.'
          end
        ),
        'mode_context_summary', jsonb_build_object(
          'mode_lock_counts', mlr.mode_lock_counts,
          'context_lock_counts', clr.context_lock_counts,
          'most_locked_mode', mlr.most_locked_mode,
          'most_locked_context', clr.most_locked_context,
          'enough_data', ((mlr.total_mode_locks + clr.total_context_locks) > 0),
          'empty_reason', case
            when (mlr.total_mode_locks + clr.total_context_locks) > 0 then null
            else 'Lock cards across contexts to build mode and occasion signal.'
          end
        ),
        'library', jsonb_build_object(
          'collection_count', cs.bottle_count,
          'saved_count', sv.saved_layers_count + sv.saved_combo_count + sv.saved_recipe_count,
          'history_count', hs.wear_count + hs.decision_count + hs.wear_trial_count,
          'recipes_count', sv.saved_recipe_count,
          'liked_count', pr.liked_count,
          'loved_count', pr.loved_count,
          'wear_more_count', rr.wear_more_count,
          'favorite_count', rr.wear_more_count,
          'retired_count', rt.retired_count,
          'preference_count', pr.preference_count,
          'saved_empty_reason', case
            when (sv.saved_layers_count + sv.saved_combo_count + sv.saved_recipe_count) > 0 then null
            else 'No real saved items yet.'
          end,
          'history_empty_reason', case
            when (hs.wear_count + hs.decision_count + hs.wear_trial_count) > 0 then null
            else 'No real scent history yet.'
          end
        ),
        'data_quality', jsonb_build_object(
          'has_collection', (cs.bottle_count > 0),
          'has_history', ((hs.wear_count + hs.decision_count + hs.wear_trial_count) > 0),
          'has_wear_trials', (hs.wear_trial_count > 0),
          'has_saved', ((sv.saved_layers_count + sv.saved_combo_count + sv.saved_recipe_count) > 0),
          'has_preferences', (pr.preference_count > 0 or rr.wear_more_count > 0 or rt.retired_count > 0),
          'has_guest_collection', false
        )
      ) as payload
      from collection_stats cs
      cross join family_summary fs
      left join taste t on true
      cross join saved sv
      cross join history hs
      cross join context_summary ctx
      cross join repeat_summary rs
      cross join layer_usage lu
      cross join preference_rollup pr
      cross join rotation_rollup rr
      cross join retired_rollup rt
      cross join favorite_summary fav
      cross join mode_lock_rollup mlr
      cross join context_lock_rollup clr
    )
    select payload
    into v_payload
    from signed_in_payload;

    return v_payload;
  end if;

  with guest_bottles as (
    select distinct on (
      coalesce(
        gb.fragrance_id::text,
        gb.style_key || '|' || lower(gb.bottle_name) || '|' || lower(gb.bottle_brand)
      )
    )
      coalesce(
        gb.fragrance_id::text,
        gb.style_key || '|' || lower(gb.bottle_name) || '|' || lower(gb.bottle_brand)
      ) as bottle_key,
      gb.fragrance_id,
      gb.style_key,
      gb.bottle_role,
      coalesce(f.family_key, gb.family_label_override, gsw.canonical_family_key, 'unknown') as family_key,
      coalesce(f.notes, '{}'::text[]) as notes,
      coalesce(f.accords, '{}'::text[]) as accords
    from public.guest_style_world_bottles gb
    left join public.fragrances f
      on f.id = gb.fragrance_id
    left join public.guest_style_worlds gsw
      on gsw.style_key = gb.style_key
    where gb.is_active
    order by
      coalesce(
        gb.fragrance_id::text,
        gb.style_key || '|' || lower(gb.bottle_name) || '|' || lower(gb.bottle_brand)
      ),
      gb.display_rank
  ),
  guest_stats as (
    select
      count(*) as bottle_count,
      count(*) filter (where family_key is not null and family_key <> 'unknown') as classified_bottle_count
    from guest_bottles
  ),
  guest_family_counts as (
    select
      family_key,
      count(*) as cnt
    from guest_bottles
    where family_key is not null
      and family_key <> 'unknown'
    group by 1
    order by count(*) desc, family_key
  ),
  guest_family_summary as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'family_key', gfc.family_key,
            'label', initcap(replace(gfc.family_key, '-', ' ')),
            'count', gfc.cnt,
            'pct', case
              when gs.classified_bottle_count > 0 then round((gfc.cnt::numeric / gs.classified_bottle_count::numeric) * 100.0)
              else 0
            end
          )
          order by gfc.cnt desc, gfc.family_key
        ) filter (where gfc.family_key is not null),
        '[]'::jsonb
      ) as family_counts,
      (select gfc.family_key from guest_family_counts gfc order by gfc.cnt desc, gfc.family_key limit 1) as dominant_family_key,
      (select gfc.cnt from guest_family_counts gfc order by gfc.cnt desc, gfc.family_key limit 1) as dominant_family_count
    from guest_stats gs
    left join guest_family_counts gfc
      on true
  ),
  guest_role_summary as (
    select
      count(*) filter (where role_bucket <> 'hero') as layer_role_count,
      count(*) filter (where role_bucket = 'mode') as mode_role_count,
      count(*) filter (where role_bucket = 'alternate') as alternate_role_count
    from public.guest_style_role_matrix_v1
  ),
  guest_family_signal as (
    select
      coalesce(sum(cnt) filter (where family_key in ('citrus-cologne', 'fresh-blue', 'woody-clean')), 0) as bright_family_count,
      coalesce(sum(cnt) filter (where family_key in ('oud-amber', 'sweet-gourmand', 'dark-leather', 'tobacco-boozy')), 0) as rich_family_count,
      coalesce(sum(cnt) filter (where family_key in ('woody-clean', 'fresh-blue', 'sweet-gourmand')), 0) as smooth_family_count,
      coalesce(sum(cnt) filter (where family_key in ('dark-leather', 'oud-amber', 'tobacco-boozy')), 0) as textured_family_count,
      coalesce(sum(cnt) filter (where family_key in ('citrus-cologne', 'fresh-blue', 'woody-clean')), 0) as day_family_count,
      coalesce(sum(cnt) filter (where family_key in ('dark-leather', 'oud-amber', 'tobacco-boozy', 'sweet-gourmand')), 0) as night_family_count
    from guest_family_counts
  ),
  guest_accord_signal as (
    select
      coalesce(sum(cnt) filter (where accord ~* '(citrus|fresh|clean|aromatic|aquatic|soapy)'), 0) as bright_accord_count,
      coalesce(sum(cnt) filter (where accord ~* '(amber|oud|gourmand|vanilla|leather|smoky|boozy|sweet)'), 0) as rich_accord_count,
      coalesce(sum(cnt) filter (where accord ~* '(musk|powdery|creamy|vanilla|soft|iris)'), 0) as smooth_accord_count,
      coalesce(sum(cnt) filter (where accord ~* '(spicy|leather|smoky|woody|oud|green|earthy|resinous|tobacco)'), 0) as textured_accord_count
    from (
      select lower(trim(value)) as accord, count(*) as cnt
      from guest_bottles gb
      cross join lateral unnest(gb.accords) value
      group by 1
    ) accords
  ),
  guest_payload as (
    select jsonb_build_object(
      'profile_contract_version', 'profile_dossier_v1',
      'surface_type', 'guest',
      'computed_at', now(),
      'profile_identity', jsonb_build_object(
        'display_name', 'Guest Preview',
        'initials', 'GP',
        'status_label', 'Demo wardrobe'
      ),
      'collection_summary', jsonb_build_object(
        'bottle_count', gs.bottle_count,
        'source', 'guest_style_world_bottles',
        'enough_data', (gs.bottle_count > 0),
        'empty_reason', case
          when gs.bottle_count > 0 then null
          else 'Guest demo wardrobe is empty.'
        end
      ),
      'family_balance', jsonb_build_object(
        'dominant_family', case
          when gfs.dominant_family_key is not null then initcap(replace(gfs.dominant_family_key, '-', ' '))
          else null
        end,
        'dominant_family_key', gfs.dominant_family_key,
        'family_counts', gfs.family_counts,
        'coverage_copy', case
          when gs.classified_bottle_count > 0 and gfs.dominant_family_key is not null then
            format(
              'Guest preview spans %s real demo bottles, led by %s.',
              gs.bottle_count,
              initcap(replace(gfs.dominant_family_key, '-', ' '))
            )
          when gs.bottle_count > 0 then
            'Guest preview is real, but family labeling is still thin.'
          else
            'Guest demo wardrobe is empty.'
        end,
        'enough_data', (gs.classified_bottle_count > 0),
        'empty_reason', case
          when gs.bottle_count = 0 then 'Guest demo wardrobe is empty.'
          when gs.classified_bottle_count = 0 then 'Not enough labeled family metadata yet.'
          else null
        end
      ),
      'insights', jsonb_build_object(
        'lean', jsonb_build_object(
          'value', case
            when (gsig.bright_family_count + gasig.bright_accord_count) > (gsig.rich_family_count + gasig.rich_accord_count) then 'Bright / airy'
            when (gsig.rich_family_count + gasig.rich_accord_count) > (gsig.bright_family_count + gasig.bright_accord_count) then 'Rich / deep'
            else null
          end,
          'confidence', case
            when gs.bottle_count >= 20 then 'low'
            else 'low'
          end,
          'source', case
            when gs.bottle_count > 0 then 'guest family + accord distribution'
            else null
          end,
          'empty_reason', case
            when gs.bottle_count > 0 then 'Guest preview still needs real wear behavior to sharpen this.'
            else 'Guest demo wardrobe is empty.'
          end
        ),
        'texture', jsonb_build_object(
          'value', case
            when (gsig.smooth_family_count + gasig.smooth_accord_count) > (gsig.textured_family_count + gasig.textured_accord_count) then 'Smooth'
            when (gsig.textured_family_count + gasig.textured_accord_count) > (gsig.smooth_family_count + gasig.smooth_accord_count) then 'Textured'
            else null
          end,
          'confidence', 'low',
          'source', case
            when gs.bottle_count > 0 then 'guest family + accord distribution'
            else null
          end,
          'empty_reason', case
            when gs.bottle_count > 0 then 'Guest preview still needs real wear behavior to sharpen texture signal.'
            else 'Guest demo wardrobe is empty.'
          end
        ),
        'dominant_family', jsonb_build_object(
          'value', case
            when gfs.dominant_family_key is not null then initcap(replace(gfs.dominant_family_key, '-', ' '))
            else null
          end,
          'confidence', case when gfs.dominant_family_key is not null then 'medium' else 'low' end,
          'source', case when gfs.dominant_family_key is not null then 'guest_style_world_bottles + guest_style_worlds + fragrances.family_key' else null end,
          'empty_reason', case
            when gs.bottle_count = 0 then 'Guest demo wardrobe is empty.'
            when gfs.dominant_family_key is null then 'Not enough labeled family metadata yet.'
            else null
          end
        ),
        'layering', jsonb_build_object(
          'value', case
            when grs.layer_role_count > 0 then 'Layer-ready'
            else null
          end,
          'confidence', case when grs.layer_role_count > 0 then 'medium' else 'low' end,
          'source', case when grs.layer_role_count > 0 then 'guest_style_role_matrix_v1.role_bucket' else null end,
          'empty_reason', case
            when grs.layer_role_count > 0 then null
            else 'Guest preview has no layer structure yet.'
          end
        ),
        'day_night', jsonb_build_object(
          'value', case
            when gsig.day_family_count > 0 and gsig.night_family_count > 0 then 'Day-to-night range'
            when gsig.day_family_count > 0 and gsig.night_family_count = 0 then 'Day-leaning'
            when gsig.night_family_count > 0 and gsig.day_family_count = 0 then 'Night-leaning'
            else null
          end,
          'confidence', case
            when gsig.day_family_count > 0 or gsig.night_family_count > 0 then 'low'
            else 'low'
          end,
          'source', case
            when gsig.day_family_count > 0 or gsig.night_family_count > 0 then 'guest_style_world_bottles family mix'
            else null
          end,
          'empty_reason', case
            when gsig.day_family_count > 0 or gsig.night_family_count > 0 then null
            else 'Guest preview has no real day/night range signal yet.'
          end
        ),
        'signature_gravity', jsonb_build_object(
          'value', null,
          'confidence', 'low',
          'source', null,
          'empty_reason', 'Guest preview has no repeat-wear signal yet.'
        )
      ),
      'preference_summary', jsonb_build_object(
        'liked_count', 0,
        'loved_count', 0,
        'wear_more_count', 0,
        'favorite_count', 0,
        'retired_count', 0,
        'preference_count', 0,
        'favorite_lane', null,
        'favorite_lane_confidence', 'low',
        'favorite_lane_empty_reason', 'Guest preview does not write real likes or loves.',
        'house_gravity', null,
        'house_gravity_confidence', 'low',
        'house_gravity_empty_reason', 'Guest preview has no real identity signal yet.'
      ),
      'mode_context_summary', jsonb_build_object(
        'mode_lock_counts', '{}'::jsonb,
        'context_lock_counts', '{}'::jsonb,
        'most_locked_mode', null,
        'most_locked_context', null,
        'enough_data', false,
        'empty_reason', 'Guest preview has no signed-in lock history.'
      ),
      'library', jsonb_build_object(
        'collection_count', gs.bottle_count,
        'saved_count', 0,
        'history_count', 0,
        'recipes_count', 0,
        'liked_count', 0,
        'loved_count', 0,
        'wear_more_count', 0,
        'favorite_count', 0,
        'retired_count', 0,
        'preference_count', 0,
        'saved_empty_reason', 'Guest preview does not carry real saved items.',
        'history_empty_reason', 'Guest preview has no real scent history yet.'
      ),
      'data_quality', jsonb_build_object(
        'has_collection', false,
        'has_history', false,
        'has_wear_trials', false,
        'has_saved', false,
        'has_preferences', false,
        'has_guest_collection', (gs.bottle_count > 0)
      )
    ) as payload
    from guest_stats gs
    cross join guest_family_summary gfs
    cross join guest_role_summary grs
    cross join guest_family_signal gsig
    cross join guest_accord_signal gasig
  )
  select payload
  into v_payload
  from guest_payload;

  return v_payload;
end;
$function$;

grant execute on function public.get_odara_profile_dossier_v1(uuid, text) to anon, authenticated, service_role;
