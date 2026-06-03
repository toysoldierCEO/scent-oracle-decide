create or replace function public.get_signed_in_card_contract_v7(
  p_user_id uuid,
  p_temperature numeric default null::numeric,
  p_context text default 'daily'::text,
  p_brand text default null::text,
  p_wear_date text default null::text,
  p_queue_limit integer default 24
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
  v_effective_limit integer := greatest(least(coalesce(p_queue_limit, 24), 48), 1);

  v_oracle jsonb := jsonb_build_object(
    'today_pick', null,
    'layer', null,
    'alternates', '[]'::jsonb
  );
  v_queue jsonb;
  v_queue_first jsonb;
  v_mode_stacks jsonb;
  v_alternates jsonb;
  v_hero_id uuid;
  v_main_row record;
  v_default_layer jsonb;
  v_default_layer_mode text := 'balance';
  v_primary_resolver_produced_hero boolean := false;
  v_queue_fallback_used boolean := false;
  v_hero_source text := 'none';
  v_queue_count integer := 0;
  v_main_reason_chip jsonb := jsonb_build_object(
    'reason_chip_label', null,
    'reason_chip_explanation', null
  );
  v_reason text;
  v_card_unavailable jsonb := null;
begin
  v_auth_user := auth.uid();

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user_id must match auth.uid() for signed-in card contract v7.';
  end if;

  select *
  into v_main_row
  from public.get_oracle_main_pick_v2(
    p_user_id::uuid,
    p_temperature::numeric,
    v_effective_context::text,
    p_brand::text,
    v_effective_wear_date::text
  )
  limit 1;

  if v_main_row is null then
    v_primary_resolver_produced_hero := false;
  else
    v_primary_resolver_produced_hero := true;
    v_hero_source := 'primary';
  end if;

  if v_main_row is not null then
    v_main_reason_chip := public.get_main_reason_chip_v1(
      p_user_id::uuid,
      v_main_row.fragrance_id::uuid,
      v_effective_context::text,
      p_temperature::numeric,
      v_effective_wear_date::text
    );

    v_reason := coalesce(
      v_main_row.oracle_reason,
      case v_effective_context
        when 'work' then 'Clean and controlled - stays professional.'
        when 'date' then 'Rich and magnetic - pulls people in.'
        when 'hangout' then 'Relaxed and effortless - easy to wear.'
        else 'Balanced for the day - works anywhere.'
      end
    );

    v_oracle := jsonb_build_object(
      'today_pick',
      jsonb_build_object(
        'fragrance_id', v_main_row.fragrance_id,
        'name', v_main_row.name,
        'family', coalesce(v_main_row.family_key, ''),
        'reason', v_reason,
        'brand', v_main_row.brand,
        'reason_chip_label', v_main_reason_chip->>'reason_chip_label',
        'reason_chip_explanation', v_main_reason_chip->>'reason_chip_explanation'
      ),
      'layer', null,
      'alternates', '[]'::jsonb
    );
  end if;

  v_queue := public.get_signed_in_queue_json_v1(
    p_user_id::uuid,
    v_effective_context::text,
    p_temperature::numeric,
    p_brand::text,
    v_effective_wear_date::text,
    v_effective_limit::integer
  );
  v_queue_count := case
    when jsonb_typeof(coalesce(v_queue, '[]'::jsonb)) = 'array'
      then jsonb_array_length(coalesce(v_queue, '[]'::jsonb))
    else 0
  end;

  if nullif(v_oracle->'today_pick'->>'fragrance_id', '') is null
     and jsonb_typeof(coalesce(v_queue, '[]'::jsonb)) = 'array'
     and jsonb_array_length(coalesce(v_queue, '[]'::jsonb)) > 0 then
    v_queue_first := v_queue->0;

    if nullif(v_queue_first->>'fragrance_id', '') is not null then
      v_oracle := jsonb_build_object(
        'today_pick',
        jsonb_build_object(
          'fragrance_id', v_queue_first->>'fragrance_id',
          'name', coalesce(v_queue_first->>'name', v_queue_first #>> '{preview,name}', ''),
          'family', coalesce(v_queue_first->>'family', v_queue_first #>> '{preview,family_key}', ''),
          'reason', coalesce(v_queue_first->>'why_this', v_queue_first #>> '{preview,why_this}', 'Ready for this context.'),
          'brand', coalesce(v_queue_first->>'brand', v_queue_first #>> '{preview,brand}', ''),
          'reason_chip_label', v_queue_first #>> '{preview,reason_chip_label}',
          'reason_chip_explanation', v_queue_first #>> '{preview,reason_chip_explanation}'
        ),
        'layer', null,
        'alternates', '[]'::jsonb
      );
      v_queue_fallback_used := true;
      v_hero_source := 'queue_fallback';
    end if;
  end if;

  v_hero_id := nullif(v_oracle->'today_pick'->>'fragrance_id', '')::uuid;

  if v_hero_id is not null then
    select jsonb_build_object(
      'fragrance_id', x.layer_fragrance_id,
      'name', x.layer_name,
      'family', coalesce(f.family_key, ''),
      'brand', coalesce(f.brand, ''),
      'reason', x.reason,
      'ratio_hint',
        case
          when lower(coalesce(x.spray_guidance, '')) like '2 sprays anchor / 1 spray layer%' then '2:1'
          when lower(coalesce(x.spray_guidance, '')) like '1 spray each%' then '1:1'
          when lower(coalesce(x.spray_guidance, '')) like '1 spray anchor / 2 sprays layer%' then '1:2'
          when lower(coalesce(x.spray_guidance, '')) like '% - 2:1.%' then '2:1'
          when lower(coalesce(x.spray_guidance, '')) like '% - 1:1.%' then '1:1'
          when lower(coalesce(x.spray_guidance, '')) like '% - 1:2.%' then '1:2'
          else null
        end,
      'application_style', x.application_style,
      'placement_hint', x.placement_guidance,
      'spray_guidance', x.spray_guidance,
      'layer_mode', x.layer_mode,
      'layer_score', x.layer_score,
      'why_it_works', x.why_it_works
    )
    into v_default_layer
    from public.get_layer_for_pick_v1(
      p_user_id::uuid,
      v_hero_id::uuid,
      p_temperature::numeric,
      v_effective_context::text,
      p_brand::text,
      v_effective_wear_date::text
    ) x
    left join public.fragrances f
      on f.id = x.layer_fragrance_id
    limit 1;

    v_default_layer_mode := coalesce(nullif(v_default_layer->>'layer_mode', ''), 'balance');

    v_oracle := jsonb_set(
      v_oracle,
      '{layer}',
      coalesce(v_default_layer, 'null'::jsonb),
      true
    );

    v_mode_stacks := jsonb_build_object(
      'default_mode', v_default_layer_mode,
      'preview_depth', 0,
      'overlap_policy', 'deferred_signed_in_home_initial_load',
      'deferred', true,
      'deferred_reason', 'mode_stacks_deferred_for_initial_home_contract',
      'modes', '{}'::jsonb
    );

    with a as (
      select
        alt.bucket,
        alt.sort_order,
        alt.fragrance_id,
        alt.name,
        alt.brand,
        alt.family,
        alt.reason,
        alt.preview
      from public.get_alternates_for_card_v1(
        p_user_id::uuid,
        v_hero_id::uuid,
        v_effective_context::text,
        p_temperature::numeric,
        p_brand::text,
        v_effective_wear_date::text
      ) alt
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bucket', a.bucket,
          'sort_order', a.sort_order,
          'fragrance_id', a.fragrance_id,
          'name', a.name,
          'brand', a.brand,
          'family', a.family,
          'family_key', a.family,
          'reason', a.reason,
          'preview', coalesce(a.preview, '{}'::jsonb),
          'tokens',
            case
              when a.fragrance_id is not null
                then coalesce(public.get_fragrance_card_tokens_v2(a.fragrance_id::uuid, 4), '[]'::jsonb)
              else '[]'::jsonb
            end
        )
        order by a.sort_order
      ),
      '[]'::jsonb
    )
    into v_alternates
    from a;
  else
    v_mode_stacks := '{}'::jsonb;
    v_alternates := '[]'::jsonb;
    v_card_unavailable := jsonb_build_object(
      'is_unavailable', true,
      'reason_code', 'no_card_for_context',
      'message', 'No card is ready for this context yet. Try another context or check back after the next refresh.',
      'context', v_effective_context,
      'wear_date', v_effective_wear_date,
      'source', 'get_signed_in_card_contract_v7'
    );
  end if;

  return (
    public.build_signed_in_card_contract_v7(
      v_oracle,
      v_queue,
      v_mode_stacks,
      v_alternates,
      v_effective_context::text,
      p_temperature::numeric,
      p_brand::text,
      v_effective_wear_date::text
    )
    ||
    jsonb_build_object(
      'card_contract_version', 'signed_in_card_contract_v7',
      'surface_type', 'signed_in',
      'preview_depth', '0',
      'overlap_policy', 'deferred_signed_in_home_initial_load',
      'layer_modes_deferred', true,
      'card_unavailable', v_card_unavailable,
      'requested_context', v_effective_context,
      'context_key', v_effective_context,
      'wear_date', v_effective_wear_date,
      'hero_source', v_hero_source,
      'primary_resolver_produced_hero', v_primary_resolver_produced_hero,
      'queue_fallback_used', v_queue_fallback_used,
      'queue_count', v_queue_count
    )
  );
end;
$function$;

notify pgrst, 'reload schema';
