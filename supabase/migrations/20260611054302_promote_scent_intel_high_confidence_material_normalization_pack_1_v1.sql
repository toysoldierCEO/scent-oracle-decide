do $$
begin
  if exists (
    select 1
    from public.scent_terms
    where slug in (
      'violet',
      'lily-of-the-valley'
    )
  ) then
    raise exception 'Locked preflight failed: one or more new target slugs already exist.';
  end if;

  if (
    select count(*)
    from public.scent_terms
    where slug in (
      'cedar',
      'oud',
      'leather',
      'marine-aquatic'
    )
  ) <> 4 then
    raise exception 'Locked preflight failed: one or more required existing targets are missing.';
  end if;

  if exists (
    select 1
    from public.scent_terms
    where slug in (
      'cedarwood',
      'agarwood',
      'agarwood-oud',
      'leathery',
      'marine',
      'synthetic'
    )
  ) then
    raise exception 'Locked preflight failed: one or more blocked canonical slugs already exist.';
  end if;

  if exists (
    select 1
    from (
      values
        ('violet flower', 'violet'),
        ('violet flowers', 'violet'),
        ('violet accord', 'violet'),
        ('violet notes', 'violet'),
        ('muguet', 'lily-of-the-valley'),
        ('lily of valley', 'lily-of-the-valley'),
        ('cedarwood', 'cedar'),
        ('cedar wood', 'cedar'),
        ('agarwood', 'oud'),
        ('agarwood oud', 'oud'),
        ('agarwood-oud', 'oud'),
        ('agarwood (oud)', 'oud'),
        ('leathery', 'leather'),
        ('leathery accord', 'leather'),
        ('leathery notes', 'leather'),
        ('marine', 'marine-aquatic'),
        ('marine accord', 'marine-aquatic'),
        ('marine notes', 'marine-aquatic')
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
    'violet',
    'Violet',
    'material',
    'Floral Material',
    null,
    'Floral Material',
    'Violet is a soft floral note used for powdery petals, gentle sweetness, and a smooth cosmetic floral effect.',
    array['Soft violet petals', 'powder', 'candy-like floral sweetness', 'iris-like softness', 'and clean floral musk'],
    'Powdery florals, musks, iris blends, vintage-style florals, soft woods, and clean daily fragrances.',
    'Adds powdery softness, floral sweetness, and a polished cosmetic texture.',
    array['Iris', 'Powdery', 'Musk', 'Rose', 'Violet Leaf', 'White Musk', 'Sandalwood', 'Amber', 'Cedar', 'Vanilla'],
    null,
    'high',
    'verified_secondary',
    null
  ),
  (
    'lily-of-the-valley',
    'Lily of the Valley',
    'material',
    'Floral Material',
    null,
    'Floral Material',
    'Lily of the Valley is a fresh white floral note used for clean spring-like brightness and delicate green floral lift.',
    array['Fresh white bells', 'green stems', 'clean floral air', 'soft soapiness', 'watery petals', 'and spring freshness'],
    'Fresh florals, clean musks, white floral blends, aldehydic florals, soaps, and polished daily scents.',
    'Adds clean floral lift, watery freshness, and a delicate spring-like brightness.',
    array['White Floral', 'Floral', 'Jasmine', 'Neroli', 'Aldehydic', 'Musk', 'Soapy / Clean', 'Green Notes', 'Rose', 'Citrus'],
    null,
    'medium-high',
    'verified_secondary',
    null
  );

with target_terms as (
  select id, slug
  from public.scent_terms
  where slug in (
    'violet',
    'lily-of-the-valley',
    'cedar',
    'oud',
    'leather',
    'marine-aquatic'
  )
),
term_aliases as (
  select 'violet'::text as slug, alias
  from unnest(array[
    'violet',
    'violet-flower',
    'violet-flowers',
    'violet-accord',
    'violet-notes'
  ]::text[]) as alias
  union all
  select 'lily-of-the-valley', alias
  from unnest(array[
    'lily-of-the-valley',
    'muguet',
    'lily-of-valley'
  ]::text[]) as alias
  union all
  select 'cedar', alias
  from unnest(array[
    'cedarwood',
    'cedar-wood'
  ]::text[]) as alias
  union all
  select 'oud', alias
  from unnest(array[
    'agarwood',
    'agarwood-oud'
  ]::text[]) as alias
  union all
  select 'leather', alias
  from unnest(array[
    'leathery',
    'leathery-accord',
    'leathery-notes'
  ]::text[]) as alias
  union all
  select 'marine-aquatic', alias
  from unnest(array[
    'marine',
    'marine-accord',
    'marine-notes'
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
    btrim(rt.term_label) as term_label,
    rt.position,
    rt.source,
    rt.source_url,
    public.scent_term_slugify_v1(btrim(rt.term_label)) as term_slug
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

  if position('when ''cedarwood'' then ''cedar''' in v_function) = 0 then
    if position('    when ''mat'' then ''mate''' in v_function) = 0 then
      raise exception 'Locked resolver patch failed: expected CASE anchor was not found.';
    end if;

    v_updated_function := replace(
      v_function,
      '    when ''mat'' then ''mate''',
      '    when ''violet-flower'' then ''violet''
    when ''violet-flowers'' then ''violet''
    when ''violet-accord'' then ''violet''
    when ''violet-notes'' then ''violet''
    when ''muguet'' then ''lily-of-the-valley''
    when ''lily-of-valley'' then ''lily-of-the-valley''
    when ''cedarwood'' then ''cedar''
    when ''cedar-wood'' then ''cedar''
    when ''agarwood'' then ''oud''
    when ''agarwood-oud'' then ''oud''
    when ''leathery'' then ''leather''
    when ''leathery-accord'' then ''leather''
    when ''leathery-notes'' then ''leather''
    when ''marine'' then ''marine-aquatic''
    when ''marine-accord'' then ''marine-aquatic''
    when ''marine-notes'' then ''marine-aquatic''
    when ''mat'' then ''mate'''
    );

    execute v_updated_function;
  end if;
end
$$;

grant execute on function public.get_scent_term_dossier_v1(uuid, text, text, uuid, text) to anon, authenticated, service_role;
