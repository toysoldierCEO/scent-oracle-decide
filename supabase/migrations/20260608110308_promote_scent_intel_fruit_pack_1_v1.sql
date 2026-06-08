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
    'apple',
    'Apple',
    'note',
    'Fruit Note',
    'fresh-citrus',
    'Reconstructed Fruit Note',
    'Apple is a reconstructed fruit note used for crisp, juicy freshness. It is usually built from aroma materials rather than apple extract.',
    array['Crunchy green apple skin', 'ripe apple juice', 'fresh peel', 'and a clean sweet-tart bite'],
    'Fresh fruity openings, fruity florals, clean musks, and modern woody scents.',
    'Makes a fragrance feel brighter, juicier, cleaner, and more playful.',
    array['Pear', 'Citrus', 'Blackcurrant / Cassis', 'Violet', 'Musk', 'Cedar', 'Vanilla', 'Caramel'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Apple as a reconstructed fruit note.'
  ),
  (
    'peach',
    'Peach',
    'note',
    'Fruit Note',
    'floral-rich',
    'Reconstructed Fruit Note',
    'Peach is a soft fruit note used to recreate the sweet, velvety character of ripe peach.',
    array['Juicy peach flesh', 'fuzzy skin', 'creamy sweetness', 'nectar', 'and light floral softness'],
    'Fruity florals, soft gourmands, peach-skin effects, and velvety floral hearts.',
    'Makes a fragrance feel rounder, softer, creamier, and more sensual.',
    array['Rose', 'Osmanthus', 'Vanilla', 'Sandalwood', 'Patchouli', 'Coconut', 'Bergamot', 'Jasmine', 'Musk', 'Apricot'],
    null,
    'high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Peach as a reconstructed fruit note.'
  ),
  (
    'fig',
    'Fig',
    'note',
    'Fruit Note',
    'green-earthy',
    'Fruit Note / Green Lactonic Effect',
    'Fig in perfume can suggest fruit, leaf, sap, and tree. It often blends green freshness with milky sweetness.',
    array['Crushed fig leaves', 'milky sap', 'coconut-like creaminess', 'sweet fruit', 'and dry bark'],
    'Green fruity woods, creamy fresh blends, airy summer scents, and naturalistic niche compositions.',
    'Adds green texture, soft creaminess, and a less sugary fruit profile.',
    array['Coconut', 'Green Notes', 'Neroli', 'Cedar', 'Sandalwood', 'Musk', 'Blackcurrant / Cassis', 'Citrus'],
    null,
    'high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Fig as a fruit note with green lactonic facets.'
  ),
  (
    'cherry',
    'Cherry',
    'note',
    'Fruit Note',
    'sweet-gourmand',
    'Reconstructed Fruit Note',
    'Cherry is a reconstructed fruit note that can lean sweet, tart, almondy, syrupy, or dark.',
    array['Sweet-tart fruit', 'cherry syrup', 'liqueur', 'bitter almond', 'and dark red fruit'],
    'Gourmands, dark fruits, playful fruity florals, and richer sweet blends.',
    'Makes a fragrance feel juicier, darker, sweeter, and more dramatic.',
    array['Almond', 'Vanilla', 'Tonka', 'Rose', 'Tobacco', 'Leather', 'Patchouli', 'Amber'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Cherry as a reconstructed fruit note.'
  ),
  (
    'blackcurrant-cassis',
    'Blackcurrant / Cassis',
    'note',
    'Fruit Note',
    'green-earthy',
    'Fruit Note / Bud Material Effect',
    'Blackcurrant can mean fruity cassis, green blackcurrant bud, or a berry-green effect.',
    array['Tart dark berries', 'crushed green leaves', 'sharp fruit skin', 'and a faint sulfurous edge'],
    'Fruity florals, green bite, fresh musks, woods, and chypre-style contrast.',
    'Makes a fragrance feel brighter, sharper, juicier, and more textured than a simple sweet berry.',
    array['Rose', 'Bergamot', 'Sandalwood', 'Vanilla', 'Patchouli', 'Peach', 'Lemon', 'Cedar', 'Musk', 'Violet'],
    null,
    'medium-high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Blackcurrant / Cassis as a fruit note with berry-green contrast.'
  ),
  (
    'pear',
    'Pear',
    'note',
    'Fruit Note',
    'fresh-citrus',
    'Reconstructed Fruit Note',
    'Pear is a crisp, watery fruit note used for clean juiciness. It is usually a reconstructed fruit effect.',
    array['Green pear skin', 'juicy white flesh', 'watery freshness', 'and soft sweetness'],
    'Fruity florals, fresh musks, sparkling top notes, and clean modern scents.',
    'Makes a fragrance feel lighter, clearer, juicier, and more transparent.',
    array['Apple', 'Freesia', 'Rose', 'Musk', 'Citrus', 'Tea', 'Soft Woods', 'Ambrox-style Freshness'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Pear as a reconstructed fruit note.'
  ),
  (
    'coconut',
    'Coconut',
    'note',
    'Fruit Note',
    'sweet-gourmand',
    'Creamy Fruit / Lactonic Effect',
    'Coconut is a creamy tropical note that can smell like coconut milk, sun-warmed skin, or soft lactonic sweetness.',
    array['Coconut milk', 'cream', 'soft sweetness', 'toasted flakes', 'and tropical warmth'],
    'Solar scents, gourmands, creamy musks, beachy florals, and tropical blends.',
    'Adds creaminess, softness, sweetness, and a warmer skin-like feel.',
    array['Vanilla', 'Tiare', 'Jasmine', 'Sandalwood', 'Amber', 'Fig', 'Mango', 'Musks'],
    null,
    'medium-high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Coconut as a creamy fruit note with lactonic warmth.'
  ),
  (
    'bitter-orange',
    'Bitter Orange',
    'material',
    'Citrus Material',
    'citrus-cologne',
    'Citrus Material',
    'Bitter orange is the sharper, drier citrus side of the orange tree. It is related to neroli and petitgrain but smells different.',
    array['Bitter peel', 'green rind', 'pith', 'dry zest', 'and crisp citrus oil'],
    'Colognes, chypre-style citrus, aromatic freshness, and sharper orange effects.',
    'Adds bitterness, structure, and a more grown-up citrus edge.',
    array['Neroli', 'Petitgrain', 'Bergamot', 'Herbs', 'Woods', 'Florals', 'Musks', 'Amber'],
    null,
    'high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Bitter Orange as a distinct citrus material separate from Orange, Neroli, and Petitgrain.'
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
  odara_read = excluded.odara_read,
  confidence = excluded.confidence,
  source_status = excluded.source_status,
  source_note = excluded.source_note,
  updated_at = now();

with target_terms as (
  select id, slug
  from public.scent_terms
  where slug in (
    'apple',
    'peach',
    'fig',
    'cherry',
    'blackcurrant-cassis',
    'pear',
    'coconut',
    'bitter-orange'
  )
),
term_aliases as (
  select 'apple'::text as slug, alias
  from unnest(array[
    'apple',
    'green-apple',
    'red-apple',
    'baked-apple'
  ]::text[]) as alias
  union all
  select 'peach', alias
  from unnest(array[
    'peach'
  ]::text[]) as alias
  union all
  select 'fig', alias
  from unnest(array[
    'fig',
    'fig-leaf',
    'fig-tree'
  ]::text[]) as alias
  union all
  select 'cherry', alias
  from unnest(array[
    'cherry',
    'sour-cherry'
  ]::text[]) as alias
  union all
  select 'blackcurrant-cassis', alias
  from unnest(array[
    'blackcurrant-cassis',
    'blackcurrant',
    'blackcurrant-bud',
    'cassis',
    'black-currant'
  ]::text[]) as alias
  union all
  select 'pear', alias
  from unnest(array[
    'pear'
  ]::text[]) as alias
  union all
  select 'coconut', alias
  from unnest(array[
    'coconut',
    'coconut-milk'
  ]::text[]) as alias
  union all
  select 'bitter-orange', alias
  from unnest(array[
    'bitter-orange',
    'bigarade'
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

  v_requested_slug := case coalesce(
    nullif(public.scent_term_slugify_v1(p_term_slug), ''),
    nullif(public.scent_term_slugify_v1(p_term_label), '')
  )
    when 'aldehydes' then 'aldehydic'
    when 'aldehyde' then 'aldehydic'
    when 'aldehydic-notes' then 'aldehydic'
    when 'aldehydic-note' then 'aldehydic'
    when 'spices' then 'spice'
    when 'spicy' then 'spice'
    when 'warm-spicy' then 'spicy-warm'
    when 'olibanum' then 'frankincense'
    when 'frank-incense' then 'frankincense'
    when 'boswellia' then 'frankincense'
    when 'olibanum-resin' then 'frankincense'
    when 'frankincense-resin' then 'frankincense'
    when 'myrrhe' then 'myrrh'
    when 'smoky' then 'smoke'
    when 'smokey' then 'smoke'
    when 'smoke-accord' then 'smoke'
    when 'smoky-woods' then 'smoke'
    when 'resin' then 'resins'
    when 'resinous' then 'resins'
    when 'resin-material' then 'resins'
    when 'resin-materials' then 'resins'
    when 'resin-note' then 'resins'
    when 'resin-notes' then 'resins'
    when 'resinous-note' then 'resins'
    when 'resinous-notes' then 'resins'
    when 'resinous-material' then 'resins'
    when 'resinous-materials' then 'resins'
    when 'amber-resin-and-incense' then 'amber-resin-incense'
    when 'green-apple' then 'apple'
    when 'red-apple' then 'apple'
    when 'baked-apple' then 'apple'
    when 'fig-leaf' then 'fig'
    when 'fig-tree' then 'fig'
    when 'sour-cherry' then 'cherry'
    when 'blackcurrant' then 'blackcurrant-cassis'
    when 'blackcurrant-bud' then 'blackcurrant-cassis'
    when 'cassis' then 'blackcurrant-cassis'
    when 'black-currant' then 'blackcurrant-cassis'
    when 'coconut-milk' then 'coconut'
    when 'bigarade' then 'bitter-orange'
    else coalesce(
      nullif(public.scent_term_slugify_v1(p_term_slug), ''),
      nullif(public.scent_term_slugify_v1(p_term_label), '')
    )
  end;

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
      'what_it_is', v_term.what_it_is,
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
