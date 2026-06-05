-- Scent Intel v1
-- Normalized, compact education cards for Odara detail chips.
-- This migration creates new Scent Intel tables only; it does not mutate
-- public.fragrances, recommendation queues, taxonomy, or collection rows.

create or replace function public.scent_term_slugify_v1(p_label text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(
    regexp_replace(lower(btrim(coalesce(p_label, ''))), '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)',
    '',
    'g'
  );
$$;

create table if not exists public.scent_terms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  term_type text not null,
  scent_category text null,
  family_key text null,
  short_label text null,
  smells_like text[] null,
  used_for text null,
  what_it_does text null,
  pairs_well_with text[] null,
  odara_read text null,
  confidence text null,
  source_status text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scent_terms_slug_not_blank check (btrim(slug) <> ''),
  constraint scent_terms_label_not_blank check (btrim(label) <> ''),
  constraint scent_terms_term_type_check check (term_type in ('note', 'accord', 'material', 'family', 'chord')),
  constraint scent_terms_confidence_check check (confidence is null or confidence in ('high', 'medium', 'low')),
  constraint scent_terms_source_status_check check (source_status is null or source_status in ('approved', 'inferred', 'needs_review'))
);

create index if not exists scent_terms_term_type_idx
  on public.scent_terms (term_type);

create index if not exists scent_terms_family_key_idx
  on public.scent_terms (family_key)
  where family_key is not null;

drop trigger if exists scent_terms_touch_updated_at
  on public.scent_terms;

create trigger scent_terms_touch_updated_at
before update on public.scent_terms
for each row
execute function public.set_updated_at_v1();

alter table public.scent_terms enable row level security;

drop policy if exists "Scent terms are readable" on public.scent_terms;
create policy "Scent terms are readable"
on public.scent_terms
for select
to anon, authenticated
using (true);

grant select on table public.scent_terms to anon, authenticated;
grant all on table public.scent_terms to service_role;

create table if not exists public.fragrance_scent_terms (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  scent_term_id uuid not null references public.scent_terms(id) on delete cascade,
  term_label text null,
  position text null,
  confidence text null,
  source text null,
  source_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fragrance_scent_terms_position_check check (
    position is null or position in ('top', 'heart', 'middle', 'base', 'accord', 'material', 'family', 'unknown')
  ),
  constraint fragrance_scent_terms_confidence_check check (
    confidence is null or confidence in ('high', 'medium', 'low')
  ),
  constraint fragrance_scent_terms_unique_position unique (fragrance_id, scent_term_id, position)
);

create index if not exists fragrance_scent_terms_term_idx
  on public.fragrance_scent_terms (scent_term_id, fragrance_id);

create index if not exists fragrance_scent_terms_fragrance_idx
  on public.fragrance_scent_terms (fragrance_id, scent_term_id);

drop trigger if exists fragrance_scent_terms_touch_updated_at
  on public.fragrance_scent_terms;

create trigger fragrance_scent_terms_touch_updated_at
before update on public.fragrance_scent_terms
for each row
execute function public.set_updated_at_v1();

alter table public.fragrance_scent_terms enable row level security;

drop policy if exists "Fragrance scent terms are readable" on public.fragrance_scent_terms;
create policy "Fragrance scent terms are readable"
on public.fragrance_scent_terms
for select
to anon, authenticated
using (true);

grant select on table public.fragrance_scent_terms to anon, authenticated;
grant all on table public.fragrance_scent_terms to service_role;

insert into public.scent_terms (
  slug,
  label,
  term_type,
  scent_category,
  family_key,
  short_label,
  smells_like,
  used_for,
  what_it_does,
  pairs_well_with,
  odara_read,
  confidence,
  source_status
)
values
  ('basil', 'Basil', 'note', 'Green Aromatic Note', null, 'Green aromatic',
    array['Fresh herbs', 'peppery leaves', 'green stems', 'faint licorice'],
    'Adds crisp herbal lift to citrus, green, fougere, and aromatic scents.',
    'Makes a fragrance feel fresher, sharper, cleaner, and more alive.',
    array['Bergamot', 'Lemon', 'Lavender', 'Mint', 'Vetiver', 'Neroli'],
    'Usually pushes scents greener, fresher, sharper, and more aromatic.',
    'high', 'approved'),
  ('oud', 'Oud', 'material', 'Dark Woody Material', null, 'Dark woody',
    array['Dark wood', 'resin', 'smoke', 'leather', 'warm dust'],
    'Adds depth and shadow to amber, rose, leather, incense, and woody scents.',
    'Makes a fragrance feel darker, denser, richer, and longer-lasting.',
    array['Rose', 'Saffron', 'Amber', 'Vanilla', 'Incense', 'Leather', 'Patchouli'],
    'Usually pushes scents darker, warmer, woodier, denser, and more sensual.',
    'high', 'approved'),
  ('amber', 'Amber', 'accord', 'Warm Resinous Accord', 'amber-oriental', 'Warm resin',
    array['Warm resin', 'vanilla glow', 'soft spice', 'golden sweetness'],
    'Gives warmth and roundness to woods, vanilla, incense, spice, and florals.',
    'Makes a fragrance feel warmer, smoother, richer, and more enveloping.',
    array['Vanilla', 'Labdanum', 'Benzoin', 'Sandalwood', 'Patchouli', 'Incense'],
    'Usually pushes scents warmer, sweeter, smoother, and more sensual.',
    'high', 'approved'),
  ('bergamot', 'Bergamot', 'note', 'Citrus Note', null, 'Citrus',
    array['Bright citrus peel', 'Earl Grey tea', 'soft bitterness', 'fresh sparkle'],
    'Adds lift and brightness to citrus, aromatic, fougere, and woody scents.',
    'Makes a fragrance feel fresher, cleaner, brighter, and more open.',
    array['Lavender', 'Basil', 'Neroli', 'Vetiver', 'Cedar', 'Musk'],
    'Usually pushes scents brighter, fresher, cleaner, and more energetic.',
    'high', 'approved'),
  ('vanilla', 'Vanilla', 'note', 'Sweet Balsamic Note', null, 'Sweet balsamic',
    array['Creamy sweetness', 'warm sugar', 'soft spice', 'smooth woods'],
    'Rounds amber, tobacco, woods, spice, leather, and gourmand scents.',
    'Makes a fragrance feel softer, warmer, sweeter, and more comforting.',
    array['Amber', 'Tonka Bean', 'Benzoin', 'Tobacco', 'Sandalwood', 'Musk'],
    'Usually pushes scents sweeter, smoother, warmer, and more wearable.',
    'high', 'approved'),
  ('labdanum', 'Labdanum', 'material', 'Amber Resin Material', null, 'Amber resin',
    array['Sticky amber resin', 'leather', 'dry sweetness', 'warm balsam'],
    'Builds amber depth in resinous, leathery, incense, and chypre scents.',
    'Makes a fragrance feel warmer, darker, more textured, and more tenacious.',
    array['Benzoin', 'Vanilla', 'Patchouli', 'Incense', 'Rose', 'Leather'],
    'Usually pushes scents amberier, darker, leathery, and resinous.',
    'high', 'approved'),
  ('benzoin', 'Benzoin', 'material', 'Sweet Resin Material', null, 'Sweet resin',
    array['Vanilla resin', 'warm balsam', 'soft powder', 'honeyed sweetness'],
    'Softens amber, vanilla, incense, woods, and powdery compositions.',
    'Makes a fragrance feel smoother, sweeter, warmer, and more cushioned.',
    array['Vanilla', 'Labdanum', 'Amber', 'Sandalwood', 'Tonka Bean', 'Incense'],
    'Usually pushes scents warmer, smoother, sweeter, and more balsamic.',
    'high', 'approved'),
  ('sandalwood', 'Sandalwood', 'material', 'Creamy Wood Material', null, 'Creamy wood',
    array['Creamy wood', 'soft milkiness', 'dry warmth', 'smooth powder'],
    'Adds polished woodiness to amber, musk, iris, floral, and vanilla scents.',
    'Makes a fragrance feel smoother, creamier, calmer, and more refined.',
    array['Iris', 'Musk', 'Vanilla', 'Cedar', 'Rose', 'Amber'],
    'Usually pushes scents smoother, creamier, woodier, and more polished.',
    'high', 'approved'),
  ('cedar', 'Cedar', 'material', 'Dry Wood Material', null, 'Dry wood',
    array['Dry pencil wood', 'clean shavings', 'crisp timber', 'cool air'],
    'Adds structure to citrus, aromatic, woody, leather, and musky scents.',
    'Makes a fragrance feel drier, cleaner, straighter, and more architectural.',
    array['Bergamot', 'Vetiver', 'Musk', 'Lavender', 'Patchouli', 'Iris'],
    'Usually pushes scents drier, cleaner, woodier, and more tailored.',
    'high', 'approved'),
  ('vetiver', 'Vetiver', 'material', 'Dry Green Root Material', null, 'Green root',
    array['Dry roots', 'green earth', 'smoke', 'bitter grass'],
    'Adds earthy dryness to citrus, woods, green, aromatic, and smoky scents.',
    'Makes a fragrance feel drier, greener, sharper, and more grounded.',
    array['Bergamot', 'Cedar', 'Lavender', 'Basil', 'Patchouli', 'Musk'],
    'Usually pushes scents greener, drier, earthier, and more structured.',
    'high', 'approved'),
  ('patchouli', 'Patchouli', 'material', 'Earthy Woody Material', null, 'Earthy wood',
    array['Damp earth', 'dark leaves', 'cocoa shadow', 'woody camphor'],
    'Adds depth to amber, rose, chocolate, incense, leather, and chypre scents.',
    'Makes a fragrance feel darker, earthier, richer, and more grounded.',
    array['Rose', 'Amber', 'Vanilla', 'Incense', 'Labdanum', 'Leather'],
    'Usually pushes scents earthier, darker, woodier, and more persistent.',
    'high', 'approved'),
  ('leather', 'Leather', 'accord', 'Leather Accord', 'leather', 'Leather',
    array['Suede', 'tanned hide', 'smoke', 'dry woods', 'warm polish'],
    'Adds texture and attitude to amber, oud, tobacco, rose, and spicy scents.',
    'Makes a fragrance feel darker, drier, more tactile, and more assertive.',
    array['Oud', 'Saffron', 'Rose', 'Tobacco', 'Patchouli', 'Amber'],
    'Usually pushes scents darker, drier, more textured, and more dressed-up.',
    'high', 'approved'),
  ('tobacco', 'Tobacco', 'note', 'Warm Leaf Note', null, 'Warm leaf',
    array['Dried leaf', 'honey', 'hay', 'soft smoke', 'warm spice'],
    'Adds warmth to vanilla, amber, spice, leather, boozy, and woody scents.',
    'Makes a fragrance feel warmer, richer, smoother, and more intimate.',
    array['Vanilla', 'Tonka Bean', 'Amber', 'Leather', 'Cinnamon', 'Patchouli'],
    'Usually pushes scents warmer, sweeter, deeper, and more enveloping.',
    'high', 'approved'),
  ('iris', 'Iris', 'material', 'Powdery Floral Material', null, 'Powdery floral',
    array['Cool powder', 'violet softness', 'makeup bag', 'buttery woods'],
    'Adds polish to musk, woods, leather, violet, powdery, and floral scents.',
    'Makes a fragrance feel smoother, cooler, more elegant, and more dressed.',
    array['Sandalwood', 'Musk', 'Violet', 'Cedar', 'Leather', 'Rose'],
    'Usually pushes scents powderier, smoother, cooler, and more refined.',
    'high', 'approved'),
  ('lavender', 'Lavender', 'note', 'Aromatic Floral Note', null, 'Aromatic floral',
    array['Clean herbs', 'soft flowers', 'camphor', 'fresh linen'],
    'Adds aromatic clarity to fougere, citrus, musk, amber, and barbershop scents.',
    'Makes a fragrance feel cleaner, calmer, fresher, and more composed.',
    array['Bergamot', 'Basil', 'Mint', 'Vanilla', 'Tonka Bean', 'Musk'],
    'Usually pushes scents fresher, cleaner, more aromatic, and more classic.',
    'high', 'approved'),
  ('rose', 'Rose', 'note', 'Floral Note', null, 'Floral',
    array['Velvety petals', 'jammy fruit', 'green stems', 'soft spice'],
    'Adds floral body to oud, amber, musk, patchouli, leather, and citrus scents.',
    'Makes a fragrance feel fuller, more romantic, more textured, and more expressive.',
    array['Oud', 'Saffron', 'Patchouli', 'Amber', 'Musk', 'Bergamot'],
    'Usually pushes scents more floral, richer, smoother, and more expressive.',
    'high', 'approved'),
  ('musk', 'Musk', 'material', 'Soft Skin Material', null, 'Skin musk',
    array['Clean skin', 'soft laundry', 'warm fabric', 'quiet sweetness'],
    'Adds softness and diffusion to citrus, floral, woods, amber, and clean scents.',
    'Makes a fragrance feel smoother, cleaner, more wearable, and more skin-like.',
    array['Bergamot', 'Iris', 'Sandalwood', 'Rose', 'Cedar', 'Vanilla'],
    'Usually pushes scents cleaner, softer, smoother, and closer to skin.',
    'high', 'approved'),
  ('incense', 'Incense', 'accord', 'Smoky Resin Accord', null, 'Smoky resin',
    array['Sacred smoke', 'dry resin', 'ash', 'cool spice'],
    'Adds atmosphere to amber, woods, rose, oud, leather, and resinous scents.',
    'Makes a fragrance feel smokier, drier, darker, and more ceremonial.',
    array['Oud', 'Amber', 'Labdanum', 'Patchouli', 'Rose', 'Cedar'],
    'Usually pushes scents smokier, darker, resinous, and more meditative.',
    'high', 'approved'),
  ('saffron', 'Saffron', 'note', 'Warm Spicy Note', null, 'Warm spice',
    array['Warm spice', 'dry hay', 'soft leather', 'metallic glow'],
    'Adds radiance to oud, rose, amber, leather, woods, and spicy scents.',
    'Makes a fragrance feel warmer, brighter, more leathery, and more luxurious.',
    array['Oud', 'Rose', 'Amber', 'Leather', 'Cedar', 'Patchouli'],
    'Usually pushes scents warmer, spicier, more leathery, and more radiant.',
    'high', 'approved'),
  ('tonka-bean', 'Tonka Bean', 'material', 'Sweet Coumarin Material', null, 'Sweet coumarin',
    array['Almond vanilla', 'warm hay', 'powder', 'soft tobacco'],
    'Adds smooth sweetness to vanilla, lavender, tobacco, amber, and gourmand scents.',
    'Makes a fragrance feel warmer, softer, sweeter, and more rounded.',
    array['Vanilla', 'Lavender', 'Tobacco', 'Amber', 'Musk', 'Benzoin'],
    'Usually pushes scents sweeter, warmer, powderier, and more comforting.',
    'high', 'approved'),
  ('woody', 'Woody', 'family', 'Woody Style', 'woody', 'Woody',
    array['Dry woods', 'polished timber', 'cedar shavings', 'warm bark'],
    'Frames a scent with structure, dryness, warmth, or clean timber.',
    'Makes a fragrance feel more grounded, tailored, and durable.',
    array['Cedar', 'Sandalwood', 'Vetiver', 'Patchouli', 'Bergamot', 'Musk'],
    'Usually pushes scents more grounded, structured, dry, or polished.',
    'high', 'approved'),
  ('resinous', 'Resinous', 'accord', 'Resinous Style', null, 'Resinous',
    array['Sticky balsam', 'amber sap', 'incense warmth', 'dark sweetness'],
    'Builds warmth and depth in amber, incense, oud, vanilla, and smoky scents.',
    'Makes a fragrance feel warmer, richer, darker, and more enveloping.',
    array['Labdanum', 'Benzoin', 'Amber', 'Incense', 'Patchouli', 'Vanilla'],
    'Usually pushes scents warmer, darker, balsamic, and more persistent.',
    'high', 'approved'),
  ('aromatic', 'Aromatic', 'family', 'Aromatic Style', 'aromatic', 'Aromatic',
    array['Herbs', 'lavender', 'green air', 'clean spice'],
    'Adds freshness and clarity to citrus, musk, woods, fougere, and amber scents.',
    'Makes a fragrance feel cleaner, fresher, sharper, and more composed.',
    array['Lavender', 'Basil', 'Bergamot', 'Mint', 'Vetiver', 'Musk'],
    'Usually pushes scents fresher, greener, cleaner, and more aromatic.',
    'high', 'approved'),
  ('fresh-citrus', 'Fresh Citrus', 'family', 'Fresh Citrus Style', 'citrus-cologne', 'Fresh citrus',
    array['Citrus peel', 'clean air', 'sparkle', 'light musk'],
    'Keeps a scent bright, crisp, open, and easy to wear.',
    'Makes a fragrance feel fresher, cleaner, brighter, and more casual.',
    array['Bergamot', 'Lemon', 'Neroli', 'Musk', 'Cedar', 'Basil'],
    'Usually pushes scents brighter, cleaner, lighter, and more daytime-safe.',
    'high', 'approved'),
  ('green', 'Green', 'family', 'Green Style', 'green', 'Green',
    array['Leaves', 'stems', 'grass', 'crushed herbs'],
    'Adds natural snap to citrus, floral, aromatic, and woody scents.',
    'Makes a fragrance feel fresher, sharper, more natural, and more alive.',
    array['Basil', 'Bergamot', 'Vetiver', 'Lavender', 'Mint', 'Rose'],
    'Usually pushes scents greener, sharper, more aromatic, and more outdoorsy.',
    'high', 'approved'),
  ('smoky', 'Smoky', 'accord', 'Smoky Style', null, 'Smoky',
    array['Smoke', 'ash', 'charred woods', 'dry incense'],
    'Adds atmosphere to incense, leather, oud, vetiver, amber, and woody scents.',
    'Makes a fragrance feel darker, drier, moodier, and more textured.',
    array['Incense', 'Vetiver', 'Oud', 'Leather', 'Amber', 'Cedar'],
    'Usually pushes scents darker, drier, more dramatic, and more atmospheric.',
    'high', 'approved'),
  ('musky', 'Musky', 'accord', 'Musky Style', null, 'Musky',
    array['Clean skin', 'soft fabric', 'warm air', 'quiet sweetness'],
    'Softens and extends citrus, floral, woods, amber, and clean scents.',
    'Makes a fragrance feel smoother, cleaner, softer, and more intimate.',
    array['Musk', 'Iris', 'Sandalwood', 'Bergamot', 'Rose', 'Vanilla'],
    'Usually pushes scents cleaner, softer, smoother, and more wearable.',
    'high', 'approved'),
  ('powdery', 'Powdery', 'accord', 'Powdery Style', null, 'Powdery',
    array['Soft powder', 'makeup dust', 'iris', 'clean fabric'],
    'Adds polish to iris, musk, rose, almond, vanilla, and woody scents.',
    'Makes a fragrance feel softer, smoother, more refined, and more dressed.',
    array['Iris', 'Musk', 'Rose', 'Tonka Bean', 'Sandalwood', 'Vanilla'],
    'Usually pushes scents softer, smoother, cooler, and more elegant.',
    'high', 'approved'),
  ('spicy-warm', 'Spicy Warm', 'accord', 'Warm Spicy Style', 'spicy', 'Warm spice',
    array['Warm spice', 'pepper', 'cardamom', 'dry heat'],
    'Adds energy to amber, tobacco, leather, woods, vanilla, and rose scents.',
    'Makes a fragrance feel warmer, livelier, sharper, and more sensual.',
    array['Saffron', 'Tobacco', 'Amber', 'Vanilla', 'Cedar', 'Patchouli'],
    'Usually pushes scents warmer, spicier, more textured, and more alive.',
    'high', 'approved'),
  ('gourmand', 'Gourmand', 'family', 'Edible Sweet Style', 'gourmand', 'Gourmand',
    array['Dessert sweetness', 'vanilla', 'caramel', 'warm pastry'],
    'Adds edible warmth to vanilla, amber, tobacco, musk, fruit, and woods.',
    'Makes a fragrance feel sweeter, cozier, richer, and more indulgent.',
    array['Vanilla', 'Tonka Bean', 'Benzoin', 'Tobacco', 'Amber', 'Musk'],
    'Usually pushes scents sweeter, warmer, softer, and more comfort-driven.',
    'high', 'approved'),
  ('tobacco-boozy', 'Tobacco Boozy', 'chord', 'Tobacco Boozy Chord', 'tobacco-boozy', 'Tobacco boozy',
    array['Dried tobacco', 'dark syrup', 'warm liquor', 'vanilla spice'],
    'Builds a plush evening feel in tobacco, amber, vanilla, leather, and spice.',
    'Makes a fragrance feel warmer, sweeter, deeper, and more nocturnal.',
    array['Tobacco', 'Vanilla', 'Tonka Bean', 'Amber', 'Leather', 'Patchouli'],
    'Usually pushes scents richer, warmer, sweeter, and more evening-coded.',
    'medium', 'approved'),
  ('dark-leather', 'Dark Leather', 'chord', 'Dark Leather Chord', 'dark-leather', 'Dark leather',
    array['Black leather', 'smoke', 'resin', 'dry woods'],
    'Adds shadow and texture to oud, amber, saffron, rose, tobacco, and woods.',
    'Makes a fragrance feel darker, drier, more assertive, and more dressed.',
    array['Leather', 'Oud', 'Saffron', 'Amber', 'Rose', 'Patchouli'],
    'Usually pushes scents darker, more tactile, more resinous, and more formal.',
    'medium', 'approved'),
  ('woody-clean', 'Woody Clean', 'chord', 'Woody Clean Chord', 'woody-clean', 'Woody clean',
    array['Clean woods', 'musk', 'cedar air', 'soft polish'],
    'Keeps woody scents crisp, wearable, fresh, and office-safe.',
    'Makes a fragrance feel cleaner, drier, smoother, and more transparent.',
    array['Cedar', 'Musk', 'Bergamot', 'Vetiver', 'Iris', 'Sandalwood'],
    'Usually pushes scents cleaner, woodier, drier, and more restrained.',
    'medium', 'approved')
on conflict (slug) do update
set
  label = excluded.label,
  term_type = excluded.term_type,
  scent_category = excluded.scent_category,
  family_key = excluded.family_key,
  short_label = excluded.short_label,
  smells_like = excluded.smells_like,
  used_for = excluded.used_for,
  what_it_does = excluded.what_it_does,
  pairs_well_with = excluded.pairs_well_with,
  odara_read = excluded.odara_read,
  confidence = excluded.confidence,
  source_status = excluded.source_status,
  updated_at = now();

with raw_terms as (
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
    public.scent_term_slugify_v1(rt.term_label) as direct_slug
  from raw_terms rt
),
matched_terms as (
  select distinct on (nt.fragrance_id, st.id, nt.position)
    nt.fragrance_id,
    st.id as scent_term_id,
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
  join public.scent_terms st
    on st.slug = nt.direct_slug
    or st.family_key = nt.direct_slug
  order by nt.fragrance_id, st.id, nt.position, nt.source
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

create or replace function public.get_scent_term_dossier_v1(
  p_user uuid default null,
  p_term_slug text default null,
  p_term_label text default null,
  p_fragrance_id uuid default null,
  p_position text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_requested_slug text;
  v_term public.scent_terms%rowtype;
  v_context_position text;
  v_wardrobe jsonb := '[]'::jsonb;
begin
  if p_user is not null then
    if auth.uid() is null or auth.uid() <> p_user then
      raise exception 'Access denied: p_user must match auth.uid().';
    end if;
  end if;

  v_requested_slug := coalesce(
    nullif(public.scent_term_slugify_v1(p_term_slug), ''),
    nullif(public.scent_term_slugify_v1(p_term_label), '')
  );

  if v_requested_slug is null then
    return jsonb_build_object(
      'found', false,
      'term_slug', null,
      'label', null,
      'message', 'Odara has not mapped this note yet.'
    );
  end if;

  select st.*
  into v_term
  from public.scent_terms st
  where st.slug = v_requested_slug
  limit 1;

  if v_term.id is null then
    return jsonb_build_object(
      'found', false,
      'term_slug', v_requested_slug,
      'label', coalesce(nullif(btrim(p_term_label), ''), p_term_slug),
      'message', 'Odara has not mapped this note yet.'
    );
  end if;

  if p_position is not null and btrim(p_position) <> '' then
    v_context_position := lower(btrim(p_position));
  elsif p_fragrance_id is not null then
    select fst.position
    into v_context_position
    from public.fragrance_scent_terms fst
    where fst.fragrance_id = p_fragrance_id
      and fst.scent_term_id = v_term.id
    order by case fst.position
      when 'top' then 1
      when 'heart' then 2
      when 'middle' then 2
      when 'base' then 3
      when 'accord' then 4
      when 'material' then 5
      when 'family' then 6
      else 9
    end
    limit 1;
  end if;

  if p_user is not null then
    select coalesce(jsonb_agg(row_payload order by display_name), '[]'::jsonb)
    into v_wardrobe
    from (
      select
        f.name as display_name,
        jsonb_build_object(
          'fragrance_id', f.id,
          'name', f.name,
          'brand', f.brand,
          'status', u.effective_status,
          'positions', coalesce(
            jsonb_agg(distinct fst.position) filter (where fst.position is not null),
            '[]'::jsonb
          )
        ) as row_payload
      from public.user_collection_effective_items_v2 u
      join public.fragrances f
        on f.id = u.representative_fragrance_id
      join public.fragrance_scent_terms fst
        on fst.fragrance_id = f.id
       and fst.scent_term_id = v_term.id
      where u.user_id = p_user
        and coalesce(u.has_disliked, false) = false
        and coalesce(u.effective_status, '') in ('signature', 'owned', 'liked', 'would_buy')
      group by f.id, f.name, f.brand, u.effective_status
      order by f.name
      limit 8
    ) matches;
  end if;

  return jsonb_build_object(
    'found', true,
    'term', jsonb_build_object(
      'id', v_term.id,
      'slug', v_term.slug,
      'label', v_term.label,
      'term_type', v_term.term_type,
      'scent_category', v_term.scent_category,
      'family_key', v_term.family_key,
      'short_label', v_term.short_label,
      'smells_like', coalesce(to_jsonb(v_term.smells_like), '[]'::jsonb),
      'used_for', v_term.used_for,
      'what_it_does', v_term.what_it_does,
      'pairs_well_with', coalesce(to_jsonb(v_term.pairs_well_with), '[]'::jsonb),
      'odara_read', v_term.odara_read,
      'confidence', v_term.confidence,
      'source_status', v_term.source_status
    ),
    'context_position', v_context_position,
    'wardrobe_matches', coalesce(v_wardrobe, '[]'::jsonb)
  );
end;
$$;

comment on table public.scent_terms is
  'Reusable compact Scent Intel education cards for notes, accords, materials, families, and chords.';

comment on table public.fragrance_scent_terms is
  'Join table connecting fragrances to normalized Scent Intel terms with known source position when available.';

comment on function public.get_scent_term_dossier_v1(uuid, text, text, uuid, text) is
  'Returns one compact Scent Intel dossier plus a small user-scoped wardrobe match list. Does not recalculate recommendations or mutate product data.';

grant execute on function public.scent_term_slugify_v1(text) to anon, authenticated, service_role;
grant execute on function public.get_scent_term_dossier_v1(uuid, text, text, uuid, text) to anon, authenticated, service_role;
