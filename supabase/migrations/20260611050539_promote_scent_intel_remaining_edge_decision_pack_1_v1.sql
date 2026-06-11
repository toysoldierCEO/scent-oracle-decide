do $$
begin
  if exists (
    select 1
    from public.scent_terms
    where slug in (
      'calone',
      'seaweed',
      'mate',
      'clean-musk',
      'synthetic'
    )
  ) then
    raise exception 'Locked preflight failed: a target or blocked slug already exists.';
  end if;

  if not exists (
    select 1
    from public.scent_terms
    where slug = 'white-musk'
  ) then
    raise exception 'Locked preflight failed: white-musk is missing.';
  end if;

  if exists (
    select 1
    from (
      values
        ('clean musk'),
        ('calone'),
        ('seaweed'),
        ('mate'),
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
        ('calone note', 'calone'),
        ('calone accord', 'calone'),
        ('seaweed note', 'seaweed'),
        ('seaweed notes', 'seaweed'),
        ('seaweed accord', 'seaweed'),
        ('maté', 'mate'),
        ('yerba mate', 'mate'),
        ('yerba maté', 'mate'),
        ('mate tea', 'mate'),
        ('maté tea', 'mate'),
        ('clean musk', 'white-musk'),
        ('clean musks', 'white-musk'),
        ('clean musk accord', 'white-musk'),
        ('clean musk notes', 'white-musk')
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
    'calone',
    'Calone',
    'material',
    'Material Effect',
    null,
    'Marine Aroma Material',
    'Calone is a marine aroma material used to create watery freshness, sea-breeze effects, and transparent aquatic lift.',
    array['Sea breeze', 'watery air', 'cool melon rind', 'clean oceanic freshness', 'and transparent aquatic lift'],
    'Aquatic scents, marine accords, fresh-blue styles, watery florals, clean summer scents, and airy modern fragrances.',
    'Adds watery space, marine freshness, transparency, and a cool airy feeling.',
    array['Marine / Aquatic', 'Fresh Aquatic', 'Aquatic', 'Ozonic', 'Salt', 'Rain', 'Mineral', 'White Musk', 'Citrus', 'Seaweed'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Calone as a standalone marine aroma material kept distinct from aquatic families and adjacent watery effects.'
  ),
  (
    'seaweed',
    'Seaweed',
    'material',
    'Marine Material',
    null,
    'Marine Green Material',
    'Seaweed is a marine green material effect used to suggest salty coastal greenery, ocean vegetation, and briny depth.',
    array['Salty seaweed', 'green ocean air', 'mineral brine', 'damp algae', 'driftwood', 'and a coastal iodine-like edge'],
    'Marine scents, coastal woods, naturalistic aquatics, salty green effects, beachy compositions, and oceanic depth.',
    'Adds salty green realism, coastal texture, briny depth, and a more natural marine edge.',
    array['Marine / Aquatic', 'Aquatic', 'Salt', 'Ambergris', 'Mineral', 'Rain', 'Cedar', 'Vetiver', 'Citrus', 'Calone'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Seaweed as a standalone marine green material effect kept distinct from aquatic families, Salt, Ambergris, and Calone.'
  ),
  (
    'mate',
    'Mate',
    'material',
    'Tea Note',
    null,
    'Tea / Herbal Material',
    'Mate is a tea-like herbal material used for dry green bitterness, leafy warmth, and calm aromatic freshness.',
    array['Dry green tea', 'toasted leaves', 'hay', 'soft bitterness', 'herbal warmth', 'and a slightly smoky tea-like edge'],
    'Tea scents, green aromatics, citrus blends, musks, herbal woods, and calm daily fragrances.',
    'Adds dry green lift, gentle bitterness, tea-like texture, and a quiet herbal backbone.',
    array['Tea', 'Matcha', 'Green Notes', 'Herbal', 'Citrus', 'Mint', 'Vetiver', 'Cedar', 'White Musk', 'Ginger'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Mate as a standalone tea-like herbal material kept distinct from Tea, Matcha, Herbal, and adjacent green concepts.'
  );

with target_terms as (
  select id, slug
  from public.scent_terms
  where slug in (
    'calone',
    'seaweed',
    'mate',
    'white-musk'
  )
),
term_aliases as (
  select 'calone'::text as slug, alias
  from unnest(array[
    'calone',
    'calone-note',
    'calone-accord'
  ]::text[]) as alias
  union all
  select 'seaweed', alias
  from unnest(array[
    'seaweed',
    'seaweed-note',
    'seaweed-notes',
    'seaweed-accord'
  ]::text[]) as alias
  union all
  select 'mate', alias
  from unnest(array[
    'mate',
    'yerba-mate',
    'mate-tea'
  ]::text[]) as alias
  union all
  select 'white-musk', alias
  from unnest(array[
    'clean-musk',
    'clean-musks',
    'clean-musk-accord',
    'clean-musk-notes'
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

  if position('when ''calone-note'' then ''calone''' in v_function) = 0 then
    if position('    when ''aquatic-accord'' then ''aquatic''' in v_function) = 0 then
      raise exception 'Locked resolver patch failed: expected CASE anchor was not found.';
    end if;

    v_updated_function := replace(
      v_function,
      '    when ''aquatic-accord'' then ''aquatic''',
      '    when ''clean-musk'' then ''white-musk''
    when ''clean-musks'' then ''white-musk''
    when ''clean-musk-accord'' then ''white-musk''
    when ''clean-musk-notes'' then ''white-musk''
    when ''calone-note'' then ''calone''
    when ''calone-accord'' then ''calone''
    when ''seaweed-note'' then ''seaweed''
    when ''seaweed-notes'' then ''seaweed''
    when ''seaweed-accord'' then ''seaweed''
    when ''yerba-mate'' then ''mate''
    when ''mate-tea'' then ''mate''
    when ''aquatic-accord'' then ''aquatic'''
    );

    execute v_updated_function;
  end if;
end
$$;

grant execute on function public.get_scent_term_dossier_v1(uuid, text, text, uuid, text) to anon, authenticated, service_role;
