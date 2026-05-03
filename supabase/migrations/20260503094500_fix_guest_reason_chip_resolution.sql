CREATE OR REPLACE FUNCTION public.get_guest_oracle_home_v6(
  p_temperature numeric DEFAULT 72,
  p_context text DEFAULT 'daily'::text,
  p_brand text DEFAULT NULL::text,
  p_wear_date text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with normalized as (
    select
      lower(coalesce(nullif(p_context, ''), 'daily')) as context_key,
      coalesce(nullif(p_wear_date, ''), current_date::text) as wear_date_text,
      coalesce(nullif(p_wear_date, ''), current_date::text)::date as wear_date
  ),
  base as (
    select
      n.*,
      public.get_guest_oracle_home_v6_base_before_hero_rotation(
        p_temperature,
        p_context,
        p_brand,
        p_wear_date
      ) as j
    from normalized n
  ),
  resolved as (
    select
      b.context_key,
      b.wear_date_text,
      b.wear_date,
      case
        when b.j->>'card_type' = 'standard' then
          public.apply_guest_standard_context_hero_v1(
            b.j,
            coalesce(b.j->>'resolved_standard_style_key', b.j->>'base_style_key'),
            b.context_key,
            b.wear_date
          )
        else b.j
      end as payload
    from base b
  ),
  hero_identity as (
    select
      r.payload,
      r.context_key,
      r.wear_date_text,
      nullif(r.payload #>> '{main_bundle,hero,fragrance_id}', '')::uuid as hero_fragrance_id,
      nullif(r.payload #>> '{main_bundle,hero,bottle_norm_key}', '') as hero_bottle_norm_key,
      nullif(r.payload #>> '{main_bundle,hero,name}', '') as hero_name,
      nullif(r.payload #>> '{main_bundle,hero,brand}', '') as hero_brand
    from resolved r
  ),
  canonicalized as (
    select
      h.payload,
      h.context_key,
      h.wear_date_text,
      coalesce(
        h.hero_fragrance_id,
        bottle_key_match.fragrance_id,
        exact_match.fragrance_id,
        normalized_match.fragrance_id
      ) as resolved_hero_fragrance_id
    from hero_identity h
    left join lateral (
      select gsrm.fragrance_id
      from public.guest_style_role_matrix_v1 gsrm
      where h.hero_bottle_norm_key is not null
        and gsrm.bottle_norm_key = h.hero_bottle_norm_key
        and gsrm.fragrance_id is not null
      order by
        gsrm.role_rank nulls last,
        gsrm.style_key,
        gsrm.role_key
      limit 1
    ) bottle_key_match
      on true
    left join lateral (
      select
        case
          when count(distinct f.id) = 1 then (array_agg(f.id order by f.id))[1]
          else null::uuid
        end as fragrance_id
      from public.fragrances f
      where h.hero_name is not null
        and h.hero_brand is not null
        and f.name = h.hero_name
        and f.brand = h.hero_brand
    ) exact_match
      on true
    left join lateral (
      select public.pick_canonical_fragrance_v1(
        public.norm_identity_name_v1(h.hero_name),
        public.norm_identity_brand_v1(h.hero_brand)
      ) as fragrance_id
      where h.hero_name is not null
        and h.hero_brand is not null
    ) normalized_match
      on true
  ),
  decorated as (
    select
      c.payload,
      c.resolved_hero_fragrance_id,
      public.get_main_reason_chip_v1(
        null::uuid,
        c.resolved_hero_fragrance_id,
        c.context_key,
        p_temperature,
        c.wear_date_text
      ) as hero_reason_chip
    from canonicalized c
  )
  select
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            d.payload,
            '{main_bundle,hero,fragrance_id}',
            coalesce(to_jsonb(d.resolved_hero_fragrance_id), 'null'::jsonb),
            true
          ),
          '{main_bundle,hero,reason_chip_label}',
          coalesce(to_jsonb(d.hero_reason_chip->>'reason_chip_label'), 'null'::jsonb),
          true
        ),
        '{main_bundle,hero,reason_chip_explanation}',
        coalesce(to_jsonb(d.hero_reason_chip->>'reason_chip_explanation'), 'null'::jsonb),
        true
      ),
      '{today_pick}',
      coalesce(d.payload->'today_pick', '{}'::jsonb)
        || jsonb_build_object(
          'fragrance_id', d.resolved_hero_fragrance_id,
          'reason_chip_label', d.hero_reason_chip->>'reason_chip_label',
          'reason_chip_explanation', d.hero_reason_chip->>'reason_chip_explanation'
        ),
      true
    )
  from decorated d;
$function$;
