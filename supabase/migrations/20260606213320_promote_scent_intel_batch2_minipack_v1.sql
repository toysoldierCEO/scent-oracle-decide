alter table public.scent_terms
  drop constraint if exists scent_terms_source_status_check;

alter table public.scent_terms
  add constraint scent_terms_source_status_check
  check (
    source_status is null
    or source_status in (
      'approved',
      'inferred',
      'needs_review',
      'verified_primary',
      'verified_secondary',
      'source_light'
    )
  );

insert into public.scent_terms (
  slug,
  label,
  term_type,
  scent_category,
  family_key,
  short_label,
  what_it_is,
  smells_like,
  used_for,
  what_it_does,
  pairs_well_with,
  odara_read,
  confidence,
  source_status,
  source_note
)
values
  (
    'lemon',
    'Lemon',
    'material',
    'Citrus Material',
    null,
    'Citrus Material',
    'Lemon is a peel-based citrus material used for sharp, sparkling freshness.',
    array['Zesty peel', 'crisp sourness', 'juicy brightness', 'citral snap'],
    'Colognes, aromatic citrus openings, and sharpening fresh blends.',
    'Adds sparkle, edge, and a cleaner top-note lift.',
    array['Bergamot', 'Grapefruit', 'Orange', 'Neroli', 'Lavender', 'Herbs', 'Musk', 'Tea'],
    null,
    'high',
    'verified_primary',
    'Primary support is strong for lemon as a peel-based citrus material used for top-note brightness.'
  ),
  (
    'orange',
    'Orange',
    'material',
    'Citrus Material',
    null,
    'Citrus Material',
    'Orange is a bright citrus note made from the peel of the fruit. In perfume, it usually means sweet orange oil, though bitter orange can give a drier, cleaner twist.',
    array['Juicy peel', 'sweet citrus', 'fresh zest', 'soft brightness'],
    'Citrus openings, colognes, fruity-fresh florals, and brightening woody blends.',
    'Adds instant freshness, sweetness, and a more inviting top note.',
    array['Bergamot', 'Mandarin', 'Lemon', 'Neroli', 'Petitgrain', 'Jasmine', 'Cedar', 'Musk'],
    null,
    'high',
    'verified_primary',
    'Primary support is strong for orange peel materials in perfumery, especially sweet and bitter orange oils.'
  ),
  (
    'mandarin',
    'Mandarin',
    'material',
    'Citrus Material',
    null,
    'Citrus Material',
    'Mandarin is a sweet, peel-based citrus note. Green mandarin is especially valued for its brighter, more lifted character.',
    array['Sweet zest', 'juicy citrus', 'soft florals', 'fruity freshness'],
    'Soft citrus openings, playful freshness, and smoothing sharper citrus blends.',
    'Makes a citrus top feel rounder, juicier, and less harsh.',
    array['Orange', 'Bergamot', 'Lemon', 'Neroli', 'Jasmine', 'Herbs', 'Musk', 'Woods'],
    null,
    'high',
    'verified_primary',
    'Primary support is strong for mandarin as a sweet citrus peel material, including green mandarin variants.'
  ),
  (
    'grapefruit',
    'Grapefruit',
    'material',
    'Citrus Material',
    null,
    'Citrus Material',
    'Grapefruit is a peel-based citrus note known for brightness with bite.',
    array['Juicy peel', 'tart citrus', 'bitter freshness', 'a faint sulfury snap'],
    'Modern citrus openings, crisp colognes, and bright fresh-woody scents.',
    'Sharpens the top, adds bitterness, and makes freshness feel more realistic.',
    array['Bergamot', 'Lemon', 'Mandarin', 'Vetiver', 'Cedar', 'Herbs', 'Musks', 'Aquatic Notes'],
    null,
    'high',
    'verified_primary',
    'Primary support is strong for grapefruit as a citrus peel note with tart bitterness and a slightly sulfury facet.'
  ),
  (
    'marine-aquatic',
    'Marine / Aquatic',
    'accord',
    'Aquatic Scent Blend',
    null,
    'Aquatic Scent Blend',
    'Marine or aquatic is a built scent effect that suggests water, sea air, or watery freshness.',
    array['Sea breeze', 'cool water', 'fresh air', 'salt', 'ozone', 'watery florals'],
    'Fresh scents, transparent musks, watery florals, and beachy or sporty styles.',
    'Cools a formula, adds air, and makes freshness feel more modern and spacious.',
    array['Grapefruit', 'Lemon', 'Green Notes', 'Muguet-style Florals', 'White Musks', 'Cedar', 'Ambrox-like Notes', 'Lavender'],
    null,
    'high',
    'verified_primary',
    'Primary support is strong for marine and aquatic as built watery scent effects rather than one natural material.'
  ),
  (
    'fresh-aquatic',
    'Fresh Aquatic',
    'family',
    'Aquatic Scent Blend',
    'fresh-aquatic',
    'Fragrance Family Style',
    'Fresh aquatic is the cleaner, lighter side of watery perfumery. It suggests cool air, dew, and clean freshness more than literal seawater.',
    array['Dewy air', 'cool water', 'fresh linen', 'soft ozone', 'watery florals'],
    'Easy fresh scents, airy florals, sporty styles, and clean musk blends.',
    'Makes a fragrance feel lighter, cooler, and more transparent.',
    array['Citrus', 'Muguet-style Florals', 'Musks', 'Aldehydic Notes', 'Green Notes', 'Light Woods', 'Lavender', 'Neroli'],
    null,
    'medium',
    'verified_secondary',
    'Secondary support reflects this as a family-style watery freshness profile rather than one fixed material.'
  ),
  (
    'powdery',
    'Powdery',
    'accord',
    'Material Effect',
    null,
    'Texture Effect',
    'Powdery is a soft texture effect in perfume, not one single note. It often comes from iris-like materials, heliotrope-style sweetness, or clean musks.',
    array['Soft face powder', 'cosmetics', 'powdered petals', 'musky softness', 'almond cream'],
    'Smoothing florals, softening woods, and creating a velvety finish.',
    'Makes a scent feel softer, more polished, and more skin-close.',
    array['Iris', 'Violet', 'Rose', 'Musks', 'Heliotrope', 'Tonka', 'Sandalwood', 'Aldehydes'],
    null,
    'medium',
    'verified_secondary',
    'Secondary support treats powdery as a texture effect built from multiple materials rather than a single note.'
  ),
  (
    'aldehydic',
    'Aldehydic',
    'accord',
    'Material Effect',
    null,
    'Material-Led Effect',
    'Aldehydic describes a sparkling, polished perfume effect created by aldehyde materials. It is more of a style or texture than a single smell.',
    array['Soapy freshness', 'waxy lift', 'clean sparkle', 'cool air', 'bright abstraction'],
    'Polished tops, classic florals, clean musks, and making a fragrance feel more finished.',
    'Adds shimmer, lift, and a more unmistakably perfumed effect.',
    array['Citrus', 'Rose', 'Neroli', 'White Florals', 'Musks', 'Iris', 'Sandalwood', 'Powdery Notes'],
    null,
    'medium',
    'verified_secondary',
    'Secondary support reflects aldehydic as a material-led polished effect rather than a single smell object.'
  ),
  (
    'raspberry',
    'Raspberry',
    'note',
    'Fruit Note',
    null,
    'Reconstructed Fruit Note',
    'Raspberry is usually a rebuilt red-fruit note in perfume. It can feel tart and juicy, or sweeter and more jammy depending on the formula.',
    array['Red berries', 'jammy sweetness', 'tart fruit', 'candy brightness', 'soft powder'],
    'Fruity florals, berry gourmands, and playful sweet-fruit effects.',
    'Adds sweetness, color, and a more vivid red-fruit character.',
    array['Rose', 'Violet', 'Jasmine', 'Vanilla', 'Musks', 'Patchouli', 'Woods', 'Soft Gourmands'],
    null,
    'medium',
    'verified_secondary',
    'Secondary support reflects raspberry as a frequently reconstructed red-fruit note with tart or jammy styles.'
  ),
  (
    'plum',
    'Plum',
    'note',
    'Fruit Note',
    null,
    'Reconstructed Fruit Note',
    'Plum is usually a rebuilt fruit note in perfume rather than a common natural extract. It can be fresh and juicy or dark and velvety depending on the formula.',
    array['Juicy purple fruit', 'sweet-tart flesh', 'winey depth', 'soft jam', 'dark fruit skin'],
    'Fruity florals, plush ambers, dark woods, and richer modern fruit effects.',
    'Adds depth, color, and a more sensual fruit profile than brighter citrus or berry notes.',
    array['Osmanthus', 'Rose', 'Patchouli', 'Vanilla', 'Amber', 'Sandalwood', 'Leather', 'Tobacco'],
    null,
    'low',
    'source_light',
    'Source-light support treats plum as a reconstructed fruit note with fresh-to-dark stylistic variation.'
  )
on conflict (slug) do update
set
  label = excluded.label,
  term_type = excluded.term_type,
  scent_category = excluded.scent_category,
  family_key = excluded.family_key,
  short_label = excluded.short_label,
  what_it_is = excluded.what_it_is,
  smells_like = excluded.smells_like,
  used_for = excluded.used_for,
  what_it_does = excluded.what_it_does,
  pairs_well_with = excluded.pairs_well_with,
  odara_read = coalesce(public.scent_terms.odara_read, excluded.odara_read),
  confidence = coalesce(public.scent_terms.confidence, excluded.confidence),
  source_status = coalesce(public.scent_terms.source_status, excluded.source_status),
  source_note = coalesce(public.scent_terms.source_note, excluded.source_note),
  updated_at = now();

with target_terms as (
  select id, slug
  from public.scent_terms
  where slug in (
    'lemon',
    'orange',
    'mandarin',
    'grapefruit',
    'marine-aquatic',
    'fresh-aquatic',
    'powdery',
    'aldehydic',
    'raspberry',
    'plum'
  )
),
term_aliases as (
  select 'lemon'::text as slug, alias from unnest(array['lemon']) as alias
  union all
  select 'orange', alias from unnest(array['orange']) as alias
  union all
  select 'mandarin', alias from unnest(array['mandarin', 'mandarin-orange']) as alias
  union all
  select 'grapefruit', alias from unnest(array['grapefruit']) as alias
  union all
  select 'marine-aquatic', alias from unnest(array['marine', 'marine-notes', 'aquatic', 'marine-aquatic']) as alias
  union all
  select 'fresh-aquatic', alias from unnest(array['fresh-aquatic', 'fresh aquatic']) as alias
  union all
  select 'powdery', alias from unnest(array['powdery', 'powdery-notes']) as alias
  union all
  select 'aldehydic', alias from unnest(array['aldehydic', 'aldehydes']) as alias
  union all
  select 'raspberry', alias from unnest(array['raspberry']) as alias
  union all
  select 'plum', alias from unnest(array['plum']) as alias
),
raw_terms as (
  select
    f.id as fragrance_id,
    x.label::text as term_label,
    x.position::text as position,
    x.source::text as source,
    f.source_url
  from public.fragrances f
  cross join lateral (
    select unnest(coalesce(f.top_notes, '{}'::text[])) as label, 'top' as position, 'fragrances.top_notes' as source
    union all
    select unnest(coalesce(f.heart_notes, '{}'::text[])) as label, 'heart' as position, 'fragrances.heart_notes' as source
    union all
    select unnest(coalesce(f.base_notes, '{}'::text[])) as label, 'base' as position, 'fragrances.base_notes' as source
    union all
    select unnest(coalesce(f.notes, '{}'::text[])) as label, 'unknown' as position, 'fragrances.notes' as source
    union all
    select unnest(coalesce(f.accords, '{}'::text[])) as label, 'accord' as position, 'fragrances.accords' as source
    union all
    select coalesce(f.family_key, f.family, f.family_raw) as label, 'family' as position, 'fragrances.family_key' as source
      where coalesce(f.family_key, f.family, f.family_raw) is not null
  ) x
  where nullif(btrim(x.label), '') is not null
),
normalized_terms as (
  select
    rt.fragrance_id,
    rt.term_label,
    rt.position,
    rt.source,
    rt.source_url,
    public.scent_term_slugify_v1(rt.term_label) as term_slug
  from raw_terms rt
),
matched_terms as (
  select distinct on (nt.fragrance_id, tt.id, nt.position)
    nt.fragrance_id,
    tt.id as scent_term_id,
    nt.term_label,
    nt.position,
    nt.source,
    nt.source_url,
    case
      when nt.position in ('top', 'heart', 'base') then 'high'
      when nt.position in ('accord', 'family') then 'medium'
      else 'medium'
    end as confidence
  from normalized_terms nt
  join term_aliases ta
    on ta.alias = nt.term_slug
  join target_terms tt
    on tt.slug = ta.slug
  order by nt.fragrance_id, tt.id, nt.position, nt.term_label
)
insert into public.fragrance_scent_terms (
  fragrance_id,
  scent_term_id,
  term_label,
  position,
  confidence,
  source,
  source_url
)
select
  mt.fragrance_id,
  mt.scent_term_id,
  mt.term_label,
  mt.position,
  mt.confidence,
  mt.source,
  mt.source_url
from matched_terms mt
on conflict (fragrance_id, scent_term_id, position) do update
set
  term_label = excluded.term_label,
  confidence = excluded.confidence,
  source = excluded.source,
  source_url = excluded.source_url,
  updated_at = now();
