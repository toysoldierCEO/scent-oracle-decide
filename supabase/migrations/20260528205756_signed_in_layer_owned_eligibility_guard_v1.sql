create or replace function public.get_layer_for_card_mode_v1(
  p_user uuid,
  p_fragrance_id uuid,
  p_mode text default 'balance'::text,
  p_context text default 'daily'::text,
  p_temperature numeric default null::numeric,
  p_brand text default null::text,
  p_wear_date text default null::text,
  p_exclude_fragrance_ids uuid[] default '{}'::uuid[]
)
returns table(
  anchor_fragrance_id uuid,
  layer_fragrance_id uuid,
  layer_name text,
  layer_brand text,
  layer_family text,
  layer_score numeric,
  requested_mode text,
  ratio_hint text,
  application_style text,
  placement_hint text,
  spray_guidance text,
  reason text,
  why_it_works text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid;
  v_mode text;
  v_context text;
  v_guest_preview_user constant uuid := '330006e3-331c-4451-a321-d0e6f3ba454c'::uuid;
begin
  v_auth_user := auth.uid();
  v_mode := lower(coalesce(nullif(p_mode, ''), 'balance'));
  v_context := lower(coalesce(nullif(p_context, ''), 'daily'));

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user = v_auth_user)
    or ((auth.role() = 'anon' or v_auth_user is null) and p_user = v_guest_preview_user)
  ) then
    raise exception 'Access denied: p_user must match auth.uid() for mood layer lookup.';
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
      coalesce(g.longevity_score, 0.5) as longevity_score,
      coalesce(g.top_weight, 0.33) as top_weight,
      coalesce(g.base_weight, 0.33) as base_weight
    from public.fragrances f
    left join public.fragrance_genome g
      on g.fragrance_id = f.id
    where f.id = p_fragrance_id
  ),

  wardrobe as (
    select
      f.id,
      f.name,
      f.brand,
      f.family_key,
      ucei.effective_status as status,
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
      coalesce(g.longevity_score, 0.5) as longevity_score,
      coalesce(g.top_weight, 0.33) as top_weight,
      coalesce(g.base_weight, 0.33) as base_weight
    from public.user_collection_effective_items_v2 ucei
    join public.fragrances f
      on f.id = ucei.representative_fragrance_id
    left join public.fragrance_genome g
      on g.fragrance_id = f.id
    where ucei.user_id = p_user
      and ucei.effective_status in ('signature', 'owned')
      and coalesce(ucei.has_disliked, false) = false
      and f.id <> p_fragrance_id
      and not (f.id = any(coalesce(p_exclude_fragrance_ids, '{}'::uuid[])))
      and (p_brand is null or f.brand = p_brand)
    order by
      lower(f.name),
      lower(f.brand),
      case when ucei.effective_status = 'signature' then 0 else 1 end,
      f.id
  ),

  scored_base as (
    select
      a.id as anchor_fragrance_id,
      a.name as anchor_name,
      a.brand as anchor_brand,
      a.family_key as anchor_family,

      w.id as layer_fragrance_id,
      w.name as layer_name,
      w.brand as layer_brand,
      w.family_key as layer_family,

      a.projection_score as anchor_proj,
      w.projection_score as layer_proj,
      a.longevity_score as anchor_lon,
      w.longevity_score as layer_lon,

      a.airy_dense as anchor_density,
      w.airy_dense as layer_density,
      a.top_weight as anchor_top,
      w.top_weight as layer_top,
      a.base_weight as anchor_base,
      w.base_weight as layer_base,
      a.smooth_textured as anchor_smooth,
      w.smooth_textured as layer_smooth,
      a.crisp_creamy as anchor_creamy,
      w.crisp_creamy as layer_creamy,

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

      case
        when v_context = 'daily' then 0.28
        when v_context = 'work' then 0.18
        when v_context = 'hangout' then 0.30
        when v_context = 'date' then 0.38
        else 0.28
      end as target_contrast,

      case
        when coalesce(w.family_key, '') = coalesce(a.family_key, '') then 1
        else 0
      end as same_family,

      ((a.projection_score * 0.70) + (a.longevity_score * 0.30)) as anchor_strength,
      ((w.projection_score * 0.70) + (w.longevity_score * 0.30)) as layer_strength,

      (
        a.top_weight +
        ((1 - a.base_weight) * 0.35) +
        ((1 - a.airy_dense) * 0.15)
      ) as anchor_opening_score,

      (
        w.top_weight +
        ((1 - w.base_weight) * 0.35) +
        ((1 - w.airy_dense) * 0.15)
      ) as layer_opening_score,

      (
        a.base_weight +
        (a.longevity_score * 0.35) +
        (a.airy_dense * 0.15)
      ) as anchor_drydown_score,

      (
        w.base_weight +
        (w.longevity_score * 0.35) +
        (w.airy_dense * 0.15)
      ) as layer_drydown_score,

      greatest(
        0::numeric,
        least(
          1::numeric,
          (abs(w.projection_score - a.projection_score) * 0.45) +
          (abs(w.airy_dense - a.airy_dense) * 0.20) +
          (
            (
              abs(w.bright_dark - a.bright_dark) +
              abs(w.dry_sweet - a.dry_sweet) +
              abs(w.clean_dirty - a.clean_dirty) +
              abs(w.fresh_warm - a.fresh_warm)
            ) / 4.0
          ) * 0.35
        )
      ) as masking_risk_score,

      case
        when v_context = 'daily' then
          case
            when a.family_key in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and w.family_key in ('woody-clean', 'fresh-blue', 'citrus-cologne') then 'lift'
            when a.family_key in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and w.family_key = 'sweet-gourmand' then 'smooth'
            when a.family_key in ('woody-clean', 'fresh-blue', 'citrus-cologne')
                 and w.family_key in ('oud-amber', 'dark-leather', 'tobacco-boozy', 'sweet-gourmand') then 'deepen'
            when w.smooth_textured > a.smooth_textured + 0.05
                 or w.crisp_creamy > a.crisp_creamy + 0.05 then 'smooth'
            else 'balance'
          end
        when v_context = 'work' then
          case
            when w.family_key in ('woody-clean', 'fresh-blue', 'citrus-cologne')
                 and w.projection_score <= a.projection_score + 0.05 then 'lift'
            when w.smooth_textured > a.smooth_textured + 0.04
                 or w.crisp_creamy > a.crisp_creamy + 0.05 then 'smooth'
            else 'balance'
          end
        when v_context = 'hangout' then
          case
            when w.family_key in ('fresh-blue', 'citrus-cologne')
                 and w.airy_dense <= a.airy_dense + 0.03 then 'lift'
            when w.family_key = 'sweet-gourmand' then 'smooth'
            when w.airy_dense > a.airy_dense + 0.08
                 or w.projection_score > a.projection_score + 0.08 then 'deepen'
            else 'balance'
          end
        when v_context = 'date' then
          case
            when a.family_key in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and w.family_key = 'sweet-gourmand' then 'smooth'
            when a.family_key in ('woody-clean', 'fresh-blue', 'citrus-cologne')
                 and w.family_key in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 'deepen'
            when a.family_key in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and w.family_key in ('woody-clean', 'fresh-blue', 'citrus-cologne') then 'lift'
            when w.smooth_textured > a.smooth_textured + 0.05 then 'smooth'
            else 'balance'
          end
        else 'balance'
      end as projected_layer_mode
    from anchor a
    cross join wardrobe w
  ),

  scored as (
    select
      sb.*,

      greatest(
        0::numeric,
        least(
          1::numeric,
          1 - abs(sb.contrast_distance - sb.target_contrast) * 2.2
        )
      ) as contrast_fit,

      case
        when sb.projected_layer_mode = 'lift' then
          greatest(
            0::numeric,
            least(
              1::numeric,
              0.55
              + ((sb.layer_top - sb.anchor_top) * 1.2)
              - (greatest(0::numeric, sb.layer_proj - sb.anchor_proj) * 0.5)
            )
          )
        when sb.projected_layer_mode = 'smooth' then
          greatest(
            0::numeric,
            least(
              1::numeric,
              0.55
              + ((sb.layer_smooth - sb.anchor_smooth) * 0.9)
              + ((sb.layer_creamy - sb.anchor_creamy) * 0.6)
            )
          )
        when sb.projected_layer_mode = 'deepen' then
          greatest(
            0::numeric,
            least(
              1::numeric,
              0.50
              + ((sb.layer_base - sb.anchor_base) * 1.0)
              + ((sb.layer_density - sb.anchor_density) * 0.6)
            )
          )
        else
          greatest(
            0::numeric,
            least(
              1::numeric,
              0.60
              + (sb.structural_similarity * 0.30)
              - (abs(sb.layer_proj - sb.anchor_proj) * 0.25)
            )
          )
      end as phase_support,

      case
        when v_context = 'daily' then
          case
            when sb.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and sb.layer_family = 'woody-clean' then 0.18
            when sb.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and sb.layer_family in ('fresh-blue', 'citrus-cologne') then 0.14
            when sb.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and sb.layer_family = 'sweet-gourmand' then 0.09
            when sb.anchor_family = 'woody-clean'
                 and sb.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy', 'sweet-gourmand') then 0.14
            when sb.anchor_family in ('fresh-blue', 'citrus-cologne')
                 and sb.layer_family = 'woody-clean' then 0.16
            when sb.anchor_family in ('fresh-blue', 'citrus-cologne')
                 and sb.layer_family in ('oud-amber', 'sweet-gourmand') then 0.10
            when sb.anchor_family = 'sweet-gourmand'
                 and sb.layer_family in ('woody-clean', 'fresh-blue', 'citrus-cologne') then 0.15
            when sb.layer_family <> sb.anchor_family then 0.03
            else 0
          end
        when v_context = 'work' then
          case
            when sb.layer_family = 'woody-clean' then 0.18
            when sb.layer_family = 'fresh-blue' then 0.14
            when sb.layer_family = 'citrus-cologne' then 0.12
            when sb.layer_family = 'sweet-gourmand' then 0.03
            when sb.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then -0.06
            else 0
          end
        when v_context = 'hangout' then
          case
            when sb.layer_family in ('fresh-blue', 'citrus-cologne') then 0.14
            when sb.layer_family = 'sweet-gourmand' then 0.13
            when sb.layer_family = 'woody-clean' then 0.08
            when sb.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.03
            else 0
          end
        when v_context = 'date' then
          case
            when sb.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and sb.layer_family = 'sweet-gourmand' then 0.18
            when sb.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and sb.layer_family = 'woody-clean' then 0.14
            when sb.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and sb.layer_family in ('fresh-blue', 'citrus-cologne') then 0.08
            when sb.anchor_family in ('woody-clean', 'fresh-blue', 'citrus-cologne')
                 and sb.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.18
            when sb.anchor_family in ('woody-clean', 'fresh-blue', 'citrus-cologne')
                 and sb.layer_family = 'sweet-gourmand' then 0.14
            when sb.anchor_family = 'sweet-gourmand'
                 and sb.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.15
            when sb.layer_family <> sb.anchor_family then 0.04
            else 0
          end
        else 0
      end as family_bonus,

      case
        when v_context = 'daily' then
          case
            when sb.layer_lon between 0.50 and 0.85 then 0.03
            when sb.layer_lon < 0.38 then -0.04
            else 0
          end
        when v_context = 'work' then
          case
            when sb.layer_proj between 0.35 and 0.65
                 and sb.layer_lon between 0.45 and 0.80 then 0.08
            when sb.layer_proj between 0.66 and 0.78 then 0.04
            when sb.layer_proj > 0.82 then -0.08
            when sb.layer_proj < 0.30 then -0.04
            else 0
          end
        when v_context = 'hangout' then
          case
            when sb.layer_proj between 0.45 and 0.75 then 0.06
            when sb.layer_proj > 0.88 then -0.04
            else 0
          end
        when v_context = 'date' then
          case
            when sb.layer_proj between 0.45 and 0.80
                 and sb.layer_lon >= 0.55 then 0.09
            when sb.layer_proj < 0.35 then -0.05
            else 0
          end
        else 0
      end as performance_bonus,

      case
        when v_context = 'daily' then
          case
            when sb.projected_layer_mode = 'lift' then 0.07
            when sb.projected_layer_mode = 'smooth' then 0.06
            when sb.projected_layer_mode = 'deepen' then 0.05
            else 0.04
          end
        when v_context = 'work' then
          case
            when sb.projected_layer_mode = 'lift' then 0.08
            when sb.projected_layer_mode = 'smooth' then 0.06
            when sb.projected_layer_mode = 'balance' then 0.03
            else -0.02
          end
        when v_context = 'hangout' then
          case
            when sb.projected_layer_mode = 'lift' then 0.07
            when sb.projected_layer_mode = 'smooth' then 0.07
            when sb.projected_layer_mode = 'balance' then 0.04
            else 0
          end
        when v_context = 'date' then
          case
            when sb.projected_layer_mode = 'deepen' then 0.09
            when sb.projected_layer_mode = 'smooth' then 0.09
            when sb.projected_layer_mode = 'lift' then 0.05
            else 0.04
          end
        else 0.04
      end as mode_bonus,

      case
        when v_context = 'work' and sb.same_family = 1 then 0.03
        when sb.same_family = 1 then 0.06
        else 0
      end as same_family_penalty
    from scored_base sb
  ),

  ranked as (
    select
      s.*,

      case
        when s.layer_strength > s.anchor_strength + 0.08 then 'driver'
        when s.layer_opening_score > s.anchor_opening_score + 0.07
             and s.layer_drydown_score <= s.anchor_drydown_score then 'lift'
        when s.layer_drydown_score > s.anchor_drydown_score + 0.07
             and s.layer_opening_score <= s.anchor_opening_score then 'lingering-base'
        else 'support'
      end as support_role_estimate,

      case
        when s.masking_risk_score < 0.28 then 'low'
        when s.masking_risk_score < 0.52 then 'moderate'
        else 'high'
      end as masking_risk_band_estimate,

      case
        when s.layer_strength > s.anchor_strength + 0.08 then s.layer_name
        else s.anchor_name
      end as dominant_name_estimate,

      case
        when s.layer_opening_score > s.anchor_opening_score then s.layer_name
        else s.anchor_name
      end as opening_lead_name_estimate,

      case
        when s.layer_drydown_score > s.anchor_drydown_score then s.layer_name
        else s.anchor_name
      end as drydown_lead_name_estimate,

      case
        when s.masking_risk_score < 0.28
             and abs(s.layer_strength - s.anchor_strength) <= 0.18 then 'high'
        when s.masking_risk_score < 0.52 then 'moderate'
        else 'experimental'
      end as balance_confidence_estimate,

      (
        (s.structural_similarity * 0.30) +
        (s.contrast_fit * 0.14) +
        (s.phase_support * 0.14) +
        s.family_bonus +
        s.performance_bonus +
        s.mode_bonus -
        s.same_family_penalty
      ) as base_layer_score,

      case
        when v_mode = 'balance' then
          case
            when s.projected_layer_mode = 'balance' then 0.34
            when s.projected_layer_mode = 'smooth' then 0.12
            when s.projected_layer_mode = 'lift' then 0.10
            when s.projected_layer_mode = 'deepen' then -0.04
            else 0
          end
          - (abs(s.layer_proj - s.anchor_proj) * 0.08)

        when v_mode = 'smooth' then
          case
            when s.projected_layer_mode = 'smooth' then 0.40
            when s.projected_layer_mode = 'balance' then 0.10
            when s.projected_layer_mode = 'lift' then 0.02
            when s.projected_layer_mode = 'deepen' then -0.10
            else -0.04
          end
          + (greatest(0::numeric, s.layer_smooth - s.anchor_smooth) * 0.20)
          + (greatest(0::numeric, s.layer_creamy - s.anchor_creamy) * 0.14)
          + case when s.layer_family = 'sweet-gourmand' then 0.08 else 0 end

        when v_mode = 'bold' then
          case
            when s.projected_layer_mode = 'deepen' then 0.44
            when s.projected_layer_mode = 'balance' then 0.10
            when s.projected_layer_mode = 'lift' then -0.06
            when s.projected_layer_mode = 'smooth' then -0.18
            else 0
          end
          + (greatest(0::numeric, s.layer_proj - s.anchor_proj) * 0.24)
          + (greatest(0::numeric, s.layer_density - s.anchor_density) * 0.18)
          + case
              when s.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.12
              when s.layer_family = 'sweet-gourmand' then -0.08
              else 0
            end
          + case
              when s.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
               and s.layer_family = 'sweet-gourmand' then -0.12
              when s.anchor_family in ('fresh-blue', 'citrus-cologne', 'woody-clean')
               and s.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.08
              else 0
            end

        when v_mode = 'wild' then
          case when s.layer_family <> s.anchor_family then 0.26 else -0.10 end
          + (s.contrast_distance * 0.22)
          + case
              when s.projected_layer_mode in ('lift', 'deepen') then 0.10
              when s.projected_layer_mode = 'smooth' then 0.03
              else 0
            end

        else 0
      end as requested_mode_bonus
    from scored s
  ),

  final_ranked as (
    select
      r.*,

      (
        case
          when r.masking_risk_band_estimate = 'low' then 0.03
          when r.masking_risk_band_estimate = 'moderate' then -0.04
          else -0.14
        end
        +
        case
          when v_mode = 'balance' and r.support_role_estimate in ('support', 'lift', 'lingering-base') then 0.03
          when v_mode = 'smooth' and r.support_role_estimate in ('support', 'lift') then 0.04
          when v_mode = 'bold' and r.support_role_estimate = 'lingering-base' then 0.04
          when v_mode = 'wild' and r.masking_risk_band_estimate = 'low' then 0.02
          else 0
        end
        +
        case
          when v_mode in ('balance', 'smooth') and r.support_role_estimate = 'driver' then -0.14
          when v_mode = 'bold' and r.support_role_estimate = 'driver' then 0.03
          when v_mode = 'wild' and r.support_role_estimate = 'driver' then 0.06
          else 0
        end
      ) as pair_adjustment,

      (
        r.base_layer_score
        + r.requested_mode_bonus
        +
        (
          case
            when r.masking_risk_band_estimate = 'low' then 0.03
            when r.masking_risk_band_estimate = 'moderate' then -0.04
            else -0.14
          end
          +
          case
            when v_mode = 'balance' and r.support_role_estimate in ('support', 'lift', 'lingering-base') then 0.03
            when v_mode = 'smooth' and r.support_role_estimate in ('support', 'lift') then 0.04
            when v_mode = 'bold' and r.support_role_estimate = 'lingering-base' then 0.04
            when v_mode = 'wild' and r.masking_risk_band_estimate = 'low' then 0.02
            else 0
          end
          +
          case
            when v_mode in ('balance', 'smooth') and r.support_role_estimate = 'driver' then -0.14
            when v_mode = 'bold' and r.support_role_estimate = 'driver' then 0.03
            when v_mode = 'wild' and r.support_role_estimate = 'driver' then 0.06
            else 0
          end
        )
      ) as final_score
    from ranked r
  ),

  safety_gated as (
    select
      fr.*,
      (
        fr.support_role_estimate = 'driver'
        or (
          fr.masking_risk_band_estimate = 'high'
          and fr.opening_lead_name_estimate = fr.layer_name
          and fr.drydown_lead_name_estimate = fr.layer_name
        )
      ) as layer_dominates_anchor
    from final_ranked fr
  ),

  patterned as (
    select
      sg.*,
      public.resolve_layer_spray_pattern_v1(
        sg.anchor_fragrance_id,
        sg.layer_fragrance_id,
        v_context,
        v_mode
      ) as spray_pattern
    from safety_gated sg
  ),

  chosen as (
    select *
    from patterned
    where not layer_dominates_anchor
      and coalesce((spray_pattern->>'is_layer_allowed')::boolean, true)
    order by final_score desc, layer_name
    limit 1
  )

  select
    c.anchor_fragrance_id,
    c.layer_fragrance_id,
    c.layer_name,
    c.layer_brand,
    c.layer_family,
    round(c.final_score::numeric, 6) as layer_score,
    v_mode as requested_mode,

    coalesce(c.spray_pattern->>'spray_ratio', case when v_mode = 'wild' then '1:1' else '2:1' end) as ratio_hint,
    coalesce(c.spray_pattern->>'name', 'Anchor Halo') as application_style,
    coalesce(c.spray_pattern->>'placement', c.anchor_name || ': 1 spray chest, 1 spray neck | ' || c.layer_name || ': 1 spray wrist or collarbone') as placement_hint,
    (
      coalesce(c.spray_pattern->>'name', 'Anchor Halo')
      || ' - '
      || coalesce(c.spray_pattern->>'spray_ratio', case when v_mode = 'wild' then '1:1' else '2:1' end)
      || '. '
      || coalesce(c.spray_pattern->>'trail', 'Anchor leads.')
    ) as spray_guidance,
    coalesce(c.spray_pattern->>'user_description', 'Use the resolved spray pattern to keep the main scent in front.') as reason,
    coalesce(c.spray_pattern->>'why_it_works', 'The main scent stays in front while the layer supports the edges.') as why_it_works
  from chosen c;

end;
$function$;
