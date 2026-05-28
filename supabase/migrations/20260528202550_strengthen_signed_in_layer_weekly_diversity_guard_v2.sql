create or replace function public.get_signed_in_recent_layer_rotation_exclusions_v1(
  p_user_id uuid,
  p_context text default 'daily'::text,
  p_temperature numeric default null::numeric,
  p_brand text default null::text,
  p_wear_date text default null::text,
  p_lookback_days integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid;
  v_effective_context text := lower(coalesce(nullif(p_context, ''), 'daily'));
  v_effective_wear_date date := coalesce(nullif(p_wear_date, '')::date, current_date);
  v_effective_lookback integer := greatest(least(coalesce(p_lookback_days, 3), 7), 0);

  v_adjacent_day uuid[] := '{}'::uuid[];
  v_recent_window uuid[] := '{}'::uuid[];
  v_weekly_window uuid[] := '{}'::uuid[];

  v_offset integer;
  v_history_date text;
  v_history_main_row record;
  v_history_queue jsonb;
  v_history_hero_id uuid;
  v_history_layer_id uuid;
begin
  v_auth_user := auth.uid();

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user_id must match auth.uid() for signed-in recent layer exclusions.';
  end if;

  if v_effective_lookback = 0 then
    return jsonb_build_object(
      'adjacent_day', '[]'::jsonb,
      'recent_window', '[]'::jsonb,
      'weekly_window', '[]'::jsonb,
      'lookback_days', 0
    );
  end if;

  for v_offset in 1..v_effective_lookback
  loop
    v_history_date := (v_effective_wear_date - v_offset)::text;
    v_history_hero_id := null;
    v_history_queue := null;
    v_history_layer_id := null;

    select *
    into v_history_main_row
    from public.get_oracle_main_pick_v2(
      p_user_id::uuid,
      p_temperature::numeric,
      v_effective_context::text,
      p_brand::text,
      v_history_date::text
    )
    limit 1;

    if v_history_main_row is not null then
      v_history_hero_id := v_history_main_row.fragrance_id::uuid;
    end if;

    if v_history_hero_id is null then
      v_history_queue := public.get_signed_in_queue_json_v1(
        p_user_id::uuid,
        v_effective_context::text,
        p_temperature::numeric,
        p_brand::text,
        v_history_date::text,
        1
      );
      v_history_hero_id := nullif(v_history_queue->0->>'fragrance_id', '')::uuid;
    end if;

    continue when v_history_hero_id is null;

    select x.layer_fragrance_id
    into v_history_layer_id
    from public.get_layer_for_card_mode_v1(
      p_user_id::uuid,
      v_history_hero_id::uuid,
      'balance'::text,
      v_effective_context::text,
      p_temperature::numeric,
      p_brand::text,
      v_history_date::text,
      '{}'::uuid[]
    ) as x
    limit 1;

    continue when v_history_layer_id is null;

    if v_offset = 1
       and not (v_history_layer_id = any(coalesce(v_adjacent_day, '{}'::uuid[]))) then
      v_adjacent_day := array_append(v_adjacent_day, v_history_layer_id);
    end if;

    if v_offset <= least(v_effective_lookback, 3)
       and not (v_history_layer_id = any(coalesce(v_recent_window, '{}'::uuid[]))) then
      v_recent_window := array_append(v_recent_window, v_history_layer_id);
    end if;

    if not (v_history_layer_id = any(coalesce(v_weekly_window, '{}'::uuid[]))) then
      v_weekly_window := array_append(v_weekly_window, v_history_layer_id);
    end if;
  end loop;

  return jsonb_build_object(
    'adjacent_day', coalesce(to_jsonb(v_adjacent_day), '[]'::jsonb),
    'recent_window', coalesce(to_jsonb(v_recent_window), '[]'::jsonb),
    'weekly_window', coalesce(to_jsonb(v_weekly_window), '[]'::jsonb),
    'lookback_days', v_effective_lookback
  );
end;
$function$;

notify pgrst, 'reload schema';

create or replace function public.get_signed_in_layer_mode_stacks_v2(
  p_user_id uuid,
  p_fragrance_id uuid,
  p_context text default 'daily'::text,
  p_temperature numeric default null::numeric,
  p_brand text default null::text,
  p_wear_date text default null::text,
  p_depth integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid;
  v_effective_context text := lower(coalesce(nullif(p_context, ''), 'daily'));
  v_effective_wear_date text := coalesce(nullif(p_wear_date, ''), current_date::text);
  v_effective_depth integer := greatest(least(coalesce(p_depth, 3), 3), 1);

  v_base_modes jsonb;
  v_default_mode text := 'balance';

  v_mode text;
  v_slot integer;

  v_candidate jsonb;
  v_candidate_id uuid;

  v_layers jsonb;
  v_modes jsonb := '{}'::jsonb;

  v_local_exclude uuid[] := '{}'::uuid[];
  v_requested_exclude uuid[] := '{}'::uuid[];
  v_global_primary_exclude uuid[] := '{}'::uuid[];
  v_global_preview_exclude uuid[] := '{}'::uuid[];
  v_primary_recent_requested_exclude uuid[] := '{}'::uuid[];
  v_primary_adjacent_requested_exclude uuid[] := '{}'::uuid[];

  v_recent_rotation_exclusions jsonb := jsonb_build_object(
    'adjacent_day', '[]'::jsonb,
    'recent_window', '[]'::jsonb,
    'weekly_window', '[]'::jsonb
  );
  v_recent_primary_hard_exclude uuid[] := '{}'::uuid[];
  v_recent_primary_soft_exclude uuid[] := '{}'::uuid[];
  v_recent_primary_weekly_exclude uuid[] := '{}'::uuid[];
  v_recent_preview_soft_exclude uuid[] := '{}'::uuid[];
begin
  v_auth_user := auth.uid();

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user_id must match auth.uid() for signed-in mode stacks v2.';
  end if;

  select public.get_layer_card_modes_v1(
    p_user_id::uuid,
    p_fragrance_id::uuid,
    v_effective_context::text,
    p_temperature::numeric,
    p_brand::text,
    v_effective_wear_date::text
  )
  into v_base_modes;

  v_default_mode := coalesce(nullif(v_base_modes->>'default_mode', ''), 'balance');

  v_recent_rotation_exclusions := public.get_signed_in_recent_layer_rotation_exclusions_v1(
    p_user_id::uuid,
    v_effective_context::text,
    p_temperature::numeric,
    p_brand::text,
    v_effective_wear_date::text,
    case when v_effective_context = 'daily' then 7 else 3 end
  );

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into v_recent_primary_hard_exclude
  from jsonb_array_elements_text(coalesce(v_recent_rotation_exclusions->'adjacent_day', '[]'::jsonb)) as t(value);

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into v_recent_primary_soft_exclude
  from jsonb_array_elements_text(coalesce(v_recent_rotation_exclusions->'recent_window', '[]'::jsonb)) as t(value);

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into v_recent_primary_weekly_exclude
  from jsonb_array_elements_text(
    case
      when v_effective_context = 'daily'
        then coalesce(v_recent_rotation_exclusions->'weekly_window', '[]'::jsonb)
      else '[]'::jsonb
    end
  ) as t(value);

  v_recent_preview_soft_exclude := v_recent_primary_soft_exclude;

  foreach v_mode in array array['balance','bold','smooth','wild']::text[]
  loop
    v_layers := '[]'::jsonb;
    v_local_exclude := '{}'::uuid[];

    for v_slot in 1..v_effective_depth
    loop
      if v_slot = 1 then
        v_primary_adjacent_requested_exclude :=
          array_cat(
            array_cat(
              coalesce(v_global_primary_exclude, '{}'::uuid[]),
              coalesce(v_local_exclude, '{}'::uuid[])
            ),
            coalesce(v_recent_primary_hard_exclude, '{}'::uuid[])
          );

        v_primary_recent_requested_exclude :=
          array_cat(
            v_primary_adjacent_requested_exclude,
            coalesce(v_recent_primary_soft_exclude, '{}'::uuid[])
          );

        v_requested_exclude :=
          array_cat(
            v_primary_recent_requested_exclude,
            coalesce(v_recent_primary_weekly_exclude, '{}'::uuid[])
          );

        select to_jsonb(x)
        into v_candidate
        from public.get_layer_for_card_mode_v1(
          p_user_id::uuid,
          p_fragrance_id::uuid,
          v_mode::text,
          v_effective_context::text,
          p_temperature::numeric,
          p_brand::text,
          v_effective_wear_date::text,
          v_requested_exclude
        ) as x
        limit 1;

        if v_candidate is null
           or nullif(v_candidate->>'layer_fragrance_id', '') is null then
          select to_jsonb(x)
          into v_candidate
          from public.get_layer_for_card_mode_v1(
            p_user_id::uuid,
            p_fragrance_id::uuid,
            v_mode::text,
            v_effective_context::text,
            p_temperature::numeric,
            p_brand::text,
            v_effective_wear_date::text,
            v_primary_recent_requested_exclude
          ) as x
          limit 1;
        end if;

        if v_candidate is null
           or nullif(v_candidate->>'layer_fragrance_id', '') is null then
          select to_jsonb(x)
          into v_candidate
          from public.get_layer_for_card_mode_v1(
            p_user_id::uuid,
            p_fragrance_id::uuid,
            v_mode::text,
            v_effective_context::text,
            p_temperature::numeric,
            p_brand::text,
            v_effective_wear_date::text,
            v_primary_adjacent_requested_exclude
          ) as x
          limit 1;
        end if;
      else
        v_requested_exclude :=
          array_cat(
            array_cat(
              coalesce(v_global_preview_exclude, '{}'::uuid[]),
              coalesce(v_local_exclude, '{}'::uuid[])
            ),
            coalesce(v_recent_preview_soft_exclude, '{}'::uuid[])
          );

        select to_jsonb(x)
        into v_candidate
        from public.get_layer_for_card_mode_v1(
          p_user_id::uuid,
          p_fragrance_id::uuid,
          v_mode::text,
          v_effective_context::text,
          p_temperature::numeric,
          p_brand::text,
          v_effective_wear_date::text,
          v_requested_exclude
        ) as x
        limit 1;
      end if;

      if v_candidate is null
         or nullif(v_candidate->>'layer_fragrance_id', '') is null then
        select to_jsonb(x)
        into v_candidate
        from public.get_layer_for_card_mode_v1(
          p_user_id::uuid,
          p_fragrance_id::uuid,
          v_mode::text,
          v_effective_context::text,
          p_temperature::numeric,
          p_brand::text,
          v_effective_wear_date::text,
          coalesce(v_local_exclude, '{}'::uuid[])
        ) as x
        limit 1;
      end if;

      exit when v_candidate is null
        or nullif(v_candidate->>'layer_fragrance_id', '') is null;

      v_candidate_id := (v_candidate->>'layer_fragrance_id')::uuid;

      exit when v_candidate_id = any(coalesce(v_local_exclude, '{}'::uuid[]));

      v_layers := v_layers || jsonb_build_array(
        public.normalize_signed_in_layer_mode_entry_v3(v_candidate)
      );

      if not (v_candidate_id = any(coalesce(v_local_exclude, '{}'::uuid[]))) then
        v_local_exclude := array_append(v_local_exclude, v_candidate_id);
      end if;

      if not (v_candidate_id = any(coalesce(v_global_preview_exclude, '{}'::uuid[]))) then
        v_global_preview_exclude := array_append(v_global_preview_exclude, v_candidate_id);
      end if;

      if v_slot = 1
         and not (v_candidate_id = any(coalesce(v_global_primary_exclude, '{}'::uuid[]))) then
        v_global_primary_exclude := array_append(v_global_primary_exclude, v_candidate_id);
      end if;
    end loop;

    v_modes := v_modes || jsonb_build_object(
      v_mode,
      jsonb_build_object(
        'mode', v_mode,
        'layers', coalesce(v_layers, '[]'::jsonb),
        'returned_count', jsonb_array_length(coalesce(v_layers, '[]'::jsonb))
      )
    );
  end loop;

  return jsonb_build_object(
    'default_mode', v_default_mode,
    'preview_depth', to_jsonb(v_effective_depth),
    'overlap_policy', to_jsonb('hard_adjacent_soft_recent_soft_weekly_fallback'::text),
    'modes', v_modes
  );
end;
$function$;
