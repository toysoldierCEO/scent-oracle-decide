do $$
begin
  if exists (
    select 1
    from public.scent_terms
    where slug in (
      'fresh-blue',
      'sweet-gourmand',
      'animalic',
      'creamy',
      'citrus-cologne',
      'herbal'
    )
  ) then
    raise exception 'Locked preflight failed: one or more target slugs already exist.';
  end if;

  if exists (
    select 1
    from (
      values
        ('oud-amber'),
        ('oriental'),
        ('aquatic'),
        ('synthetic'),
        ('clean musk'),
        ('calone'),
        ('seaweed'),
        ('mate')
    ) as blocked(label)
    where coalesce(
      (public.get_scent_term_dossier_v1(null, null, blocked.label, null, null)->>'found')::boolean,
      false
    )
  ) then
    raise exception 'Locked preflight failed: a blocked term already resolves.';
  end if;

  if exists (
    select 1
    from (
      values
        ('fresh blue', 'fresh-blue'),
        ('blue fresh', 'fresh-blue'),
        ('sweet gourmand', 'sweet-gourmand'),
        ('gourmand sweet', 'sweet-gourmand'),
        ('animalic notes', 'animalic'),
        ('animalic accord', 'animalic'),
        ('creamy notes', 'creamy'),
        ('creamy accord', 'creamy'),
        ('creaminess', 'creamy'),
        ('citrus cologne', 'citrus-cologne'),
        ('cologne citrus', 'citrus-cologne'),
        ('herbal notes', 'herbal'),
        ('herbal accord', 'herbal'),
        ('herbaceous', 'herbal')
    ) as alias_check(label, expected_slug)
    where coalesce(
      (public.get_scent_term_dossier_v1(null, null, alias_check.label, null, null)->>'found')::boolean,
      false
    )
      and coalesce(
        public.get_scent_term_dossier_v1(null, null, alias_check.label, null, null) #>> '{term,slug}',
        public.get_scent_term_dossier_v1(null, null, alias_check.label, null, null)->>'term_slug'
      ) <> alias_check.expected_slug
  ) then
    raise exception 'Locked preflight failed: an approved alias already resolves to another canonical term.';
  end if;
end
$$;

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
    'fresh-blue',
    'Fresh Blue',
    'family',
    'Scent Style',
    'fresh-blue',
    'Scent Style',
    'Fresh Blue is a modern fresh style built around clean citrus, airy woods, watery freshness, musk, and smooth aromatic lift.',
    array['Clean shower freshness', 'bright citrus', 'airy woods', 'light aquatic freshness', 'soft musk', 'and polished blue-style smoothness'],
    'Modern daily scents, office-friendly fragrances, fresh masculine styles, gym-safe scents, and easy warm-weather wear.',
    'Makes a fragrance feel cleaner, brighter, smoother, and easier to wear.',
    array['Fresh', 'Citrus', 'Fresh Aquatic', 'Marine / Aquatic', 'Ozonic', 'Musk', 'White Musk', 'Ambroxan', 'Cedar', 'Bergamot'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'sweet-gourmand',
    'Sweet Gourmand',
    'family',
    'Scent Style',
    'sweet-gourmand',
    'Scent Style',
    'Sweet Gourmand is a sweet edible style built around dessert-like warmth, vanilla, caramel, praline, chocolate, honey, fruit, or sugary effects.',
    array['Vanilla warmth', 'caramel', 'praline', 'chocolate', 'honey', 'syrupy fruit', 'soft sugar', 'and smooth dessert-like sweetness'],
    'Gourmands, date-night scents, cozy ambers, playful sweet scents, and rich winter fragrances.',
    'Makes a fragrance feel warmer, sweeter, more comforting, and more edible.',
    array['Sweet', 'Vanilla', 'Caramel', 'Praline', 'Chocolate / Cacao', 'Honey', 'Tonka', 'Almond', 'Coffee', 'Amber'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'animalic',
    'Animalic',
    'accord',
    'Scent Effect',
    'dark-leather',
    'Scent Effect',
    'Animalic is a broad scent effect used when a fragrance suggests warm skin, musk, leather, fur-like warmth, or sensual depth.',
    array['Warm skin', 'soft musk', 'leather', 'fur-like warmth', 'ambergris-like depth', 'and a slightly wild natural edge'],
    'Musks, leathers, florals, ambers, vintage-style scents, oud blends, and sensual evening fragrances.',
    'Adds warmth, depth, skin texture, and a more sensual base.',
    array['Musk', 'Leather', 'Ambergris', 'Oud', 'Rose', 'Jasmine', 'Honey', 'Tobacco', 'Patchouli', 'Amber'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'creamy',
    'Creamy',
    'accord',
    'Texture Effect',
    'sweet-gourmand',
    'Scent Effect',
    'Creamy is a texture effect used when a fragrance feels smooth, milky, soft, rounded, or lotion-like.',
    array['Soft cream', 'smooth woods', 'coconut milk', 'vanilla softness', 'sandalwood creaminess', 'and gentle milky warmth'],
    'Gourmands, musks, sandalwood scents, coconut blends, white florals, lactonic effects, and soft daily fragrances.',
    'Makes a fragrance feel smoother, softer, rounder, and more comforting.',
    array['Sandalwood', 'Coconut', 'Vanilla', 'White Musk', 'Jasmine', 'Ylang-Ylang', 'Almond', 'Tonka', 'Musk', 'Amber'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'citrus-cologne',
    'Citrus Cologne',
    'family',
    'Scent Style',
    'citrus-cologne',
    'Scent Style',
    'Citrus Cologne is a bright classic fresh style built around citrus, herbs, light florals, clean musk, and short, sparkling freshness.',
    array['Lemon peel', 'bergamot', 'orange zest', 'neroli', 'herbs', 'light florals', 'clean musk', 'and crisp cologne freshness'],
    'Classic colognes, warm-weather scents, after-shower freshness, daily wear, and bright casual fragrances.',
    'Makes a fragrance feel crisp, clean, sparkling, and easy to reapply.',
    array['Citrus', 'Bergamot', 'Lemon', 'Orange', 'Neroli', 'Petitgrain', 'Lavender', 'Rosemary', 'Musk', 'Fresh'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'herbal',
    'Herbal',
    'accord',
    'Scent Effect',
    'aromatic-fougere',
    'Scent Effect',
    'Herbal is a broad scent effect used when a fragrance has clear herb-like freshness, green aromatic leaves, stems, or savory natural lift.',
    array['Fresh herbs', 'green leaves', 'aromatic stems', 'soft bitterness', 'savory freshness', 'and dry herbal tea'],
    'Aromatic scents, green fragrances, fresh woods, citrus blends, fougères, and herbal florals.',
    'Adds natural freshness, green bite, aromatic lift, and a less sugary brightness.',
    array['Basil', 'Mint', 'Rosemary', 'Sage', 'Clary Sage', 'Artemisia', 'Lavender', 'Citrus', 'Green Notes', 'Tea'],
    null,
    'medium',
    'source_light',
    null
  );

with target_terms as (
  select id, slug
  from public.scent_terms
  where slug in (
    'fresh-blue',
    'sweet-gourmand',
    'animalic',
    'creamy',
    'citrus-cologne',
    'herbal'
  )
),
term_aliases as (
  select 'fresh-blue'::text as slug, alias
  from unnest(array[
    'fresh-blue',
    'blue-fresh'
  ]::text[]) as alias
  union all
  select 'sweet-gourmand', alias
  from unnest(array[
    'sweet-gourmand',
    'gourmand-sweet'
  ]::text[]) as alias
  union all
  select 'animalic', alias
  from unnest(array[
    'animalic',
    'animalic-notes',
    'animalic-accord'
  ]::text[]) as alias
  union all
  select 'creamy', alias
  from unnest(array[
    'creamy',
    'creamy-notes',
    'creamy-accord',
    'creaminess'
  ]::text[]) as alias
  union all
  select 'citrus-cologne', alias
  from unnest(array[
    'citrus-cologne',
    'cologne-citrus'
  ]::text[]) as alias
  union all
  select 'herbal', alias
  from unnest(array[
    'herbal',
    'herbal-notes',
    'herbal-accord',
    'herbaceous'
  ]::text[]) as alias
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
      when nt.position = 'accord' then 'medium'
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
on conflict (fragrance_id, scent_term_id, position) do nothing;

do $$
declare
  v_function text;
  v_updated_function text;
begin
  select pg_get_functiondef('public.get_scent_term_dossier_v1(uuid,text,text,uuid,text)'::regprocedure)
  into v_function;

  if v_function is null then
    raise exception 'Locked resolver patch failed: get_scent_term_dossier_v1 was not found.';
  end if;

  if position('when ''blue-fresh'' then ''fresh-blue''' in v_function) = 0 then
    if position('    when ''ambroxan-note'' then ''ambroxan''' in v_function) = 0 then
      raise exception 'Locked resolver patch failed: expected CASE anchor was not found.';
    end if;

    v_updated_function := replace(
      v_function,
      '    when ''ambroxan-note'' then ''ambroxan''',
      '    when ''blue-fresh'' then ''fresh-blue''
    when ''gourmand-sweet'' then ''sweet-gourmand''
    when ''animalic-notes'' then ''animalic''
    when ''animalic-accord'' then ''animalic''
    when ''creamy-notes'' then ''creamy''
    when ''creamy-accord'' then ''creamy''
    when ''creaminess'' then ''creamy''
    when ''cologne-citrus'' then ''citrus-cologne''
    when ''herbal-notes'' then ''herbal''
    when ''herbal-accord'' then ''herbal''
    when ''herbaceous'' then ''herbal''
    when ''ambroxan-note'' then ''ambroxan'''
    );

    execute v_updated_function;
  end if;
end
$$;

grant execute on function public.get_scent_term_dossier_v1(uuid, text, text, uuid, text) to anon, authenticated, service_role;
