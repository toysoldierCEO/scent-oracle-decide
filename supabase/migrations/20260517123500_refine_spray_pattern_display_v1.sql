alter table public.spray_patterns_v1
  add column if not exists anchor_placement_text text;

alter table public.spray_patterns_v1
  add column if not exists layer_placement_text text;

insert into public.spray_patterns_v1 (
  pattern_key,
  display_name,
  user_description,
  placement_template,
  anchor_placement_text,
  layer_placement_text,
  halo_template,
  trail_template,
  why_template,
  default_anchor_sprays,
  default_layer_sprays,
  default_ratio,
  allowed_contexts,
  family_hints,
  mode_affinity,
  placement_style,
  intensity_level,
  is_layer_allowed,
  sort_order,
  active
)
values
  (
    'anchor_halo',
    'Anchor Halo',
    'Anchor-forward support with a soft outer halo.',
    E'Anchor: 1 chest + 1 lower neck.\nLayer: 1 light spray back of neck or high collarbone.',
    '1 chest + 1 lower neck.',
    '1 light spray back of neck or high collarbone.',
    'Soft ring around the anchor.',
    'Quiet edge lift while the anchor stays first.',
    'The anchor stays in front while the layer opens around it softly.',
    2,
    1,
    '2:1',
    array['daily','work','hangout']::text[],
    array['support','low-risk']::text[],
    array['balance','smooth']::text[],
    'anchor_forward',
    'controlled',
    true,
    10,
    true
  ),
  (
    'split_trail',
    'Split Trail',
    'Separated zones keep contrast controlled.',
    E'Anchor: 1 chest + 1 neck.\nLayer: 1 wrist, inner forearm, or back of neck. Keep zones separated.',
    '1 chest + 1 neck.',
    '1 wrist, inner forearm, or back of neck. Keep zones separated.',
    'Separated pockets instead of one blended cloud.',
    'The layer appears later, after the anchor opens.',
    'Separated zones let the layer add contrast without crowding the anchor.',
    2,
    1,
    '2:1',
    array['daily','hangout','date','social','work']::text[],
    array['contrast','separation']::text[],
    array['balance','bold','wild']::text[],
    'separated',
    'expressive',
    true,
    20,
    true
  ),
  (
    'soft_veil',
    'Soft Veil',
    'A sheer layer lifts the opening without changing the identity.',
    E'Anchor: 1 chest + 1 lower neck.\nLayer: 1 light/distant spray on collarbone, shoulder edge, or back of neck.',
    '1 chest + 1 lower neck.',
    '1 light/distant spray on collarbone, shoulder edge, or back of neck.',
    'Barely there around the anchor.',
    'Soft lift that stays close and clean.',
    'The layer stays sheer, so the opening feels softer while the anchor keeps its identity.',
    2,
    1,
    '2:1 light',
    array['daily','work']::text[],
    array['airy','fresh','clean','musk','tea','citrus']::text[],
    array['smooth','balance']::text[],
    'sheer',
    'soft',
    true,
    30,
    true
  ),
  (
    'wrist_accent',
    'Wrist Accent',
    'A stronger layer stays off-center as a controlled accent.',
    E'Anchor: 1 chest + 1 neck.\nLayer: 1 spray on one wrist or one inner forearm only. Do not rub.',
    '1 chest + 1 neck.',
    '1 spray on one wrist or one inner forearm only. Do not rub.',
    'Close accent outside the anchor core.',
    'The layer appears in small passes while the anchor stays first.',
    'The layer has enough character to matter, so this keeps it supportive instead of central.',
    2,
    1,
    '2:1',
    array['daily','work','hangout']::text[],
    array['accent','controlled-strength']::text[],
    array['bold','wild']::text[],
    'accent',
    'controlled',
    true,
    40,
    true
  ),
  (
    'trail_boost',
    'Trail Boost',
    'The layer extends the finish from behind the anchor.',
    E'Anchor: 1 chest + 1 neck.\nLayer: 1 back of neck, shoulder edge, or shirt edge. Use fabric carefully.',
    '1 chest + 1 neck.',
    '1 back of neck, shoulder edge, or shirt edge. Use fabric carefully.',
    'Rear-weighted halo that starts after the anchor.',
    'The anchor opens first; the layer arrives in the wake.',
    'The layer arrives later in motion, so the anchor still owns the first impression.',
    2,
    1,
    '2:1',
    array['date','hangout']::text[],
    array['trail','longevity','drydown']::text[],
    array['bold','wild']::text[],
    'rear_trail',
    'expressive',
    true,
    50,
    true
  ),
  (
    'skin_lock',
    'Close Wear',
    'Both scents stay close and disciplined on skin.',
    E'Anchor: 1 under-shirt chest.\nLayer: 1 inner elbow, low chest, or under-shirt collarbone.',
    '1 under-shirt chest.',
    '1 inner elbow, low chest, or under-shirt collarbone.',
    'A tight skin bubble instead of a room-filling cloud.',
    'Minimal trail; the pair stays close and tidy.',
    'Both scents stay close to skin, so the pairing feels clean, quiet, and controlled.',
    1,
    1,
    '1:1',
    array['work','daily','date']::text[],
    array['quiet','close-wear']::text[],
    array['smooth','balance']::text[],
    'close_wear',
    'quiet',
    true,
    60,
    true
  ),
  (
    'bright_lift',
    'Bright Lift',
    'A brighter layer freshens the top while the anchor holds the body.',
    E'Anchor: 1 chest + 1 lower neck.\nLayer: 1 collarbone, side neck, or wrist.',
    '1 chest + 1 lower neck.',
    '1 collarbone, side neck, or wrist.',
    'A brighter ring above the anchor core.',
    'Fresh lift on top while the anchor still carries the body.',
    'The layer freshens the opening while the anchor keeps the body and structure.',
    2,
    1,
    '2:1',
    array['daily','work','hangout','date']::text[],
    array['bright','fresh','lift']::text[],
    array['balance','bold','wild']::text[],
    'high_lift',
    'bright',
    true,
    70,
    true
  ),
  (
    'deepen',
    'Deepen',
    'Depth sits underneath the anchor instead of replacing it.',
    E'Anchor: 1 chest + 1 neck.\nLayer: 1 lower chest, back of neck, or shoulder edge.',
    '1 chest + 1 neck.',
    '1 lower chest, back of neck, or shoulder edge.',
    'A lower shadow that supports the anchor.',
    'Warmer weight under the anchor, not over it.',
    'The layer adds depth underneath, so the finish gets warmer without taking over.',
    2,
    1,
    '2:1',
    array['date','hangout']::text[],
    array['warmth','base','depth']::text[],
    array['bold','smooth','wild']::text[],
    'low_shadow',
    'deep',
    true,
    80,
    true
  ),
  (
    'not_a_layer',
    'Not a Layer',
    'The second scent wants to lead, so this pair is better apart.',
    'Do not layer. Wear it solo or let it lead another card.',
    null,
    null,
    'No safe halo.',
    'Better worn separately.',
    'Not recommended as a layer because the support scent is likely to overtake the anchor. Treat it as a main-scent candidate, not a layer.',
    0,
    0,
    '0',
    array['daily','work','hangout','date']::text[],
    array['failure','takeover']::text[],
    array['balance','bold','smooth','wild']::text[],
    'rejected',
    'blocked',
    false,
    90,
    true
  )
on conflict (pattern_key) do update
set
  display_name = excluded.display_name,
  user_description = excluded.user_description,
  placement_template = excluded.placement_template,
  anchor_placement_text = excluded.anchor_placement_text,
  layer_placement_text = excluded.layer_placement_text,
  halo_template = excluded.halo_template,
  trail_template = excluded.trail_template,
  why_template = excluded.why_template,
  default_anchor_sprays = excluded.default_anchor_sprays,
  default_layer_sprays = excluded.default_layer_sprays,
  default_ratio = excluded.default_ratio,
  allowed_contexts = excluded.allowed_contexts,
  family_hints = excluded.family_hints,
  mode_affinity = excluded.mode_affinity,
  placement_style = excluded.placement_style,
  intensity_level = excluded.intensity_level,
  is_layer_allowed = excluded.is_layer_allowed,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

create or replace function public.resolve_layer_spray_pattern_v1(
  p_anchor_fragrance_id uuid,
  p_layer_fragrance_id uuid,
  p_context text default 'daily'::text,
  p_mode text default 'balance'::text
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with normalized as (
  select
    lower(coalesce(nullif(p_context, ''), 'daily')) as context_key,
    lower(coalesce(nullif(p_mode, ''), 'balance')) as mode_key
),
anchor_row as (
  select
    f.id,
    f.name,
    f.family_key,
    coalesce(g.bright_dark, f.bright_dark, 0.5) as bright_dark,
    coalesce(g.dry_sweet, f.dry_sweet, 0.5) as dry_sweet,
    coalesce(g.clean_dirty, f.clean_dirty, 0.5) as clean_dirty,
    coalesce(g.airy_dense, f.intimate_projective, 0.5) as airy_dense,
    coalesce(g.fresh_warm, 0.5) as fresh_warm,
    coalesce(g.smooth_textured, f.smooth_textured, 0.5) as smooth_textured,
    coalesce(g.crisp_creamy, 0.5) as crisp_creamy,
    coalesce(g.projection_score, f.projection_score, 0.5) as projection_score,
    coalesce(g.longevity_score, f.longevity_score, 0.5) as longevity_score,
    coalesce(g.top_weight, 0.33) as top_weight,
    coalesce(g.base_weight, 0.33) as base_weight
  from public.fragrances f
  left join public.fragrance_genome g
    on g.fragrance_id = f.id
  where f.id = p_anchor_fragrance_id
),
layer_row as (
  select
    f.id,
    f.name,
    f.family_key,
    coalesce(g.bright_dark, f.bright_dark, 0.5) as bright_dark,
    coalesce(g.dry_sweet, f.dry_sweet, 0.5) as dry_sweet,
    coalesce(g.clean_dirty, f.clean_dirty, 0.5) as clean_dirty,
    coalesce(g.airy_dense, f.intimate_projective, 0.5) as airy_dense,
    coalesce(g.fresh_warm, 0.5) as fresh_warm,
    coalesce(g.smooth_textured, f.smooth_textured, 0.5) as smooth_textured,
    coalesce(g.crisp_creamy, 0.5) as crisp_creamy,
    coalesce(g.projection_score, f.projection_score, 0.5) as projection_score,
    coalesce(g.longevity_score, f.longevity_score, 0.5) as longevity_score,
    coalesce(g.top_weight, 0.33) as top_weight,
    coalesce(g.base_weight, 0.33) as base_weight
  from public.fragrances f
  left join public.fragrance_genome g
    on g.fragrance_id = f.id
  where f.id = p_layer_fragrance_id
),
metrics as (
  select
    n.context_key,
    n.mode_key,
    a.name as anchor_name,
    l.name as layer_name,
    coalesce(a.family_key, '') as anchor_family,
    coalesce(l.family_key, '') as layer_family,
    a.projection_score as anchor_proj,
    l.projection_score as layer_proj,
    a.longevity_score as anchor_lon,
    l.longevity_score as layer_lon,
    a.airy_dense as anchor_density,
    l.airy_dense as layer_density,
    a.top_weight as anchor_top,
    l.top_weight as layer_top,
    a.base_weight as anchor_base,
    l.base_weight as layer_base,
    a.smooth_textured as anchor_smooth,
    l.smooth_textured as layer_smooth,
    a.crisp_creamy as anchor_creamy,
    l.crisp_creamy as layer_creamy,
    ((a.projection_score * 0.70) + (a.longevity_score * 0.30)) as anchor_strength,
    ((l.projection_score * 0.70) + (l.longevity_score * 0.30)) as layer_strength,
    (
      a.top_weight +
      ((1 - a.base_weight) * 0.35) +
      ((1 - a.airy_dense) * 0.15)
    ) as anchor_opening_score,
    (
      l.top_weight +
      ((1 - l.base_weight) * 0.35) +
      ((1 - l.airy_dense) * 0.15)
    ) as layer_opening_score,
    (
      a.base_weight +
      (a.longevity_score * 0.35) +
      (a.airy_dense * 0.15)
    ) as anchor_drydown_score,
    (
      l.base_weight +
      (l.longevity_score * 0.35) +
      (l.airy_dense * 0.15)
    ) as layer_drydown_score,
    greatest(
      0::numeric,
      least(
        1::numeric,
        (abs(l.projection_score - a.projection_score) * 0.45) +
        (abs(l.airy_dense - a.airy_dense) * 0.20) +
        (
          (
            abs(l.bright_dark - a.bright_dark) +
            abs(l.dry_sweet - a.dry_sweet) +
            abs(l.clean_dirty - a.clean_dirty) +
            abs(l.fresh_warm - a.fresh_warm)
          ) / 4.0
        ) * 0.35
      )
    ) as masking_risk_score,
    (
      abs(l.bright_dark - a.bright_dark) +
      abs(l.dry_sweet - a.dry_sweet) +
      abs(l.clean_dirty - a.clean_dirty) +
      abs(l.fresh_warm - a.fresh_warm)
    ) / 4.0 as contrast_distance
  from normalized n
  join anchor_row a on true
  join layer_row l on true
),
decision as (
  select
    m.*,
    case
      when m.masking_risk_score < 0.28 then 'low'
      when m.masking_risk_score < 0.52 then 'moderate'
      else 'high'
    end as masking_band,
    (
      m.layer_strength > m.anchor_strength + 0.08
      or (
        m.masking_risk_score >= 0.52
        and m.layer_opening_score > m.anchor_opening_score
        and m.layer_drydown_score > m.anchor_drydown_score
      )
    ) as layer_takeover_risk,
    (
      m.layer_family in ('woody-clean','fresh-blue','citrus-cologne','citrus-aromatic','fresh-citrus','fresh-aquatic')
      or (m.layer_density <= 0.50 and m.layer_top >= m.anchor_top)
    ) as layer_reads_bright,
    (
      m.layer_family in ('oud-amber','dark-leather','tobacco-boozy','sweet-gourmand')
      or m.layer_base > m.anchor_base + 0.07
    ) as layer_reads_deep,
    (
      m.anchor_family in ('oud-amber','dark-leather','tobacco-boozy','sweet-gourmand')
      or m.anchor_density >= 0.62
      or m.anchor_base >= 0.50
    ) as anchor_reads_dense,
    (
      m.anchor_family in ('woody-clean','fresh-blue','citrus-cologne','citrus-aromatic','fresh-citrus','fresh-aquatic')
      or m.anchor_density <= 0.45
    ) as anchor_reads_light,
    (
      m.layer_strength >= m.anchor_strength - 0.02
      or m.layer_proj > m.anchor_proj + 0.04
      or m.masking_risk_score >= 0.34
    ) as layer_needs_control,
    (m.contrast_distance >= 0.30) as contrastive_pair,
    (m.layer_top >= m.anchor_top + 0.05) as layer_has_lift,
    (
      m.layer_base >= m.anchor_base + 0.05
      or m.layer_drydown_score > m.anchor_drydown_score + 0.06
    ) as layer_adds_depth,
    (
      m.layer_smooth > m.anchor_smooth + 0.04
      or m.layer_creamy > m.anchor_creamy + 0.05
    ) as layer_adds_softness
  from metrics m
),
pattern_candidates as (
  select
    sp.pattern_key,
    sp.display_name,
    sp.user_description,
    sp.placement_template,
    sp.anchor_placement_text,
    sp.layer_placement_text,
    sp.halo_template,
    sp.trail_template,
    sp.why_template,
    sp.default_anchor_sprays,
    sp.default_layer_sprays,
    sp.default_ratio,
    sp.allowed_contexts,
    sp.family_hints,
    sp.mode_affinity,
    sp.placement_style,
    sp.intensity_level,
    sp.is_layer_allowed,
    sp.sort_order,
    sp.model_version,
    d.*,
    (
      case
        when d.layer_takeover_risk then
          case when sp.pattern_key = 'not_a_layer' then 1000 else -1000 end
        else 0
      end
      +
      case
        when not d.layer_takeover_risk and d.mode_key = any(coalesce(sp.mode_affinity, array[]::text[]))
          then 0.18
        else 0
      end
      +
      case d.mode_key
        when 'balance' then
          case sp.pattern_key
            when 'anchor_halo' then 0.28
            when 'split_trail' then 0.18
            when 'bright_lift' then 0.16
            when 'skin_lock' then 0.12
            when 'soft_veil' then 0.08
            when 'deepen' then 0.04
            when 'wrist_accent' then 0.02
            when 'trail_boost' then -0.08
            else 0
          end
        when 'bold' then
          case sp.pattern_key
            when 'trail_boost' then 0.26
            when 'wrist_accent' then 0.24
            when 'split_trail' then 0.22
            when 'bright_lift' then 0.18
            when 'deepen' then 0.16
            when 'anchor_halo' then -0.06
            when 'skin_lock' then -0.10
            when 'soft_veil' then -0.18
            else 0
          end
        when 'smooth' then
          case sp.pattern_key
            when 'soft_veil' then 0.28
            when 'skin_lock' then 0.26
            when 'anchor_halo' then 0.20
            when 'deepen' then 0.12
            when 'bright_lift' then 0.04
            when 'split_trail' then -0.08
            when 'wrist_accent' then -0.12
            when 'trail_boost' then -0.16
            else 0
          end
        when 'wild' then
          case sp.pattern_key
            when 'split_trail' then 0.28
            when 'wrist_accent' then 0.20
            when 'deepen' then 0.18
            when 'bright_lift' then 0.16
            when 'trail_boost' then 0.12
            when 'skin_lock' then -0.08
            when 'anchor_halo' then -0.10
            when 'soft_veil' then -0.16
            else 0
          end
        else 0
      end
      +
      case d.context_key
        when 'work' then
          case sp.pattern_key
            when 'skin_lock' then 0.22
            when 'anchor_halo' then 0.16
            when 'wrist_accent' then 0.12
            when 'bright_lift' then 0.10
            when 'soft_veil' then 0.06
            when 'split_trail' then 0.04
            when 'trail_boost' then -0.20
            when 'deepen' then -0.14
            else 0
          end
        when 'daily' then
          case sp.pattern_key
            when 'anchor_halo' then 0.16
            when 'bright_lift' then 0.14
            when 'soft_veil' then 0.12
            when 'skin_lock' then 0.10
            when 'split_trail' then 0.08
            when 'trail_boost' then -0.04
            else 0
          end
        when 'hangout' then
          case sp.pattern_key
            when 'split_trail' then 0.16
            when 'bright_lift' then 0.12
            when 'trail_boost' then 0.10
            when 'wrist_accent' then 0.08
            when 'deepen' then 0.08
            when 'anchor_halo' then 0.04
            else 0
          end
        when 'date' then
          case sp.pattern_key
            when 'deepen' then 0.16
            when 'trail_boost' then 0.16
            when 'split_trail' then 0.10
            when 'bright_lift' then 0.08
            when 'anchor_halo' then 0.04
            when 'skin_lock' then 0.02
            else 0
          end
        else 0
      end
      +
      case
        when d.layer_needs_control then
          case sp.pattern_key
            when 'wrist_accent' then 0.22
            when 'split_trail' then 0.18
            when 'skin_lock' then 0.16
            when 'trail_boost' then 0.08
            when 'bright_lift' then 0.04
            when 'anchor_halo' then -0.18
            when 'soft_veil' then -0.10
            else 0
          end
        else 0
      end
      +
      case
        when d.masking_band = 'high' then
          case sp.pattern_key
            when 'split_trail' then 0.22
            when 'skin_lock' then 0.18
            when 'wrist_accent' then 0.16
            when 'anchor_halo' then -0.24
            when 'soft_veil' then -0.18
            when 'trail_boost' then -0.12
            else 0
          end
        when d.masking_band = 'moderate' then
          case sp.pattern_key
            when 'split_trail' then 0.12
            when 'wrist_accent' then 0.10
            when 'skin_lock' then 0.08
            when 'anchor_halo' then -0.06
            else 0
          end
        else 0
      end
      +
      case
        when d.anchor_reads_dense and d.layer_reads_bright then
          case sp.pattern_key
            when 'bright_lift' then 0.20
            when 'soft_veil' then 0.08
            when 'split_trail' then 0.06
            else 0
          end
        else 0
      end
      +
      case
        when d.anchor_reads_light and d.layer_reads_deep then
          case sp.pattern_key
            when 'deepen' then 0.18
            when 'trail_boost' then 0.10
            when 'split_trail' then 0.04
            else 0
          end
        else 0
      end
      +
      case
        when d.layer_adds_softness then
          case sp.pattern_key
            when 'soft_veil' then 0.14
            when 'skin_lock' then 0.12
            when 'anchor_halo' then 0.08
            else 0
          end
        else 0
      end
      +
      case
        when d.contrastive_pair then
          case sp.pattern_key
            when 'split_trail' then 0.18
            when 'bright_lift' then 0.06
            when 'wrist_accent' then 0.04
            else 0
          end
        else 0
      end
      +
      case
        when d.layer_has_lift then
          case sp.pattern_key
            when 'bright_lift' then 0.10
            when 'soft_veil' then 0.06
            else 0
          end
        else 0
      end
      +
      case
        when d.layer_adds_depth then
          case sp.pattern_key
            when 'deepen' then 0.10
            when 'trail_boost' then 0.06
            else 0
          end
        else 0
      end
      +
      case
        when d.context_key = 'work' and d.mode_key in ('bold', 'wild') then
          case sp.pattern_key
            when 'wrist_accent' then 0.10
            when 'split_trail' then 0.08
            when 'skin_lock' then 0.08
            when 'trail_boost' then -0.20
            when 'deepen' then -0.16
            else 0
          end
        else 0
      end
    ) as pattern_score
  from decision d
  join public.spray_patterns_v1 sp
    on sp.active
   and d.context_key = any(sp.allowed_contexts)
  where case
    when d.layer_takeover_risk then sp.pattern_key = 'not_a_layer'
    else sp.pattern_key <> 'not_a_layer'
  end
),
selected_pattern as (
  select *
  from pattern_candidates
  order by pattern_score desc, sort_order asc, pattern_key asc
  limit 1
)
select
  jsonb_build_object(
    'key', p.pattern_key,
    'name', p.display_name,
    'user_description', p.user_description,
    'placement', coalesce(
      concat_ws(
        E'\n',
        case when nullif(p.anchor_placement_text, '') is not null then 'Anchor: ' || p.anchor_placement_text end,
        case when nullif(p.layer_placement_text, '') is not null then 'Layer: ' || p.layer_placement_text end
      ),
      p.placement_template
    ),
    'anchor_placement_text', p.anchor_placement_text,
    'layer_placement_text', p.layer_placement_text,
    'halo', p.halo_template,
    'trail', p.trail_template,
    'why_it_works', p.why_template,
    'anchor_sprays', p.default_anchor_sprays,
    'layer_sprays', p.default_layer_sprays,
    'spray_ratio', p.default_ratio,
    'is_layer_allowed', p.is_layer_allowed,
    'mode_affinity', to_jsonb(p.mode_affinity),
    'placement_style', p.placement_style,
    'intensity_level', p.intensity_level,
    'context', p.context_key,
    'mode', p.mode_key,
    'model_version', p.model_version,
    'source', 'resolve_layer_spray_pattern_v1'
  )
from selected_pattern p;
$function$;

create or replace function public.layer_spray_pattern_from_resolved_fields_v1(
  p_mode_entry jsonb
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with matched as (
  select sp.*
  from public.spray_patterns_v1 sp
  where sp.active
    and (
      lower(sp.pattern_key) = lower(coalesce(p_mode_entry->>'spray_pattern_key', ''))
      or lower(sp.display_name) = lower(coalesce(p_mode_entry->>'spray_pattern_name', ''))
      or lower(sp.display_name) = lower(coalesce(p_mode_entry->>'application_style', ''))
  )
  order by sp.sort_order
  limit 1
),
resolved as (
  select
    m.*,
    coalesce(
      nullif(p_mode_entry->'spray_pattern'->>'anchor_placement_text', ''),
      nullif(p_mode_entry->>'anchor_placement_text', ''),
      m.anchor_placement_text
    ) as resolved_anchor_placement_text,
    coalesce(
      nullif(p_mode_entry->'spray_pattern'->>'layer_placement_text', ''),
      nullif(p_mode_entry->>'layer_placement_text', ''),
      m.layer_placement_text
    ) as resolved_layer_placement_text
  from matched m
)
select
  case
    when not exists (select 1 from matched) then null
    else (
      select jsonb_build_object(
        'key', r.pattern_key,
        'name', r.display_name,
        'placement', coalesce(
          nullif(p_mode_entry->'spray_pattern'->>'placement', ''),
          nullif(p_mode_entry->>'placement_hint', ''),
          concat_ws(
            E'\n',
            case when nullif(r.resolved_anchor_placement_text, '') is not null then 'Anchor: ' || r.resolved_anchor_placement_text end,
            case when nullif(r.resolved_layer_placement_text, '') is not null then 'Layer: ' || r.resolved_layer_placement_text end
          ),
          r.placement_template
        ),
        'anchor_placement_text', r.resolved_anchor_placement_text,
        'layer_placement_text', r.resolved_layer_placement_text,
        'halo', coalesce(
          nullif(p_mode_entry->'spray_pattern'->>'halo', ''),
          nullif(p_mode_entry->>'halo', ''),
          r.halo_template
        ),
        'trail', coalesce(
          nullif(p_mode_entry->'spray_pattern'->>'trail', ''),
          nullif(p_mode_entry->>'trail', ''),
          r.trail_template
        ),
        'why_it_works', coalesce(
          nullif(p_mode_entry->'spray_pattern'->>'why_it_works', ''),
          nullif(p_mode_entry->>'why_it_works', ''),
          r.why_template
        ),
        'anchor_sprays', coalesce(p_mode_entry->'anchor_sprays', to_jsonb(r.default_anchor_sprays)),
        'layer_sprays', coalesce(p_mode_entry->'layer_sprays', to_jsonb(r.default_layer_sprays)),
        'spray_ratio', coalesce(
          nullif(p_mode_entry->'spray_pattern'->>'spray_ratio', ''),
          nullif(p_mode_entry->>'ratio_hint', ''),
          r.default_ratio
        ),
        'is_layer_allowed', r.is_layer_allowed,
        'mode_affinity', to_jsonb(r.mode_affinity),
        'placement_style', r.placement_style,
        'intensity_level', r.intensity_level,
        'model_version', r.model_version,
        'source', 'layer_spray_pattern_from_resolved_fields_v1'
      )
      from resolved r
    )
  end;
$function$;
