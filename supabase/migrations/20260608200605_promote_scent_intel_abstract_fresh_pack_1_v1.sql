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
    'aromatic',
    'Aromatic',
    'family',
    'Scent Style',
    'aromatic-fougere',
    'Scent Style / Aromatic Effect',
    'Aromatic is a fragrance style built around fresh herbs, lavender-like freshness, green materials, and dry spices. It describes an overall style, not one ingredient.',
    array['Clean herbs', 'lavender-like freshness', 'green stems', 'dry spice', 'crisp citrus', 'and polished woods'],
    'Colognes, fougeres, fresh woods, clean masculine structures, and herbal-citrus blends.',
    'Adds structure, freshness, polish, and a classic barbershop-style backbone.',
    array['Lavender', 'Rosemary', 'Sage', 'Bergamot', 'Mint', 'Black Pepper', 'Vetiver', 'Cedar', 'Musk', 'Oakmoss'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Aromatic as a scent style built from herbs, spices, and polished freshness.'
  ),
  (
    'fresh-spicy',
    'Fresh Spicy',
    'accord',
    'Scent Effect',
    'citrus-aromatic',
    'Fresh Spicy Scent Effect',
    'Fresh Spicy is a bright spice effect where spice is used for lift, sparkle, and clean heat rather than heavy warmth.',
    array['Fresh-cracked pepper', 'ginger brightness', 'cool cardamom', 'citrus peel', 'clean dry heat', 'and airy spice'],
    'Fresh openings, modern woods, aromatic scents, citrus-spice blends, and energetic masculine styles.',
    'Adds motion, brightness, tension, and clean spicy lift.',
    array['Ginger', 'Pink Pepper', 'Black Pepper', 'Bergamot', 'Vetiver', 'Cedar', 'Lavender', 'Musk', 'Tea', 'Incense'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Fresh Spicy as a bright spice effect distinct from individual spice materials.'
  ),
  (
    'soapy-clean',
    'Soapy / Clean',
    'accord',
    'Clean Effect',
    'floral-musk',
    'Clean Scent Effect',
    'Soapy / Clean is a scent effect used to suggest fresh soap, clean skin, shampoo, and freshly washed fabric.',
    array['White soap', 'clean skin', 'soft musk', 'fresh towels', 'light florals', 'and crisp citrus'],
    'Clean musks, aldehydic florals, office-friendly scents, shampoo-like freshness, and polished everyday fragrances.',
    'Makes a fragrance feel fresher, safer, smoother, and more freshly washed.',
    array['Musk', 'Aldehydic', 'Lavender', 'Neroli', 'Iris', 'Rose', 'Citrus', 'Powdery', 'Sandalwood', 'Fresh Aquatic'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Soapy / Clean as a clean effect distinct from powdery, musk, and aquatic concepts.'
  ),
  (
    'mineral',
    'Mineral',
    'accord',
    'Scent Effect',
    'fresh-aquatic',
    'Mineral Scent Effect',
    'Mineral is an abstract scent effect used to suggest stone, wet rock, flint, dry earth, or cool stony texture.',
    array['Wet stone', 'cool rock', 'flint', 'dry dust', 'rain on stone', 'and clean grey texture'],
    'Modern fresh scents, dry woods, incense, iris, minimal compositions, and marine-adjacent contrast.',
    'Adds coolness, dryness, texture, and a less sweet finish.',
    array['Vetiver', 'Iris', 'Incense', 'Cedar', 'Marine / Aquatic', 'Musk', 'Bergamot', 'Sage', 'Transparent Woods', 'Citrus'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Mineral as a cool stony scent effect distinct from aquatic, salt, metallic, and rain concepts.'
  ),
  (
    'solar',
    'Solar',
    'accord',
    'Scent Effect',
    'floral-rich',
    'Solar Scent Effect',
    'Solar is a warm bright scent effect used to suggest sun-warmed skin, beach florals, sunscreen-style creaminess, and summer warmth.',
    array['Sun-warmed skin', 'creamy white flowers', 'warm musk', 'soft coconut facets', 'tiare-like florals', 'and smooth amber warmth'],
    'Beachy florals, summer musks, coconut/tiare styles, tropical blends, and warm skin scents.',
    'Makes a fragrance feel warmer, brighter, smoother, and more summery.',
    array['Coconut', 'Tiare', 'Jasmine', 'Ylang-Ylang', 'Neroli', 'Vanilla', 'Musk', 'Amber', 'Sandalwood', 'Citrus'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Solar as a warm bright summer skin effect distinct from coconut, jasmine, and amber as individual materials.'
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
    'aromatic',
    'fresh-spicy',
    'soapy-clean',
    'mineral',
    'solar'
  )
),
term_aliases as (
  select 'aromatic'::text as slug, alias
  from unnest(array[
    'aromatic',
    'aromatic-notes',
    'aromatic-accord',
    'aromatics'
  ]::text[]) as alias
  union all
  select 'fresh-spicy', alias
  from unnest(array[
    'fresh-spicy',
    'fresh-spice',
    'spicy-fresh'
  ]::text[]) as alias
  union all
  select 'soapy-clean', alias
  from unnest(array[
    'soapy',
    'soap',
    'clean',
    'clean-accord',
    'clean-notes',
    'fresh-clean'
  ]::text[]) as alias
  union all
  select 'mineral', alias
  from unnest(array[
    'mineral',
    'mineral-notes',
    'mineral-accord',
    'wet-stone',
    'wet-rock',
    'stone',
    'flint'
  ]::text[]) as alias
  union all
  select 'solar', alias
  from unnest(array[
    'solar',
    'solar-notes',
    'solar-accord',
    'sun-accord',
    'sun-cream',
    'sunscreen',
    'suntan-lotion'
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
as $function$
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
    when 'beeswax' then 'honey'
    when 'cacao' then 'chocolate-cacao'
    when 'cocoa' then 'chocolate-cacao'
    when 'chocolate' then 'chocolate-cacao'
    when 'dark-chocolate' then 'chocolate-cacao'
    when 'cacao-pod' then 'chocolate-cacao'
    when 'bitter-almond' then 'almond'
    when 'almond-milk' then 'almond'
    when 'marzipan' then 'almond'
    when 'caramelized-sugar' then 'caramel'
    when 'toffee' then 'caramel'
    when 'butterscotch' then 'caramel'
    when 'sugar' then 'sugar-cotton-candy'
    when 'cotton-candy' then 'sugar-cotton-candy'
    when 'candy-floss' then 'sugar-cotton-candy'
    when 'spun-sugar' then 'sugar-cotton-candy'
    when 'burnt-sugar' then 'sugar-cotton-candy'
    when 'cloves' then 'clove'
    when 'clove-bud' then 'clove'
    when 'clove-oil' then 'clove'
    when 'clove-leaf' then 'clove'
    when 'nutmeg-seed' then 'nutmeg'
    when 'nutmeg-oil' then 'nutmeg'
    when 'ginger-root' then 'ginger'
    when 'fresh-ginger' then 'ginger'
    when 'ginger-oil' then 'ginger'
    when 'pink-peppercorn' then 'pink-pepper'
    when 'pink-peppercorns' then 'pink-pepper'
    when 'pink-berries' then 'pink-pepper'
    when 'baies-roses' then 'pink-pepper'
    when 'pepper' then 'black-pepper'
    when 'black-peppercorn' then 'black-pepper'
    when 'black-peppercorns' then 'black-pepper'
    when 'cracked-pepper' then 'black-pepper'
    when 'anise' then 'anise-licorice'
    when 'aniseed' then 'anise-licorice'
    when 'star-anise' then 'anise-licorice'
    when 'licorice' then 'anise-licorice'
    when 'liquorice' then 'anise-licorice'
    when 'fennel' then 'anise-licorice'
    when 'basil-leaf' then 'basil'
    when 'sweet-basil' then 'basil'
    when 'fresh-basil' then 'basil'
    when 'mint-leaf' then 'mint'
    when 'peppermint' then 'mint'
    when 'spearmint' then 'mint'
    when 'fresh-mint' then 'mint'
    when 'rosemary-leaf' then 'rosemary'
    when 'rosemary-oil' then 'rosemary'
    when 'fresh-rosemary' then 'rosemary'
    when 'sage-leaf' then 'sage'
    when 'common-sage' then 'sage'
    when 'garden-sage' then 'sage'
    when 'clarysage' then 'clary-sage'
    when 'salvia-sclarea' then 'clary-sage'
    when 'wormwood' then 'artemisia'
    when 'mugwort' then 'artemisia'
    when 'sagebrush' then 'artemisia'
    when 'green-note' then 'green-notes'
    when 'green-notes' then 'green-notes'
    when 'green-accord' then 'green-notes'
    when 'leafy-green' then 'green-notes'
    when 'green-leaves' then 'green-notes'
    when 'crushed-leaves' then 'green-notes'
    when 'aromatic-notes' then 'aromatic'
    when 'aromatic-accord' then 'aromatic'
    when 'aromatics' then 'aromatic'
    when 'fresh-spicy' then 'fresh-spicy'
    when 'fresh-spice' then 'fresh-spicy'
    when 'spicy-fresh' then 'fresh-spicy'
    when 'soapy' then 'soapy-clean'
    when 'soap' then 'soapy-clean'
    when 'clean' then 'soapy-clean'
    when 'clean-accord' then 'soapy-clean'
    when 'clean-notes' then 'soapy-clean'
    when 'fresh-clean' then 'soapy-clean'
    when 'mineral-notes' then 'mineral'
    when 'mineral-accord' then 'mineral'
    when 'wet-stone' then 'mineral'
    when 'wet-rock' then 'mineral'
    when 'stone' then 'mineral'
    when 'flint' then 'mineral'
    when 'solar-notes' then 'solar'
    when 'solar-accord' then 'solar'
    when 'sun-accord' then 'solar'
    when 'sun-cream' then 'solar'
    when 'sunscreen' then 'solar'
    when 'suntan-lotion' then 'solar'
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
$function$;
