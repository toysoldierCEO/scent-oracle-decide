CREATE OR REPLACE FUNCTION public.get_main_reason_chip_v1(
  p_user_id uuid,
  p_fragrance_id uuid,
  p_context text DEFAULT NULL::text,
  p_temperature numeric DEFAULT NULL::numeric,
  p_wear_date text DEFAULT NULL::text,
  p_identity_similarity numeric DEFAULT NULL::numeric,
  p_weather_fit numeric DEFAULT NULL::numeric,
  p_rotation_fit numeric DEFAULT NULL::numeric,
  p_performance_fit numeric DEFAULT NULL::numeric
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
with params as (
  select
    lower(coalesce(nullif(p_context, ''), 'daily')) as context_key,
    coalesce(nullif(p_wear_date, ''), current_date::text)::date as wear_date
),
fragrance_row as (
  select
    f.id,
    coalesce(f.family_key, '') as family_key,
    coalesce(g.bright_dark, f.bright_dark, 0.5) as bright_dark,
    coalesce(g.dry_sweet, f.dry_sweet, 0.5) as dry_sweet,
    coalesce(g.clean_dirty, f.clean_dirty, 0.5) as clean_dirty,
    coalesce(g.fresh_warm, 0.5) as fresh_warm,
    coalesce(g.smooth_textured, f.smooth_textured, 0.5) as smooth_textured,
    coalesce(g.natural_synthetic, f.natural_synthetic, 0.5) as natural_synthetic,
    coalesce(g.intimate_projective, f.intimate_projective, 0.5) as intimate_projective,
    coalesce(g.familiar_avant, f.familiar_avant, 0.5) as familiar_avant,
    coalesce(g.longevity_score, f.longevity_score, 0.5) as longevity_score,
    coalesce(g.projection_score, f.projection_score, 0.5) as projection_score,
    coalesce(g.linear_evolutive, f.linear_evolutive, 0.5) as linear_evolutive,
    coalesce(g.soft_sharp, 0.5) as soft_sharp
  from public.fragrances f
  left join public.fragrance_genome g
    on g.fragrance_id = f.id
  where f.id = p_fragrance_id
),
identity_seed as (
  select
    s.user_id,
    s.bright_dark,
    s.dry_sweet,
    s.clean_dirty,
    s.natural_synthetic,
    s.linear_evolutive,
    s.intimate_projective,
    s.smooth_textured,
    s.familiar_avant
  from public.user_identity_seed_v3 s
  where s.user_id = p_user_id
),
recent_family_mix as (
  select
    coalesce(max(case when rf.family_key = fr.family_key then rf.wear_count else 0 end), 0) as current_family_recent_count,
    coalesce(max(rf.wear_count), 0) as max_recent_family_count
  from fragrance_row fr
  cross join params p
  left join lateral (
    select
      coalesce(f2.family_key, '') as family_key,
      count(*)::int as wear_count
    from public.wear_events we
    join public.fragrances f2
      on f2.id = we.fragrance_id
    where p_user_id is not null
      and we.user_id = p_user_id
      and we.wear_date >= (p.wear_date - 7)
      and we.wear_date < p.wear_date
    group by coalesce(f2.family_key, '')
  ) rf
    on true
),
signals as (
  select
    fr.*,
    exists (
      select 1
      from public.user_collection_canonical_product_v1 uc
      where uc.user_id = p_user_id
        and uc.fragrance_id = p_fragrance_id
        and uc.status = 'signature'
    ) as is_signature,
    coalesce(
      p_identity_similarity,
      case
        when seed.user_id is not null then
          1 - (
            abs(fr.bright_dark - seed.bright_dark) +
            abs(fr.dry_sweet - seed.dry_sweet) +
            abs(fr.clean_dirty - seed.clean_dirty) +
            abs(fr.natural_synthetic - seed.natural_synthetic) +
            abs(fr.linear_evolutive - seed.linear_evolutive) +
            abs(fr.intimate_projective - seed.intimate_projective) +
            abs(fr.smooth_textured - seed.smooth_textured) +
            abs(fr.familiar_avant - seed.familiar_avant)
          ) / 8.0
        else null::numeric
      end
    ) as identity_similarity,
    coalesce(
      p_weather_fit,
      public.get_weather_multiplier_v2(p_temperature, fr.family_key)
    ) as weather_fit,
    coalesce(
      p_rotation_fit,
      case
        when p_user_id is not null then public.get_rotation_multiplier_v3(p_user_id, p_fragrance_id)
        else null::numeric
      end,
      1.0
    ) as rotation_fit,
    coalesce(
      p_performance_fit,
      ((fr.longevity_score * 0.6) + (fr.projection_score * 0.4))
    ) as performance_fit,
    coalesce(rfm.current_family_recent_count, 0) as current_family_recent_count,
    coalesce(rfm.max_recent_family_count, 0) as max_recent_family_count
  from fragrance_row fr
  left join identity_seed seed
    on true
  left join recent_family_mix rfm
    on true
),
picked as (
  select
    case
      when is_signature
        and coalesce(identity_similarity, 0) >= 0.88
      then 'Signature'

      when p_temperature is not null
        and p_temperature <= 60
        and coalesce(weather_fit, 1.0) >= 1.05
        and (
          family_key in ('oud-amber', 'dark-leather', 'tobacco-boozy', 'sweet-gourmand')
          or fresh_warm >= 0.58
        )
      then 'Cool-Day Warmth'

      when p_temperature is not null
        and p_temperature >= 75
        and coalesce(weather_fit, 1.0) >= 1.05
        and (
          family_key in ('citrus-cologne', 'fresh-blue', 'woody-clean')
          or fresh_warm <= 0.42
        )
      then 'Warm-Day Fresh'

      when longevity_score >= 0.78
        and linear_evolutive >= 0.48
        and coalesce(performance_fit, 0) >= 0.70
        and (bright_dark < 0.72 or fresh_warm < 0.70)
      then 'All-Day Drydown'

      when projection_score <= 0.40
        and intimate_projective <= 0.42
      then 'Quiet Projection'

      when longevity_score >= 0.84
        and bright_dark >= 0.72
        and linear_evolutive >= 0.50
      then 'Deep Drydown'

      when smooth_textured >= 0.68
        and longevity_score >= 0.68
        and linear_evolutive >= 0.42
      then 'Smooth Drydown'

      when p_user_id is not null
        and coalesce(rotation_fit, 1.0) >= 0.95
        and max_recent_family_count >= 2
        and current_family_recent_count = 0
      then 'Rotation Balance'

      when smooth_textured >= 0.66
        and soft_sharp <= 0.40
      then 'Soft Edge'

      when bright_dark >= 0.78
        and smooth_textured >= 0.52
        and fresh_warm >= 0.60
      then 'Dark Polish'

      else null::text
    end as reason_chip_label
  from signals
)
select coalesce(
  (
    select jsonb_build_object(
      'reason_chip_label', p.reason_chip_label,
      'reason_chip_explanation',
        case p.reason_chip_label
          when 'Signature' then 'This sits close to the center of what you consistently reach for.'
          when 'Rain-Ready' then 'Damp air won’t flatten this one; it keeps its shape when the weather turns wet.'
          when 'Cool-Day Warmth' then 'Cooler air lets the warmer parts of this scent show up without feeling heavy.'
          when 'Warm-Day Fresh' then 'Heat can thicken denser scents, so this one wins by staying lighter and cleaner in warm air.'
          when 'All-Day Drydown' then 'The drydown is the strength here; it stays good long after the opening fades.'
          when 'Quiet Projection' then 'It stays present without filling the room, which is why it wins today.'
          when 'Rotation Balance' then 'You’ve leaned one way lately, and this restores balance without feeling random.'
          when 'Smooth Drydown' then 'The finish is soft and blended, which is the main reason it works today.'
          when 'Soft Edge' then 'There’s definition here, but it’s rounded enough to stay easy to wear.'
          when 'Dark Polish' then 'Richer darker notes win here, but they stay refined instead of rough.'
          when 'Deep Drydown' then 'The later hours are the payoff here; the base gets fuller and more resonant as it wears.'
          else null::text
        end
    )
    from picked p
  ),
  jsonb_build_object(
    'reason_chip_label', null,
    'reason_chip_explanation', null
  )
);
$function$;

CREATE OR REPLACE FUNCTION public.get_todays_oracle_v3(
  p_user_id uuid,
  p_temperature numeric,
  p_context text,
  p_brand text DEFAULT NULL::text,
  p_wear_date text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_wear_date date;
  v_context text := lower(coalesce(nullif(p_context, ''), 'daily'));
  v_candidate_limit integer := 12;
  v_main_row record;
  v_main_reason_chip jsonb := jsonb_build_object(
    'reason_chip_label', null,
    'reason_chip_explanation', null
  );

  v_layer_id uuid;
  v_layer_name text;
  v_layer_score numeric;
  v_layer_mode text;
  v_layer_application_style text;
  v_layer_spray_guidance text;
  v_layer_placement_guidance text;
  v_layer_picker_reason text;
  v_layer_why_it_works text;

  v_layer_brand text;
  v_layer_family text;
  v_has_layer boolean := false;

  v_alternates jsonb;
  v_reason text;
  v_ratio_hint text;

  v_auth_user uuid;
  v_guest_preview_user constant uuid := '330006e3-331c-4451-a321-d0e6f3ba454c'::uuid;
begin
  v_auth_user := auth.uid();

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user_id = v_auth_user)
    or ((auth.role() = 'anon' or v_auth_user is null) and p_user_id = v_guest_preview_user)
  ) then
    raise exception 'Not authorized for requested user_id';
  end if;

  v_wear_date := coalesce(nullif(p_wear_date, '')::date, current_date);

  select *
  into v_main_row
  from public.get_oracle_main_pick_v2(
    p_user_id,
    p_temperature,
    v_context::text,
    p_brand,
    v_wear_date::text
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
      and uc.status in ('owned','signature')
      and (p_brand is null or f.brand = p_brand)
    order by md5(p_user_id::text || v_wear_date::text || f.id::text)
    limit 1;
  end if;

  if v_main_row is null then
    return jsonb_build_object(
      'today_pick', null,
      'layer', null,
      'alternates', '[]'::jsonb
    );
  end if;

  v_main_reason_chip := public.get_main_reason_chip_v1(
    p_user_id,
    v_main_row.fragrance_id,
    v_context::text,
    p_temperature,
    v_wear_date::text
  );

  select
    l.layer_fragrance_id,
    l.layer_name,
    l.layer_score,
    l.layer_mode,
    l.application_style,
    l.spray_guidance,
    l.placement_guidance,
    l.reason,
    l.why_it_works
  into
    v_layer_id,
    v_layer_name,
    v_layer_score,
    v_layer_mode,
    v_layer_application_style,
    v_layer_spray_guidance,
    v_layer_placement_guidance,
    v_layer_picker_reason,
    v_layer_why_it_works
  from public.get_layer_for_pick_v1(
    p_user_id,
    v_main_row.fragrance_id,
    p_temperature,
    v_context::text,
    p_brand,
    v_wear_date::text
  ) l
  limit 1;

  v_has_layer := found and v_layer_id is not null;

  if v_has_layer then
    select
      f.brand,
      f.family_key
    into
      v_layer_brand,
      v_layer_family
    from public.fragrances f
    where f.id = v_layer_id;

    v_ratio_hint :=
      case
        when lower(coalesce(v_layer_spray_guidance, '')) like '2 sprays anchor / 1 spray layer%' then '2:1'
        when lower(coalesce(v_layer_spray_guidance, '')) like '1 spray each%' then '1:1'
        when lower(coalesce(v_layer_spray_guidance, '')) like '1 spray anchor / 2 sprays layer%' then '1:2'
        else null
      end;
  else
    v_layer_brand := null;
    v_layer_family := null;
    v_ratio_hint := null;
    v_layer_application_style := null;
    v_layer_placement_guidance := null;
    v_layer_spray_guidance := null;
    v_layer_mode := null;
    v_layer_score := null;
    v_layer_picker_reason := null;
    v_layer_why_it_works := null;
  end if;

  with ranked as (
    select
      r.fragrance_id,
      f.name,
      f.brand,
      f.family_key,
      r.rank_position
    from public.get_todays_pick_with_alternates_v12(
      p_user_id,
      p_temperature,
      v_context::text,
      p_brand,
      v_candidate_limit::integer,
      v_wear_date::text
    ) r
    join public.user_collection uc
      on uc.user_id = p_user_id
     and uc.fragrance_id = r.fragrance_id
     and uc.status in ('owned','signature')
    join public.fragrances f
      on f.id = r.fragrance_id
    where r.fragrance_id <> v_main_row.fragrance_id
      and not (
        lower(coalesce(f.name, '')) = lower(coalesce(v_main_row.name, ''))
        and lower(coalesce(f.brand, '')) = lower(coalesce(v_main_row.brand, ''))
      )
  ),
  safe_pick as (
    select *
    from ranked
    order by
      case when coalesce(family_key, '') = coalesce(v_main_row.family_key, '') then 0 else 1 end,
      rank_position,
      name
    limit 1
  ),
  bridge_pick as (
    select *
    from ranked
    where fragrance_id not in (select fragrance_id from safe_pick)
    order by
      case when coalesce(family_key, '') <> coalesce(v_main_row.family_key, '') then 0 else 1 end,
      case when v_has_layer and coalesce(family_key, '') = coalesce(v_layer_family, '') then 1 else 0 end,
      rank_position,
      name
    limit 1
  ),
  wild_pick as (
    select *
    from ranked
    where fragrance_id not in (
      select fragrance_id from safe_pick
      union
      select fragrance_id from bridge_pick
    )
    order by
      case
        when coalesce(family_key, '') <> coalesce(v_main_row.family_key, '')
         and coalesce(family_key, '') <> coalesce((select family_key from safe_pick limit 1), '')
         and coalesce(family_key, '') <> coalesce((select family_key from bridge_pick limit 1), '')
         and (not v_has_layer or coalesce(family_key, '') <> coalesce(v_layer_family, ''))
        then 0 else 1
      end,
      rank_position,
      name
    limit 1
  ),
  alt_rows as (
    select
      1 as sort_order,
      s.fragrance_id,
      s.name,
      s.brand,
      s.family_key,
      public.get_oracle_alternate_reason_v1(
        'safe'::text,
        v_context::text,
        v_main_row.family_key,
        s.family_key,
        coalesce(s.family_key, '') = coalesce(v_main_row.family_key, '')
      ) as reason
    from safe_pick s

    union all

    select
      2 as sort_order,
      b.fragrance_id,
      b.name,
      b.brand,
      b.family_key,
      public.get_oracle_alternate_reason_v1(
        'bridge'::text,
        v_context::text,
        v_main_row.family_key,
        b.family_key,
        false
      ) as reason
    from bridge_pick b

    union all

    select
      3 as sort_order,
      w.fragrance_id,
      w.name,
      w.brand,
      w.family_key,
      public.get_oracle_alternate_reason_v1(
        'wild'::text,
        v_context::text,
        v_main_row.family_key,
        w.family_key,
        false
      ) as reason
    from wild_pick w
  )
  select
    jsonb_agg(
      jsonb_build_object(
        'fragrance_id', a.fragrance_id,
        'name', a.name,
        'brand', a.brand,
        'family', a.family_key,
        'reason', a.reason
      )
      order by a.sort_order
    )
  into v_alternates
  from alt_rows a;

  v_reason := coalesce(
    v_main_row.oracle_reason,
    case v_context
      when 'work' then 'Clean and controlled — stays professional.'
      when 'date' then 'Rich and magnetic — pulls people in.'
      when 'hangout' then 'Relaxed and effortless — easy to wear.'
      else 'Balanced for the day — works anywhere.'
    end
  );

  return jsonb_build_object(
    'today_pick', jsonb_build_object(
      'fragrance_id', v_main_row.fragrance_id,
      'name', v_main_row.name,
      'family', coalesce(v_main_row.family_key, ''),
      'reason', v_reason,
      'brand', v_main_row.brand,
      'reason_chip_label', v_main_reason_chip->>'reason_chip_label',
      'reason_chip_explanation', v_main_reason_chip->>'reason_chip_explanation'
    ),
    'layer',
      case when v_has_layer then jsonb_build_object(
        'fragrance_id', v_layer_id,
        'name', v_layer_name,
        'family', v_layer_family,
        'brand', v_layer_brand,
        'reason', coalesce(v_layer_picker_reason, 'Balanced layer — support-first pairing.'),
        'ratio_hint', v_ratio_hint,
        'application_style', v_layer_application_style,
        'placement_hint', v_layer_placement_guidance,
        'spray_guidance', v_layer_spray_guidance,
        'layer_mode', v_layer_mode,
        'layer_score', v_layer_score,
        'why_it_works', v_layer_why_it_works
      ) else null end,
    'alternates', coalesce(v_alternates, '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_home_card_queue_v1(
  p_user uuid,
  p_context text DEFAULT 'daily'::text,
  p_temperature numeric DEFAULT NULL::numeric,
  p_brand text DEFAULT NULL::text,
  p_wear_date text DEFAULT NULL::text,
  p_limit integer DEFAULT 24
)
RETURNS TABLE(
  queue_rank integer,
  fragrance_id uuid,
  name text,
  brand text,
  family_key text,
  source text,
  why_this text,
  collection_status text,
  is_in_collection boolean,
  preview jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_auth_user uuid;
  v_effective_context text;
  v_effective_wear_date text;
  v_fetch_limit integer;
begin
  v_auth_user := auth.uid();

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user = v_auth_user)
  ) then
    raise exception 'Access denied: p_user must match auth.uid() for home queue.';
  end if;

  v_effective_context := lower(coalesce(nullif(p_context, ''), 'daily'));
  v_effective_wear_date := coalesce(nullif(p_wear_date, ''), current_date::text);
  v_fetch_limit := greatest(least(coalesce(p_limit, 24) * 2, 36), 18);

  return query
  with collection_state as (
    select distinct on (uc.fragrance_id)
      uc.fragrance_id,
      uc.status
    from public.user_collection_canonical_product_v1 uc
    where uc.user_id = p_user
      and uc.status in ('signature', 'owned')
    order by
      uc.fragrance_id,
      case uc.status
        when 'signature' then 0
        when 'owned' then 1
        else 9
      end
  ),

  scored_raw as (
    select
      r.fragrance_id as raw_fragrance_id,
      r.rank_position,
      r.reason
    from public.get_todays_pick_with_alternates_v11(
      p_user,
      p_temperature,
      v_effective_context,
      p_brand,
      v_fetch_limit
    ) r
  ),

  redirected_scored as (
    select
      sr.raw_fragrance_id,
      coalesce(rp.canonical_id, sr.raw_fragrance_id) as canonical_fragrance_id,
      sr.rank_position,
      sr.reason
    from scored_raw sr
    left join public.fragrance_identity_redirects_product_v1 rp
      on rp.original_id = sr.raw_fragrance_id
  ),

  today_pick as (
    select
      rs.canonical_fragrance_id as today_pick_id
    from redirected_scored rs
    order by rs.rank_position asc
    limit 1
  ),

  scored_queue as (
    select distinct on (rs.canonical_fragrance_id)
      rs.canonical_fragrance_id as queue_fragrance_id,
      f.name as queue_name,
      f.brand as queue_brand,
      f.family_key as queue_family_key,
      cs.status as queue_collection_status,
      rs.rank_position as queue_rank_position,
      coalesce(rs.reason, 'Home-ranked scent for the current context.') as queue_why_this,
      'scored'::text as queue_source
    from redirected_scored rs
    join collection_state cs
      on cs.fragrance_id = rs.canonical_fragrance_id
    join public.fragrances f
      on f.id = rs.canonical_fragrance_id
    where (p_brand is null or f.brand = p_brand)
      and rs.canonical_fragrance_id not in (select tp.today_pick_id from today_pick tp)
    order by
      rs.canonical_fragrance_id,
      rs.rank_position asc
  ),

  fallback_pool as (
    select
      cs.fragrance_id as fallback_fragrance_id,
      f.name as fallback_name,
      f.brand as fallback_brand,
      f.family_key as fallback_family_key,
      cs.status as fallback_collection_status,

      case
        when v_effective_context = 'work' then
          case
            when coalesce(f.family_key, '') = 'woody-clean' then 5
            when coalesce(f.family_key, '') = 'fresh-blue' then 4
            when coalesce(f.family_key, '') = 'citrus-cologne' then 3
            when coalesce(f.family_key, '') = 'sweet-gourmand' then 1
            when coalesce(f.family_key, '') in ('oud-amber','dark-leather','tobacco-boozy') then 0
            else 2
          end
        when v_effective_context = 'date' then
          case
            when coalesce(f.family_key, '') in ('oud-amber','dark-leather','tobacco-boozy') then 5
            when coalesce(f.family_key, '') = 'sweet-gourmand' then 4
            when coalesce(f.family_key, '') = 'woody-clean' then 3
            when coalesce(f.family_key, '') in ('fresh-blue','citrus-cologne') then 1
            else 2
          end
        when v_effective_context = 'hangout' then
          case
            when coalesce(f.family_key, '') in ('fresh-blue','citrus-cologne') then 5
            when coalesce(f.family_key, '') = 'woody-clean' then 4
            when coalesce(f.family_key, '') = 'sweet-gourmand' then 3
            when coalesce(f.family_key, '') in ('oud-amber','dark-leather','tobacco-boozy') then 2
            else 1
          end
        else
          case
            when coalesce(f.family_key, '') in ('oud-amber','woody-clean','dark-leather','tobacco-boozy','fresh-blue','sweet-gourmand','citrus-cologne') then 3
            else 1
          end
      end as fallback_context_family_rank,

      case
        when cs.status = 'signature' then 0
        when cs.status = 'owned' then 1
        else 9
      end as fallback_status_rank
    from collection_state cs
    join public.fragrances f
      on f.id = cs.fragrance_id
    where (p_brand is null or f.brand = p_brand)
      and cs.fragrance_id not in (select tp.today_pick_id from today_pick tp)
      and not exists (
        select 1
        from scored_queue sq
        where sq.queue_fragrance_id = cs.fragrance_id
      )
  ),

  fallback_queue as (
    select
      fp.fallback_fragrance_id,
      fp.fallback_name,
      fp.fallback_brand,
      fp.fallback_family_key,
      fp.fallback_collection_status,
      ('Collection fallback for Home queue — ' || v_effective_context || ' context.')::text as fallback_why_this,
      'fallback'::text as fallback_source,
      fp.fallback_context_family_rank,
      fp.fallback_status_rank
    from fallback_pool fp
  ),

  combined as (
    select
      sq.queue_fragrance_id as combined_fragrance_id,
      sq.queue_name as combined_name,
      sq.queue_brand as combined_brand,
      sq.queue_family_key as combined_family_key,
      sq.queue_collection_status as combined_collection_status,
      sq.queue_why_this as combined_why_this,
      sq.queue_source as combined_source,
      0 as combined_source_rank,
      case sq.queue_collection_status
        when 'signature' then 0
        when 'owned' then 1
        else 9
      end as combined_status_rank,
      999 as combined_context_family_rank,
      sq.queue_rank_position as combined_rank_position,
      md5(p_user::text || v_effective_wear_date || sq.queue_fragrance_id::text) as combined_stable_key
    from scored_queue sq

    union all

    select
      fq.fallback_fragrance_id as combined_fragrance_id,
      fq.fallback_name as combined_name,
      fq.fallback_brand as combined_brand,
      fq.fallback_family_key as combined_family_key,
      fq.fallback_collection_status as combined_collection_status,
      fq.fallback_why_this as combined_why_this,
      fq.fallback_source as combined_source,
      1 as combined_source_rank,
      fq.fallback_status_rank as combined_status_rank,
      fq.fallback_context_family_rank as combined_context_family_rank,
      null::integer as combined_rank_position,
      md5(p_user::text || v_effective_wear_date || fq.fallback_fragrance_id::text) as combined_stable_key
    from fallback_queue fq
  ),

  ranked as (
    select
      row_number() over (
        order by
          c.combined_source_rank asc,
          c.combined_status_rank asc,
          c.combined_rank_position asc nulls last,
          c.combined_context_family_rank desc,
          c.combined_stable_key asc
      )::int as ranked_queue_rank,
      c.combined_fragrance_id,
      c.combined_name,
      c.combined_brand,
      c.combined_family_key,
      c.combined_source,
      c.combined_why_this,
      c.combined_collection_status,
      true as ranked_is_in_collection,
      public.get_main_reason_chip_v1(
        p_user,
        c.combined_fragrance_id,
        v_effective_context,
        p_temperature,
        v_effective_wear_date
      ) as ranked_reason_chip,
      jsonb_build_object(
        'fragrance_id', c.combined_fragrance_id,
        'name', c.combined_name,
        'brand', c.combined_brand,
        'family_key', c.combined_family_key,
        'source', c.combined_source,
        'why_this', c.combined_why_this,
        'collection_status', c.combined_collection_status,
        'is_in_collection', true
      ) as ranked_preview_base
    from combined c
  )

  select
    r.ranked_queue_rank,
    r.combined_fragrance_id,
    r.combined_name,
    r.combined_brand,
    r.combined_family_key,
    r.combined_source,
    r.combined_why_this,
    r.combined_collection_status,
    r.ranked_is_in_collection,
    r.ranked_preview_base
      || jsonb_build_object(
        'reason_chip_label', r.ranked_reason_chip->>'reason_chip_label',
        'reason_chip_explanation', r.ranked_reason_chip->>'reason_chip_explanation'
      ) as preview
  from ranked r
  order by r.ranked_queue_rank
  limit greatest(coalesce(p_limit, 24), 1);

end;
$function$;

CREATE OR REPLACE FUNCTION public.get_alternates_for_card_v1(
  p_user uuid,
  p_fragrance_id uuid,
  p_context text DEFAULT 'daily'::text,
  p_temperature numeric DEFAULT NULL::numeric,
  p_brand text DEFAULT NULL::text,
  p_wear_date text DEFAULT NULL::text
)
RETURNS TABLE(
  bucket text,
  sort_order integer,
  fragrance_id uuid,
  name text,
  brand text,
  family text,
  reason text,
  preview jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_auth_user uuid;
begin
  v_auth_user := auth.uid();

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user = v_auth_user)
  ) then
    raise exception 'Access denied: p_user must match auth.uid() for alternates lookup.';
  end if;

  return query
  with anchor as (
    select
      f.id,
      f.name,
      f.brand,
      f.family_key,
      coalesce(g.bright_dark, 0.5) as bright_dark,
      coalesce(g.dry_sweet, 0.5) as dry_sweet,
      coalesce(g.clean_dirty, 0.5) as clean_dirty,
      coalesce(g.airy_dense, 0.5) as airy_dense,
      coalesce(g.fresh_warm, 0.5) as fresh_warm,
      coalesce(g.smooth_textured, 0.5) as smooth_textured,
      coalesce(g.natural_synthetic, 0.5) as natural_synthetic,
      coalesce(g.linear_evolutive, 0.5) as linear_evolutive,
      coalesce(g.intimate_projective, 0.5) as intimate_projective,
      coalesce(g.familiar_avant, 0.5) as familiar_avant,
      coalesce(g.crisp_creamy, 0.5) as crisp_creamy,
      coalesce(g.projection_score, 0.5) as projection_score,
      coalesce(g.longevity_score, 0.5) as longevity_score
    from public.fragrances f
    left join public.fragrance_genome g
      on g.fragrance_id = f.id
    where f.id = p_fragrance_id
  ),

  wardrobe as (
    select distinct on (lower(f.name), lower(f.brand))
      f.id,
      f.name,
      f.brand,
      f.family_key,
      f.notes,
      f.accords,
      uc.status,
      coalesce(g.bright_dark, 0.5) as bright_dark,
      coalesce(g.dry_sweet, 0.5) as dry_sweet,
      coalesce(g.clean_dirty, 0.5) as clean_dirty,
      coalesce(g.airy_dense, 0.5) as airy_dense,
      coalesce(g.fresh_warm, 0.5) as fresh_warm,
      coalesce(g.smooth_textured, 0.5) as smooth_textured,
      coalesce(g.natural_synthetic, 0.5) as natural_synthetic,
      coalesce(g.linear_evolutive, 0.5) as linear_evolutive,
      coalesce(g.intimate_projective, 0.5) as intimate_projective,
      coalesce(g.familiar_avant, 0.5) as familiar_avant,
      coalesce(g.crisp_creamy, 0.5) as crisp_creamy,
      coalesce(g.projection_score, 0.5) as projection_score,
      coalesce(g.longevity_score, 0.5) as longevity_score
    from public.user_collection uc
    join public.fragrances f
      on f.id = uc.fragrance_id
    left join public.fragrance_genome g
      on g.fragrance_id = f.id
    where uc.user_id = p_user
      and uc.status in ('signature','owned','liked')
      and f.id <> p_fragrance_id
      and (p_brand is null or f.brand = p_brand)
    order by
      lower(f.name),
      lower(f.brand),
      case when uc.status = 'signature' then 0 else 1 end,
      f.id
  ),

  base as (
    select
      a.id as anchor_id,
      a.family_key as anchor_family,
      w.id as alt_fragrance_id,
      w.name as alt_name,
      w.brand as alt_brand,
      coalesce(w.family_key, 'unknown') as alt_family,
      w.notes as alt_notes,
      w.accords as alt_accords,

      1 - (
        abs(w.bright_dark - a.bright_dark) +
        abs(w.dry_sweet - a.dry_sweet) +
        abs(w.clean_dirty - a.clean_dirty) +
        abs(w.natural_synthetic - a.natural_synthetic) +
        abs(w.linear_evolutive - a.linear_evolutive) +
        abs(w.intimate_projective - a.intimate_projective) +
        abs(w.smooth_textured - a.smooth_textured) +
        abs(w.familiar_avant - a.familiar_avant)
      ) / 8.0 as structural_similarity,

      (
        abs(w.bright_dark - a.bright_dark) +
        abs(w.dry_sweet - a.dry_sweet) +
        abs(w.clean_dirty - a.clean_dirty) +
        abs(w.fresh_warm - a.fresh_warm)
      ) / 4.0 as contrast_distance,

      greatest(
        0::numeric,
        1 - (
          abs(w.projection_score - a.projection_score) +
          abs(w.longevity_score - a.longevity_score)
        ) / 2.0
      ) as performance_fit,

      case
        when coalesce(w.family_key, '') = coalesce(a.family_key, '') then 1
        else 0
      end as same_family
    from anchor a
    cross join wardrobe w
  ),

  safe_candidates as (
    select
      'safe'::text as out_bucket,
      1 as out_sort_order,
      b.alt_fragrance_id,
      b.alt_name,
      b.alt_brand,
      b.alt_family,
      (
        (b.structural_similarity * 0.62) +
        (b.performance_fit * 0.18) +
        case
          when b.same_family = 1 then 0.18
          when b.anchor_family in ('oud-amber','dark-leather','tobacco-boozy')
           and b.alt_family in ('oud-amber','dark-leather','tobacco-boozy') then 0.08
          when b.anchor_family = 'sweet-gourmand'
           and b.alt_family = 'sweet-gourmand' then 0.10
          else 0
        end
        - (b.contrast_distance * 0.22)
      ) as bucket_score,
      case
        when b.same_family = 1 then 'Safe pick — closest fit in the same lane.'
        when b.anchor_family in ('oud-amber','dark-leather','tobacco-boozy')
         and b.alt_family in ('oud-amber','dark-leather','tobacco-boozy') then 'Safe pick — richer fallback that still stays on-profile.'
        when b.anchor_family = 'sweet-gourmand'
         and b.alt_family = 'sweet-gourmand' then 'Safe pick — closest fit in the same lane.'
        else 'Safe pick — easy fallback that still stays on-profile.'
      end as out_reason,
      jsonb_build_object(
        'notes', coalesce(b.alt_notes, '{}'::text[]),
        'accords', coalesce(b.alt_accords, '{}'::text[])
      ) as out_preview
    from base b
  ),

  safe_pick as (
    select *
    from safe_candidates sc
    order by sc.bucket_score desc, sc.alt_name
    limit 1
  ),

  bridge_candidates as (
    select
      'bridge'::text as out_bucket,
      2 as out_sort_order,
      b.alt_fragrance_id,
      b.alt_name,
      b.alt_brand,
      b.alt_family,
      (
        (b.structural_similarity * 0.32) +
        (b.performance_fit * 0.14) +
        (greatest(0::numeric, 1 - abs(b.contrast_distance - 0.28) * 2.4) * 0.20) +
        case
          when b.anchor_family in ('oud-amber','dark-leather','tobacco-boozy')
           and b.alt_family in ('woody-clean','fresh-blue','citrus-cologne') then 0.20
          when b.anchor_family in ('oud-amber','dark-leather','tobacco-boozy')
           and b.alt_family = 'sweet-gourmand' then 0.10
          when b.anchor_family = 'sweet-gourmand'
           and b.alt_family in ('woody-clean','fresh-blue','citrus-cologne') then 0.18
          when b.anchor_family in ('fresh-blue','citrus-cologne','woody-clean')
           and b.alt_family in ('oud-amber','dark-leather','tobacco-boozy') then 0.16
          when b.alt_family <> b.anchor_family then 0.08
          else -0.06
        end
      ) as bucket_score,
      case
        when b.anchor_family in ('oud-amber','dark-leather','tobacco-boozy')
         and b.alt_family in ('woody-clean','fresh-blue','citrus-cologne') then 'Bridge pick — cleaner reset from your darker lane.'
        when b.anchor_family = 'sweet-gourmand'
         and b.alt_family in ('woody-clean','fresh-blue','citrus-cologne') then 'Bridge pick — fresher step out without losing the dessert core.'
        else 'Bridge pick — alternate lane that still fits cleanly.'
      end as out_reason,
      jsonb_build_object(
        'notes', coalesce(b.alt_notes, '{}'::text[]),
        'accords', coalesce(b.alt_accords, '{}'::text[])
      ) as out_preview
    from base b
    where not exists (
      select 1
      from safe_pick s
      where s.alt_fragrance_id = b.alt_fragrance_id
    )
  ),

  bridge_pool as (
    select *
    from bridge_candidates bc
    order by bc.bucket_score desc, bc.alt_name
    limit 4
  ),

  bridge_pick as (
    select *
    from bridge_pool bp
    order by md5(
      coalesce(p_wear_date, '') || '|bridge|' ||
      (select b.anchor_id::text from base b limit 1) || '|' ||
      bp.alt_fragrance_id::text
    )
    limit 1
  ),

  wild_candidates as (
    select
      'wild'::text as out_bucket,
      3 as out_sort_order,
      b.alt_fragrance_id,
      b.alt_name,
      b.alt_brand,
      b.alt_family,
      (
        (b.contrast_distance * 0.34) +
        (b.structural_similarity * 0.14) +
        (b.performance_fit * 0.10) +
        case
          when b.alt_family <> b.anchor_family then 0.20
          else -0.12
        end +
        case
          when b.anchor_family in ('oud-amber','dark-leather','tobacco-boozy')
           and b.alt_family in ('fresh-blue','citrus-cologne','woody-clean') then 0.12
          when b.anchor_family = 'sweet-gourmand'
           and b.alt_family in ('fresh-blue','citrus-cologne','woody-clean') then 0.10
          when b.alt_family in ('citrus-cologne','fresh-blue','dark-leather','oud-amber','sweet-gourmand') then 0.06
          else 0
        end
      ) as bucket_score,
      case
        when b.anchor_family in ('oud-amber','dark-leather','tobacco-boozy')
         and b.alt_family in ('fresh-blue','citrus-cologne') then 'Wild card — bright shock against your darker lane.'
        when b.anchor_family = 'sweet-gourmand'
         and b.alt_family in ('fresh-blue','citrus-cologne') then 'Wild card — brightest wearable shift from your sweeter lane.'
        else 'Wild card — most distinct wearable shift from your main lane.'
      end as out_reason,
      jsonb_build_object(
        'notes', coalesce(b.alt_notes, '{}'::text[]),
        'accords', coalesce(b.alt_accords, '{}'::text[])
      ) as out_preview
    from base b
    where not exists (
      select 1
      from safe_pick s
      where s.alt_fragrance_id = b.alt_fragrance_id
    )
      and not exists (
        select 1
        from bridge_pick br
        where br.alt_fragrance_id = b.alt_fragrance_id
      )
  ),

  wild_pool as (
    select *
    from wild_candidates wc
    order by wc.bucket_score desc, wc.alt_name
    limit 5
  ),

  wild_pick as (
    select *
    from wild_pool wp
    order by md5(
      coalesce(p_wear_date, '') || '|wild|' ||
      (select b.anchor_id::text from base b limit 1) || '|' ||
      wp.alt_fragrance_id::text
    )
    limit 1
  ),

  final_rows as (
    select
      sp.out_bucket as final_bucket,
      sp.out_sort_order as final_sort_order,
      sp.alt_fragrance_id as final_fragrance_id,
      sp.alt_name as final_name,
      sp.alt_brand as final_brand,
      sp.alt_family as final_family,
      sp.out_reason as final_reason,
      sp.out_preview as final_preview
    from safe_pick sp

    union all

    select
      bp.out_bucket,
      bp.out_sort_order,
      bp.alt_fragrance_id,
      bp.alt_name,
      bp.alt_brand,
      bp.alt_family,
      bp.out_reason,
      bp.out_preview
    from bridge_pick bp

    union all

    select
      wp.out_bucket,
      wp.out_sort_order,
      wp.alt_fragrance_id,
      wp.alt_name,
      wp.alt_brand,
      wp.alt_family,
      wp.out_reason,
      wp.out_preview
    from wild_pick wp
  )

  select
    fr.final_bucket,
    fr.final_sort_order,
    fr.final_fragrance_id,
    fr.final_name,
    fr.final_brand,
    fr.final_family,
    fr.final_reason,
    fr.final_preview
      || jsonb_build_object(
        'reason_chip_label', rc.reason_chip->>'reason_chip_label',
        'reason_chip_explanation', rc.reason_chip->>'reason_chip_explanation'
      ) as preview
  from final_rows fr
  cross join lateral (
    select public.get_main_reason_chip_v1(
      p_user,
      fr.final_fragrance_id,
      p_context,
      p_temperature,
      p_wear_date
    ) as reason_chip
  ) rc
  order by fr.final_sort_order;

end;
$function$;

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
  decorated as (
    select
      r.payload,
      public.get_main_reason_chip_v1(
        null::uuid,
        nullif(r.payload #>> '{main_bundle,hero,fragrance_id}', '')::uuid,
        r.context_key,
        p_temperature,
        r.wear_date_text
      ) as hero_reason_chip
    from resolved r
  )
  select
    jsonb_set(
      jsonb_set(
        d.payload,
        '{main_bundle,hero}',
        coalesce(d.payload #> '{main_bundle,hero}', '{}'::jsonb)
          || jsonb_build_object(
            'reason_chip_label', d.hero_reason_chip->>'reason_chip_label',
            'reason_chip_explanation', d.hero_reason_chip->>'reason_chip_explanation'
          ),
        true
      ),
      '{today_pick}',
      coalesce(d.payload->'today_pick', '{}'::jsonb)
        || jsonb_build_object(
          'reason_chip_label', d.hero_reason_chip->>'reason_chip_label',
          'reason_chip_explanation', d.hero_reason_chip->>'reason_chip_explanation'
        ),
      true
    )
  from decorated d;
$function$;
