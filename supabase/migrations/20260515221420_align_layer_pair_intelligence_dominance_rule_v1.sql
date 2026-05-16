-- Future-proof dormant layer pair helper semantics.
--
-- A layer is only valid when it supports the requested anchor. If the proposed
-- layer is likely to overtake the anchor, keep the diagnostic information but
-- mark the pairing as not recommended for layering.

create or replace function public.get_layer_pair_intelligence_v1(
  p_anchor_fragrance_id uuid,
  p_layer_fragrance_id uuid,
  p_mode text default 'balance'
)
returns table(
  dominant_fragrance_id uuid,
  support_fragrance_id uuid,
  support_role text,
  expected_intensity_band text,
  masking_risk_band text,
  opening_lead_id uuid,
  opening_lead_name text,
  drydown_lead_id uuid,
  drydown_lead_name text,
  balance_confidence text,
  explanation text
)
language sql
stable
set search_path to 'public'
as $function$
with pair as (
  select
    fa.id as anchor_id,
    fa.name as anchor_name,
    coalesce(ga.bright_dark, 0.5) as anchor_bright_dark,
    coalesce(ga.dry_sweet, 0.5) as anchor_dry_sweet,
    coalesce(ga.clean_dirty, 0.5) as anchor_clean_dirty,
    coalesce(ga.fresh_warm, 0.5) as anchor_fresh_warm,
    coalesce(ga.airy_dense, 0.5) as anchor_density,
    coalesce(ga.top_weight, 0.33) as anchor_top,
    coalesce(ga.base_weight, 0.33) as anchor_base,
    coalesce(ga.projection_score, 0.5) as anchor_proj,
    coalesce(ga.longevity_score, 0.5) as anchor_lon,

    fl.id as layer_id,
    fl.name as layer_name,
    coalesce(gl.bright_dark, 0.5) as layer_bright_dark,
    coalesce(gl.dry_sweet, 0.5) as layer_dry_sweet,
    coalesce(gl.clean_dirty, 0.5) as layer_clean_dirty,
    coalesce(gl.fresh_warm, 0.5) as layer_fresh_warm,
    coalesce(gl.airy_dense, 0.5) as layer_density,
    coalesce(gl.top_weight, 0.33) as layer_top,
    coalesce(gl.base_weight, 0.33) as layer_base,
    coalesce(gl.projection_score, 0.5) as layer_proj,
    coalesce(gl.longevity_score, 0.5) as layer_lon
  from public.fragrances fa
  left join public.fragrance_genome ga
    on ga.fragrance_id = fa.id
  join public.fragrances fl
    on fl.id = p_layer_fragrance_id
  left join public.fragrance_genome gl
    on gl.fragrance_id = fl.id
  where fa.id = p_anchor_fragrance_id
),
calc as (
  select
    p.*,

    ((p.anchor_proj * 0.70) + (p.anchor_lon * 0.30)) as anchor_strength,
    ((p.layer_proj * 0.70) + (p.layer_lon * 0.30)) as layer_strength,

    (
      abs(p.layer_bright_dark - p.anchor_bright_dark) +
      abs(p.layer_dry_sweet - p.anchor_dry_sweet) +
      abs(p.layer_clean_dirty - p.anchor_clean_dirty) +
      abs(p.layer_fresh_warm - p.anchor_fresh_warm)
    ) / 4.0 as contrast_distance,

    greatest(
      0::numeric,
      least(
        1::numeric,
        (abs(p.layer_proj - p.anchor_proj) * 0.45) +
        (abs(p.layer_density - p.anchor_density) * 0.20) +
        (
          (
            abs(p.layer_bright_dark - p.anchor_bright_dark) +
            abs(p.layer_dry_sweet - p.anchor_dry_sweet) +
            abs(p.layer_clean_dirty - p.anchor_clean_dirty) +
            abs(p.layer_fresh_warm - p.anchor_fresh_warm)
          ) / 4.0
        ) * 0.35
      )
    ) as masking_risk_score,

    (
      p.anchor_top +
      ((1 - p.anchor_base) * 0.35) +
      ((1 - p.anchor_density) * 0.15)
    ) as anchor_opening_score,

    (
      p.layer_top +
      ((1 - p.layer_base) * 0.35) +
      ((1 - p.layer_density) * 0.15)
    ) as layer_opening_score,

    (
      p.anchor_base +
      (p.anchor_lon * 0.35) +
      (p.anchor_density * 0.15)
    ) as anchor_drydown_score,

    (
      p.layer_base +
      (p.layer_lon * 0.35) +
      (p.layer_density * 0.15)
    ) as layer_drydown_score
  from pair p
),
finalized as (
  select
    c.*,
    (c.layer_strength > c.anchor_strength + 0.08) as is_layer_takeover,

    case
      when c.layer_strength > c.anchor_strength + 0.08 then c.layer_id
      else c.anchor_id
    end as dominant_id,

    case
      when c.layer_strength > c.anchor_strength + 0.08 then c.anchor_id
      else c.layer_id
    end as support_id,

    case
      when c.layer_strength > c.anchor_strength + 0.08 then c.layer_name
      else c.anchor_name
    end as dominant_name,

    case
      when c.layer_strength > c.anchor_strength + 0.08 then c.anchor_name
      else c.layer_name
    end as support_name,

    case
      when c.layer_opening_score > c.anchor_opening_score then c.layer_id
      else c.anchor_id
    end as opening_id,

    case
      when c.layer_opening_score > c.anchor_opening_score then c.layer_name
      else c.anchor_name
    end as opening_name,

    case
      when c.layer_drydown_score > c.anchor_drydown_score then c.layer_id
      else c.anchor_id
    end as drydown_id,

    case
      when c.layer_drydown_score > c.anchor_drydown_score then c.layer_name
      else c.anchor_name
    end as drydown_name
  from calc c
)
select
  f.dominant_id as dominant_fragrance_id,
  f.support_id as support_fragrance_id,

  case
    when f.is_layer_takeover then 'not_recommended'
    when f.layer_opening_score > f.anchor_opening_score + 0.07
         and f.layer_drydown_score <= f.anchor_drydown_score then 'lift'
    when f.layer_drydown_score > f.anchor_drydown_score + 0.07
         and f.layer_opening_score <= f.anchor_opening_score then 'lingering-base'
    else 'support'
  end as support_role,

  case
    when greatest(f.anchor_strength, f.layer_strength) < 0.42 then 'soft'
    when greatest(f.anchor_strength, f.layer_strength) < 0.68 then 'moderate'
    when greatest(f.anchor_strength, f.layer_strength) < 0.85 then 'strong'
    else 'very-strong'
  end as expected_intensity_band,

  case
    when f.masking_risk_score < 0.28 then 'low'
    when f.masking_risk_score < 0.52 then 'moderate'
    else 'high'
  end as masking_risk_band,

  f.opening_id as opening_lead_id,
  f.opening_name as opening_lead_name,
  f.drydown_id as drydown_lead_id,
  f.drydown_name as drydown_lead_name,

  case
    when f.is_layer_takeover then 'not_recommended'
    when f.masking_risk_score < 0.28
         and abs(f.layer_strength - f.anchor_strength) <= 0.18 then 'high'
    when f.masking_risk_score < 0.52 then 'moderate'
    else 'experimental'
  end as balance_confidence,

  (
    case
      when f.is_layer_takeover then
        'Not recommended as a layer because ' || f.layer_name ||
        ' is likely to overtake the anchor ' || f.anchor_name ||
        '. Treat ' || f.layer_name ||
        ' as a main-scent candidate instead, or use only if reduced spray and separated placement keep ' ||
        f.anchor_name || ' clearly in front.'
      else
        f.anchor_name || ' should stay in front, while ' || f.layer_name || ' behaves more like ' ||
        case
          when f.layer_opening_score > f.anchor_opening_score + 0.07
               and f.layer_drydown_score <= f.anchor_drydown_score then 'a lift/support accent'
          when f.layer_drydown_score > f.anchor_drydown_score + 0.07
               and f.layer_opening_score <= f.anchor_opening_score then 'a lingering base support'
          else 'support rather than a true co-lead'
        end || '.'
    end
  )
  || ' '
  || f.opening_name || ' should show more in the opening, while '
  || f.drydown_name || ' should stay more present later.'
  || ' '
  || case
       when f.is_layer_takeover then
         'This is a layer failure condition, not a successful layer outcome.'
       else
         'Overall intensity should stay close to ' || f.dominant_name || '.'
     end
  || ' Masking risk is '
  || case
       when f.masking_risk_score < 0.28 then 'low'
       when f.masking_risk_score < 0.52 then 'moderate'
       else 'high'
     end
  || '.'
  as explanation
from finalized f;
$function$;
