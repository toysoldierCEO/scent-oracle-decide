begin;

create or replace function private.get_layer_mode_candidate_scores_v1(
  p_user uuid,
  p_fragrance_id uuid,
  p_mode text default 'balance'::text,
  p_context text default 'daily'::text,
  p_temperature numeric default null::numeric,
  p_brand text default null::text,
  p_wear_date text default null::text,
  p_exclude_fragrance_ids uuid[] default '{}'::uuid[],
  p_distinct_from_fragrance_id uuid default null::uuid
)
returns table(
  anchor_fragrance_id uuid,
  layer_fragrance_id uuid,
  layer_name text,
  layer_brand text,
  layer_family text,
  layer_status text,
  harmony_score numeric,
  amplification_score numeric,
  smoothing_score numeric,
  novelty_score numeric,
  bridge_score numeric,
  contrast_score numeric,
  clash_risk numeric,
  family_distance numeric,
  shared_note_count integer,
  shared_accord_count integer,
  performance_fit numeric,
  user_preference_fit numeric,
  projected_layer_mode text,
  support_role_estimate text,
  masking_risk_band_estimate text,
  layer_dominates_anchor boolean,
  quality_floor numeric,
  quality_floor_met boolean,
  same_as_distinct_target boolean,
  distinct_candidate_pool_count integer,
  same_as_distinct_penalty numeric,
  same_as_distinct_relaxed boolean,
  distinctness_reason text,
  final_score numeric
)
language sql
stable
security definer
set search_path = ''
as $function$
with normalized as (
  select
    lower(coalesce(nullif(p_mode, ''), 'balance')) as mode_key,
    lower(coalesce(nullif(p_context, ''), 'daily')) as context_key,
    coalesce(nullif(p_wear_date, ''), current_date::text) as wear_date_key,
    coalesce(p_exclude_fragrance_ids, '{}'::uuid[]) as exclude_ids,
    p_distinct_from_fragrance_id as distinct_from_id
),
anchor as (
  select
    f.id,
    f.name,
    f.brand,
    coalesce(f.family_key, 'unknown') as family_key,
    case
      when coalesce(f.family_key, '') in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 'dark'
      when coalesce(f.family_key, '') in ('fresh-blue', 'citrus-cologne') then 'bright'
      when coalesce(f.family_key, '') = 'sweet-gourmand' then 'sweet'
      when coalesce(f.family_key, '') = 'woody-clean' then 'woody'
      else 'other'
    end as family_lane,
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
    coalesce(g.base_weight, 0.33) as base_weight,
    coalesce(
      (
        select array_agg(distinct lower(trim(x)))
        filter (where nullif(trim(x), '') is not null)
        from unnest(coalesce(f.notes, '{}'::text[])) as x
      ),
      '{}'::text[]
    ) as notes_norm,
    coalesce(
      (
        select array_agg(distinct lower(trim(x)))
        filter (where nullif(trim(x), '') is not null)
        from unnest(coalesce(f.accords, '{}'::text[])) as x
      ),
      '{}'::text[]
    ) as accords_norm
  from public.fragrances f
  left join public.fragrance_genome g
    on g.fragrance_id = f.id
  where f.id = p_fragrance_id
),
anchor_enriched as (
  select
    a.*,
    coalesce(array_to_string(a.notes_norm, '|'), '') as notes_blob,
    coalesce(array_to_string(a.accords_norm, '|'), '') as accords_blob
  from anchor a
),
wardrobe as (
  select distinct on (lower(f.name), lower(f.brand))
    f.id,
    f.name,
    f.brand,
    coalesce(f.family_key, 'unknown') as family_key,
    ucei.effective_status as status,
    case
      when coalesce(f.family_key, '') in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 'dark'
      when coalesce(f.family_key, '') in ('fresh-blue', 'citrus-cologne') then 'bright'
      when coalesce(f.family_key, '') = 'sweet-gourmand' then 'sweet'
      when coalesce(f.family_key, '') = 'woody-clean' then 'woody'
      else 'other'
    end as family_lane,
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
    coalesce(g.base_weight, 0.33) as base_weight,
    coalesce(
      (
        select array_agg(distinct lower(trim(x)))
        filter (where nullif(trim(x), '') is not null)
        from unnest(coalesce(f.notes, '{}'::text[])) as x
      ),
      '{}'::text[]
    ) as notes_norm,
    coalesce(
      (
        select array_agg(distinct lower(trim(x)))
        filter (where nullif(trim(x), '') is not null)
        from unnest(coalesce(f.accords, '{}'::text[])) as x
      ),
      '{}'::text[]
    ) as accords_norm
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
wardrobe_enriched as (
  select
    w.*,
    coalesce(array_to_string(w.notes_norm, '|'), '') as notes_blob,
    coalesce(array_to_string(w.accords_norm, '|'), '') as accords_blob
  from wardrobe w
),
scored_base as (
  select
    n.mode_key,
    n.context_key,
    n.wear_date_key,
    n.distinct_from_id,
    a.id as anchor_fragrance_id,
    a.name as anchor_name,
    a.brand as anchor_brand,
    a.family_key as anchor_family,
    a.family_lane as anchor_family_lane,
    w.id as layer_fragrance_id,
    w.name as layer_name,
    w.brand as layer_brand,
    w.family_key as layer_family,
    w.family_lane as layer_family_lane,
    w.status as layer_status,
    a.notes_blob as anchor_notes_blob,
    a.accords_blob as anchor_accords_blob,
    w.notes_blob as layer_notes_blob,
    w.accords_blob as layer_accords_blob,
    (
      select count(*)
      from (
        select unnest(a.notes_norm) as token
        intersect
        select unnest(w.notes_norm) as token
      ) shared_notes
    )::integer as shared_note_count,
    (
      select count(*)
      from (
        select unnest(a.accords_norm) as token
        intersect
        select unnest(w.accords_norm) as token
      ) shared_accords
    )::integer as shared_accord_count,
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
      least(
        1::numeric,
        1 - (
          (abs(w.projection_score - a.projection_score) * 0.55) +
          (abs(w.longevity_score - a.longevity_score) * 0.45)
        )
      )
    ) as performance_fit,
    case when w.status = 'signature' then 1.00 else 0.90 end as user_preference_fit,
    case
      when w.family_key = a.family_key then 0.00
      when w.family_lane = a.family_lane then 0.28
      when a.family_lane = 'dark' and w.family_lane = 'bright' then 0.88
      when a.family_lane = 'bright' and w.family_lane = 'dark' then 0.88
      when a.family_lane = 'sweet' and w.family_lane in ('woody', 'dark') then 0.74
      when a.family_lane = 'woody' and w.family_lane = 'sweet' then 0.72
      when a.family_lane = 'bright' and w.family_lane = 'sweet' then 0.62
      when a.family_lane = 'sweet' and w.family_lane = 'bright' then 0.62
      when a.family_lane = 'woody' and w.family_lane = 'dark' then 0.66
      when a.family_lane = 'dark' and w.family_lane = 'woody' then 0.56
      else 0.48
    end as family_distance,
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
        (abs(w.projection_score - a.projection_score) * 0.42) +
        (abs(w.airy_dense - a.airy_dense) * 0.18) +
        (
          (
            abs(w.bright_dark - a.bright_dark) +
            abs(w.dry_sweet - a.dry_sweet) +
            abs(w.clean_dirty - a.clean_dirty) +
            abs(w.fresh_warm - a.fresh_warm)
          ) / 4.0
        ) * 0.30 +
        case
          when w.family_lane <> a.family_lane and (
            (
              (
                select count(*)
                from (
                  select unnest(a.accords_norm) as token
                  intersect
                  select unnest(w.accords_norm) as token
                ) shared_accords
              )
            ) = 0
          ) then 0.12
          else 0
        end
      )
    ) as masking_risk_score,
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
    w.familiar_avant as layer_familiar_avant
  from normalized n
  cross join anchor_enriched a
  join wardrobe_enriched w
    on true
),
annotated as (
  select
    sb.*,
    (sb.layer_notes_blob like '%musk%' or sb.layer_accords_blob like '%musky%') as has_musk,
    (sb.layer_notes_blob like '%amber%' or sb.layer_accords_blob like '%amber%') as has_amber,
    (sb.layer_notes_blob like '%sandalwood%' or sb.layer_notes_blob like '%cashmere%') as has_soft_wood,
    (sb.layer_notes_blob like '%vanilla%' or sb.layer_accords_blob like '%vanilla%') as has_vanilla,
    (sb.layer_notes_blob like '%iris%' or sb.layer_accords_blob like '%powdery%') as has_iris_or_powder,
    (sb.layer_notes_blob like '%tea%' or sb.layer_accords_blob like '%tea%') as has_tea,
    (sb.layer_accords_blob like '%powdery%' or sb.layer_accords_blob like '%cream%') as has_powder_or_cream,
    (sb.layer_accords_blob like '%aromatic%' or sb.layer_notes_blob like '%lavender%' or sb.layer_notes_blob like '%sage%') as has_gentle_aromatic,
    (sb.layer_notes_blob like '%leather%' or sb.layer_accords_blob like '%leather%') as has_leather,
    (sb.layer_notes_blob like '%oud%' or sb.layer_accords_blob like '%oud%') as has_oud,
    (sb.layer_notes_blob like '%smoke%' or sb.layer_accords_blob like '%smok%') as has_smoke,
    (sb.layer_accords_blob like '%spicy%' or sb.layer_notes_blob like '%pepper%' or sb.layer_notes_blob like '%saffron%' or sb.layer_notes_blob like '%cardamom%') as has_spice,
    (sb.layer_accords_blob like '%citrus%' or sb.layer_notes_blob like '%bergamot%' or sb.layer_notes_blob like '%lemon%' or sb.layer_notes_blob like '%orange%' or sb.layer_notes_blob like '%mandarin%' or sb.layer_notes_blob like '%grapefruit%') as has_citrus,
    (sb.layer_accords_blob like '%fruity%' or sb.layer_notes_blob like '%apple%' or sb.layer_notes_blob like '%berry%' or sb.layer_notes_blob like '%pear%' or sb.layer_notes_blob like '%peach%' or sb.layer_notes_blob like '%plum%' or sb.layer_notes_blob like '%cherry%') as has_fruit,
    (sb.layer_accords_blob like '%green%' or sb.layer_notes_blob like '%fig leaf%' or sb.layer_notes_blob like '%galbanum%' or sb.layer_notes_blob like '%tea%') as has_green_or_tea,
    (sb.layer_accords_blob like '%marine%' or sb.layer_accords_blob like '%aquatic%' or sb.layer_notes_blob like '%sea%' or sb.layer_notes_blob like '%ozonic%') as has_aquatic,
    (sb.layer_accords_blob like '%floral%' or sb.layer_notes_blob like '%rose%' or sb.layer_notes_blob like '%jasmine%' or sb.layer_notes_blob like '%violet%' or sb.layer_notes_blob like '%iris%') as has_floral,
    (sb.layer_accords_blob like '%resin%' or sb.layer_accords_blob like '%incense%' or sb.layer_notes_blob like '%olibanum%' or sb.layer_notes_blob like '%myrrh%' or sb.layer_notes_blob like '%resin%') as has_resin_or_incense,
    (sb.layer_accords_blob like '%gourmand%' or sb.layer_notes_blob like '%tonka%' or sb.layer_notes_blob like '%vanilla%' or sb.layer_notes_blob like '%caramel%' or sb.layer_notes_blob like '%praline%' or sb.layer_notes_blob like '%chocolate%') as has_gourmand,
    (sb.anchor_accords_blob like '%leather%' or sb.anchor_notes_blob like '%leather%') as anchor_has_leather,
    (sb.anchor_accords_blob like '%oud%' or sb.anchor_notes_blob like '%oud%') as anchor_has_oud,
    (sb.anchor_accords_blob like '%smok%' or sb.anchor_notes_blob like '%smoke%') as anchor_has_smoke,
    (sb.anchor_accords_blob like '%gourmand%' or sb.anchor_notes_blob like '%tonka%' or sb.anchor_notes_blob like '%vanilla%') as anchor_has_gourmand
  from scored_base sb
),
scored as (
  select
    a.*,
    greatest(
      0::numeric,
      least(
        1::numeric,
        (a.shared_note_count * 0.14) +
        (a.shared_accord_count * 0.12) +
        case
          when a.layer_family = a.anchor_family then 0.24
          when a.layer_family_lane = a.anchor_family_lane then 0.14
          when a.anchor_family_lane = 'dark' and a.layer_family_lane = 'bright' then 0.12
          when a.anchor_family_lane = 'bright' and a.layer_family_lane = 'dark' then 0.12
          when a.anchor_family_lane = 'sweet' and a.layer_family_lane = 'woody' then 0.12
          when a.anchor_family_lane = 'woody' and a.layer_family_lane = 'sweet' then 0.10
          when a.shared_accord_count > 0 then 0.08
          else 0
        end
      )
    ) as bridge_score,
    greatest(
      0::numeric,
      least(
        1::numeric,
        (a.has_musk::int * 0.16) +
        (a.has_amber::int * 0.10) +
        (a.has_soft_wood::int * 0.14) +
        (a.has_vanilla::int * 0.12) +
        (a.has_iris_or_powder::int * 0.12) +
        (a.has_tea::int * 0.08) +
        (a.has_powder_or_cream::int * 0.10) +
        (a.has_gentle_aromatic::int * 0.08) +
        greatest(0::numeric, a.layer_smooth - a.anchor_smooth) * 0.18 +
        greatest(0::numeric, a.layer_creamy - a.anchor_creamy) * 0.14 +
        greatest(0::numeric, a.anchor_proj - a.layer_proj) * 0.10
      )
    ) as soft_material_score,
    greatest(
      0::numeric,
      least(
        1::numeric,
        (a.has_leather::int * 0.18) +
        (a.has_oud::int * 0.18) +
        (a.has_smoke::int * 0.16) +
        (a.has_spice::int * 0.12) +
        greatest(0::numeric, a.layer_proj - a.anchor_proj) * 0.18 +
        greatest(0::numeric, a.layer_density - a.anchor_density) * 0.10
      )
    ) as aggressive_score,
    greatest(
      0::numeric,
      least(
        1::numeric,
        (a.contrast_distance * 0.44) +
        (a.family_distance * 0.34) +
        greatest(0::numeric, a.layer_familiar_avant - 0.50) * 0.12 +
        case
          when a.anchor_family_lane = 'dark' and (a.has_citrus or a.has_fruit or a.has_green_or_tea or a.has_floral) then 0.18
          when a.anchor_has_leather and a.has_tea then 0.14
          when a.anchor_has_smoke and a.has_citrus then 0.14
          when a.anchor_family_lane = 'sweet' and a.has_spice then 0.12
          when a.anchor_family_lane = 'woody' and a.has_gourmand then 0.12
          when a.anchor_family_lane = 'woody' and a.has_aquatic then 0.12
          when a.anchor_family_lane = 'dark' and a.has_floral then 0.10
          else 0
        end
      )
    ) as novelty_score,
    greatest(
      0::numeric,
      least(
        1::numeric,
        a.contrast_distance * 0.82 +
        a.family_distance * 0.18
      )
    ) as contrast_score,
    greatest(
      0::numeric,
      least(
        1::numeric,
        (a.masking_risk_score * 0.72) +
        greatest(0::numeric, a.contrast_distance - (
          (a.shared_note_count * 0.08) +
          (a.shared_accord_count * 0.10)
        )) * 0.34 +
        (
          (
            (a.has_leather::int * 0.18) +
            (a.has_oud::int * 0.18) +
            (a.has_smoke::int * 0.16) +
            (a.has_spice::int * 0.12) +
            greatest(0::numeric, a.layer_proj - a.anchor_proj) * 0.18 +
            greatest(0::numeric, a.layer_density - a.anchor_density) * 0.10
          ) * 0.18
        )
      )
    ) as clash_risk
  from annotated a
),
mode_projection as (
  select
    s.*,
    case
      when s.context_key = 'daily' then
        case
          when s.anchor_family_lane = 'dark' and s.layer_family_lane = 'bright' then 'lift'
          when s.anchor_family_lane = 'dark' and s.layer_family_lane = 'sweet' then 'smooth'
          when s.anchor_family_lane in ('bright', 'woody') and s.layer_family_lane in ('dark', 'sweet') then 'deepen'
          when s.soft_material_score >= 0.46 then 'smooth'
          when s.contrast_score >= 0.62 then 'lift'
          else 'balance'
        end
      when s.context_key = 'work' then
        case
          when s.soft_material_score >= 0.42 then 'smooth'
          when s.layer_family_lane = 'bright' and s.layer_proj <= s.anchor_proj + 0.05 then 'lift'
          else 'balance'
        end
      when s.context_key = 'hangout' then
        case
          when s.novelty_score >= 0.62 and s.bridge_score >= 0.14 then 'lift'
          when s.soft_material_score >= 0.44 then 'smooth'
          when s.amplification_score >= 0.52 then 'deepen'
          else 'balance'
        end
      when s.context_key = 'date' then
        case
          when s.amplification_score >= 0.54 then 'deepen'
          when s.soft_material_score >= 0.46 then 'smooth'
          when s.novelty_score >= 0.64 and s.bridge_score >= 0.12 then 'lift'
          else 'balance'
        end
      else 'balance'
    end as projected_layer_mode
  from (
    select
      s0.*,
      greatest(
        0::numeric,
        least(
          1::numeric,
          greatest(0::numeric, s0.layer_strength - s0.anchor_strength) * 0.46 +
          greatest(0::numeric, s0.layer_base - s0.anchor_base) * 0.22 +
          greatest(0::numeric, s0.layer_density - s0.anchor_density) * 0.14 +
          case
            when s0.layer_family_lane = 'dark' then 0.12
            when s0.layer_family_lane = 'sweet' then 0.06
            else 0
          end +
          s0.bridge_score * 0.10
        )
      ) as amplification_score
    from scored s0
  ) s
),
ranked as (
  select
    mp.*,
    greatest(
      0::numeric,
      least(
        1::numeric,
        (mp.structural_similarity * 0.46) +
        (mp.bridge_score * 0.30) +
        (mp.performance_fit * 0.24) -
        (mp.clash_risk * 0.18)
      )
    ) as harmony_score,
    greatest(
      0::numeric,
      least(
        1::numeric,
        (mp.soft_material_score * 0.42) +
        (mp.bridge_score * 0.16) +
        (mp.performance_fit * 0.12) +
        (greatest(0::numeric, mp.anchor_proj - mp.layer_proj) * 0.10) -
        (mp.aggressive_score * 0.20) -
        (mp.novelty_score * 0.08)
      )
    ) as smoothing_score,
    case
      when mp.layer_strength > mp.anchor_strength + 0.08 then 'driver'
      when mp.layer_opening_score > mp.anchor_opening_score + 0.07
           and mp.layer_drydown_score <= mp.anchor_drydown_score then 'lift'
      when mp.layer_drydown_score > mp.anchor_drydown_score + 0.07
           and mp.layer_opening_score <= mp.anchor_opening_score then 'lingering-base'
      else 'support'
    end as support_role_estimate,
    case
      when mp.masking_risk_score < 0.28 then 'low'
      when mp.masking_risk_score < 0.52 then 'moderate'
      else 'high'
    end as masking_risk_band_estimate,
    (
      mp.layer_strength > mp.anchor_strength + 0.08
      or (
        mp.masking_risk_score >= 0.52
        and mp.layer_opening_score > mp.anchor_opening_score
        and mp.layer_drydown_score > mp.anchor_drydown_score
      )
    ) as layer_dominates_anchor,
    case mp.mode_key
      when 'balance' then 0.66
      when 'smooth' then 0.68
      when 'bold' then 0.60
      when 'wild' then 0.62
      else 0.64
    end as quality_floor,
    case
      when mp.context_key = 'daily' then 0.28
      when mp.context_key = 'work' then 0.18
      when mp.context_key = 'hangout' then 0.30
      when mp.context_key = 'date' then 0.38
      else 0.28
    end as target_contrast,
    greatest(
      0::numeric,
      least(
        1::numeric,
        1 - abs(
          mp.contrast_distance - case
            when mp.context_key = 'daily' then 0.28
            when mp.context_key = 'work' then 0.18
            when mp.context_key = 'hangout' then 0.30
            when mp.context_key = 'date' then 0.38
            else 0.28
          end
        ) * 2.2
      )
    ) as contrast_fit,
    case
      when mp.projected_layer_mode = 'lift' then
        greatest(
          0::numeric,
          least(
            1::numeric,
            0.55
            + ((mp.layer_top - mp.anchor_top) * 1.2)
            - (greatest(0::numeric, mp.layer_proj - mp.anchor_proj) * 0.5)
          )
        )
      when mp.projected_layer_mode = 'smooth' then
        greatest(
          0::numeric,
          least(
            1::numeric,
            0.55
            + ((mp.layer_smooth - mp.anchor_smooth) * 0.9)
            + ((mp.layer_creamy - mp.anchor_creamy) * 0.6)
          )
        )
      when mp.projected_layer_mode = 'deepen' then
        greatest(
          0::numeric,
          least(
            1::numeric,
            0.50
            + ((mp.layer_base - mp.anchor_base) * 1.0)
            + ((mp.layer_density - mp.anchor_density) * 0.6)
          )
        )
      else
        greatest(
          0::numeric,
          least(
            1::numeric,
            0.60
            + (mp.structural_similarity * 0.30)
            - (abs(mp.layer_proj - mp.anchor_proj) * 0.25)
          )
        )
    end as phase_support,
    case
      when mp.context_key = 'daily' then
        case
          when mp.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
               and mp.layer_family = 'woody-clean' then 0.18
          when mp.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
               and mp.layer_family in ('fresh-blue', 'citrus-cologne') then 0.14
          when mp.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
               and mp.layer_family = 'sweet-gourmand' then 0.09
          when mp.anchor_family = 'woody-clean'
               and mp.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy', 'sweet-gourmand') then 0.14
          when mp.anchor_family in ('fresh-blue', 'citrus-cologne')
               and mp.layer_family = 'woody-clean' then 0.16
          when mp.anchor_family in ('fresh-blue', 'citrus-cologne')
               and mp.layer_family in ('oud-amber', 'sweet-gourmand') then 0.10
          when mp.anchor_family = 'sweet-gourmand'
               and mp.layer_family in ('woody-clean', 'fresh-blue', 'citrus-cologne') then 0.15
          when mp.layer_family <> mp.anchor_family then 0.03
          else 0
        end
      when mp.context_key = 'work' then
        case
          when mp.layer_family = 'woody-clean' then 0.18
          when mp.layer_family = 'fresh-blue' then 0.14
          when mp.layer_family = 'citrus-cologne' then 0.12
          when mp.layer_family = 'sweet-gourmand' then 0.03
          when mp.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then -0.06
          else 0
        end
      when mp.context_key = 'hangout' then
        case
          when mp.layer_family in ('fresh-blue', 'citrus-cologne') then 0.14
          when mp.layer_family = 'sweet-gourmand' then 0.13
          when mp.layer_family = 'woody-clean' then 0.08
          when mp.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.03
          else 0
        end
      when mp.context_key = 'date' then
        case
          when mp.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
               and mp.layer_family = 'sweet-gourmand' then 0.18
          when mp.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
               and mp.layer_family = 'woody-clean' then 0.14
          when mp.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
               and mp.layer_family in ('fresh-blue', 'citrus-cologne') then 0.08
          when mp.anchor_family in ('woody-clean', 'fresh-blue', 'citrus-cologne')
               and mp.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.18
          when mp.anchor_family in ('woody-clean', 'fresh-blue', 'citrus-cologne')
               and mp.layer_family = 'sweet-gourmand' then 0.14
          when mp.anchor_family = 'sweet-gourmand'
               and mp.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.15
          when mp.layer_family <> mp.anchor_family then 0.04
          else 0
        end
      else 0
    end as family_bonus,
    case
      when mp.context_key = 'daily' then
        case
          when mp.layer_lon between 0.50 and 0.85 then 0.03
          when mp.layer_lon < 0.38 then -0.04
          else 0
        end
      when mp.context_key = 'work' then
        case
          when mp.layer_proj between 0.35 and 0.65
               and mp.layer_lon between 0.45 and 0.80 then 0.08
          when mp.layer_proj between 0.66 and 0.78 then 0.04
          when mp.layer_proj > 0.82 then -0.08
          when mp.layer_proj < 0.30 then -0.04
          else 0
        end
      when mp.context_key = 'hangout' then
        case
          when mp.layer_proj between 0.45 and 0.75 then 0.06
          when mp.layer_proj > 0.88 then -0.04
          else 0
        end
      when mp.context_key = 'date' then
        case
          when mp.layer_proj between 0.45 and 0.80
               and mp.layer_lon >= 0.55 then 0.09
          when mp.layer_proj < 0.35 then -0.05
          else 0
        end
      else 0
    end as performance_bonus,
    case
      when mp.context_key = 'daily' then
        case
          when mp.projected_layer_mode = 'lift' then 0.07
          when mp.projected_layer_mode = 'smooth' then 0.06
          when mp.projected_layer_mode = 'deepen' then 0.05
          else 0.04
        end
      when mp.context_key = 'work' then
        case
          when mp.projected_layer_mode = 'lift' then 0.08
          when mp.projected_layer_mode = 'smooth' then 0.06
          when mp.projected_layer_mode = 'balance' then 0.03
          else -0.02
        end
      when mp.context_key = 'hangout' then
        case
          when mp.projected_layer_mode = 'lift' then 0.07
          when mp.projected_layer_mode = 'smooth' then 0.07
          when mp.projected_layer_mode = 'balance' then 0.04
          else 0
        end
      when mp.context_key = 'date' then
        case
          when mp.projected_layer_mode = 'deepen' then 0.09
          when mp.projected_layer_mode = 'smooth' then 0.09
          when mp.projected_layer_mode = 'lift' then 0.05
          else 0.04
        end
      else 0.04
    end as legacy_mode_bonus,
    case
      when mp.context_key = 'work' and mp.layer_family = mp.anchor_family then 0.03
      when mp.layer_family = mp.anchor_family then 0.06
      else 0
    end as same_family_penalty
  from mode_projection mp
),
raw_scores as (
  select
    r.*,
    (
      (r.structural_similarity * 0.30) +
      (r.contrast_fit * 0.14) +
      (r.phase_support * 0.14) +
      r.family_bonus +
      r.performance_bonus +
      r.legacy_mode_bonus -
      r.same_family_penalty
    ) as legacy_base_score,
    (
      case
        when r.mode_key = 'balance' then
          case
            when r.projected_layer_mode = 'balance' then 0.34
            when r.projected_layer_mode = 'smooth' then 0.12
            when r.projected_layer_mode = 'lift' then 0.10
            when r.projected_layer_mode = 'deepen' then -0.04
            else 0
          end
          - (abs(r.layer_proj - r.anchor_proj) * 0.08)
        when r.mode_key = 'smooth' then
          case
            when r.projected_layer_mode = 'smooth' then 0.40
            when r.projected_layer_mode = 'balance' then 0.10
            when r.projected_layer_mode = 'lift' then 0.02
            when r.projected_layer_mode = 'deepen' then -0.10
            else -0.04
          end
          + (greatest(0::numeric, r.layer_smooth - r.anchor_smooth) * 0.20)
          + (greatest(0::numeric, r.layer_creamy - r.anchor_creamy) * 0.14)
          + case when r.layer_family = 'sweet-gourmand' then 0.08 else 0 end
        when r.mode_key = 'bold' then
          case
            when r.projected_layer_mode = 'deepen' then 0.44
            when r.projected_layer_mode = 'balance' then 0.10
            when r.projected_layer_mode = 'lift' then -0.06
            when r.projected_layer_mode = 'smooth' then -0.18
            else 0
          end
          + (greatest(0::numeric, r.layer_proj - r.anchor_proj) * 0.24)
          + (greatest(0::numeric, r.layer_density - r.anchor_density) * 0.18)
          + case
              when r.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.12
              when r.layer_family = 'sweet-gourmand' then -0.08
              else 0
            end
          + case
              when r.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
               and r.layer_family = 'sweet-gourmand' then -0.12
              when r.anchor_family in ('fresh-blue', 'citrus-cologne', 'woody-clean')
               and r.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.08
              else 0
            end
        when r.mode_key = 'wild' then
          case when r.layer_family <> r.anchor_family then 0.26 else -0.10 end
          + (r.contrast_distance * 0.22)
          + case
              when r.projected_layer_mode in ('lift', 'deepen') then 0.10
              when r.projected_layer_mode = 'smooth' then 0.03
              else 0
            end
        else 0
      end
    ) as legacy_requested_mode_bonus,
    (
      case
        when r.masking_risk_band_estimate = 'low' then 0.03
        when r.masking_risk_band_estimate = 'moderate' then -0.04
        else -0.14
      end
      +
      case
        when r.mode_key = 'balance' and r.support_role_estimate in ('support', 'lift', 'lingering-base') then 0.03
        when r.mode_key = 'smooth' and r.support_role_estimate in ('support', 'lift') then 0.04
        when r.mode_key = 'bold' and r.support_role_estimate = 'lingering-base' then 0.04
        when r.mode_key = 'wild' and r.masking_risk_band_estimate = 'low' then 0.02
        else 0
      end
      +
      case
        when r.mode_key in ('balance', 'smooth') and r.support_role_estimate = 'driver' then -0.14
        when r.mode_key = 'bold' and r.support_role_estimate = 'driver' then 0.03
        when r.mode_key = 'wild' and r.support_role_estimate = 'driver' then 0.06
        else 0
      end
    ) as legacy_pair_adjustment,
    (
      (
        (r.structural_similarity * 0.30) +
        (r.contrast_fit * 0.14) +
        (r.phase_support * 0.14) +
        r.family_bonus +
        r.performance_bonus +
        r.legacy_mode_bonus -
        r.same_family_penalty
      )
      +
      (
        case
          when r.mode_key = 'balance' then
            ((r.harmony_score * 0.08) + (r.bridge_score * 0.04) - (r.novelty_score * 0.02))
          when r.mode_key = 'smooth' then
            ((r.smoothing_score * 0.16) + (r.bridge_score * 0.05) - (r.aggressive_score * 0.06))
          when r.mode_key = 'bold' then
            ((r.amplification_score * 0.10) + (r.bridge_score * 0.03) - (r.smoothing_score * 0.04))
          when r.mode_key = 'wild' then
            ((r.novelty_score * 0.16) + (r.bridge_score * 0.08) + (r.contrast_score * 0.06) - (r.smoothing_score * 0.12))
          else 0
        end
      )
      +
      (
        case
          when r.mode_key = 'wild' and r.bridge_score < 0.12 and r.contrast_score > 0.62 then -0.10
          when r.mode_key = 'wild' and r.soft_material_score >= 0.50 and r.novelty_score < 0.48 then -0.12
          when r.mode_key = 'smooth' and r.soft_material_score >= 0.55 then 0.06
          when r.mode_key = 'smooth' and r.aggressive_score >= 0.38 then -0.08
          else 0
        end
      )
      +
      (
        case
          when r.mode_key = 'balance' then
            case
              when r.projected_layer_mode = 'balance' then 0.34
              when r.projected_layer_mode = 'smooth' then 0.12
              when r.projected_layer_mode = 'lift' then 0.10
              when r.projected_layer_mode = 'deepen' then -0.04
              else 0
            end
            - (abs(r.layer_proj - r.anchor_proj) * 0.08)
          when r.mode_key = 'smooth' then
            case
              when r.projected_layer_mode = 'smooth' then 0.40
              when r.projected_layer_mode = 'balance' then 0.10
              when r.projected_layer_mode = 'lift' then 0.02
              when r.projected_layer_mode = 'deepen' then -0.10
              else -0.04
            end
            + (greatest(0::numeric, r.layer_smooth - r.anchor_smooth) * 0.20)
            + (greatest(0::numeric, r.layer_creamy - r.anchor_creamy) * 0.14)
            + case when r.layer_family = 'sweet-gourmand' then 0.08 else 0 end
          when r.mode_key = 'bold' then
            case
              when r.projected_layer_mode = 'deepen' then 0.44
              when r.projected_layer_mode = 'balance' then 0.10
              when r.projected_layer_mode = 'lift' then -0.06
              when r.projected_layer_mode = 'smooth' then -0.18
              else 0
            end
            + (greatest(0::numeric, r.layer_proj - r.anchor_proj) * 0.24)
            + (greatest(0::numeric, r.layer_density - r.anchor_density) * 0.18)
            + case
                when r.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.12
                when r.layer_family = 'sweet-gourmand' then -0.08
                else 0
              end
            + case
                when r.anchor_family in ('oud-amber', 'dark-leather', 'tobacco-boozy')
                 and r.layer_family = 'sweet-gourmand' then -0.12
                when r.anchor_family in ('fresh-blue', 'citrus-cologne', 'woody-clean')
                 and r.layer_family in ('oud-amber', 'dark-leather', 'tobacco-boozy') then 0.08
                else 0
              end
          when r.mode_key = 'wild' then
            case when r.layer_family <> r.anchor_family then 0.26 else -0.10 end
            + (r.contrast_distance * 0.22)
            + case
                when r.projected_layer_mode in ('lift', 'deepen') then 0.10
                when r.projected_layer_mode = 'smooth' then 0.03
                else 0
              end
          else 0
        end
      )
      +
      (
        case
          when r.masking_risk_band_estimate = 'low' then 0.03
          when r.masking_risk_band_estimate = 'moderate' then -0.04
          else -0.14
        end
        +
        case
          when r.mode_key = 'balance' and r.support_role_estimate in ('support', 'lift', 'lingering-base') then 0.03
          when r.mode_key = 'smooth' and r.support_role_estimate in ('support', 'lift') then 0.04
          when r.mode_key = 'bold' and r.support_role_estimate = 'lingering-base' then 0.04
          when r.mode_key = 'wild' and r.masking_risk_band_estimate = 'low' then 0.02
          else 0
        end
        +
        case
          when r.mode_key in ('balance', 'smooth') and r.support_role_estimate = 'driver' then -0.14
          when r.mode_key = 'bold' and r.support_role_estimate = 'driver' then 0.03
          when r.mode_key = 'wild' and r.support_role_estimate = 'driver' then 0.06
          else 0
        end
      )
    ) as raw_mode_score
  from ranked r
),
windowed as (
  select
    rs.*,
    count(*) filter (
      where not rs.layer_dominates_anchor
    ) over () as viable_pool_count,
    count(*) filter (
      where not rs.layer_dominates_anchor
        and rs.layer_fragrance_id <> rs.distinct_from_id
        and rs.raw_mode_score >= rs.quality_floor
        and rs.clash_risk < 0.68
    ) over () as distinct_candidate_pool_count
  from raw_scores rs
),
finalized as (
  select
    w.anchor_fragrance_id,
    w.layer_fragrance_id,
    w.layer_name,
    w.layer_brand,
    w.layer_family,
    w.layer_status,
    round(w.harmony_score::numeric, 6) as harmony_score,
    round(w.amplification_score::numeric, 6) as amplification_score,
    round(w.smoothing_score::numeric, 6) as smoothing_score,
    round(w.novelty_score::numeric, 6) as novelty_score,
    round(w.bridge_score::numeric, 6) as bridge_score,
    round(w.contrast_score::numeric, 6) as contrast_score,
    round(w.clash_risk::numeric, 6) as clash_risk,
    round(w.family_distance::numeric, 6) as family_distance,
    w.shared_note_count,
    w.shared_accord_count,
    round(w.performance_fit::numeric, 6) as performance_fit,
    round(w.user_preference_fit::numeric, 6) as user_preference_fit,
    w.projected_layer_mode,
    w.support_role_estimate,
    w.masking_risk_band_estimate,
    w.layer_dominates_anchor,
    round(w.quality_floor::numeric, 6) as quality_floor,
    case
      when w.raw_mode_score - (
        case
          when w.distinct_from_id is null or w.mode_key <> 'wild' or w.layer_fragrance_id <> w.distinct_from_id then 0::numeric
          when w.distinct_candidate_pool_count >= 2 then 0.30
          when w.distinct_candidate_pool_count = 1 then 0.24
          when w.viable_pool_count >= 5 then 0.14
          when w.viable_pool_count >= 3 then 0.10
          else 0.06
        end
      ) >= w.quality_floor then true
      when w.mode_key = 'wild'
           and w.distinct_from_id is not null
           and w.layer_fragrance_id = w.distinct_from_id
           and w.distinct_candidate_pool_count = 0
           and w.raw_mode_score >= (w.quality_floor - 0.05) then true
      else false
    end as quality_floor_met,
    (
      w.distinct_from_id is not null
      and w.mode_key = 'wild'
      and w.layer_fragrance_id = w.distinct_from_id
    ) as same_as_distinct_target,
    w.distinct_candidate_pool_count::integer as distinct_candidate_pool_count,
    round(
      case
        when w.distinct_from_id is null or w.mode_key <> 'wild' or w.layer_fragrance_id <> w.distinct_from_id then 0::numeric
        when w.distinct_candidate_pool_count >= 2 then 0.30
        when w.distinct_candidate_pool_count = 1 then 0.24
        when w.viable_pool_count >= 5 then 0.14
        when w.viable_pool_count >= 3 then 0.10
        else 0.06
      end,
      6
    ) as same_as_distinct_penalty,
    (
      w.distinct_from_id is not null
      and w.mode_key = 'wild'
      and w.layer_fragrance_id = w.distinct_from_id
      and w.distinct_candidate_pool_count = 0
    ) as same_as_distinct_relaxed,
    case
      when w.distinct_from_id is null or w.mode_key <> 'wild' then null
      when w.layer_fragrance_id <> w.distinct_from_id then 'distinct_wild_candidate_selected'
      when w.distinct_candidate_pool_count >= 1 then 'distinct_safe_wild_candidate_exists'
      when w.viable_pool_count <= 2 then 'candidate_pool_too_small_to_force_wild_distinction'
      else 'no_safe_distinct_wild_candidate_above_quality_floor'
    end as distinctness_reason,
    round(
      (
        w.raw_mode_score - (
          case
            when w.distinct_from_id is null or w.mode_key <> 'wild' or w.layer_fragrance_id <> w.distinct_from_id then 0::numeric
            when w.distinct_candidate_pool_count >= 2 then 0.30
            when w.distinct_candidate_pool_count = 1 then 0.24
            when w.viable_pool_count >= 5 then 0.14
            when w.viable_pool_count >= 3 then 0.10
            else 0.06
          end
        )
      )::numeric,
      6
    ) as final_score
  from windowed w
)
select *
from finalized
order by
  quality_floor_met desc,
  final_score desc,
  shared_accord_count desc,
  shared_note_count desc,
  layer_name asc;
$function$;

create or replace function private.pick_layer_mode_candidate_v1(
  p_user uuid,
  p_fragrance_id uuid,
  p_mode text default 'balance'::text,
  p_context text default 'daily'::text,
  p_temperature numeric default null::numeric,
  p_brand text default null::text,
  p_wear_date text default null::text,
  p_exclude_fragrance_ids uuid[] default '{}'::uuid[],
  p_distinct_from_fragrance_id uuid default null::uuid
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
language sql
stable
security definer
set search_path = ''
as $function$
with scored as (
  select *
  from private.get_layer_mode_candidate_scores_v1(
    p_user,
    p_fragrance_id,
    p_mode,
    p_context,
    p_temperature,
    p_brand,
    p_wear_date,
    p_exclude_fragrance_ids,
    p_distinct_from_fragrance_id
  )
  where not layer_dominates_anchor
),
patterned as (
  select
    s.*,
    public.resolve_layer_spray_pattern_v1(
      s.anchor_fragrance_id,
      s.layer_fragrance_id,
      p_context,
      p_mode
    ) as spray_pattern
  from scored s
),
eligible as (
  select *
  from patterned
  where coalesce((spray_pattern->>'is_layer_allowed')::boolean, true)
),
preferred as (
  select *
  from eligible
  where quality_floor_met
  order by final_score desc, layer_name asc
  limit 1
),
fallback as (
  select *
  from eligible
  order by final_score desc, layer_name asc
  limit 1
),
chosen as (
  select * from preferred
  union all
  select * from fallback
  where not exists (select 1 from preferred)
  limit 1
)
select
  c.anchor_fragrance_id,
  c.layer_fragrance_id,
  c.layer_name,
  c.layer_brand,
  c.layer_family,
  c.final_score as layer_score,
  lower(coalesce(nullif(p_mode, ''), 'balance')) as requested_mode,
  coalesce(c.spray_pattern->>'spray_ratio', case when lower(coalesce(nullif(p_mode, ''), 'balance')) = 'wild' then '2:1' else '2:1' end) as ratio_hint,
  coalesce(c.spray_pattern->>'name', 'Anchor Halo') as application_style,
  coalesce(
    c.spray_pattern->>'placement',
    c.layer_name || ': use the resolved spray pattern to keep the anchor in front.'
  ) as placement_hint,
  (
    coalesce(c.spray_pattern->>'name', 'Anchor Halo')
    || ' - '
    || coalesce(c.spray_pattern->>'spray_ratio', '2:1')
    || '. '
    || coalesce(c.spray_pattern->>'trail', 'Anchor leads.')
  ) as spray_guidance,
  case
    when lower(coalesce(nullif(p_mode, ''), 'balance')) = 'wild'
         and p_distinct_from_fragrance_id is not null
         and c.layer_fragrance_id = p_distinct_from_fragrance_id
      then 'Wild fallback kept this scent because every safer contrast option fell below quality or crossed the clash threshold. The placement shifts the effect into controlled tension instead of softening.'
    else coalesce(
      c.spray_pattern->>'user_description',
      'Use the resolved spray pattern to keep the main scent in front.'
    )
  end as reason,
  case
    when lower(coalesce(nullif(p_mode, ''), 'balance')) = 'wild'
         and p_distinct_from_fragrance_id is not null
         and c.layer_fragrance_id = p_distinct_from_fragrance_id
      then 'The same scent is only reused here because no better Wild option cleared the safety floor; the split placement changes the tension and trail so it does not behave like Smooth.'
    else coalesce(
      c.spray_pattern->>'why_it_works',
      'The main scent stays in front while the layer supports the edges.'
    )
  end as why_it_works
from chosen c;
$function$;


notify pgrst, 'reload schema';

commit;
