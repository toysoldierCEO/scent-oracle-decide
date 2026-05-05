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
  v_mode_stacks jsonb;
  v_alternates jsonb;
  v_hero_id uuid;
  v_main_row record;
  v_main_reason_chip jsonb := jsonb_build_object(
    'reason_chip_label', null,
    'reason_chip_explanation', null
  );
  v_reason text;
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
    select
      f.id as fragrance_id,
      f.name,
      f.brand,
      f.family_key,
      null::text as oracle_reason
    into v_main_row
    from public.user_collection uc
    join public.fragrances f
      on f.id = uc.fragrance_id
    where uc.user_id = p_user_id
      and uc.status in ('owned', 'signature')
      and (p_brand is null or f.brand = p_brand)
    order by md5(p_user_id::text || v_effective_wear_date || f.id::text)
    limit 1;
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
        when 'work' then 'Clean and controlled — stays professional.'
        when 'date' then 'Rich and magnetic — pulls people in.'
        when 'hangout' then 'Relaxed and effortless — easy to wear.'
        else 'Balanced for the day — works anywhere.'
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

  v_hero_id := nullif(v_oracle->'today_pick'->>'fragrance_id', '')::uuid;

  if v_hero_id is not null then
    v_mode_stacks := public.get_signed_in_layer_mode_stacks_v2(
      p_user_id::uuid,
      v_hero_id::uuid,
      v_effective_context::text,
      p_temperature::numeric,
      p_brand::text,
      v_effective_wear_date::text,
      3
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
      'preview_depth', '3',
      'overlap_policy', 'hard_primary_soft_preview_fallback'
    )
  );
end;
$function$;
