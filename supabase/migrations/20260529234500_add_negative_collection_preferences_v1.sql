alter table public.user_fragrance_preferences_v1
  drop constraint if exists user_fragrance_preferences_v1_preference_state_check;

alter table public.user_fragrance_preferences_v1
  add constraint user_fragrance_preferences_v1_preference_state_check
  check (
    preference_state = any (
      array[
        'liked'::text,
        'loved'::text,
        'not_for_me'::text,
        'disliked'::text
      ]
    )
  );

create or replace function public.set_user_fragrance_preference_v1(
  p_fragrance_id uuid,
  p_next_state text,
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
  v_next_state text := lower(coalesce(trim(p_next_state), ''));
  v_source text := coalesce(nullif(trim(p_source), ''), 'collection');
begin
  if v_auth_user is null then
    raise exception 'Signed-in preference write requires auth.uid().';
  end if;

  if p_fragrance_id is null then
    raise exception 'p_fragrance_id is required.';
  end if;

  if v_next_state not in ('liked', 'loved', 'not_for_me', 'disliked', 'neutral') then
    raise exception 'p_next_state must be liked, loved, not_for_me, disliked, or neutral.';
  end if;

  if v_next_state = 'neutral' then
    delete from public.user_fragrance_preferences_v1
    where user_id = v_auth_user
      and fragrance_id = p_fragrance_id;
  else
    insert into public.user_fragrance_preferences_v1 (
      user_id,
      fragrance_id,
      preference_state,
      source,
      created_at,
      updated_at,
      last_event_at
    )
    values (
      v_auth_user,
      p_fragrance_id,
      v_next_state,
      v_source,
      now(),
      now(),
      now()
    )
    on conflict (user_id, fragrance_id)
    do update
    set
      preference_state = excluded.preference_state,
      source = excluded.source,
      updated_at = now(),
      last_event_at = now();
  end if;

  return (
    with preference_rollup as (
      select
        count(*) filter (where preference_state = 'liked') as liked_count,
        count(*) filter (where preference_state = 'loved') as loved_count,
        count(*) filter (where preference_state = 'not_for_me') as not_for_me_count,
        count(*) filter (where preference_state = 'disliked') as disliked_count,
        count(*) filter (where preference_state in ('liked', 'loved')) as preference_count,
        count(*) filter (where preference_state in ('not_for_me', 'disliked')) as negative_count
      from public.user_fragrance_preferences_v1
      where user_id = v_auth_user
    ),
    current_row as (
      select
        preference_state,
        source,
        updated_at,
        last_event_at
      from public.user_fragrance_preferences_v1
      where user_id = v_auth_user
        and fragrance_id = p_fragrance_id
    )
    select jsonb_build_object(
      'fragrance_id', p_fragrance_id,
      'preference_state', coalesce((select preference_state from current_row), 'neutral'),
      'source', case
        when exists(select 1 from current_row) then (select source from current_row)
        else v_source
      end,
      'removed', not exists(select 1 from current_row),
      'updated_at', coalesce((select updated_at from current_row), now()),
      'last_event_at', coalesce((select last_event_at from current_row), now()),
      'liked_count', coalesce((select liked_count from preference_rollup), 0),
      'loved_count', coalesce((select loved_count from preference_rollup), 0),
      'not_for_me_count', coalesce((select not_for_me_count from preference_rollup), 0),
      'disliked_count', coalesce((select disliked_count from preference_rollup), 0),
      'preference_count', coalesce((select preference_count from preference_rollup), 0),
      'negative_count', coalesce((select negative_count from preference_rollup), 0)
    )
  );
end;
$function$;

grant execute on function public.set_user_fragrance_preference_v1(uuid, text, text) to authenticated, service_role;
