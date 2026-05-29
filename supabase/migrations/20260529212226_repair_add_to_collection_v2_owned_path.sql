create or replace function public.add_to_collection_v2(
  p_user_id uuid,
  p_name text,
  p_brand text,
  p_release_year integer,
  p_concentration text,
  p_status text,
  p_love_level smallint,
  p_negative_level smallint,
  p_longevity_feedback smallint default null,
  p_projection_feedback smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_conc text := upper(trim(coalesce(p_concentration, 'UNKNOWN')));
  v_status text := lower(trim(coalesce(p_status, '')));
  v_fragrance_id uuid;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required.';
  end if;

  if v_auth_user is null and auth.role() <> 'service_role' and session_user <> 'postgres' then
    raise exception 'Signed-in collection write requires auth.uid().';
  end if;

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user_id must match auth.uid().';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'p_name is required.';
  end if;

  if coalesce(trim(p_brand), '') = '' then
    raise exception 'p_brand is required.';
  end if;

  if v_status <> 'owned' then
    raise exception 'p_status must be owned.';
  end if;

  if v_conc not in ('EDT', 'EDP', 'PARFUM', 'EXTRAIT', 'COLOGNE', 'UNKNOWN') then
    v_conc := 'UNKNOWN';
  end if;

  select f.id
  into v_fragrance_id
  from public.fragrances f
  where lower(trim(f.name)) = lower(trim(p_name))
    and lower(trim(f.brand)) = lower(trim(p_brand))
    and coalesce(f.release_year, -1) = coalesce(p_release_year, -1)
    and coalesce(upper(trim(f.concentration)), 'UNKNOWN') = v_conc
  order by f.updated_at desc nulls last, f.created_at desc nulls last, f.id
  limit 1;

  if v_fragrance_id is null then
    raise exception 'Existing fragrance not found for owned wardrobe add.';
  end if;

  insert into public.user_collection (
    user_id,
    fragrance_id,
    status,
    love_level,
    negative_level,
    longevity_feedback,
    projection_feedback
  )
  values (
    p_user_id,
    v_fragrance_id,
    'owned',
    p_love_level,
    p_negative_level,
    p_longevity_feedback,
    p_projection_feedback
  )
  on conflict (user_id, fragrance_id)
  do update
  set
    status = 'owned',
    love_level = coalesce(excluded.love_level, user_collection.love_level),
    negative_level = coalesce(excluded.negative_level, user_collection.negative_level),
    longevity_feedback = coalesce(excluded.longevity_feedback, user_collection.longevity_feedback),
    projection_feedback = coalesce(excluded.projection_feedback, user_collection.projection_feedback),
    updated_at = now();

  return v_fragrance_id;
end;
$function$;

create or replace function public.add_to_collection_v2(
  p_user_id uuid,
  p_name text,
  p_brand text,
  p_release_year integer,
  p_concentration text,
  p_status text,
  p_love_level smallint,
  p_negative_level smallint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
begin
  return public.add_to_collection_v2(
    p_user_id,
    p_name,
    p_brand,
    p_release_year,
    p_concentration,
    p_status,
    p_love_level,
    p_negative_level,
    null,
    null
  );
end;
$function$;
