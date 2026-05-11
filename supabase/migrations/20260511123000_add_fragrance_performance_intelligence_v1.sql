create or replace function public.normalize_performance_term_v1(p_value text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.clamp_performance_score_v1(p_value numeric)
returns numeric
language sql
immutable
as $$
  select greatest(0::numeric, least(1::numeric, coalesce(p_value, 0::numeric)));
$$;

revoke all on function public.normalize_performance_term_v1(text) from public;
revoke all on function public.normalize_performance_term_v1(text) from anon;
revoke all on function public.normalize_performance_term_v1(text) from authenticated;
grant execute on function public.normalize_performance_term_v1(text) to service_role;

revoke all on function public.clamp_performance_score_v1(numeric) from public;
revoke all on function public.clamp_performance_score_v1(numeric) from anon;
revoke all on function public.clamp_performance_score_v1(numeric) from authenticated;
grant execute on function public.clamp_performance_score_v1(numeric) to service_role;

create table if not exists public.performance_signal_dictionary_v1 (
  signal_key text primary key,
  match_term text not null,
  normalized_term text not null,
  signal_type text not null,
  evidence_tier text not null,
  base_confidence numeric(4,3) not null,
  detection_source_preference text[] not null default '{}'::text[],
  performance_effects jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  model_version text not null default 'performance_signal_dictionary_v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.performance_signal_dictionary_v1 enable row level security;

revoke all on public.performance_signal_dictionary_v1 from anon;
revoke all on public.performance_signal_dictionary_v1 from authenticated;

with seed_rows as (
  select *
  from (
    values
      (
        'ambroxan',
        'ambroxan',
        'projection_driver',
        'named_material',
        0.920::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.82,"tenacity":0.44,"odor_impact":0.68,"diffusion_bridge":true,"beast_mode_risk":0.56,"balancing_strategy":"avoid_loud_on_loud"}'::jsonb
      ),
      (
        'ambroxide',
        'ambroxide',
        'projection_driver',
        'named_material',
        0.900::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.80,"tenacity":0.42,"odor_impact":0.64,"diffusion_bridge":true,"beast_mode_risk":0.52,"balancing_strategy":"avoid_loud_on_loud"}'::jsonb
      ),
      (
        'amberwood',
        'amberwood',
        'projection_driver',
        'named_material',
        0.940::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.86,"tenacity":0.52,"odor_impact":0.74,"density":0.48,"base_weight":0.42,"super_amber":true,"woody_amber_dominance":0.90,"beast_mode_risk":0.74,"balancing_strategy":"avoid_loud_on_loud"}'::jsonb
      ),
      (
        'woody_amber',
        'woody amber',
        'projection_driver',
        'accord_family',
        0.820::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text','family_key']::text[],
        '{"projection":0.72,"tenacity":0.44,"odor_impact":0.60,"density":0.38,"base_weight":0.36,"super_amber":true,"woody_amber_dominance":0.78,"beast_mode_risk":0.62,"balancing_strategy":"avoid_loud_on_loud"}'::jsonb
      ),
      (
        'mineral_amber',
        'mineral amber',
        'projection_driver',
        'accord_family',
        0.820::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.74,"tenacity":0.38,"odor_impact":0.60,"super_amber":true,"woody_amber_dominance":0.72,"beast_mode_risk":0.58,"balancing_strategy":"avoid_loud_on_loud"}'::jsonb
      ),
      (
        'amber_xtreme',
        'amber xtreme',
        'projection_driver',
        'named_material',
        0.970::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.96,"tenacity":0.60,"odor_impact":0.86,"density":0.54,"base_weight":0.46,"super_amber":true,"woody_amber_dominance":0.96,"beast_mode_risk":0.92,"balancing_strategy":"solo_or_one_spray_anchor"}'::jsonb
      ),
      (
        'ambrocenide',
        'ambrocenide',
        'projection_driver',
        'named_material',
        0.970::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.94,"tenacity":0.58,"odor_impact":0.84,"density":0.52,"base_weight":0.44,"super_amber":true,"woody_amber_dominance":0.94,"beast_mode_risk":0.90,"balancing_strategy":"solo_or_one_spray_anchor"}'::jsonb
      ),
      (
        'ambermax',
        'ambermax',
        'projection_driver',
        'named_material',
        0.950::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.90,"tenacity":0.54,"odor_impact":0.80,"density":0.48,"base_weight":0.42,"super_amber":true,"woody_amber_dominance":0.90,"beast_mode_risk":0.84,"balancing_strategy":"solo_or_one_spray_anchor"}'::jsonb
      ),
      (
        'javanol',
        'javanol',
        'projection_driver',
        'named_material',
        0.910::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.72,"tenacity":0.44,"odor_impact":0.68,"density":0.40,"base_weight":0.34,"beast_mode_risk":0.48,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'norlimbanol',
        'norlimbanol',
        'projection_driver',
        'named_material',
        0.950::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.90,"tenacity":0.62,"odor_impact":0.82,"density":0.56,"base_weight":0.46,"super_amber":true,"woody_amber_dominance":0.92,"beast_mode_risk":0.88,"balancing_strategy":"solo_or_one_spray_anchor"}'::jsonb
      ),
      (
        'aldehyde',
        'aldehyde',
        'lift',
        'named_material',
        0.780::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.42,"odor_impact":0.38,"lift":0.76,"aldehydic_lift":true,"balancing_strategy":"airy_lift_support"}'::jsonb
      ),
      (
        'aldehydes',
        'aldehydes',
        'lift',
        'accord_family',
        0.720::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"projection":0.38,"odor_impact":0.34,"lift":0.74,"aldehydic_lift":true,"balancing_strategy":"airy_lift_support"}'::jsonb
      ),
      (
        'hedione',
        'hedione',
        'diffusion_bridge',
        'named_material',
        0.860::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"projection":0.42,"lift":0.34,"diffusion_bridge":true,"transparency":0.24,"balancing_strategy":"airy_lift_support"}'::jsonb
      ),
      (
        'iso_e_super',
        'iso e super',
        'diffusion_bridge',
        'named_material',
        0.900::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"projection":0.56,"tenacity":0.28,"diffusion_bridge":true,"transparency":0.32,"beast_mode_risk":0.18,"balancing_strategy":"airy_lift_support"}'::jsonb
      ),
      (
        'timbersilk',
        'timbersilk',
        'diffusion_bridge',
        'named_material',
        0.840::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"projection":0.46,"tenacity":0.24,"diffusion_bridge":true,"transparency":0.28,"balancing_strategy":"airy_lift_support"}'::jsonb
      ),
      (
        'sylvamber',
        'sylvamber',
        'diffusion_bridge',
        'named_material',
        0.880::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"projection":0.60,"tenacity":0.34,"diffusion_bridge":true,"transparency":0.22,"beast_mode_risk":0.24,"balancing_strategy":"airy_lift_support"}'::jsonb
      ),
      (
        'musk',
        'musk',
        'fixative',
        'accord_family',
        0.540::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.36,"base_weight":0.18,"fixative":true,"musk_fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'clean_musk',
        'clean musk',
        'fixative',
        'accord_family',
        0.700::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.34,"transparency":0.22,"fixative":true,"musk_fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'white_musk',
        'white musk',
        'fixative',
        'named_material',
        0.760::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.38,"transparency":0.20,"fixative":true,"musk_fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'skin_musk',
        'skin musk',
        'fixative',
        'accord_family',
        0.680::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.30,"transparency":0.22,"fixative":true,"musk_fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'galaxolide',
        'galaxolide',
        'fixative',
        'named_material',
        0.920::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"tenacity":0.56,"base_weight":0.22,"fixative":true,"musk_fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'ethylene_brassylate',
        'ethylene brassylate',
        'fixative',
        'named_material',
        0.910::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"tenacity":0.54,"base_weight":0.22,"fixative":true,"musk_fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'exaltolide',
        'exaltolide',
        'fixative',
        'named_material',
        0.920::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"tenacity":0.54,"base_weight":0.20,"fixative":true,"musk_fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'ambrettolide',
        'ambrettolide',
        'fixative',
        'named_material',
        0.920::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"tenacity":0.56,"base_weight":0.22,"fixative":true,"musk_fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'helvetolide',
        'helvetolide',
        'fixative',
        'named_material',
        0.920::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"tenacity":0.52,"base_weight":0.18,"fixative":true,"musk_fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'vanilla',
        'vanilla',
        'sweet_base_persistence',
        'accord_family',
        0.720::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text','family_key']::text[],
        '{"tenacity":0.48,"density":0.30,"base_weight":0.42,"sweet_base_persistence":true,"beast_mode_risk":0.14,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'vanillin',
        'vanillin',
        'sweet_base_persistence',
        'named_material',
        0.900::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"tenacity":0.54,"density":0.34,"base_weight":0.46,"sweet_base_persistence":true,"beast_mode_risk":0.18,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'ethyl_vanillin',
        'ethyl vanillin',
        'sweet_base_persistence',
        'named_material',
        0.920::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"tenacity":0.58,"density":0.38,"base_weight":0.48,"sweet_base_persistence":true,"beast_mode_risk":0.20,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'benzoin',
        'benzoin',
        'resin_anchor',
        'named_material',
        0.860::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.52,"density":0.42,"base_weight":0.50,"resin_anchor":true,"sweet_base_persistence":true,"beast_mode_risk":0.24,"balancing_strategy":"resin_softener"}'::jsonb
      ),
      (
        'labdanum',
        'labdanum',
        'resin_anchor',
        'named_material',
        0.900::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.58,"density":0.50,"base_weight":0.56,"resin_anchor":true,"beast_mode_risk":0.32,"balancing_strategy":"resin_softener"}'::jsonb
      ),
      (
        'patchouli',
        'patchouli',
        'resin_anchor',
        'named_material',
        0.840::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.46,"density":0.36,"base_weight":0.40,"resin_anchor":true,"beast_mode_risk":0.20,"balancing_strategy":"resin_softener"}'::jsonb
      ),
      (
        'sandalwood',
        'sandalwood',
        'fixative',
        'named_material',
        0.760::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.38,"base_weight":0.24,"fixative":true,"beast_mode_risk":0.10,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'vetiver',
        'vetiver',
        'fixative',
        'named_material',
        0.760::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.38,"base_weight":0.22,"lift":0.12,"fixative":true,"balancing_strategy":"citrus_tea_clarifier"}'::jsonb
      ),
      (
        'tonka',
        'tonka',
        'sweet_base_persistence',
        'named_material',
        0.820::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.46,"density":0.30,"base_weight":0.42,"sweet_base_persistence":true,"beast_mode_risk":0.16,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'opoponax',
        'opoponax',
        'resin_anchor',
        'named_material',
        0.860::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.50,"density":0.44,"base_weight":0.48,"resin_anchor":true,"beast_mode_risk":0.22,"balancing_strategy":"resin_softener"}'::jsonb
      ),
      (
        'copaiba',
        'copaiba',
        'resin_anchor',
        'named_material',
        0.840::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"tenacity":0.34,"density":0.28,"base_weight":0.22,"resin_anchor":true,"balancing_strategy":"resin_softener"}'::jsonb
      ),
      (
        'ambrette',
        'ambrette',
        'fixative',
        'named_material',
        0.820::numeric,
        array['note','enrichment_note','enrichment_text']::text[],
        '{"tenacity":0.38,"base_weight":0.18,"fixative":true,"musk_fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'oud',
        'oud',
        'resin_anchor',
        'named_material',
        0.860::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text','family_key']::text[],
        '{"projection":0.28,"tenacity":0.52,"odor_impact":0.44,"density":0.50,"base_weight":0.56,"resin_anchor":true,"beast_mode_risk":0.32,"balancing_strategy":"avoid_loud_on_loud"}'::jsonb
      ),
      (
        'oakmoss',
        'oakmoss',
        'fixative',
        'named_material',
        0.800::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.40,"base_weight":0.24,"fixative":true,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'citrus',
        'citrus',
        'lift',
        'accord_family',
        0.480::numeric,
        array['note','enrichment_note','accord','enrichment_accord','family_key','enrichment_text']::text[],
        '{"lift":0.54,"transparency":0.18,"balancing_strategy":"citrus_tea_clarifier"}'::jsonb
      ),
      (
        'bergamot',
        'bergamot',
        'lift',
        'named_material',
        0.760::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"lift":0.70,"transparency":0.24,"balancing_strategy":"citrus_tea_clarifier"}'::jsonb
      ),
      (
        'lemon',
        'lemon',
        'lift',
        'named_material',
        0.740::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"lift":0.68,"transparency":0.24,"balancing_strategy":"citrus_tea_clarifier"}'::jsonb
      ),
      (
        'orange',
        'orange',
        'lift',
        'named_material',
        0.700::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"lift":0.62,"transparency":0.20,"balancing_strategy":"citrus_tea_clarifier"}'::jsonb
      ),
      (
        'grapefruit',
        'grapefruit',
        'lift',
        'named_material',
        0.740::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"lift":0.68,"transparency":0.24,"balancing_strategy":"citrus_tea_clarifier"}'::jsonb
      ),
      (
        'ginger',
        'ginger',
        'lift',
        'named_material',
        0.720::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"lift":0.56,"odor_impact":0.18,"balancing_strategy":"citrus_tea_clarifier"}'::jsonb
      ),
      (
        'mint',
        'mint',
        'lift',
        'named_material',
        0.780::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"lift":0.76,"transparency":0.20,"balancing_strategy":"citrus_tea_clarifier"}'::jsonb
      ),
      (
        'tea',
        'tea',
        'lift',
        'named_material',
        0.740::numeric,
        array['note','enrichment_note','accord','enrichment_accord','family_key','enrichment_text']::text[],
        '{"lift":0.62,"transparency":0.24,"balancing_strategy":"citrus_tea_clarifier"}'::jsonb
      ),
      (
        'aromatic',
        'aromatic',
        'lift',
        'accord_family',
        0.520::numeric,
        array['note','enrichment_note','accord','enrichment_accord','family_key','enrichment_text']::text[],
        '{"lift":0.44,"transparency":0.18,"balancing_strategy":"airy_lift_support"}'::jsonb
      ),
      (
        'neroli',
        'neroli',
        'lift',
        'named_material',
        0.760::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"lift":0.68,"transparency":0.22,"balancing_strategy":"citrus_tea_clarifier"}'::jsonb
      ),
      (
        'myrrh',
        'myrrh',
        'resin_anchor',
        'named_material',
        0.860::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.48,"density":0.42,"base_weight":0.48,"resin_anchor":true,"beast_mode_risk":0.22,"balancing_strategy":"resin_softener"}'::jsonb
      ),
      (
        'amber',
        'amber',
        'resin_anchor',
        'accord_family',
        0.340::numeric,
        array['note','enrichment_note','accord','enrichment_accord','family_key','enrichment_text']::text[],
        '{"tenacity":0.20,"density":0.18,"base_weight":0.22,"beast_mode_risk":0.08,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'resin',
        'resin',
        'resin_anchor',
        'accord_family',
        0.460::numeric,
        array['accord','enrichment_accord','enrichment_text','family_key']::text[],
        '{"tenacity":0.30,"density":0.26,"base_weight":0.28,"resin_anchor":true,"beast_mode_risk":0.12,"balancing_strategy":"resin_softener"}'::jsonb
      ),
      (
        'olibanum',
        'olibanum',
        'resin_anchor',
        'named_material',
        0.880::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.42,"density":0.34,"base_weight":0.34,"resin_anchor":true,"beast_mode_risk":0.16,"balancing_strategy":"resin_softener"}'::jsonb
      ),
      (
        'incense',
        'incense',
        'resin_anchor',
        'accord_family',
        0.640::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text','family_key']::text[],
        '{"tenacity":0.36,"density":0.32,"base_weight":0.34,"resin_anchor":true,"beast_mode_risk":0.14,"balancing_strategy":"resin_softener"}'::jsonb
      ),
      (
        'caramel',
        'caramel',
        'sweet_base_persistence',
        'named_material',
        0.780::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.44,"density":0.34,"base_weight":0.40,"sweet_base_persistence":true,"beast_mode_risk":0.16,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'honey',
        'honey',
        'sweet_base_persistence',
        'named_material',
        0.760::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.40,"density":0.32,"base_weight":0.38,"sweet_base_persistence":true,"beast_mode_risk":0.16,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      ),
      (
        'praline',
        'praline',
        'sweet_base_persistence',
        'named_material',
        0.820::numeric,
        array['note','enrichment_note','accord','enrichment_accord','enrichment_text']::text[],
        '{"tenacity":0.46,"density":0.36,"base_weight":0.42,"sweet_base_persistence":true,"beast_mode_risk":0.18,"balancing_strategy":"soft_musk_rounding"}'::jsonb
      )
  ) as seeded(
    signal_key,
    match_term,
    signal_type,
    evidence_tier,
    base_confidence,
    detection_source_preference,
    performance_effects
  )
)
insert into public.performance_signal_dictionary_v1 (
  signal_key,
  match_term,
  normalized_term,
  signal_type,
  evidence_tier,
  base_confidence,
  detection_source_preference,
  performance_effects
)
select
  signal_key,
  match_term,
  public.normalize_performance_term_v1(match_term) as normalized_term,
  signal_type,
  evidence_tier,
  base_confidence,
  detection_source_preference,
  performance_effects
from seed_rows
on conflict (signal_key) do update
set
  match_term = excluded.match_term,
  normalized_term = excluded.normalized_term,
  signal_type = excluded.signal_type,
  evidence_tier = excluded.evidence_tier,
  base_confidence = excluded.base_confidence,
  detection_source_preference = excluded.detection_source_preference,
  performance_effects = excluded.performance_effects,
  is_active = true,
  updated_at = now();

create table if not exists public.fragrance_material_signals_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  signal_key text not null,
  signal_type text not null,
  detected_term text not null,
  normalized_signal_key text not null,
  detection_source text not null,
  evidence_tier text not null,
  confidence numeric(4,3) not null,
  source_table text,
  source_field text,
  source_value text,
  evidence_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  model_version text not null default 'performance_signal_v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fragrance_material_signals_v1 enable row level security;

revoke all on public.fragrance_material_signals_v1 from anon;
revoke all on public.fragrance_material_signals_v1 from authenticated;

create index if not exists fragrance_material_signals_v1_fragrance_idx
  on public.fragrance_material_signals_v1 (fragrance_id);

create index if not exists fragrance_material_signals_v1_signal_type_idx
  on public.fragrance_material_signals_v1 (signal_type);

create index if not exists fragrance_material_signals_v1_signal_key_idx
  on public.fragrance_material_signals_v1 (signal_key);

create index if not exists fragrance_material_signals_v1_model_version_idx
  on public.fragrance_material_signals_v1 (model_version);

create index if not exists fragrance_material_signals_v1_active_idx
  on public.fragrance_material_signals_v1 (is_active);

create index if not exists fragrance_material_signals_v1_detection_source_idx
  on public.fragrance_material_signals_v1 (detection_source);

create unique index if not exists fragrance_material_signals_v1_active_dedupe_idx
  on public.fragrance_material_signals_v1 (
    fragrance_id,
    signal_key,
    coalesce(source_value, ''),
    detection_source,
    model_version
  )
  where is_active;

create table if not exists public.fragrance_performance_features_v1 (
  fragrance_id uuid primary key references public.fragrances(id) on delete cascade,
  projection_driver boolean,
  projection_confidence numeric(4,3),
  tenacity_driver boolean,
  tenacity_confidence numeric(4,3),
  odor_impact_driver boolean,
  odor_impact_confidence numeric(4,3),
  diffusion_bridge boolean,
  drydown_anchor_strength text,
  opening_dominance_risk text,
  drydown_dominance_risk text,
  masking_risk_band text,
  fatigue_risk_band text,
  transparency_score numeric(4,3) not null default 0.500,
  density_score numeric(4,3) not null default 0.500,
  base_weight_score numeric(4,3) not null default 0.500,
  lift_score numeric(4,3) not null default 0.500,
  fixative_likelihood boolean,
  super_amber_likelihood boolean,
  musk_fixative_likelihood boolean,
  aldehydic_lift_likelihood boolean,
  resin_anchor_likelihood boolean,
  sweet_base_persistence_likelihood boolean,
  woody_amber_dominance_likelihood text,
  beast_mode_score numeric(4,3) not null default 0.000,
  beast_mode_band text,
  recommended_spray_caution text,
  balancing_layer_strategy text,
  evidence_json jsonb not null default '{}'::jsonb,
  signal_count integer not null default 0,
  source_count integer not null default 0,
  model_version text not null default 'performance_features_v1',
  inferred_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fragrance_performance_features_v1 enable row level security;

revoke all on public.fragrance_performance_features_v1 from anon;
revoke all on public.fragrance_performance_features_v1 from authenticated;

create table if not exists public.performance_feature_refresh_runs_v1 (
  id uuid primary key default gen_random_uuid(),
  run_started_at timestamptz not null default now(),
  run_finished_at timestamptz,
  target_fragrance_id uuid references public.fragrances(id) on delete set null,
  model_version text not null,
  refreshed_fragrance_count integer not null default 0,
  inserted_signal_count integer not null default 0,
  updated_feature_count integer not null default 0,
  warning_count integer not null default 0,
  error_count integer not null default 0,
  status text not null default 'running',
  notes text,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.performance_feature_refresh_runs_v1 enable row level security;

revoke all on public.performance_feature_refresh_runs_v1 from anon;
revoke all on public.performance_feature_refresh_runs_v1 from authenticated;

create index if not exists performance_feature_refresh_runs_v1_status_idx
  on public.performance_feature_refresh_runs_v1 (status, run_started_at desc);

create or replace function public.refresh_fragrance_performance_features_v1(p_fragrance_id uuid default null)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_run_id uuid;
  v_target_count integer := 0;
  v_inserted_signal_count integer := 0;
  v_updated_feature_count integer := 0;
  v_warning_count integer := 0;
  v_signal_model text := 'performance_signal_v1';
  v_feature_model text := 'performance_features_v1';
begin
  insert into public.performance_feature_refresh_runs_v1 (
    target_fragrance_id,
    model_version,
    metadata
  )
  values (
    p_fragrance_id,
    v_feature_model,
    jsonb_build_object(
      'signal_model_version', v_signal_model,
      'scope', case when p_fragrance_id is null then 'all' else 'single' end
    )
  )
  returning id into v_run_id;

  with target_fragrances as (
    select f.id as fragrance_id
    from public.fragrances f
    where p_fragrance_id is null or f.id = p_fragrance_id
  )
  select count(*)::integer
  into v_target_count
  from target_fragrances;

  if v_target_count = 0 then
    update public.performance_feature_refresh_runs_v1
    set
      run_finished_at = now(),
      refreshed_fragrance_count = 0,
      inserted_signal_count = 0,
      updated_feature_count = 0,
      warning_count = 1,
      error_count = 0,
      status = 'completed',
      notes = 'No target fragrances matched the requested scope.'
    where id = v_run_id;

    return jsonb_build_object(
      'run_id', v_run_id,
      'status', 'completed',
      'refreshed_fragrance_count', 0,
      'inserted_signal_count', 0,
      'updated_feature_count', 0,
      'warning_count', 1,
      'error_count', 0
    );
  end if;

  delete from public.fragrance_material_signals_v1 s
  using public.fragrances f
  where s.fragrance_id = f.id
    and s.model_version = v_signal_model
    and (p_fragrance_id is null or f.id = p_fragrance_id);

  with target_fragrances as (
    select
      f.id as fragrance_id,
      f.name,
      f.brand,
      f.family_key,
      coalesce(f.notes, '{}'::text[]) as notes,
      coalesce(f.accords, '{}'::text[]) as accords,
      coalesce(te.notes, '{}'::text[]) as enrichment_notes,
      coalesce(te.accords, '{}'::text[]) as enrichment_accords,
      te.proposed_family_key,
      te.concentration,
      te.source_url,
      te.source_confidence,
      te.provider_payload
    from public.fragrances f
    left join public.fragrance_text_enrichment te
      on te.fragrance_id = f.id
    where p_fragrance_id is null or f.id = p_fragrance_id
  ),
  exact_sources as (
    select
      tf.fragrance_id,
      'note'::text as detection_source,
      'public.fragrances'::text as source_table,
      'notes'::text as source_field,
      note_value as source_value,
      public.normalize_performance_term_v1(note_value) as normalized_source_value,
      jsonb_build_object(
        'fragrance_name', tf.name,
        'brand', tf.brand,
        'term_origin', 'fragrances.notes'
      ) as evidence_json
    from target_fragrances tf
    cross join lateral unnest(tf.notes) as note_values(note_value)

    union all

    select
      tf.fragrance_id,
      'accord',
      'public.fragrances',
      'accords',
      accord_value,
      public.normalize_performance_term_v1(accord_value),
      jsonb_build_object(
        'fragrance_name', tf.name,
        'brand', tf.brand,
        'term_origin', 'fragrances.accords'
      )
    from target_fragrances tf
    cross join lateral unnest(tf.accords) as accord_values(accord_value)

    union all

    select
      tf.fragrance_id,
      'enrichment_note',
      'public.fragrance_text_enrichment',
      'notes',
      note_value,
      public.normalize_performance_term_v1(note_value),
      jsonb_build_object(
        'fragrance_name', tf.name,
        'brand', tf.brand,
        'term_origin', 'fragrance_text_enrichment.notes',
        'source_url', tf.source_url,
        'source_confidence', tf.source_confidence
      )
    from target_fragrances tf
    cross join lateral unnest(tf.enrichment_notes) as note_values(note_value)

    union all

    select
      tf.fragrance_id,
      'enrichment_accord',
      'public.fragrance_text_enrichment',
      'accords',
      accord_value,
      public.normalize_performance_term_v1(accord_value),
      jsonb_build_object(
        'fragrance_name', tf.name,
        'brand', tf.brand,
        'term_origin', 'fragrance_text_enrichment.accords',
        'source_url', tf.source_url,
        'source_confidence', tf.source_confidence
      )
    from target_fragrances tf
    cross join lateral unnest(tf.enrichment_accords) as accord_values(accord_value)
  ),
  fuzzy_sources as (
    select
      tf.fragrance_id,
      'family_key'::text as detection_source,
      'public.fragrances'::text as source_table,
      'family_key'::text as source_field,
      tf.family_key::text as source_value,
      public.normalize_performance_term_v1(tf.family_key) as normalized_source_value,
      jsonb_build_object(
        'fragrance_name', tf.name,
        'brand', tf.brand,
        'term_origin', 'fragrances.family_key'
      ) as evidence_json
    from target_fragrances tf
    where tf.family_key is not null

    union all

    select
      tf.fragrance_id,
      'enrichment_text',
      'public.fragrance_text_enrichment',
      'provider_payload',
      left(tf.provider_payload::text, 2000),
      public.normalize_performance_term_v1(tf.provider_payload::text),
      jsonb_build_object(
        'fragrance_name', tf.name,
        'brand', tf.brand,
        'term_origin', 'fragrance_text_enrichment.provider_payload',
        'source_url', tf.source_url,
        'source_confidence', tf.source_confidence,
        'concentration', tf.concentration
      )
    from target_fragrances tf
    where tf.provider_payload is not null
  ),
  exact_matches as (
    select
      s.fragrance_id,
      d.signal_key,
      d.signal_type,
      d.match_term as detected_term,
      d.normalized_term as normalized_signal_key,
      s.detection_source,
      d.evidence_tier,
      round(
        public.clamp_performance_score_v1(
          d.base_confidence *
          case s.detection_source
            when 'note' then 1.00
            when 'enrichment_note' then 0.96
            when 'accord' then 0.82
            when 'enrichment_accord' then 0.78
            else 0.70
          end
        ),
        3
      ) as confidence,
      s.source_table,
      s.source_field,
      s.source_value,
      jsonb_build_object(
        'match_term', d.match_term,
        'normalized_term', d.normalized_term,
        'effects', d.performance_effects,
        'base_confidence', d.base_confidence,
        'detection_source_preference', d.detection_source_preference
      ) || s.evidence_json as evidence_json
    from exact_sources s
    join public.performance_signal_dictionary_v1 d
      on d.is_active
     and (coalesce(array_length(d.detection_source_preference, 1), 0) = 0 or s.detection_source = any(d.detection_source_preference))
     and s.normalized_source_value = d.normalized_term
  ),
  fuzzy_matches as (
    select
      s.fragrance_id,
      d.signal_key,
      d.signal_type,
      d.match_term as detected_term,
      d.normalized_term as normalized_signal_key,
      s.detection_source,
      d.evidence_tier,
      round(
        public.clamp_performance_score_v1(
          d.base_confidence *
          case s.detection_source
            when 'family_key' then 0.54
            when 'enrichment_text' then 0.68
            else 0.60
          end
        ),
        3
      ) as confidence,
      s.source_table,
      s.source_field,
      s.source_value,
      jsonb_build_object(
        'match_term', d.match_term,
        'normalized_term', d.normalized_term,
        'effects', d.performance_effects,
        'base_confidence', d.base_confidence,
        'detection_source_preference', d.detection_source_preference
      ) || s.evidence_json as evidence_json
    from fuzzy_sources s
    join public.performance_signal_dictionary_v1 d
      on d.is_active
     and (coalesce(array_length(d.detection_source_preference, 1), 0) = 0 or s.detection_source = any(d.detection_source_preference))
     and char_length(d.normalized_term) >= 3
     and position(
       ' ' || d.normalized_term || ' '
       in ' ' || s.normalized_source_value || ' '
     ) > 0
  ),
  combined_matches as (
    select * from exact_matches
    union all
    select * from fuzzy_matches
  ),
  deduped_matches as (
    select distinct on (
      fragrance_id,
      signal_key,
      coalesce(source_value, ''),
      detection_source
    )
      fragrance_id,
      signal_key,
      signal_type,
      detected_term,
      normalized_signal_key,
      detection_source,
      evidence_tier,
      confidence,
      source_table,
      source_field,
      source_value,
      evidence_json
    from combined_matches
    order by
      fragrance_id,
      signal_key,
      coalesce(source_value, ''),
      detection_source,
      confidence desc
  )
  insert into public.fragrance_material_signals_v1 (
    fragrance_id,
    signal_key,
    signal_type,
    detected_term,
    normalized_signal_key,
    detection_source,
    evidence_tier,
    confidence,
    source_table,
    source_field,
    source_value,
    evidence_json,
    is_active,
    model_version
  )
  select
    fragrance_id,
    signal_key,
    signal_type,
    detected_term,
    normalized_signal_key,
    detection_source,
    evidence_tier,
    confidence,
    source_table,
    source_field,
    source_value,
    evidence_json,
    true,
    v_signal_model
  from deduped_matches;

  get diagnostics v_inserted_signal_count = row_count;

  with target_fragrances as (
    select f.id as fragrance_id
    from public.fragrances f
    where p_fragrance_id is null or f.id = p_fragrance_id
  ),
  signal_rows as (
    select
      s.fragrance_id,
      s.signal_key,
      s.signal_type,
      s.detection_source,
      s.confidence,
      coalesce((s.evidence_json -> 'effects' ->> 'projection')::numeric, 0::numeric) as projection_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'tenacity')::numeric, 0::numeric) as tenacity_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'odor_impact')::numeric, 0::numeric) as odor_impact_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'density')::numeric, 0::numeric) as density_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'base_weight')::numeric, 0::numeric) as base_weight_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'lift')::numeric, 0::numeric) as lift_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'transparency')::numeric, 0::numeric) as transparency_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'beast_mode_risk')::numeric, 0::numeric) as beast_mode_risk_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'woody_amber_dominance')::numeric, 0::numeric) as woody_amber_dominance_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'diffusion_bridge')::boolean, false) as diffusion_bridge_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'super_amber')::boolean, false) as super_amber_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'fixative')::boolean, false) as fixative_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'musk_fixative')::boolean, false) as musk_fixative_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'aldehydic_lift')::boolean, false) as aldehydic_lift_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'resin_anchor')::boolean, false) as resin_anchor_effect,
      coalesce((s.evidence_json -> 'effects' ->> 'sweet_base_persistence')::boolean, false) as sweet_base_persistence_effect
    from public.fragrance_material_signals_v1 s
    join target_fragrances tf
      on tf.fragrance_id = s.fragrance_id
    where s.is_active
      and s.model_version = v_signal_model
  ),
  aggregated as (
    select
      tf.fragrance_id,
      count(sr.signal_key)::integer as signal_count,
      count(distinct sr.detection_source)::integer as source_count,
      sum(sr.projection_effect * sr.confidence) as sum_projection,
      max(sr.projection_effect * sr.confidence) as max_projection,
      sum(sr.tenacity_effect * sr.confidence) as sum_tenacity,
      max(sr.tenacity_effect * sr.confidence) as max_tenacity,
      sum(sr.odor_impact_effect * sr.confidence) as sum_odor_impact,
      max(sr.odor_impact_effect * sr.confidence) as max_odor_impact,
      sum(sr.density_effect * sr.confidence) as sum_density,
      sum(sr.base_weight_effect * sr.confidence) as sum_base_weight,
      sum(sr.lift_effect * sr.confidence) as sum_lift,
      sum(sr.transparency_effect * sr.confidence) as sum_transparency,
      sum(sr.beast_mode_risk_effect * sr.confidence) as sum_beast_mode_risk,
      max(sr.woody_amber_dominance_effect * sr.confidence) as max_woody_amber_dominance,
      bool_or(sr.diffusion_bridge_effect) as diffusion_bridge,
      bool_or(sr.super_amber_effect) as super_amber_likelihood,
      bool_or(sr.fixative_effect) as fixative_likelihood,
      bool_or(sr.musk_fixative_effect) as musk_fixative_likelihood,
      bool_or(sr.aldehydic_lift_effect) as aldehydic_lift_likelihood,
      bool_or(sr.resin_anchor_effect) as resin_anchor_likelihood,
      bool_or(sr.sweet_base_persistence_effect) as sweet_base_persistence_likelihood
    from target_fragrances tf
    left join signal_rows sr
      on sr.fragrance_id = tf.fragrance_id
    group by tf.fragrance_id
  ),
  scored as (
    select
      a.fragrance_id,
      public.clamp_performance_score_v1((coalesce(a.sum_projection, 0::numeric) * 0.55) + (coalesce(a.max_projection, 0::numeric) * 0.45)) as projection_confidence,
      public.clamp_performance_score_v1((coalesce(a.sum_tenacity, 0::numeric) * 0.55) + (coalesce(a.max_tenacity, 0::numeric) * 0.45)) as tenacity_confidence,
      public.clamp_performance_score_v1((coalesce(a.sum_odor_impact, 0::numeric) * 0.55) + (coalesce(a.max_odor_impact, 0::numeric) * 0.45)) as odor_impact_confidence,
      public.clamp_performance_score_v1(coalesce(a.sum_density, 0::numeric) * 0.55) as density_score,
      public.clamp_performance_score_v1(coalesce(a.sum_base_weight, 0::numeric) * 0.55) as base_weight_score,
      public.clamp_performance_score_v1(coalesce(a.sum_lift, 0::numeric) * 0.60) as lift_score,
      public.clamp_performance_score_v1(0.50 + (coalesce(a.sum_transparency, 0::numeric) * 0.28) - (coalesce(a.sum_density, 0::numeric) * 0.10)) as transparency_score,
      public.clamp_performance_score_v1(
        (public.clamp_performance_score_v1((coalesce(a.sum_projection, 0::numeric) * 0.55) + (coalesce(a.max_projection, 0::numeric) * 0.45)) * 0.28) +
        (public.clamp_performance_score_v1((coalesce(a.sum_odor_impact, 0::numeric) * 0.55) + (coalesce(a.max_odor_impact, 0::numeric) * 0.45)) * 0.20) +
        (public.clamp_performance_score_v1((coalesce(a.sum_tenacity, 0::numeric) * 0.55) + (coalesce(a.max_tenacity, 0::numeric) * 0.45)) * 0.18) +
        (public.clamp_performance_score_v1(coalesce(a.sum_density, 0::numeric) * 0.55) * 0.10) +
        (public.clamp_performance_score_v1(coalesce(a.sum_base_weight, 0::numeric) * 0.55) * 0.08) +
        (coalesce(a.max_woody_amber_dominance, 0::numeric) * 0.08) +
        (coalesce(a.sum_beast_mode_risk, 0::numeric) * 0.10) +
        (case when a.super_amber_likelihood then 0.10 else 0.00 end) +
        (case when a.resin_anchor_likelihood then 0.04 else 0.00 end) -
        (public.clamp_performance_score_v1(coalesce(a.sum_lift, 0::numeric) * 0.60) * 0.04)
      ) as beast_mode_score,
      coalesce(a.diffusion_bridge, false) as diffusion_bridge,
      coalesce(a.fixative_likelihood, false) as fixative_likelihood,
      coalesce(a.super_amber_likelihood, false) as super_amber_likelihood,
      coalesce(a.musk_fixative_likelihood, false) as musk_fixative_likelihood,
      coalesce(a.aldehydic_lift_likelihood, false) as aldehydic_lift_likelihood,
      coalesce(a.resin_anchor_likelihood, false) as resin_anchor_likelihood,
      coalesce(a.sweet_base_persistence_likelihood, false) as sweet_base_persistence_likelihood,
      coalesce(a.max_woody_amber_dominance, 0::numeric) as woody_amber_dominance_score,
      coalesce(a.signal_count, 0) as signal_count,
      coalesce(a.source_count, 0) as source_count
    from aggregated a
  ),
  final_rows as (
    select
      s.fragrance_id,
      (s.projection_confidence >= 0.58) as projection_driver,
      round(s.projection_confidence, 3) as projection_confidence,
      (s.tenacity_confidence >= 0.56) as tenacity_driver,
      round(s.tenacity_confidence, 3) as tenacity_confidence,
      (s.odor_impact_confidence >= 0.58) as odor_impact_driver,
      round(s.odor_impact_confidence, 3) as odor_impact_confidence,
      s.diffusion_bridge,
      case
        when public.clamp_performance_score_v1((s.tenacity_confidence * 0.45) + (s.base_weight_score * 0.30) + (s.density_score * 0.25)) >= 0.72 then 'HIGH'
        when public.clamp_performance_score_v1((s.tenacity_confidence * 0.45) + (s.base_weight_score * 0.30) + (s.density_score * 0.25)) >= 0.46 then 'MODERATE'
        else 'LOW'
      end as drydown_anchor_strength,
      case
        when public.clamp_performance_score_v1((s.projection_confidence * 0.48) + (s.odor_impact_confidence * 0.34) + (s.woody_amber_dominance_score * 0.18)) >= 0.74 then 'HIGH'
        when public.clamp_performance_score_v1((s.projection_confidence * 0.48) + (s.odor_impact_confidence * 0.34) + (s.woody_amber_dominance_score * 0.18)) >= 0.45 then 'MODERATE'
        else 'LOW'
      end as opening_dominance_risk,
      case
        when public.clamp_performance_score_v1((s.tenacity_confidence * 0.42) + (s.base_weight_score * 0.28) + (s.density_score * 0.20) + (case when s.resin_anchor_likelihood then 0.10 else 0.00 end)) >= 0.74 then 'HIGH'
        when public.clamp_performance_score_v1((s.tenacity_confidence * 0.42) + (s.base_weight_score * 0.28) + (s.density_score * 0.20) + (case when s.resin_anchor_likelihood then 0.10 else 0.00 end)) >= 0.45 then 'MODERATE'
        else 'LOW'
      end as drydown_dominance_risk,
      case
        when public.clamp_performance_score_v1((s.beast_mode_score * 0.45) + (s.density_score * 0.20) + (s.base_weight_score * 0.20) + (s.projection_confidence * 0.15)) >= 0.72 then 'HIGH'
        when public.clamp_performance_score_v1((s.beast_mode_score * 0.45) + (s.density_score * 0.20) + (s.base_weight_score * 0.20) + (s.projection_confidence * 0.15)) >= 0.42 then 'MODERATE'
        else 'LOW'
      end as masking_risk_band,
      case
        when public.clamp_performance_score_v1((s.odor_impact_confidence * 0.42) + (s.projection_confidence * 0.24) + (case when s.super_amber_likelihood then 0.18 else 0.00 end) + (s.beast_mode_score * 0.16)) >= 0.72 then 'HIGH'
        when public.clamp_performance_score_v1((s.odor_impact_confidence * 0.42) + (s.projection_confidence * 0.24) + (case when s.super_amber_likelihood then 0.18 else 0.00 end) + (s.beast_mode_score * 0.16)) >= 0.42 then 'MODERATE'
        else 'LOW'
      end as fatigue_risk_band,
      round(s.transparency_score, 3) as transparency_score,
      round(s.density_score, 3) as density_score,
      round(s.base_weight_score, 3) as base_weight_score,
      round(s.lift_score, 3) as lift_score,
      s.fixative_likelihood,
      s.super_amber_likelihood,
      s.musk_fixative_likelihood,
      s.aldehydic_lift_likelihood,
      s.resin_anchor_likelihood,
      s.sweet_base_persistence_likelihood,
      case
        when s.woody_amber_dominance_score >= 0.68 then 'HIGH'
        when s.woody_amber_dominance_score >= 0.35 then 'MODERATE'
        else 'LOW'
      end as woody_amber_dominance_likelihood,
      round(s.beast_mode_score, 3) as beast_mode_score,
      case
        when s.beast_mode_score >= 0.84 then 'EXTREME'
        when s.beast_mode_score >= 0.66 then 'HIGH'
        when s.beast_mode_score >= 0.36 then 'MODERATE'
        else 'LOW'
      end as beast_mode_band,
      case
        when s.beast_mode_score >= 0.84 then 'avoid_stacking_loud'
        when s.beast_mode_score >= 0.66 then 'one_spray_anchor'
        when s.beast_mode_score >= 0.45 then 'start_light'
        when s.diffusion_bridge and s.projection_confidence >= 0.56 and s.density_score >= 0.56 then 'separate_placement'
        else 'none'
      end as recommended_spray_caution,
      case
        when s.beast_mode_score >= 0.84 then 'solo_or_one_spray_anchor'
        when s.beast_mode_score >= 0.66 and (s.super_amber_likelihood or s.woody_amber_dominance_score >= 0.68) then 'avoid_loud_on_loud'
        when s.resin_anchor_likelihood and s.lift_score >= 0.45 then 'citrus_tea_clarifier'
        when s.resin_anchor_likelihood then 'resin_softener'
        when s.sweet_base_persistence_likelihood or s.musk_fixative_likelihood then 'soft_musk_rounding'
        when s.lift_score >= 0.56 or s.diffusion_bridge then 'airy_lift_support'
        else 'soft_musk_rounding'
      end as balancing_layer_strategy,
      jsonb_build_object(
        'signal_model_version', v_signal_model,
        'projection_confidence', round(s.projection_confidence, 3),
        'tenacity_confidence', round(s.tenacity_confidence, 3),
        'odor_impact_confidence', round(s.odor_impact_confidence, 3),
        'density_score', round(s.density_score, 3),
        'base_weight_score', round(s.base_weight_score, 3),
        'lift_score', round(s.lift_score, 3),
        'transparency_score', round(s.transparency_score, 3),
        'woody_amber_dominance_score', round(s.woody_amber_dominance_score, 3),
        'fixative_likelihood', s.fixative_likelihood,
        'super_amber_likelihood', s.super_amber_likelihood,
        'musk_fixative_likelihood', s.musk_fixative_likelihood,
        'aldehydic_lift_likelihood', s.aldehydic_lift_likelihood,
        'resin_anchor_likelihood', s.resin_anchor_likelihood,
        'sweet_base_persistence_likelihood', s.sweet_base_persistence_likelihood
      ) as evidence_json,
      s.signal_count,
      s.source_count,
      v_feature_model as model_version
    from scored s
  )
  insert into public.fragrance_performance_features_v1 (
    fragrance_id,
    projection_driver,
    projection_confidence,
    tenacity_driver,
    tenacity_confidence,
    odor_impact_driver,
    odor_impact_confidence,
    diffusion_bridge,
    drydown_anchor_strength,
    opening_dominance_risk,
    drydown_dominance_risk,
    masking_risk_band,
    fatigue_risk_band,
    transparency_score,
    density_score,
    base_weight_score,
    lift_score,
    fixative_likelihood,
    super_amber_likelihood,
    musk_fixative_likelihood,
    aldehydic_lift_likelihood,
    resin_anchor_likelihood,
    sweet_base_persistence_likelihood,
    woody_amber_dominance_likelihood,
    beast_mode_score,
    beast_mode_band,
    recommended_spray_caution,
    balancing_layer_strategy,
    evidence_json,
    signal_count,
    source_count,
    model_version,
    inferred_at,
    updated_at
  )
  select
    fragrance_id,
    projection_driver,
    projection_confidence,
    tenacity_driver,
    tenacity_confidence,
    odor_impact_driver,
    odor_impact_confidence,
    diffusion_bridge,
    drydown_anchor_strength,
    opening_dominance_risk,
    drydown_dominance_risk,
    masking_risk_band,
    fatigue_risk_band,
    transparency_score,
    density_score,
    base_weight_score,
    lift_score,
    fixative_likelihood,
    super_amber_likelihood,
    musk_fixative_likelihood,
    aldehydic_lift_likelihood,
    resin_anchor_likelihood,
    sweet_base_persistence_likelihood,
    woody_amber_dominance_likelihood,
    beast_mode_score,
    beast_mode_band,
    recommended_spray_caution,
    balancing_layer_strategy,
    evidence_json,
    signal_count,
    source_count,
    model_version,
    now(),
    now()
  from final_rows
  on conflict (fragrance_id) do update
  set
    projection_driver = excluded.projection_driver,
    projection_confidence = excluded.projection_confidence,
    tenacity_driver = excluded.tenacity_driver,
    tenacity_confidence = excluded.tenacity_confidence,
    odor_impact_driver = excluded.odor_impact_driver,
    odor_impact_confidence = excluded.odor_impact_confidence,
    diffusion_bridge = excluded.diffusion_bridge,
    drydown_anchor_strength = excluded.drydown_anchor_strength,
    opening_dominance_risk = excluded.opening_dominance_risk,
    drydown_dominance_risk = excluded.drydown_dominance_risk,
    masking_risk_band = excluded.masking_risk_band,
    fatigue_risk_band = excluded.fatigue_risk_band,
    transparency_score = excluded.transparency_score,
    density_score = excluded.density_score,
    base_weight_score = excluded.base_weight_score,
    lift_score = excluded.lift_score,
    fixative_likelihood = excluded.fixative_likelihood,
    super_amber_likelihood = excluded.super_amber_likelihood,
    musk_fixative_likelihood = excluded.musk_fixative_likelihood,
    aldehydic_lift_likelihood = excluded.aldehydic_lift_likelihood,
    resin_anchor_likelihood = excluded.resin_anchor_likelihood,
    sweet_base_persistence_likelihood = excluded.sweet_base_persistence_likelihood,
    woody_amber_dominance_likelihood = excluded.woody_amber_dominance_likelihood,
    beast_mode_score = excluded.beast_mode_score,
    beast_mode_band = excluded.beast_mode_band,
    recommended_spray_caution = excluded.recommended_spray_caution,
    balancing_layer_strategy = excluded.balancing_layer_strategy,
    evidence_json = excluded.evidence_json,
    signal_count = excluded.signal_count,
    source_count = excluded.source_count,
    model_version = excluded.model_version,
    inferred_at = excluded.inferred_at,
    updated_at = excluded.updated_at;

  get diagnostics v_updated_feature_count = row_count;

  select count(*)::integer
  into v_warning_count
  from public.fragrance_performance_features_v1 pf
  where pf.model_version = v_feature_model
    and (p_fragrance_id is null or pf.fragrance_id = p_fragrance_id)
    and pf.signal_count = 0;

  update public.performance_feature_refresh_runs_v1
  set
    run_finished_at = now(),
    refreshed_fragrance_count = v_target_count,
    inserted_signal_count = v_inserted_signal_count,
    updated_feature_count = v_updated_feature_count,
    warning_count = v_warning_count,
    error_count = 0,
    status = 'completed',
    notes = case
      when v_warning_count > 0 then 'Completed with low-signal or no-signal fragrances present.'
      else 'Completed successfully.'
    end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'target_scope', case when p_fragrance_id is null then 'all' else 'single' end,
      'signal_model_version', v_signal_model,
      'feature_model_version', v_feature_model
    )
  where id = v_run_id;

  return jsonb_build_object(
    'run_id', v_run_id,
    'status', 'completed',
    'refreshed_fragrance_count', v_target_count,
    'inserted_signal_count', v_inserted_signal_count,
    'updated_feature_count', v_updated_feature_count,
    'warning_count', v_warning_count,
    'error_count', 0,
    'signal_model_version', v_signal_model,
    'feature_model_version', v_feature_model
  );
exception
  when others then
    update public.performance_feature_refresh_runs_v1
    set
      run_finished_at = now(),
      refreshed_fragrance_count = v_target_count,
      inserted_signal_count = v_inserted_signal_count,
      updated_feature_count = v_updated_feature_count,
      warning_count = v_warning_count,
      error_count = error_count + 1,
      status = 'error',
      notes = sqlerrm
    where id = v_run_id;
    raise;
end;
$function$;

revoke all on function public.refresh_fragrance_performance_features_v1(uuid) from public;
revoke all on function public.refresh_fragrance_performance_features_v1(uuid) from anon;
revoke all on function public.refresh_fragrance_performance_features_v1(uuid) from authenticated;
grant execute on function public.refresh_fragrance_performance_features_v1(uuid) to service_role;

create or replace view public.fragrance_performance_summary_v1 as
select
  f.id as fragrance_id,
  f.name,
  f.brand,
  f.family_key,
  pf.beast_mode_score,
  pf.beast_mode_band,
  pf.projection_driver,
  pf.projection_confidence,
  pf.tenacity_driver,
  pf.tenacity_confidence,
  pf.odor_impact_driver,
  pf.odor_impact_confidence,
  pf.masking_risk_band,
  pf.fatigue_risk_band,
  pf.recommended_spray_caution,
  pf.balancing_layer_strategy,
  pf.signal_count,
  pf.source_count,
  pf.model_version,
  pf.inferred_at
from public.fragrance_performance_features_v1 pf
join public.fragrances f
  on f.id = pf.fragrance_id;

revoke all on public.fragrance_performance_summary_v1 from anon;
revoke all on public.fragrance_performance_summary_v1 from authenticated;
