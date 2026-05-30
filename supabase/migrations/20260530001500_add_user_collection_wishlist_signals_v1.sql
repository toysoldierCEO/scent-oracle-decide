create or replace function public.set_user_collection_wishlist_v1(
  p_fragrance_id uuid,
  p_next_active boolean default true,
  p_source text default 'search'::text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_source text := case
    when lower(coalesce(nullif(trim(p_source), ''), 'search')) in ('manual', 'recommendation', 'search', 'wrapped', 'import')
      then lower(coalesce(nullif(trim(p_source), ''), 'search'))
    else 'search'
  end;
  v_negative_cleared_count integer := 0;
begin
  if v_auth_user is null then
    raise exception 'Signed-in wishlist write requires auth.uid().';
  end if;

  if p_fragrance_id is null then
    raise exception 'p_fragrance_id is required.';
  end if;

  if not exists (
    select 1
    from public.fragrances f
    where f.id = p_fragrance_id
  ) then
    raise exception 'Existing fragrance not found for wishlist save.';
  end if;

  if p_next_active then
    if exists (
      select 1
      from public.user_collection uc
      where uc.user_id = v_auth_user
        and uc.fragrance_id = p_fragrance_id
        and uc.status = 'owned'
    ) then
      return jsonb_build_object(
        'fragrance_id', p_fragrance_id,
        'status', 'owned',
        'wishlist_active', false,
        'removed', false,
        'owned_preserved', true,
        'negative_cleared', false,
        'source', v_source,
        'updated_at', now()
      );
    end if;

    delete from public.user_fragrance_preferences_v1
    where user_id = v_auth_user
      and fragrance_id = p_fragrance_id
      and preference_state in ('not_for_me', 'disliked');

    get diagnostics v_negative_cleared_count = row_count;

    insert into public.user_collection (
      user_id,
      fragrance_id,
      status,
      source
    )
    values (
      v_auth_user,
      p_fragrance_id,
      'would_buy',
      v_source
    )
    on conflict (user_id, fragrance_id)
    do update
    set
      status = 'would_buy',
      source = excluded.source,
      updated_at = now();
  else
    delete from public.user_collection
    where user_id = v_auth_user
      and fragrance_id = p_fragrance_id
      and status = 'would_buy';
  end if;

  return (
    with current_row as (
      select
        uc.status,
        uc.source,
        uc.updated_at
      from public.user_collection uc
      where uc.user_id = v_auth_user
        and uc.fragrance_id = p_fragrance_id
      limit 1
    )
    select jsonb_build_object(
      'fragrance_id', p_fragrance_id,
      'status', coalesce((select status from current_row), 'neutral'),
      'wishlist_active', exists(select 1 from current_row where status = 'would_buy'),
      'removed', not exists(select 1 from current_row where status = 'would_buy'),
      'owned_preserved', exists(select 1 from current_row where status = 'owned'),
      'negative_cleared', v_negative_cleared_count > 0,
      'source', coalesce((select source from current_row), v_source),
      'updated_at', coalesce((select updated_at from current_row), now())
    )
  );
end;
$function$;

grant execute on function public.set_user_collection_wishlist_v1(uuid, boolean, text) to authenticated, service_role;

create or replace function public.get_user_collection_wishlist_signals_v1(
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
    raise exception 'Signed-in wishlist signals require p_user_id or auth.uid().';
  end if;

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and v_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user_id must match auth.uid().';
  end if;

  return jsonb_build_object(
    'collection_wishlist_signal_contract_version', 'collection_wishlist_signals_v1',
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'fragrance_id', uc.fragrance_id,
            'status', uc.status,
            'source', uc.source,
            'updated_at', uc.updated_at,
            'created_at', uc.created_at
          )
          order by uc.updated_at desc nulls last, uc.created_at desc, uc.fragrance_id
        )
        from public.user_collection uc
        where uc.user_id = v_user_id
          and uc.status = 'would_buy'
      ),
      '[]'::jsonb
    )
  );
end;
$function$;

grant execute on function public.get_user_collection_wishlist_signals_v1(uuid) to authenticated, service_role;
