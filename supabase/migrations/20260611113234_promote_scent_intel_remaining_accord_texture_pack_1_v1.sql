do $$
begin
  if exists (
    select 1
    from public.scent_terms
    where slug in (
      'soft-spicy',
      'mossy',
      'nutty',
      'lactonic',
      'yellow-floral'
    )
  ) then
    raise exception 'Locked preflight failed: one or more target slugs already exist.';
  end if;

  if exists (
    select 1
    from public.scent_terms
    where slug = 'synthetic'
  ) then
    raise exception 'Locked preflight failed: synthetic already exists as a canonical slug.';
  end if;

  if exists (
    select 1
    from (
      values
        ('soft spicy'),
        ('mossy'),
        ('nutty'),
        ('lactonic'),
        ('yellow floral'),
        ('synthetic')
    ) as miss(label)
    where coalesce(
      (public.get_scent_term_dossier_v1(null, null, miss.label, null, null)->>'found')::boolean,
      false
    )
  ) then
    raise exception 'Locked preflight failed: a required pre-apply miss already resolves.';
  end if;

  if exists (
    select 1
    from (
      values
        ('soft spice', 'soft-spicy'),
        ('soft spices', 'soft-spicy'),
        ('soft spicy accord', 'soft-spicy'),
        ('soft spicy notes', 'soft-spicy'),
        ('mossy accord', 'mossy'),
        ('mossy notes', 'mossy'),
        ('nutty accord', 'nutty'),
        ('nutty notes', 'nutty'),
        ('nutty scent', 'nutty'),
        ('lactonic accord', 'lactonic'),
        ('lactonic notes', 'lactonic'),
        ('lactonic effect', 'lactonic'),
        ('yellow florals', 'yellow-floral'),
        ('yellow flowers', 'yellow-floral'),
        ('yellow flower', 'yellow-floral'),
        ('yellow floral accord', 'yellow-floral'),
        ('yellow floral notes', 'yellow-floral')
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
    'soft-spicy',
    'Soft Spicy',
    'accord',
    'Scent Effect',
    'spicy-warm',
    'Broad Scent Effect',
    'Soft Spicy is a gentle spice effect where warmth, sweetness, and smooth texture matter more than sharp heat.',
    array['Soft warm spice', 'cinnamon warmth', 'cardamom smoothness', 'nutmeg dryness', 'ambered spice', 'and gentle sweetness'],
    'Amber scents, cozy woods, smooth tobacco blends, soft gourmands, warm florals, and evening fragrances.',
    'Adds warmth, comfort, smooth spice, and a softer rounded texture.',
    array['Spice', 'Amber Spicy', 'Cinnamon', 'Cardamom', 'Nutmeg', 'Clove', 'Vanilla', 'Amber', 'Tobacco', 'Sandalwood'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'mossy',
    'Mossy',
    'accord',
    'Scent Effect',
    'earthy-patchouli',
    'Green Earthy Effect',
    'Mossy is a green-earthy effect used when a fragrance suggests moss, forest floor, damp woods, and dry green depth.',
    array['Damp moss', 'shaded woods', 'forest floor', 'dry green earth', 'bark', 'and soft chypre-like depth'],
    'Chypre-style scents, green florals, woody fragrances, leathers, earthy bases, and classic drydowns.',
    'Adds grounded green depth, dryness, natural texture, and a more classic earthy finish.',
    array['Oakmoss', 'Earthy', 'Green Notes', 'Patchouli', 'Vetiver', 'Cedar', 'Leather', 'Bergamot', 'Galbanum', 'Woody'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'nutty',
    'Nutty',
    'accord',
    'Scent Effect',
    'sweet-gourmand',
    'Gourmand Texture Effect',
    'Nutty is a gourmand texture effect used when a fragrance suggests roasted nuts, almond-like softness, praline warmth, or creamy edible depth.',
    array['Roasted nuts', 'almond-like sweetness', 'praline warmth', 'creamy woods', 'toasted edges', 'and soft gourmand richness'],
    'Gourmands, sweet ambers, creamy woods, almond effects, praline blends, and cozy dessert-style fragrances.',
    'Adds edible warmth, roasted texture, softness, and a richer gourmand body.',
    array['Almond', 'Praline', 'Tonka', 'Sweet Gourmand', 'Creamy', 'Vanilla', 'Chocolate / Cacao', 'Coffee', 'Caramel', 'Sandalwood'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'lactonic',
    'Lactonic',
    'accord',
    'Scent Effect',
    'sweet-gourmand',
    'Creamy Milky Effect',
    'Lactonic is a creamy milky effect used when a fragrance feels smooth, soft, milky, peachy, coconut-like, or skin-creamy.',
    array['Creamy milk', 'coconut-like softness', 'peach skin', 'smooth woods', 'soft almond', 'and gentle skin warmth'],
    'Creamy florals, coconut blends, peach effects, sandalwood scents, musks, gourmands, and soft skin scents.',
    'Adds creaminess, softness, rounded texture, and a smooth skin-like finish.',
    array['Creamy', 'Coconut', 'Peach', 'Almond', 'White Musk', 'Sandalwood', 'Ylang-Ylang', 'Jasmine', 'Vanilla', 'Tonka'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'yellow-floral',
    'Yellow Floral',
    'family',
    'Scent Family',
    'floral-rich',
    'Floral Scent Family',
    'Yellow Floral is a warm floral style used when a fragrance suggests sunny, creamy, rich, or tropical yellow flower effects.',
    array['Ylang-ylang warmth', 'creamy petals', 'sunny florals', 'soft sweetness', 'tropical floral body', 'and warm pollen-like depth'],
    'Tropical florals, amber florals, creamy white florals, coconut blends, warm musks, and sensual summer scents.',
    'Adds warmth, floral volume, creaminess, and a sunny sensual body.',
    array['Ylang-Ylang', 'Floral', 'White Floral', 'Jasmine', 'Orange Blossom', 'Neroli', 'Coconut', 'Vanilla', 'Amber', 'Sandalwood'],
    null,
    'medium',
    'source_light',
    null
  );

with target_terms as (
  select id, slug
  from public.scent_terms
  where slug in (
    'soft-spicy',
    'mossy',
    'nutty',
    'lactonic',
    'yellow-floral'
  )
),
safe_labels as (
  select 'soft-spicy'::text as slug, exact_label
  from unnest(array[
    'soft spicy',
    'soft spice',
    'soft spices',
    'soft spicy accord',
    'soft spicy notes'
  ]::text[]) as exact_label
  union all
  select 'mossy', exact_label
  from unnest(array[
    'mossy',
    'mossy accord',
    'mossy notes'
  ]::text[]) as exact_label
  union all
  select 'nutty', exact_label
  from unnest(array[
    'nutty',
    'nutty accord',
    'nutty notes',
    'nutty scent'
  ]::text[]) as exact_label
  union all
  select 'lactonic', exact_label
  from unnest(array[
    'lactonic',
    'lactonic accord',
    'lactonic notes',
    'lactonic effect'
  ]::text[]) as exact_label
  union all
  select 'yellow-floral', exact_label
  from unnest(array[
    'yellow floral',
    'yellow florals',
    'yellow flowers',
    'yellow flower',
    'yellow floral accord',
    'yellow floral notes'
  ]::text[]) as exact_label
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
    select f.family_key as label, 'family' as position, 'fragrances.family_key' as source
    where nullif(btrim(coalesce(f.family_key, '')), '') is not null
    union all
    select f.family as label, 'family' as position, 'fragrances.family' as source
    where nullif(btrim(coalesce(f.family, '')), '') is not null
    union all
    select f.family_raw as label, 'family' as position, 'fragrances.family_raw' as source
    where nullif(btrim(coalesce(f.family_raw, '')), '') is not null
  ) x
  where nullif(btrim(x.label), '') is not null
),
normalized_terms as (
  select
    rt.fragrance_id,
    btrim(rt.term_label) as term_label,
    lower(btrim(rt.term_label)) as normalized_label,
    rt.position,
    rt.source,
    rt.source_url
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
  join safe_labels sl
    on sl.exact_label = nt.normalized_label
  join target_terms tt
    on tt.slug = sl.slug
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

  if position('when ''soft-spice'' then ''soft-spicy''' in v_function) = 0 then
    if position('    when ''cedarwood'' then ''cedar''' in v_function) = 0 then
      raise exception 'Locked resolver patch failed: expected CASE anchor was not found.';
    end if;

    v_updated_function := replace(
      v_function,
      '    when ''cedarwood'' then ''cedar''',
      '    when ''soft-spice'' then ''soft-spicy''
    when ''soft-spices'' then ''soft-spicy''
    when ''soft-spicy-accord'' then ''soft-spicy''
    when ''soft-spicy-notes'' then ''soft-spicy''
    when ''mossy-accord'' then ''mossy''
    when ''mossy-notes'' then ''mossy''
    when ''nutty-accord'' then ''nutty''
    when ''nutty-notes'' then ''nutty''
    when ''nutty-scent'' then ''nutty''
    when ''lactonic-accord'' then ''lactonic''
    when ''lactonic-notes'' then ''lactonic''
    when ''lactonic-effect'' then ''lactonic''
    when ''yellow-florals'' then ''yellow-floral''
    when ''yellow-flowers'' then ''yellow-floral''
    when ''yellow-flower'' then ''yellow-floral''
    when ''yellow-floral-accord'' then ''yellow-floral''
    when ''yellow-floral-notes'' then ''yellow-floral''
    when ''cedarwood'' then ''cedar'''
    );

    execute v_updated_function;
  end if;
end
$$;

grant execute on function public.get_scent_term_dossier_v1(uuid, text, text, uuid, text) to anon, authenticated, service_role;
