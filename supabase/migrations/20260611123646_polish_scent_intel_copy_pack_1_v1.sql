begin;

do $$
declare
  invalid_slugs text[];
begin
  with target_slugs(slug) as (
    values
      ('soft-spicy'),
      ('mossy'),
      ('lactonic'),
      ('yellow-floral'),
      ('fresh-blue'),
      ('amber-spicy'),
      ('creamy')
  ),
  slug_counts as (
    select slug, count(*)::int as row_count
    from public.scent_terms
    where slug in (
      'soft-spicy',
      'mossy',
      'lactonic',
      'yellow-floral',
      'fresh-blue',
      'amber-spicy',
      'creamy'
    )
    group by slug
  )
  select array_agg(t.slug order by t.slug)
    into invalid_slugs
  from target_slugs t
  left join slug_counts sc using (slug)
  where coalesce(sc.row_count, 0) <> 1;

  if invalid_slugs is not null then
    raise exception 'Expected exactly one scent_terms row for each target slug. Problem slugs: %', array_to_string(invalid_slugs, ', ');
  end if;
end
$$;

update public.scent_terms
set smells_like = array[
  'Cinnamon warmth',
  'smooth cardamom',
  'dry nutmeg',
  'ambered sweetness',
  'and gentle clove-like spice'
]
where slug = 'soft-spicy';

update public.scent_terms
set what_it_is = 'Mossy is a green-earthy effect that feels like damp forest floor, shaded bark, and dry chypre depth.'
where slug = 'mossy';

update public.scent_terms
set what_it_is = 'Lactonic is a creamy effect that gives a fragrance a milk-soft, peach-skin, coconut-like texture.'
where slug = 'lactonic';

update public.scent_terms
set what_it_is = 'Yellow Floral is a warm floral style that leans creamy, sunny, and tropical rather than airy or dewy.'
where slug = 'yellow-floral';

update public.scent_terms
set smells_like = array[
  'Clean shower freshness',
  'bright citrus',
  'airy woods',
  'light aquatic air',
  'soft musk',
  'and smooth marine-clean polish'
]
where slug = 'fresh-blue';

update public.scent_terms
set what_it_does = 'Rounds the drydown, deepens spicy amber blends, and gives a fragrance a richer evening profile.'
where slug = 'amber-spicy';

update public.scent_terms
set what_it_does = 'Rounds sharp edges and gives the drydown a fuller, softer lotion-like feel.'
where slug = 'creamy';

commit;
