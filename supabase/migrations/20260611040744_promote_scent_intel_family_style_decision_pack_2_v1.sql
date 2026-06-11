do $$
begin
  if exists (
    select 1
    from public.scent_terms
    where slug in (
      'oud-amber',
      'aquatic',
      'amber-spicy',
      'oriental',
      'synthetic'
    )
  ) then
    raise exception 'Locked preflight failed: a target or blocked slug already exists.';
  end if;

  if exists (
    select 1
    from (
      values
        ('oud-amber'),
        ('oud amber'),
        ('aquatic'),
        ('oriental'),
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
        ('aquatic accord', 'aquatic'),
        ('aquatic notes', 'aquatic'),
        ('oriental', 'amber-spicy'),
        ('oriental accord', 'amber-spicy'),
        ('oriental notes', 'amber-spicy')
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
    'oud-amber',
    'Oud Amber',
    'family',
    'Scent Style',
    'oud-amber',
    'Scent Style',
    'Oud Amber is a warm dark style built around oud-like woods, amber warmth, resins, smoke, leather, and deep sweetness.',
    array['Dark woods', 'warm amber', 'resin', 'smoke', 'leather', 'balsamic sweetness', 'and rich oud-like depth'],
    'Oud blends, amber woods, evening scents, resinous styles, leather-oud profiles, and rich winter fragrances.',
    'Makes a fragrance feel darker, warmer, richer, and more intense.',
    array['Oud', 'Amber', 'Resins', 'Incense', 'Balsamic', 'Leather', 'Smoke', 'Patchouli', 'Vanilla', 'Saffron'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Oud Amber as a standalone broad scent style kept distinct from Oud, Amber, and adjacent resin/incense concepts.'
  ),
  (
    'aquatic',
    'Aquatic',
    'family',
    'Scent Family',
    null,
    'Scent Family',
    'Aquatic is a broad fresh family used when a fragrance suggests water, clean freshness, sea air, watery transparency, or blue freshness.',
    array['Clear water', 'fresh air', 'clean musk', 'watery citrus', 'cool mineral freshness', 'and light blue-style transparency'],
    'Fresh scents, blue fragrances, summer scents, marine styles, clean musks, and easy daily wear.',
    'Makes a fragrance feel cooler, cleaner, lighter, and more refreshing.',
    array['Marine / Aquatic', 'Fresh Aquatic', 'Fresh Blue', 'Ozonic', 'Rain', 'Salt', 'Mineral', 'Musk', 'Citrus', 'Calone'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Aquatic as a standalone broad scent family kept distinct from Marine / Aquatic, Fresh Aquatic, Fresh Blue, and related watery substyles.'
  ),
  (
    'amber-spicy',
    'Amber Spicy',
    'family',
    'Scent Style',
    'oud-amber',
    'Scent Style',
    'Amber Spicy is a warm style built around amber, spices, resins, balsamic sweetness, incense, vanilla, and dark woods.',
    array['Warm amber', 'dry spices', 'vanilla sweetness', 'resin', 'incense', 'balsamic warmth', 'patchouli', 'and dark woods'],
    'Warm evening scents, amber fragrances, spicy ambers, resinous blends, winter scents, and rich classic styles.',
    'Makes a fragrance feel warmer, deeper, smoother, spicier, and more enveloping.',
    array['Amber', 'Spice', 'Balsamic', 'Resins', 'Incense', 'Vanilla', 'Patchouli', 'Oud', 'Sweet Gourmand', 'Leather'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for the safer user-facing Amber Spicy concept mapped from exact Oriental source labels without creating an Oriental canonical row.'
  );

with target_terms as (
  select id, slug
  from public.scent_terms
  where slug in (
    'oud-amber',
    'aquatic',
    'amber-spicy'
  )
),
term_aliases as (
  select 'oud-amber'::text as slug, alias
  from unnest(array[
    'oud-amber'
  ]::text[]) as alias
  union all
  select 'aquatic', alias
  from unnest(array[
    'aquatic',
    'aquatic-accord',
    'aquatic-notes'
  ]::text[]) as alias
  union all
  select 'amber-spicy', alias
  from unnest(array[
    'oriental',
    'oriental-accord',
    'oriental-notes'
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

  if position('when ''aquatic-accord'' then ''aquatic''' in v_function) = 0 then
    if position('    when ''ambroxan-note'' then ''ambroxan''' in v_function) = 0 then
      raise exception 'Locked resolver patch failed: expected CASE anchor was not found.';
    end if;

    v_updated_function := replace(
      v_function,
      '    when ''ambroxan-note'' then ''ambroxan''',
      '    when ''aquatic-accord'' then ''aquatic''
    when ''aquatic-notes'' then ''aquatic''
    when ''oriental'' then ''amber-spicy''
    when ''oriental-accord'' then ''amber-spicy''
    when ''oriental-notes'' then ''amber-spicy''
    when ''ambroxan-note'' then ''ambroxan'''
    );

    execute v_updated_function;
  end if;
end
$$;

grant execute on function public.get_scent_term_dossier_v1(uuid, text, text, uuid, text) to anon, authenticated, service_role;
