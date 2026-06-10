do $$
begin
  if exists (
    select 1
    from public.scent_terms
    where slug in (
      'ambroxan',
      'white-musk'
    )
  ) then
    raise exception 'Locked preflight failed: ambroxan or white-musk already exists.';
  end if;

  if exists (
    select 1
    from (
      values
        ('Ambrox'),
        ('Grey Amber'),
        ('Clean Musk'),
        ('Calone')
    ) as blocked(label)
    where coalesce(
      (public.get_scent_term_dossier_v1(null, null, blocked.label, null, null)->>'found')::boolean,
      false
    )
  ) then
    raise exception 'Locked preflight failed: a leave-unmapped term already resolves.';
  end if;

  if exists (
    select 1
    from (
      values
        ('ambroxan note', 'ambroxan'),
        ('ambroxan accord', 'ambroxan'),
        ('white musks', 'white-musk'),
        ('white musk accord', 'white-musk'),
        ('white musk notes', 'white-musk')
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
    'ambroxan',
    'Ambroxan',
    'material',
    'Material Effect',
    null,
    'Ambergris-Style Aroma Material',
    'Ambroxan is a modern ambergris-style aroma material used for dry amber warmth, musky diffusion, and long-lasting radiance.',
    array['Dry amber', 'clean musk', 'mineral warmth', 'salty skin', 'soft woods', 'and smooth airy warmth'],
    'Fresh ambers, woody musks, marine ambers, clean modern scents, and long-lasting drydowns.',
    'Adds diffusion, smoothness, warmth, and a clean long-lasting base.',
    array['Ambergris', 'Amber', 'Musk', 'Salt', 'Marine / Aquatic', 'Fresh Aquatic', 'Cedar', 'Vetiver', 'Bergamot', 'White Musk'],
    null,
    'high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Ambroxan as a standalone modern ambergris-style aroma material kept separate from Ambergris and Amber.'
  ),
  (
    'white-musk',
    'White Musk',
    'accord',
    'Musk Effect',
    null,
    'Clean Musk Effect',
    'White Musk is a clean musk effect used for soft skin, fresh fabric, gentle soapiness, and smooth airy comfort.',
    array['Clean skin', 'soft musk', 'fresh fabric', 'light powder', 'white soap edges', 'and airy smoothness'],
    'Clean musks, office-friendly scents, soft florals, fresh woods, laundry-adjacent styles, and gentle daily fragrances.',
    'Adds softness, cleanliness, smoothness, and a polished skin-like finish.',
    array['Musk', 'Soapy / Clean', 'Cotton', 'Laundry', 'Powdery', 'Aldehydic', 'Neroli', 'Iris', 'Sandalwood', 'Ambroxan'],
    null,
    'medium-high',
    'source_light',
    'Approved Odara Scent Intel copy for White Musk as a standalone clean musk effect kept separate from Musk, Soapy / Clean, Cotton, and Laundry.'
  );

with target_terms as (
  select id, slug
  from public.scent_terms
  where slug in (
    'ambroxan',
    'white-musk'
  )
),
term_aliases as (
  select 'ambroxan'::text as slug, alias
  from unnest(array[
    'ambroxan',
    'ambroxan-note',
    'ambroxan-accord'
  ]::text[]) as alias
  union all
  select 'white-musk', alias
  from unnest(array[
    'white-musk',
    'white-musks',
    'white-musk-accord',
    'white-musk-notes'
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

  if position('when ''ambroxan-note'' then ''ambroxan''' in v_function) = 0 then
    if position('    when ''cacao'' then ''chocolate-cacao''' in v_function) = 0 then
      raise exception 'Locked resolver patch failed: expected CASE anchor was not found.';
    end if;

    v_updated_function := replace(
      v_function,
      '    when ''cacao'' then ''chocolate-cacao''',
      '    when ''ambroxan-note'' then ''ambroxan''
    when ''ambroxan-accord'' then ''ambroxan''
    when ''white-musks'' then ''white-musk''
    when ''white-musk-accord'' then ''white-musk''
    when ''white-musk-notes'' then ''white-musk''
    when ''cacao'' then ''chocolate-cacao'''
    );

    execute v_updated_function;
  end if;
end
$$;

grant execute on function public.get_scent_term_dossier_v1(uuid, text, text, uuid, text) to anon, authenticated, service_role;
