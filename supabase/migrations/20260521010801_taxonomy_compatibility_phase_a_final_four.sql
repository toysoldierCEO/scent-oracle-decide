create table if not exists public.family_key_reference_v1 (
  family_key text primary key references public.family_keys (family_key) on update cascade on delete restrict,
  display_label text not null,
  universal_equivalent text,
  definition text,
  qualifies_when text,
  disqualifies_when text,
  examples jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.facet_key_reference_v1 (
  facet_key text primary key,
  display_label text not null,
  definition text,
  evidence_notes jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.wardrobe_role_reference_v1 (
  role_key text primary key,
  display_label text not null,
  definition text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.fragrance_facets_v1 (
  fragrance_id uuid not null references public.fragrances (id) on delete cascade,
  facet_key text not null references public.facet_key_reference_v1 (facet_key) on update cascade on delete restrict,
  confidence numeric,
  evidence_source text,
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (fragrance_id, facet_key),
  constraint fragrance_facets_v1_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create table if not exists public.fragrance_wardrobe_roles_v1 (
  fragrance_id uuid not null references public.fragrances (id) on delete cascade,
  role_key text not null references public.wardrobe_role_reference_v1 (role_key) on update cascade on delete restrict,
  role_priority integer not null default 1,
  confidence numeric,
  evidence_source text,
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (fragrance_id, role_key),
  constraint fragrance_wardrobe_roles_v1_priority_check check (role_priority >= 1),
  constraint fragrance_wardrobe_roles_v1_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create table if not exists public.fragrance_taxonomy_review_v1 (
  fragrance_id uuid primary key references public.fragrances (id) on delete cascade,
  legacy_family_key text references public.family_key_reference_v1 (family_key) on update cascade on delete restrict,
  universal_equivalent text,
  confidence numeric,
  review_status text,
  evidence_source text,
  evidence_json jsonb not null default '{}'::jsonb,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fragrance_taxonomy_review_v1_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint fragrance_taxonomy_review_v1_status_check
    check (
      review_status is null
      or review_status in (
        'confirmed',
        'medium_confidence',
        'low_confidence',
        'taxonomy_gap',
        'needs_wear_test',
        'source_gap'
      )
    )
);

alter table public.family_key_reference_v1 enable row level security;
alter table public.facet_key_reference_v1 enable row level security;
alter table public.wardrobe_role_reference_v1 enable row level security;
alter table public.fragrance_facets_v1 enable row level security;
alter table public.fragrance_wardrobe_roles_v1 enable row level security;
alter table public.fragrance_taxonomy_review_v1 enable row level security;

revoke all on table public.family_key_reference_v1 from public;
revoke all on table public.family_key_reference_v1 from anon;
revoke all on table public.family_key_reference_v1 from authenticated;
revoke all on table public.facet_key_reference_v1 from public;
revoke all on table public.facet_key_reference_v1 from anon;
revoke all on table public.facet_key_reference_v1 from authenticated;
revoke all on table public.wardrobe_role_reference_v1 from public;
revoke all on table public.wardrobe_role_reference_v1 from anon;
revoke all on table public.wardrobe_role_reference_v1 from authenticated;
revoke all on table public.fragrance_facets_v1 from public;
revoke all on table public.fragrance_facets_v1 from anon;
revoke all on table public.fragrance_facets_v1 from authenticated;
revoke all on table public.fragrance_wardrobe_roles_v1 from public;
revoke all on table public.fragrance_wardrobe_roles_v1 from anon;
revoke all on table public.fragrance_wardrobe_roles_v1 from authenticated;
revoke all on table public.fragrance_taxonomy_review_v1 from public;
revoke all on table public.fragrance_taxonomy_review_v1 from anon;
revoke all on table public.fragrance_taxonomy_review_v1 from authenticated;

grant select, insert, update on table public.family_key_reference_v1 to service_role;
grant select, insert, update on table public.facet_key_reference_v1 to service_role;
grant select, insert, update on table public.wardrobe_role_reference_v1 to service_role;
grant select, insert, update on table public.fragrance_facets_v1 to service_role;
grant select, insert, update on table public.fragrance_wardrobe_roles_v1 to service_role;
grant select, insert, update on table public.fragrance_taxonomy_review_v1 to service_role;

create index if not exists fragrance_facets_v1_facet_idx
  on public.fragrance_facets_v1 (facet_key, confidence desc nulls last);

create index if not exists fragrance_wardrobe_roles_v1_role_idx
  on public.fragrance_wardrobe_roles_v1 (role_key, role_priority, confidence desc nulls last);

create index if not exists fragrance_taxonomy_review_v1_family_idx
  on public.fragrance_taxonomy_review_v1 (legacy_family_key, review_status, confidence desc nulls last);

insert into public.family_key_reference_v1 (
  family_key,
  display_label,
  universal_equivalent,
  definition,
  qualifies_when,
  disqualifies_when,
  examples,
  active
)
values
  (
    'woody-clean',
    'Woody / Clean',
    'woody',
    'Legacy Odara compatibility family for fragrances led by clean woods, dry musks, aromatic lift, or airy woody structures.',
    'Use when woods, musks, or aromatic-clean materials dominate the lasting structure.',
    'Do not use for overt amber-oriental, leather, heavy gourmand, or fully aquatic structures.',
    '["Sugi Noir","Tea Rainfall"]'::jsonb,
    true
  ),
  (
    'oud-amber',
    'Oud / Amber',
    'amber-oriental',
    'Legacy Odara compatibility family for amber-oriental structures, including resinous, spicy, and oud-adjacent builds.',
    'Use when amber, resin, warm woods, cypriol, or oriental depth dominate the heart/base.',
    'Do not use for clean woods, bright citrus-cologne builds, or purely marine structures.',
    '["Blue Turquoise"]'::jsonb,
    true
  ),
  (
    'sweet-gourmand',
    'Sweet / Gourmand',
    'gourmand',
    'Legacy Odara compatibility family for edible, dessert-like, or clearly sweet gourmand structures.',
    'Use when vanilla, sugar, pastry, syrup, or confection notes dominate.',
    'Do not use when sweetness is only supportive and the core remains woody, amber, or fresh.',
    '["Apple Crumb","Black Origami"]'::jsonb,
    true
  ),
  (
    'citrus-cologne',
    'Citrus / Cologne',
    'citrus / hesperides',
    'Legacy Odara compatibility family for citrus-led, aromatic, brisk, or traditional cologne-style structures.',
    'Use when citrus and aromatic lift dominate the opening and carry into the structure.',
    'Do not use for sweet-gourmand, leather, or dense amber bases.',
    '["Turin 21","Sparkling Bergamot"]'::jsonb,
    true
  ),
  (
    'dark-leather',
    'Dark / Leather',
    'leather',
    'Legacy Odara compatibility family for leather-dominant dark structures.',
    'Use when leather, smoke, tar, or darker animalic structure dominates.',
    'Do not use for amber without leather or for airy woody florals.',
    '[]'::jsonb,
    true
  ),
  (
    'fresh-blue',
    'Fresh / Blue',
    'fresh-aquatic',
    'Legacy Odara compatibility family for marine, aquatic, ozonic, or fresh-air dominant structures.',
    'Use when marine, ozonic, aquatic, salty, or airy freshness drives the heart/base.',
    'Do not use when freshness is incidental and the core remains amber-oriental or woody.',
    '["Smooth Sailing"]'::jsonb,
    true
  ),
  (
    'tobacco-boozy',
    'Tobacco / Boozy',
    'facet-driven amber/woody/leather',
    'Legacy Odara compatibility family for tobacco-forward or liquor-soaked amber/woody/leather structures.',
    'Use when tobacco and boozy facets dominate the heart/base.',
    'Do not use when boozy or tobacco facets are only top-note decoration.',
    '[]'::jsonb,
    true
  )
on conflict (family_key) do update
set
  display_label = excluded.display_label,
  universal_equivalent = excluded.universal_equivalent,
  definition = excluded.definition,
  qualifies_when = excluded.qualifies_when,
  disqualifies_when = excluded.disqualifies_when,
  examples = excluded.examples,
  active = excluded.active,
  updated_at = now();

insert into public.facet_key_reference_v1 (
  facet_key,
  display_label,
  definition,
  evidence_notes,
  active
)
values
  ('citrus', 'Citrus', 'Bright citrus lift or hespérides structure.', '["bergamot","lemon","grapefruit","mandarin","neroli"]'::jsonb, true),
  ('aromatic', 'Aromatic', 'Herbal or aromatic freshness.', '["basil","thyme","rosemary","lavender","aromatic"]'::jsonb, true),
  ('green', 'Green', 'Green, vegetal, or mossy freshness.', '["green","moss","galbanum","leafy"]'::jsonb, true),
  ('tea', 'Tea', 'Tea leaf or tea-steeped transparency.', '["tea","green tea","white tea","black tea"]'::jsonb, true),
  ('marine', 'Marine', 'Marine, seawater, or oceanic freshness.', '["marine","saltwater","sea","aquatic"]'::jsonb, true),
  ('salty', 'Salty', 'Salty mineral or briny effect.', '["salty","saltwater","brine"]'::jsonb, true),
  ('ozonic', 'Ozonic', 'Fresh-air or airy ozonic effect.', '["fresh air","ozonic","air accord"]'::jsonb, true),
  ('mineral', 'Mineral', 'Stone, mineral, or metallic freshness.', '["mineral","stone","flint"]'::jsonb, true),
  ('floral', 'Floral', 'Floral heart or floral signature.', '["rose","jasmine","magnolia","violet","ylang-ylang"]'::jsonb, true),
  ('fruity', 'Fruity', 'Fruit or fruit-pulp effect.', '["fruity","fruit","sapodilla","berry"]'::jsonb, true),
  ('musk', 'Musk', 'Musky, clean-skin, or soft diffusive musk.', '["musk","musky","ambergris"]'::jsonb, true),
  ('amber', 'Amber', 'Amber, resin, or warm ambery structure.', '["amber","ambery","amber spicy"]'::jsonb, true),
  ('incense', 'Incense', 'Incense or lit-resin smoke effect.', '["incense","olibanum"]'::jsonb, true),
  ('resin', 'Resin', 'Resinous, balsamic, or smoldering resin effect.', '["resin","balsamic","benzoin","labdanum"]'::jsonb, true),
  ('leather', 'Leather', 'Leather or hide-like structure.', '["leather","suede"]'::jsonb, true),
  ('tobacco', 'Tobacco', 'Tobacco leaf or pipe-tobacco structure.', '["tobacco","cigar"]'::jsonb, true),
  ('boozy', 'Boozy', 'Liquor, rum, whiskey, or liqueur effect.', '["boozy","rum","liqueur","whiskey"]'::jsonb, true),
  ('gourmand', 'Gourmand', 'Edible or confectionary sweetness.', '["vanilla","pastry","dessert","gourmand"]'::jsonb, true),
  ('powdery', 'Powdery', 'Powdery, cosmetic, or velvety texture.', '["powdery","iris","heliotrope"]'::jsonb, true),
  ('woody', 'Woody', 'Woody backbone or woods-dominant structure.', '["woody","cedar","sandalwood","hinoki","cypress"]'::jsonb, true),
  ('balsamic', 'Balsamic', 'Balsamic, soft resin, or warm smolder.', '["balsamic","resin","amber"]'::jsonb, true),
  ('creamy', 'Creamy', 'Creamy, milky, or soft sandalwood texture.', '["creamy","milk","lactonic","sandalwood"]'::jsonb, true),
  ('spicy', 'Spicy', 'Spice or warm-spice structure.', '["spicy","pepper","cardamom","nutmeg"]'::jsonb, true)
on conflict (facet_key) do update
set
  display_label = excluded.display_label,
  definition = excluded.definition,
  evidence_notes = excluded.evidence_notes,
  active = excluded.active;

insert into public.wardrobe_role_reference_v1 (
  role_key,
  display_label,
  definition,
  active
)
values
  ('anchor', 'Anchor', 'Core backbone scent that can hold the wardrobe together.', true),
  ('brightener', 'Brightener', 'Adds lift, freshness, sparkle, or air into the wardrobe.', true),
  ('softener', 'Softener', 'Rounds edges and adds softness, comfort, or a diffused skin effect.', true),
  ('bridge', 'Bridge', 'Connects lanes, moods, or layer structures between other scents.', true),
  ('accent', 'Accent', 'Used in smaller doses for contrast, tension, or texture.', true),
  ('layer_tool', 'Layer Tool', 'Useful mainly as a construction tool or layering support piece.', true),
  ('soloist', 'Soloist', 'Best used as a full statement on its own.', true),
  ('aura', 'Aura', 'Projects a soft atmospheric halo more than a structural core.', true)
on conflict (role_key) do update
set
  display_label = excluded.display_label,
  definition = excluded.definition,
  active = excluded.active;

with review_inputs as (
  select *
  from (
    values
      (
        'b212a5ff-9365-4029-a8a6-f2f5b3351279'::uuid,
        'Bleu Mémoire L’Exclusif'::text,
        'Alexandria Fragrances'::text,
        'https://alexandriafragrances.com/products/bleu-memoire-lexclusif'::text,
        'woody-clean'::text,
        'woody'::text,
        0.75::numeric,
        'medium_confidence'::text,
        'Compatibility woody-clean assignment from exact official woody/amber/powdery/musky/balsamic accord structure.'::text,
        array['woody','amber','powdery','musk','balsamic']::text[],
        jsonb_build_array(
          jsonb_build_object('role_key', 'anchor', 'role_priority', 1),
          jsonb_build_object('role_key', 'bridge', 'role_priority', 2)
        ),
        jsonb_build_array('woody-amber','clean-musk','powdery-balsamic'),
        'Only exact Alexandria enrichment used. No dupe or inspiration claim exists.'::text,
        false
      ),
      (
        '86b3eab8-6a10-437e-90d9-54c4a41ed8de'::uuid,
        'Blue Turquoise'::text,
        'Alexandria Fragrances'::text,
        'https://alexandriafragrances.com/products/blue-turquoise'::text,
        'oud-amber'::text,
        'amber-oriental'::text,
        0.66::numeric,
        'medium_confidence'::text,
        'Compatibility oud-amber assignment from official amber-spicy, salty, floral, woody, vanilla-sandalwood structure; not a literal oud claim.'::text,
        array['amber','salty','floral','woody','spicy']::text[],
        jsonb_build_array(
          jsonb_build_object('role_key', 'soloist', 'role_priority', 1),
          jsonb_build_object('role_key', 'accent', 'role_priority', 2)
        ),
        jsonb_build_array('amber-spicy','salty-amber','floral-woods'),
        'Legacy family_key uses oud-amber as the nearest compatibility bucket for an amber-oriental structure. This is not a literal oud attribution.'::text,
        false
      ),
      (
        '68c00144-0a80-4ed5-9016-237aa83b5b81'::uuid,
        'Ghostbusters'::text,
        'Alexandria Fragrances'::text,
        'https://alexandriafragrances.com/products/ghostbusters-inspired-by-mojave-ghost-byredo'::text,
        'woody-clean'::text,
        'woody'::text,
        0.70::numeric,
        'medium_confidence'::text,
        'Compatibility woody-clean assignment from official woody/floral/fruity structure with ambergris support and a soft woody finish.'::text,
        array['floral','fruity','woody','musk']::text[],
        jsonb_build_array(
          jsonb_build_object('role_key', 'softener', 'role_priority', 1),
          jsonb_build_object('role_key', 'aura', 'role_priority', 2)
        ),
        jsonb_build_array('soft-woods','floral-woods','clean-musk'),
        'Official source describes fruity/floral opening with woody notes; ambergris support is treated as soft musky diffusion, not a separate family.'::text,
        false
      ),
      (
        'b267df6b-3bab-4e6d-a6ea-15eeeaed7e54'::uuid,
        'Smooth Sailing'::text,
        'Alexandria Fragrances'::text,
        'https://alexandriafragrances.com/products/smooth-sailing'::text,
        'fresh-blue'::text,
        'fresh-aquatic'::text,
        0.72::numeric,
        'medium_confidence'::text,
        'Compatibility fresh-blue assignment from official marine/saltwater/fresh-air heart with amber-incense drydown and boozy-fruity lift.'::text,
        array['marine','salty','ozonic','amber','resin','boozy','fruity']::text[],
        jsonb_build_array(
          jsonb_build_object('role_key', 'brightener', 'role_priority', 1),
          jsonb_build_object('role_key', 'bridge', 'role_priority', 2)
        ),
        jsonb_build_array('marine-amber','aquatic-air','salty-resin'),
        'Marine and fresh-air heart drive the compatibility family; amber and incense stay as supporting facets rather than redefining the lane.'::text,
        false
      )
  ) as v(
    fragrance_id,
    fragrance_name,
    fragrance_brand,
    expected_source_url,
    legacy_family_key,
    universal_equivalent,
    confidence,
    review_status,
    assignment_reason,
    facet_keys,
    role_rows,
    accord_tags,
    compatibility_note,
    literal_oud_claim
  )
),
targets as (
  select
    ri.*,
    f.family_key as old_family_key,
    f.notes,
    f.accords,
    f.top_notes,
    f.heart_notes,
    f.base_notes,
    coalesce(f.source_url, e.source_url) as verified_source_url,
    coalesce(f.source_confidence::text, e.source_confidence::text) as verified_source_confidence,
    e.provider_payload
  from review_inputs ri
  join public.fragrances f
    on f.id = ri.fragrance_id
   and f.name = ri.fragrance_name
   and f.brand = ri.fragrance_brand
  left join lateral (
    select e.*
    from public.fragrance_text_enrichment e
    where e.fragrance_id = f.id
    order by e.updated_at desc nulls last, e.created_at desc nulls last
    limit 1
  ) e on true
  where coalesce(f.source_url, e.source_url) = ri.expected_source_url
    and coalesce(e.provider_payload->>'identity_match_status', 'matched') = 'matched'
    and (f.family_key is null or f.family_key = ri.legacy_family_key)
),
updated_families as (
  update public.fragrances f
  set family_key = t.legacy_family_key
  from targets t
  where f.id = t.fragrance_id
    and f.family_key is distinct from t.legacy_family_key
  returning f.id
),
audit_rows as (
  insert into public.fragrance_family_assignment_audit_v1 (
    fragrance_id,
    fragrance_name,
    fragrance_brand,
    old_family_key,
    new_family_key,
    evidence_source,
    evidence_confidence,
    evidence_json,
    assignment_reason,
    assigned_by,
    created_at
  )
  select
    t.fragrance_id,
    t.fragrance_name,
    t.fragrance_brand,
    t.old_family_key,
    t.legacy_family_key,
    'alexandria_official_source_enrichment + manual taxonomy compatibility review',
    t.confidence,
    jsonb_build_object(
      'official_source_url', t.verified_source_url,
      'official_source_confidence', t.verified_source_confidence,
      'official_source_excerpt', t.provider_payload->'source_evidence'->>'official_excerpt',
      'official_notes', to_jsonb(coalesce(t.notes, '{}'::text[])),
      'official_accords', to_jsonb(coalesce(t.accords, '{}'::text[])),
      'top_notes', to_jsonb(coalesce(t.top_notes, '{}'::text[])),
      'heart_notes', to_jsonb(coalesce(t.heart_notes, '{}'::text[])),
      'base_notes', to_jsonb(coalesce(t.base_notes, '{}'::text[])),
      'universal_equivalent', t.universal_equivalent,
      'facet_keys', to_jsonb(t.facet_keys),
      'role_rows', t.role_rows,
      'accord_tags', t.accord_tags,
      'review_status', t.review_status,
      'compatibility_note', t.compatibility_note,
      'literal_oud_claim', t.literal_oud_claim,
      'compatibility_assignment', true
    ),
    t.assignment_reason,
    'odara_taxonomy_compatibility_phase_a_2026_05_21',
    now()
  from targets t
  where t.old_family_key is distinct from t.legacy_family_key
    and not exists (
      select 1
      from public.fragrance_family_assignment_audit_v1 audit
      where audit.fragrance_id = t.fragrance_id
        and audit.new_family_key = t.legacy_family_key
        and audit.assigned_by = 'odara_taxonomy_compatibility_phase_a_2026_05_21'
    )
  returning fragrance_id
),
facet_upserts as (
  insert into public.fragrance_facets_v1 (
    fragrance_id,
    facet_key,
    confidence,
    evidence_source,
    evidence_json,
    created_at,
    updated_at
  )
  select
    t.fragrance_id,
    facet_key,
    t.confidence,
    'alexandria_official_source_enrichment + manual taxonomy compatibility review',
    jsonb_build_object(
      'official_source_url', t.verified_source_url,
      'official_source_excerpt', t.provider_payload->'source_evidence'->>'official_excerpt',
      'legacy_family_key', t.legacy_family_key,
      'universal_equivalent', t.universal_equivalent,
      'review_status', t.review_status
    ),
    now(),
    now()
  from targets t
  cross join lateral unnest(t.facet_keys) as facet_key
  on conflict (fragrance_id, facet_key) do update
  set
    confidence = excluded.confidence,
    evidence_source = excluded.evidence_source,
    evidence_json = excluded.evidence_json,
    updated_at = now()
  returning fragrance_id
),
role_upserts as (
  insert into public.fragrance_wardrobe_roles_v1 (
    fragrance_id,
    role_key,
    role_priority,
    confidence,
    evidence_source,
    evidence_json,
    created_at,
    updated_at
  )
  select
    t.fragrance_id,
    rr.role_key,
    rr.role_priority,
    t.confidence,
    'alexandria_official_source_enrichment + manual taxonomy compatibility review',
    jsonb_build_object(
      'official_source_url', t.verified_source_url,
      'official_source_excerpt', t.provider_payload->'source_evidence'->>'official_excerpt',
      'legacy_family_key', t.legacy_family_key,
      'universal_equivalent', t.universal_equivalent,
      'review_status', t.review_status
    ),
    now(),
    now()
  from targets t
  cross join lateral jsonb_to_recordset(t.role_rows) as rr(role_key text, role_priority integer)
  on conflict (fragrance_id, role_key) do update
  set
    role_priority = excluded.role_priority,
    confidence = excluded.confidence,
    evidence_source = excluded.evidence_source,
    evidence_json = excluded.evidence_json,
    updated_at = now()
  returning fragrance_id
)
insert into public.fragrance_taxonomy_review_v1 (
  fragrance_id,
  legacy_family_key,
  universal_equivalent,
  confidence,
  review_status,
  evidence_source,
  evidence_json,
  reviewed_by,
  created_at,
  updated_at
)
select
  t.fragrance_id,
  t.legacy_family_key,
  t.universal_equivalent,
  t.confidence,
  t.review_status,
  'alexandria_official_source_enrichment + manual taxonomy compatibility review',
  jsonb_build_object(
    'official_source_url', t.verified_source_url,
    'official_source_confidence', t.verified_source_confidence,
    'official_source_excerpt', t.provider_payload->'source_evidence'->>'official_excerpt',
    'official_notes', to_jsonb(coalesce(t.notes, '{}'::text[])),
    'official_accords', to_jsonb(coalesce(t.accords, '{}'::text[])),
    'top_notes', to_jsonb(coalesce(t.top_notes, '{}'::text[])),
    'heart_notes', to_jsonb(coalesce(t.heart_notes, '{}'::text[])),
    'base_notes', to_jsonb(coalesce(t.base_notes, '{}'::text[])),
    'facet_keys', to_jsonb(t.facet_keys),
    'role_rows', t.role_rows,
    'accord_tags', t.accord_tags,
    'compatibility_note', t.compatibility_note,
    'literal_oud_claim', t.literal_oud_claim,
    'compatibility_assignment', true
  ),
  'odara_taxonomy_compatibility_phase_a_2026_05_21',
  now(),
  now()
from targets t
on conflict (fragrance_id) do update
set
  legacy_family_key = excluded.legacy_family_key,
  universal_equivalent = excluded.universal_equivalent,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  evidence_source = excluded.evidence_source,
  evidence_json = excluded.evidence_json,
  reviewed_by = excluded.reviewed_by,
  updated_at = now();
