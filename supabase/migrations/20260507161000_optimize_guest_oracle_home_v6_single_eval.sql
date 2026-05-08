create or replace function public.get_guest_oracle_home_v6(
  p_temperature numeric default 72,
  p_context text default 'daily'::text,
  p_brand text default null::text,
  p_wear_date text default null::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_context_key text := lower(coalesce(nullif(p_context, ''), 'daily'));
  v_wear_date_text text := coalesce(nullif(p_wear_date, ''), current_date::text);
  v_wear_date date := v_wear_date_text::date;
  v_payload jsonb := '{}'::jsonb;
  v_hero_fragrance_id uuid;
  v_hero_bottle_norm_key text;
  v_hero_name text;
  v_hero_brand text;
  v_resolved_hero_fragrance_id uuid;
  v_hero_reason_chip jsonb := jsonb_build_object(
    'reason_chip_label', null,
    'reason_chip_explanation', null
  );
begin
  v_payload := public.get_guest_oracle_home_v6_base_before_hero_rotation(
    p_temperature,
    p_context,
    p_brand,
    p_wear_date
  );

  if coalesce(v_payload->>'card_type', '') = 'standard' then
    v_payload := public.apply_guest_standard_context_hero_v1(
      v_payload,
      coalesce(v_payload->>'resolved_standard_style_key', v_payload->>'base_style_key'),
      v_context_key,
      v_wear_date
    );
  end if;

  v_hero_fragrance_id := nullif(v_payload #>> '{main_bundle,hero,fragrance_id}', '')::uuid;
  v_hero_bottle_norm_key := nullif(v_payload #>> '{main_bundle,hero,bottle_norm_key}', '');
  v_hero_name := nullif(v_payload #>> '{main_bundle,hero,name}', '');
  v_hero_brand := nullif(v_payload #>> '{main_bundle,hero,brand}', '');
  v_resolved_hero_fragrance_id := v_hero_fragrance_id;

  if v_resolved_hero_fragrance_id is null and v_hero_bottle_norm_key is not null then
    select gsrm.fragrance_id
    into v_resolved_hero_fragrance_id
    from public.guest_style_role_matrix_v1 gsrm
    where gsrm.bottle_norm_key = v_hero_bottle_norm_key
      and gsrm.fragrance_id is not null
    order by
      gsrm.role_rank nulls last,
      gsrm.style_key,
      gsrm.role_key
    limit 1;
  end if;

  if v_resolved_hero_fragrance_id is null and v_hero_name is not null and v_hero_brand is not null then
    select
      case
        when count(distinct f.id) = 1 then (array_agg(f.id order by f.id))[1]
        else null::uuid
      end
    into v_resolved_hero_fragrance_id
    from public.fragrances f
    where f.name = v_hero_name
      and f.brand = v_hero_brand;
  end if;

  if v_resolved_hero_fragrance_id is null and v_hero_name is not null and v_hero_brand is not null then
    select public.pick_canonical_fragrance_v1(
      public.norm_identity_name_v1(v_hero_name),
      public.norm_identity_brand_v1(v_hero_brand)
    )
    into v_resolved_hero_fragrance_id;
  end if;

  if v_resolved_hero_fragrance_id is not null then
    v_hero_reason_chip := public.get_main_reason_chip_v1(
      null::uuid,
      v_resolved_hero_fragrance_id,
      v_context_key,
      p_temperature,
      v_wear_date_text
    );
  end if;

  return jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          v_payload,
          '{main_bundle,hero,fragrance_id}',
          coalesce(to_jsonb(v_resolved_hero_fragrance_id), 'null'::jsonb),
          true
        ),
        '{main_bundle,hero,reason_chip_label}',
        coalesce(to_jsonb(v_hero_reason_chip->>'reason_chip_label'), 'null'::jsonb),
        true
      ),
      '{main_bundle,hero,reason_chip_explanation}',
      coalesce(to_jsonb(v_hero_reason_chip->>'reason_chip_explanation'), 'null'::jsonb),
      true
    ),
    '{today_pick}',
    coalesce(v_payload->'today_pick', '{}'::jsonb)
      || jsonb_build_object(
        'fragrance_id', v_resolved_hero_fragrance_id,
        'reason_chip_label', v_hero_reason_chip->>'reason_chip_label',
        'reason_chip_explanation', v_hero_reason_chip->>'reason_chip_explanation'
      ),
    true
  );
end;
$function$;
