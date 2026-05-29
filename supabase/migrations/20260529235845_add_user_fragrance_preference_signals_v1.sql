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
