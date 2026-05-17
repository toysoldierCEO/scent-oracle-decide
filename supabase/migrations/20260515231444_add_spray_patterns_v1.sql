create table if not exists public.spray_patterns_v1 (
  pattern_key text primary key,
  display_name text not null,
  user_description text,
  placement_template text not null,
  halo_template text not null,
  trail_template text not null,
  why_template text not null,
  default_anchor_sprays integer not null default 2,
  default_layer_sprays integer not null default 1,
  default_ratio text not null default '2:1',
  allowed_contexts text[] not null default array['daily','work','hangout','date']::text[],
  family_hints text[] not null default '{}'::text[],
  mode_affinity text[] not null default array['balance']::text[],
  placement_style text not null default 'support',
  intensity_level text not null default 'controlled',
  is_layer_allowed boolean not null default true,
  sort_order integer not null default 100,
  active boolean not null default true,
  model_version text not null default 'spray_patterns_v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.spray_patterns_v1 enable row level security;

alter table public.spray_patterns_v1
  add column if not exists mode_affinity text[] not null default array['balance']::text[];

alter table public.spray_patterns_v1
  add column if not exists placement_style text not null default 'support';

alter table public.spray_patterns_v1
  add column if not exists intensity_level text not null default 'controlled';

revoke all on table public.spray_patterns_v1 from anon;
revoke all on table public.spray_patterns_v1 from authenticated;
grant select on table public.spray_patterns_v1 to service_role;

insert into public.spray_patterns_v1 (
  pattern_key,
  display_name,
  user_description,
  placement_template,
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
  sort_order
)
values
  (
    'anchor_halo',
    'Anchor Halo',
    'Anchor-forward support with a soft outer halo.',
    'Anchor on chest and neck. Let the layer sit just off-center so it forms a soft halo instead of a second lead.',
    'Soft ring around the anchor.',
    'Subtle edge lift while the anchor opens first.',
    'The anchor stays in front while the layer widens the aura softly.',
    2,
    1,
    '2:1',
    array['daily','work','hangout']::text[],
    array['support','low-risk']::text[],
    array['balance','smooth']::text[],
    'anchor_forward',
    'controlled',
    true,
    10
  ),
  (
    'split_trail',
    'Split Trail',
    'Separated zones keep contrast controlled.',
    'Two zones, no overlap: keep the anchor on warm skin and move the layer to a separate zone so they meet in motion.',
    'Separated pockets instead of one blended cloud.',
    'The scents meet after lift-off, not all at once on skin.',
    'Separation preserves the anchor while giving the layer room to add controlled contrast.',
    2,
    1,
    '2:1',
    array['hangout','date','social']::text[],
    array['contrast','separation']::text[],
    array['balance','bold','wild']::text[],
    'separated',
    'expressive',
    true,
    20
  ),
  (
    'soft_veil',
    'Soft Veil',
    'A sheer layer lifts the opening without changing the identity.',
    'Keep the anchor on skin. Let the layer land as a sheer mist on fabric, hair, or outer clothing.',
    'Barely-there veil around the anchor.',
    'Clean close trail that never crowds the anchor.',
    'The layer stays translucent, so the anchor keeps its identity while the top feels cleaner and softer.',
    2,
    1,
    '2:0.5',
    array['daily','work']::text[],
    array['airy','fresh','clean','musk','tea','citrus']::text[],
    array['smooth','balance']::text[],
    'sheer',
    'soft',
    true,
    30
  ),
  (
    'wrist_accent',
    'Wrist Accent',
    'A stronger layer stays off-center as a controlled accent.',
    'Anchor on chest and neck. Keep the layer to one wrist or inner forearm so it reads as an accent, not a takeover.',
    'Close accent outside the anchor core.',
    'Small discovery trail that appears in gestures.',
    'The layer has enough character to matter, so this pattern keeps it supportive instead of central.',
    2,
    1,
    '2:1',
    array['work','daily','hangout']::text[],
    array['accent','controlled-strength']::text[],
    array['bold','wild']::text[],
    'accent',
    'controlled',
    true,
    40
  ),
  (
    'trail_boost',
    'Trail Boost',
    'The layer extends the finish from behind the anchor.',
    'Anchor stays on chest and neck. Put the layer behind the neck, hem, fabric edge, or lower on the body so it blooms later in the trail.',
    'Rear-weighted halo that starts after the anchor.',
    'The anchor opens first; the layer arrives in the wake.',
    'This keeps the expression stronger in motion while protecting the anchor’s first impression.',
    2,
    1,
    '2:1',
    array['date','hangout']::text[],
    array['trail','longevity','drydown']::text[],
    array['bold','wild']::text[],
    'rear_trail',
    'expressive',
    true,
    50
  ),
  (
    'skin_lock',
    'Skin Lock',
    'Both scents stay close and disciplined on skin.',
    'Keep both scents close: anchor under clothing at chest or inner elbow, layer low or under a sleeve so the blend stays intimate.',
    'A tight skin bubble instead of a room-filling cloud.',
    'Minimal trail; the pair stays close and tidy.',
    'The pattern tightens both scents close to skin so the anchor reads cleanly without getting louder.',
    1,
    1,
    '1:1',
    array['work','daily','date']::text[],
    array['quiet','close-wear']::text[],
    array['smooth','balance']::text[],
    'close_wear',
    'quiet',
    true,
    60
  ),
  (
    'bright_lift',
    'Bright Lift',
    'A brighter layer freshens the top while the anchor holds the body.',
    'Anchor on chest. Place the layer slightly higher on neck or collarbone so it brightens the opening without replacing the anchor.',
    'A brighter ring above the anchor core.',
    'Fresh lift on top; the anchor still carries the body.',
    'The layer brightens the opening and adds air while the anchor keeps the structure underneath.',
    2,
    1,
    '2:1',
    array['daily','work','hangout','date']::text[],
    array['bright','fresh','lift']::text[],
    array['balance','bold','wild']::text[],
    'high_lift',
    'bright',
    true,
    70
  ),
  (
    'deepen',
    'Deepen',
    'Depth sits underneath the anchor instead of replacing it.',
    'Keep the anchor on warm skin. Let the layer sit lower or farther back so the added depth stays underneath, not on top.',
    'A lower shadow that supports the anchor.',
    'Warmer weight under the anchor, not over it.',
    'The layer adds depth from underneath, so the anchor stays recognizable while the finish gets darker and richer.',
    2,
    1,
    '2:1',
    array['date','hangout']::text[],
    array['warmth','base','depth']::text[],
    array['bold','smooth','wild']::text[],
    'low_shadow',
    'deep',
    true,
    80
  ),
  (
    'not_a_layer',
    'Not a Layer',
    'The second scent wants to lead, so this pair is better apart.',
    'Do not layer these as a normal pair.',
    'No safe halo.',
    'Better worn separately.',
    'Not recommended as a layer because the support scent is likely to overtake the anchor. Treat it as a main-scent candidate, not a layer.',
    0,
    0,
    '0:0',
    array['daily','work','hangout','date']::text[],
    array['failure','takeover']::text[],
    array['balance','bold','smooth','wild']::text[],
    'rejected',
    'blocked',
    false,
    90
  )
on conflict (pattern_key) do update
set
  display_name = excluded.display_name,
  user_description = excluded.user_description,
  placement_template = excluded.placement_template,
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
  active = true,
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
    'user_description',
      case p.pattern_key
        when 'anchor_halo' then 'Anchor-forward support with a soft outer halo.'
        when 'split_trail' then 'Separated zones keep contrast controlled.'
        when 'soft_veil' then 'A sheer layer lifts the opening without changing the identity.'
        when 'wrist_accent' then 'A stronger layer stays off-center as a controlled accent.'
        when 'trail_boost' then 'The layer extends the finish from behind the anchor.'
        when 'skin_lock' then 'Both scents stay close and disciplined on skin.'
        when 'bright_lift' then 'A brighter layer freshens the top while the anchor holds the body.'
        when 'deepen' then 'Depth sits underneath the anchor instead of replacing it.'
        else p.user_description
      end,
    'placement',
      case p.pattern_key
        when 'anchor_halo' then
          case
            when p.mode_key = 'smooth' then 'Keep the anchor on chest and neck. Let the layer sit behind the neck or along one collarbone so it rounds the edges softly.'
            when p.context_key = 'work' then 'Anchor on chest and neck. Keep the layer to one collarbone or just behind the neck so it stays polished and controlled.'
            else 'Anchor on chest and neck. Let the layer sit just off-center so it forms a soft halo without taking the lead.'
          end
        when 'split_trail' then
          case
            when p.mode_key = 'wild' then 'Two zones, no overlap: anchor near the chest, layer on the arms or back of neck so they meet in motion.'
            when p.mode_key = 'bold' then 'Keep the anchor on chest and neck. Move the layer to wrist, forearm, or back of neck so the contrast arrives later instead of all at once.'
            when p.context_key = 'work' then 'Use two clean zones: anchor on chest, layer low on wrist or sleeve edge so the contrast stays disciplined.'
            else 'Use separate zones: anchor on warm skin, layer on wrist or back of neck so they meet in the air instead of crowding the skin.'
          end
        when 'soft_veil' then
          case
            when p.mode_key = 'smooth' then 'Keep the anchor close to the chest. Let the layer land as a soft mist on fabric, hair, or outer clothing for a cleaner edge.'
            when p.context_key = 'work' then 'Anchor on skin. Let the layer sit lightly on fabric or scarf so it stays sheer and office-safe.'
            else 'Anchor on chest and neck. Keep the layer sheer and slightly off-skin so it lifts the opening without changing the profile.'
          end
        when 'wrist_accent' then
          case
            when p.mode_key = 'bold' then 'Anchor on chest and neck. Keep the layer to one wrist or inner forearm so it reads as a deliberate accent, not a takeover.'
            when p.mode_key = 'wild' then 'Anchor stays central. Put the layer on one wrist or forearm so the contrast appears in gestures instead of over the anchor.'
            when p.context_key = 'work' then 'Anchor on chest and neck. Keep the layer to one wrist so it stays controlled and only appears up close.'
            else 'Anchor on chest and neck. Let the layer live on one wrist or forearm as a small controlled accent.'
          end
        when 'trail_boost' then
          case
            when p.mode_key = 'bold' then 'Anchor stays on chest and neck. Put the layer behind the neck, hem, or back of knees so it blooms later in the trail.'
            when p.context_key = 'date' then 'Anchor stays on warm skin. Move the layer behind the neck or low on the body so the finish grows more magnetic as you move.'
            when p.mode_key = 'wild' then 'Keep the anchor up front. Let the layer sit behind the neck or low on the body so the trail develops separately and later.'
            else 'Anchor on chest and neck. Let the layer sit behind the body so it lengthens the finish without jumping ahead.'
          end
        when 'skin_lock' then
          case
            when p.mode_key = 'smooth' then 'Keep both scents close: anchor under clothing at chest or inner elbow, layer low or under a sleeve so the blend stays intimate.'
            when p.context_key = 'work' then 'Keep both scents close to skin and under clothing. Anchor at chest, layer low on inner elbow or under a sleeve for a disciplined bubble.'
            else 'Anchor close to the chest. Keep the layer low and covered so the pairing stays neat and personal.'
          end
        when 'bright_lift' then
          case
            when p.mode_key = 'bold' then 'Anchor on chest. Place the layer slightly higher on neck or collarbone so it throws brightness first, then falls back behind the anchor.'
            when p.mode_key = 'wild' then 'Keep the anchor on chest. Let the layer sit a little higher and off-center so the freshness flashes first without replacing the anchor.'
            when p.context_key = 'work' then 'Anchor on chest. Keep the layer high but minimal on neck or collarbone so the opening feels brighter without getting louder.'
            else 'Anchor on chest and neck. Place the layer slightly higher so it lifts the opening and keeps air around the anchor.'
          end
        when 'deepen' then
          case
            when p.mode_key = 'smooth' then 'Keep the anchor on chest and neck. Place the layer lower or behind the neck so the added depth stays underneath and close.'
            when p.mode_key = 'bold' then 'Anchor stays on chest and neck. Put the layer lower, behind the neck, or at the back of the body so it adds weight from underneath, not on top.'
            when p.mode_key = 'wild' then 'Use separation with gravity: anchor high on chest and neck, layer lower or farther back so the darker depth develops underneath the anchor.'
            when p.context_key = 'date' then 'Anchor stays on chest and neck. Place the layer lower or behind the neck so the warmth arrives later and deeper in the drydown.'
            else 'Keep the anchor on warm skin. Let the layer sit lower so it adds depth without stepping in front.'
          end
        else 'Not recommended as a layer. The support scent is likely to overtake the anchor.'
      end,
    'halo',
      case p.pattern_key
        when 'anchor_halo' then 'A soft ring around the anchor, not a second center of gravity.'
        when 'split_trail' then 'Separated pockets keep the contrast airy instead of blended.'
        when 'soft_veil' then 'A sheer veil that stays close and breathable.'
        when 'wrist_accent' then 'A close accent that stays outside the anchor’s core.'
        when 'trail_boost' then 'Rear-weighted halo that starts after the anchor.'
        when 'skin_lock' then 'A tight skin bubble instead of a room-filling cloud.'
        when 'bright_lift' then 'A brighter ring above the anchor’s core.'
        when 'deepen' then 'A lower shadow that supports the anchor instead of covering it.'
        else 'No safe halo for this pairing.'
      end,
    'trail',
      case p.pattern_key
        when 'anchor_halo' then
          case when p.context_key = 'work' then 'Quiet trail that stays close to the anchor.' else 'Subtle lift around the edges while the anchor opens first.' end
        when 'split_trail' then
          case when p.mode_key = 'wild' then 'The layer flashes in motion while the anchor still owns the first impression.' else 'The scents meet after lift-off, not all at once on skin.' end
        when 'soft_veil' then 'Clean, close, and barely louder than the anchor.'
        when 'wrist_accent' then 'The layer appears in small passes while the anchor stays first.'
        when 'trail_boost' then 'The anchor opens first; the layer arrives in the wake.'
        when 'skin_lock' then 'Minimal trail; the pair stays close and tidy.'
        when 'bright_lift' then 'Fresh lift on top; the anchor still carries the body.'
        when 'deepen' then 'Warmer weight under the anchor, not over it.'
        else 'Better worn separately or treated as a main-scent alternate.'
      end,
    'why_it_works',
      case p.pattern_key
        when 'anchor_halo' then 'The anchor stays in front while the layer widens the aura softly.'
        when 'split_trail' then 'Separation preserves the anchor while giving the layer room to add controlled contrast.'
        when 'soft_veil' then 'The layer stays translucent, so the anchor keeps its identity while the top feels cleaner and softer.'
        when 'wrist_accent' then 'The layer has enough character to matter, so this pattern keeps it supportive instead of central.'
        when 'trail_boost' then 'This keeps the expression stronger in motion while protecting the anchor’s first impression.'
        when 'skin_lock' then 'The pattern tightens both scents close to skin so the anchor reads cleanly without getting louder.'
        when 'bright_lift' then 'The layer brightens the opening and adds air while the anchor keeps the structure underneath.'
        when 'deepen' then 'The layer adds depth from underneath, so the anchor stays recognizable while the finish gets darker and richer.'
        else 'Not recommended as a layer because the support scent is likely to overtake the anchor. Treat it as a main-scent candidate, not a layer.'
      end,
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
meta as (
  select lower(
    coalesce(
      nullif(p_mode_entry->>'mode', ''),
      nullif(p_mode_entry->>'requested_mode', ''),
      'balance'
    )
  ) as mode_key
)
select
  case
    when not exists (select 1 from matched) then null
    else (
      select jsonb_build_object(
        'key', m.pattern_key,
        'name', m.display_name,
        'placement', coalesce(nullif(p_mode_entry->>'placement_hint', ''), m.placement_template),
        'halo', coalesce(
          nullif(p_mode_entry->>'halo', ''),
          case m.pattern_key
            when 'anchor_halo' then 'A soft ring around the anchor, not a second center of gravity.'
            when 'split_trail' then 'Separated pockets keep the contrast airy instead of blended.'
            when 'soft_veil' then 'A sheer veil that stays close and breathable.'
            when 'wrist_accent' then 'A close accent that stays outside the anchor’s core.'
            when 'trail_boost' then 'Rear-weighted halo that starts after the anchor.'
            when 'skin_lock' then 'A tight skin bubble instead of a room-filling cloud.'
            when 'bright_lift' then 'A brighter ring above the anchor’s core.'
            when 'deepen' then 'A lower shadow that supports the anchor instead of covering it.'
            else 'No safe halo for this pairing.'
          end
        ),
        'trail', coalesce(
          nullif(p_mode_entry->>'trail', ''),
          case m.pattern_key
            when 'anchor_halo' then 'Subtle lift around the edges while the anchor opens first.'
            when 'split_trail' then case when meta.mode_key = 'wild' then 'The layer flashes in motion while the anchor still owns the first impression.' else 'The scents meet after lift-off, not all at once on skin.' end
            when 'soft_veil' then 'Clean, close, and barely louder than the anchor.'
            when 'wrist_accent' then 'The layer appears in small passes while the anchor stays first.'
            when 'trail_boost' then 'The anchor opens first; the layer arrives in the wake.'
            when 'skin_lock' then 'Minimal trail; the pair stays close and tidy.'
            when 'bright_lift' then 'Fresh lift on top; the anchor still carries the body.'
            when 'deepen' then 'Warmer weight under the anchor, not over it.'
            else 'Better worn separately or treated as a main-scent alternate.'
          end
        ),
        'why_it_works', coalesce(nullif(p_mode_entry->>'why_it_works', ''), m.why_template),
        'anchor_sprays', m.default_anchor_sprays,
        'layer_sprays', m.default_layer_sprays,
        'spray_ratio', coalesce(nullif(p_mode_entry->>'ratio_hint', ''), m.default_ratio),
        'is_layer_allowed', m.is_layer_allowed,
        'mode_affinity', to_jsonb(m.mode_affinity),
        'placement_style', m.placement_style,
        'intensity_level', m.intensity_level,
        'model_version', m.model_version,
        'source', 'layer_spray_pattern_from_resolved_fields_v1'
      )
      from matched m
      cross join meta
    )
  end;
$function$;

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
    select distinct on (lower(f.name), lower(f.brand))
      f.id,
      f.name,
      f.brand,
      f.family_key,
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
      coalesce(g.longevity_score, 0.5) as longevity_score,
      coalesce(g.top_weight, 0.33) as top_weight,
      coalesce(g.base_weight, 0.33) as base_weight
    from public.user_collection uc
    join public.fragrances f
      on f.id = uc.fragrance_id
    left join public.fragrance_genome g
      on g.fragrance_id = f.id
    where uc.user_id = p_user
      and uc.status in ('signature', 'owned', 'liked')
      and f.id <> p_fragrance_id
      and not (f.id = any(coalesce(p_exclude_fragrance_ids, '{}'::uuid[])))
      and (p_brand is null or f.brand = p_brand)
    order by
      lower(f.name),
      lower(f.brand),
      case when uc.status = 'signature' then 0 else 1 end,
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

create or replace function public.normalize_signed_in_layer_mode_entry_v3(
  p_mode_entry jsonb
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with spray as (
  select public.layer_spray_pattern_from_resolved_fields_v1(p_mode_entry) as pattern
)
select
  case
    when p_mode_entry is null
      or nullif(p_mode_entry->>'layer_fragrance_id', '') is null
    then null
    else jsonb_build_object(
      'mode', coalesce(p_mode_entry->>'mode', p_mode_entry->>'requested_mode'),
      'fragrance_id', p_mode_entry->'layer_fragrance_id',
      'name', p_mode_entry->>'layer_name',
      'brand', p_mode_entry->>'layer_brand',
      'family', p_mode_entry->>'layer_family',
      'layer_score', coalesce(p_mode_entry->'layer_score', 'null'::jsonb),
      'ratio_hint', p_mode_entry->>'ratio_hint',
      'application_style', p_mode_entry->>'application_style',
      'placement_hint', p_mode_entry->>'placement_hint',
      'spray_guidance', p_mode_entry->>'spray_guidance',
      'reason', p_mode_entry->>'reason',
      'why_it_works', p_mode_entry->>'why_it_works',
      'spray_pattern', spray.pattern,
      'spray_pattern_key', spray.pattern->>'key',
      'spray_pattern_name', spray.pattern->>'name',
      'anchor_sprays', coalesce(spray.pattern->'anchor_sprays', 'null'::jsonb),
      'layer_sprays', coalesce(spray.pattern->'layer_sprays', 'null'::jsonb),
      'halo', spray.pattern->>'halo',
      'trail', spray.pattern->>'trail',
      'tokens', public.get_fragrance_card_tokens_v2(
        nullif(p_mode_entry->>'layer_fragrance_id', '')::uuid,
        4
      )
    )
  end
from spray;
$function$;

create or replace function public.normalize_signed_in_oracle_layer_entry_v2(
  p_layer jsonb
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with spray as (
  select public.layer_spray_pattern_from_resolved_fields_v1(p_layer) as pattern
)
select
  case
    when p_layer is null
      or nullif(p_layer->>'fragrance_id', '') is null
    then null
    else jsonb_build_object(
      'fragrance_id', p_layer->'fragrance_id',
      'name', p_layer->>'name',
      'brand', p_layer->>'brand',
      'family', p_layer->>'family',
      'reason', p_layer->>'reason',
      'ratio_hint', p_layer->>'ratio_hint',
      'application_style', p_layer->>'application_style',
      'placement_hint', p_layer->>'placement_hint',
      'spray_guidance', p_layer->>'spray_guidance',
      'layer_mode', p_layer->>'layer_mode',
      'layer_score', coalesce(p_layer->'layer_score', 'null'::jsonb),
      'why_it_works', p_layer->>'why_it_works',
      'spray_pattern', coalesce(p_layer->'spray_pattern', spray.pattern),
      'spray_pattern_key', coalesce(p_layer->>'spray_pattern_key', spray.pattern->>'key'),
      'spray_pattern_name', coalesce(p_layer->>'spray_pattern_name', spray.pattern->>'name'),
      'anchor_sprays', coalesce(p_layer->'anchor_sprays', spray.pattern->'anchor_sprays', 'null'::jsonb),
      'layer_sprays', coalesce(p_layer->'layer_sprays', spray.pattern->'layer_sprays', 'null'::jsonb),
      'halo', coalesce(p_layer->>'halo', spray.pattern->>'halo'),
      'trail', coalesce(p_layer->>'trail', spray.pattern->>'trail'),
      'tokens', public.get_fragrance_card_tokens_v2(
        nullif(p_layer->>'fragrance_id', '')::uuid,
        4
      )
    )
  end
from spray;
$function$;

create or replace function public.normalize_guest_layer_entry_v2(
  p_layer jsonb
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with spray as (
  select public.layer_spray_pattern_from_resolved_fields_v1(p_layer) as pattern
)
select
  case
    when p_layer is null
      or coalesce(
        nullif(p_layer->>'name', ''),
        nullif(p_layer->>'layer_name', '')
      ) is null
    then null
    else jsonb_build_object(
      'fragrance_id', coalesce(p_layer->'fragrance_id', p_layer->'layer_fragrance_id'),
      'name', coalesce(p_layer->>'name', p_layer->>'layer_name'),
      'brand', coalesce(p_layer->>'brand', p_layer->>'layer_brand'),
      'family', coalesce(p_layer->>'family', p_layer->>'layer_family'),
      'bind_status', p_layer->>'bind_status',
      'reason', p_layer->>'reason',
      'why_it_works', p_layer->>'why_it_works',
      'ratio_hint', p_layer->>'ratio_hint',
      'application_style', p_layer->>'application_style',
      'placement_hint', p_layer->>'placement_hint',
      'spray_guidance', p_layer->>'spray_guidance',
      'spray_pattern', coalesce(p_layer->'spray_pattern', spray.pattern),
      'spray_pattern_key', coalesce(p_layer->>'spray_pattern_key', spray.pattern->>'key'),
      'spray_pattern_name', coalesce(p_layer->>'spray_pattern_name', spray.pattern->>'name'),
      'anchor_sprays', coalesce(p_layer->'anchor_sprays', spray.pattern->'anchor_sprays', 'null'::jsonb),
      'layer_sprays', coalesce(p_layer->'layer_sprays', spray.pattern->'layer_sprays', 'null'::jsonb),
      'halo', coalesce(p_layer->>'halo', spray.pattern->>'halo'),
      'trail', coalesce(p_layer->>'trail', spray.pattern->>'trail'),
      'layer_score', coalesce(p_layer->'layer_score', 'null'::jsonb),
      'tokens', coalesce(p_layer->'tokens', '[]'::jsonb)
    )
  end
from spray;
$function$;

create or replace function public.attach_layer_spray_pattern_to_entry_v1(
  p_layer jsonb,
  p_anchor_fragrance_id uuid,
  p_context text default 'daily'::text,
  p_mode text default 'balance'::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_layer_id uuid;
  v_pattern jsonb;
begin
  if p_layer is null or p_anchor_fragrance_id is null then
    return p_layer;
  end if;

  v_layer_id := nullif(coalesce(p_layer->>'fragrance_id', p_layer->>'layer_fragrance_id'), '')::uuid;

  if v_layer_id is null then
    return p_layer;
  end if;

  v_pattern := public.resolve_layer_spray_pattern_v1(
    p_anchor_fragrance_id,
    v_layer_id,
    p_context,
    p_mode
  );

  if v_pattern is null then
    return p_layer;
  end if;

  if coalesce((v_pattern->>'is_layer_allowed')::boolean, true) = false then
    return null;
  end if;

  return p_layer
    || jsonb_build_object(
      'spray_pattern', v_pattern,
      'spray_pattern_key', v_pattern->>'key',
      'spray_pattern_name', v_pattern->>'name',
      'anchor_sprays', coalesce(v_pattern->'anchor_sprays', 'null'::jsonb),
      'layer_sprays', coalesce(v_pattern->'layer_sprays', 'null'::jsonb),
      'ratio_hint', coalesce(v_pattern->>'spray_ratio', p_layer->>'ratio_hint'),
      'application_style', coalesce(v_pattern->>'name', p_layer->>'application_style'),
      'placement_hint', coalesce(v_pattern->>'placement', p_layer->>'placement_hint'),
      'spray_guidance',
        coalesce(v_pattern->>'name', 'Spray Pattern')
        || ' - '
        || coalesce(v_pattern->>'spray_ratio', '2:1')
        || '. '
        || coalesce(v_pattern->>'trail', 'Anchor leads.'),
      'halo', v_pattern->>'halo',
      'trail', v_pattern->>'trail'
    );
end;
$function$;

create or replace function public.attach_guest_bundle_spray_patterns_v1(
  p_bundle jsonb,
  p_anchor_fragrance_id uuid,
  p_context text default 'daily'::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb := coalesce(p_bundle, '{}'::jsonb);
  v_mode text;
  v_layers jsonb;
  v_new_layers jsonb;
  v_default_mode text := lower(coalesce(nullif(p_bundle->>'ui_default_mode', ''), 'balance'));
  v_top_layer jsonb;
begin
  if p_bundle is null or p_anchor_fragrance_id is null then
    return p_bundle;
  end if;

  foreach v_mode in array array['balance','bold','smooth','wild']::text[]
  loop
    v_layers := v_result #> array['layer_modes', v_mode, 'layers'];

    if jsonb_typeof(v_layers) = 'array' then
      with transformed as (
        select
          public.attach_layer_spray_pattern_to_entry_v1(
            e.layer_obj,
            p_anchor_fragrance_id,
            p_context,
            v_mode
          ) as layer_obj,
          e.ordinality
        from jsonb_array_elements(v_layers) with ordinality as e(layer_obj, ordinality)
      )
      select coalesce(
        jsonb_agg(t.layer_obj order by t.ordinality) filter (where t.layer_obj is not null),
        '[]'::jsonb
      )
      into v_new_layers
      from transformed t;

      v_result := jsonb_set(
        v_result,
        array['layer_modes', v_mode, 'layers'],
        coalesce(v_new_layers, '[]'::jsonb),
        true
      );
    end if;
  end loop;

  v_top_layer := coalesce(
    v_result #> array['layer_modes', v_default_mode, 'layers', '0'],
    v_result #> array['layer_modes', 'balance', 'layers', '0'],
    public.attach_layer_spray_pattern_to_entry_v1(v_result->'layer', p_anchor_fragrance_id, p_context, v_default_mode)
  );

  v_result := jsonb_set(v_result, '{layer}', coalesce(v_top_layer, 'null'::jsonb), true);

  if v_top_layer is not null then
    v_result := jsonb_set(v_result, '{layer_tokens}', coalesce(v_top_layer->'tokens', v_result->'layer_tokens', '[]'::jsonb), true);
  end if;

  return v_result;
end;
$function$;

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
  v_main_bundle jsonb;
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

    v_main_bundle := public.attach_guest_bundle_spray_patterns_v1(
      v_payload->'main_bundle',
      v_resolved_hero_fragrance_id,
      v_context_key
    );

    if v_main_bundle is not null then
      v_payload := jsonb_set(v_payload, '{main_bundle}', v_main_bundle, true);
      v_payload := jsonb_set(v_payload, '{layer}', coalesce(v_main_bundle->'layer', 'null'::jsonb), true);
      v_payload := jsonb_set(v_payload, '{layer_modes}', coalesce(v_main_bundle->'layer_modes', '{}'::jsonb), true);
      v_payload := jsonb_set(v_payload, '{layer_tokens}', coalesce(v_main_bundle->'layer_tokens', '[]'::jsonb), true);
    end if;
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

revoke all on function public.resolve_layer_spray_pattern_v1(uuid, uuid, text, text) from anon;
revoke all on function public.resolve_layer_spray_pattern_v1(uuid, uuid, text, text) from authenticated;
grant execute on function public.resolve_layer_spray_pattern_v1(uuid, uuid, text, text) to service_role;

revoke all on function public.layer_spray_pattern_from_resolved_fields_v1(jsonb) from anon;
revoke all on function public.layer_spray_pattern_from_resolved_fields_v1(jsonb) from authenticated;
grant execute on function public.layer_spray_pattern_from_resolved_fields_v1(jsonb) to service_role;

notify pgrst, 'reload schema';
