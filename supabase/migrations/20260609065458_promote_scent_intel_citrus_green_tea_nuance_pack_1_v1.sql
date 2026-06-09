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
    'neroli',
    'Neroli',
    'material',
    'Citrus Floral Material',
    null,
    'Citrus Floral Material',
    'Neroli is a citrus-floral material from bitter orange blossoms. It is fresh, green, sparkling, and clean.',
    array['Bitter orange flower', 'green citrus peel', 'white petals', 'clean soapiness', 'and light herbal freshness'],
    'Colognes, fresh florals, clean musks, citrus blends, and elegant summer structures.',
    'Adds bright floral lift, clean freshness, and a polished citrus-floral edge.',
    array['Petitgrain', 'Bergamot', 'Lemon', 'Lavender', 'Jasmine', 'Musk', 'Amber', 'Basil', 'Green Notes'],
    null,
    'high',
    'verified_primary',
    'Approved Odara Scent Intel copy for Neroli as a distinct citrus-floral material separate from Orange Blossom and Petitgrain.'
  ),
  (
    'petitgrain',
    'Petitgrain',
    'material',
    'Citrus Material',
    null,
    'Green Citrus Material',
    'Petitgrain is a green citrus material from the leaves and twigs of the bitter orange tree.',
    array['Green citrus leaves', 'bitter twigs', 'orange rind', 'clean woods', 'and fresh herbal sharpness'],
    'Colognes, aromatic citrus, fresh woods, neroli structures, and green clean scents.',
    'Adds crisp green structure, citrus bitterness, and dry leafy freshness.',
    array['Neroli', 'Bitter Orange', 'Bergamot', 'Lemon', 'Rosemary', 'Basil', 'Lavender', 'Vetiver', 'Cedar'],
    null,
    'high',
    'verified_primary',
    'Approved Odara Scent Intel copy for Petitgrain as a bitter-orange leaf and twig material kept distinct from Neroli and Bitter Orange.'
  ),
  (
    'galbanum',
    'Galbanum',
    'material',
    'Green Material',
    null,
    'Green Resin Material',
    'Galbanum is a sharp green resin material used for intense leafy bite, resinous depth, and classic green structure.',
    array['Crushed green stems', 'bitter sap', 'sharp leaves', 'resin', 'dry earth', 'and cold green bite'],
    'Green florals, chypre-style structures, iris blends, leather contrasts, incense, and sharp green openings.',
    'Adds strong green bite, resinous depth, bitterness, and structure.',
    array['Green Notes', 'Violet Leaf', 'Tomato Leaf', 'Iris', 'Bergamot', 'Jasmine', 'Rose', 'Vetiver', 'Leather', 'Incense'],
    null,
    'high',
    'verified_primary',
    'Approved Odara Scent Intel copy for Galbanum as a distinct green resin material that should not collapse into Green Notes or Resins.'
  ),
  (
    'violet-leaf',
    'Violet Leaf',
    'material',
    'Green Material',
    null,
    'Leafy Green Material',
    'Violet Leaf is a green leafy material from violet leaves, separate from the sweeter violet flower effect.',
    array['Green violet leaves', 'watery leaf', 'cucumber-like freshness', 'cut stems', 'and soft leathery green texture'],
    'Green florals, watery greens, iris blends, modern woods, leather accents, and fresh musks.',
    'Adds cool green texture, watery freshness, and a refined leafy edge.',
    array['Galbanum', 'Green Notes', 'Iris', 'Rose', 'Vetiver', 'Cedar', 'Musk', 'Tomato Leaf', 'Bergamot', 'Leather'],
    null,
    'medium-high',
    'verified_primary',
    'Approved Odara Scent Intel copy for Violet Leaf as a distinct leafy green material separate from Violet and Green Notes.'
  ),
  (
    'tomato-leaf',
    'Tomato Leaf',
    'material',
    'Green Material',
    null,
    'Leafy Green Material',
    'Tomato Leaf is a green leafy scent effect used to suggest tomato vines, garden stems, and sharp plant freshness.',
    array['Tomato vine', 'green stems', 'crushed leaves', 'garden air', 'bitter sap', 'and fresh herbal sharpness'],
    'Green fragrances, garden effects, modern niche freshness, herbal citrus, and leafy contrast.',
    'Adds realistic green bite, garden freshness, and a less polished leafy edge.',
    array['Basil', 'Mint', 'Galbanum', 'Green Notes', 'Fig', 'Vetiver', 'Blackcurrant / Cassis', 'Cedar', 'Musk', 'Lemon'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Tomato Leaf as a leafy green effect kept distinct from Tomato fruit and Green Notes.'
  ),
  (
    'tea',
    'Tea',
    'note',
    'Tea Note',
    null,
    'Tea Note / Aromatic Effect',
    'Tea is an aromatic note used to suggest brewed tea, dry tea leaves, soft bitterness, and calm freshness.',
    array['Brewed tea', 'dry leaves', 'light bitterness', 'soft woods', 'clean steam', 'and gentle aromatic warmth'],
    'Fresh scents, citrus-tea blends, musks, florals, woody tea compositions, and calming everyday fragrances.',
    'Adds quiet freshness, dryness, lift, and a more reflective aromatic texture.',
    array['Bergamot', 'Lemon', 'Mandarin', 'Jasmine', 'Mint', 'Ginger', 'Honey', 'Fig', 'Musk', 'Sandalwood'],
    null,
    'medium-high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Tea as a broad tea note kept distinct from Matcha.'
  ),
  (
    'matcha',
    'Matcha',
    'note',
    'Tea Note',
    null,
    'Green Tea Effect',
    'Matcha is a powdered green tea effect used for vegetal tea freshness, soft bitterness, and a dry green powdery feel.',
    array['Powdered green tea', 'soft bitterness', 'steamed greens', 'dry leaf', 'light creaminess', 'and earthy tea powder'],
    'Tea scents, green gourmands, clean musks, soft woods, and modern fresh compositions.',
    'Adds green calm, powdery dryness, vegetal freshness, and gentle bitterness.',
    array['Tea', 'Green Notes', 'Jasmine', 'Mint', 'Fig', 'Coconut', 'Musk', 'Sandalwood', 'Bergamot', 'Vanilla'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for Matcha as a distinct green tea effect that should not collapse into Tea.'
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
    'neroli',
    'petitgrain',
    'galbanum',
    'violet-leaf',
    'tomato-leaf',
    'tea',
    'matcha'
  )
),
term_aliases as (
  select 'neroli'::text as slug, alias
  from unnest(array[
    'neroli',
    'neroli-oil',
    'neroli-essence'
  ]::text[]) as alias
  union all
  select 'petitgrain', alias
  from unnest(array[
    'petitgrain',
    'petitgrain-oil',
    'petit-grain',
    'petitgrain-bigarade'
  ]::text[]) as alias
  union all
  select 'galbanum', alias
  from unnest(array[
    'galbanum',
    'galbanum-resin',
    'galbanum-gum',
    'gum-galbanum',
    'green-galbanum'
  ]::text[]) as alias
  union all
  select 'violet-leaf', alias
  from unnest(array[
    'violet-leaf',
    'violet-leaves',
    'violet-leaf-absolute'
  ]::text[]) as alias
  union all
  select 'tomato-leaf', alias
  from unnest(array[
    'tomato-leaf',
    'tomato-leaves',
    'tomato-vine',
    'tomato-vines',
    'tomato-stem',
    'tomato-foliage'
  ]::text[]) as alias
  union all
  select 'tea', alias
  from unnest(array[
    'tea',
    'tea-leaf',
    'tea-leaves',
    'tea-accord',
    'brewed-tea',
    'black-tea',
    'green-tea',
    'white-tea',
    'oolong-tea'
  ]::text[]) as alias
  union all
  select 'matcha', alias
  from unnest(array[
    'matcha',
    'matcha-tea',
    'powdered-green-tea',
    'matcha-powder'
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
    when 'neroli-oil' then 'neroli'
    when 'neroli-essence' then 'neroli'
    when 'petitgrain-oil' then 'petitgrain'
    when 'petit-grain' then 'petitgrain'
    when 'petitgrain-bigarade' then 'petitgrain'
    when 'beeswax' then 'honey'
    when 'galbanum-resin' then 'galbanum'
    when 'galbanum-gum' then 'galbanum'
    when 'gum-galbanum' then 'galbanum'
    when 'green-galbanum' then 'galbanum'
    when 'violet-leaves' then 'violet-leaf'
    when 'violet-leaf-absolute' then 'violet-leaf'
    when 'tomato-leaves' then 'tomato-leaf'
    when 'tomato-vine' then 'tomato-leaf'
    when 'tomato-vines' then 'tomato-leaf'
    when 'tomato-stem' then 'tomato-leaf'
    when 'tomato-foliage' then 'tomato-leaf'
    when 'tea-leaf' then 'tea'
    when 'tea-leaves' then 'tea'
    when 'tea-accord' then 'tea'
    when 'brewed-tea' then 'tea'
    when 'black-tea' then 'tea'
    when 'green-tea' then 'tea'
    when 'white-tea' then 'tea'
    when 'oolong-tea' then 'tea'
    when 'matcha-tea' then 'matcha'
    when 'powdered-green-tea' then 'matcha'
    when 'matcha-powder' then 'matcha'
    when 'cacao' then 'chocolate-cacao'
    when 'cocoa' then 'chocolate-cacao'
    when 'chocolate' then 'chocolate-cacao'
    when 'dark-chocolate' then 'chocolate-cacao'
    when 'cacao-pod' then 'chocolate-cacao'
    when 'roasted-coffee' then 'coffee'
    when 'roasted-coffee-note' then 'coffee'
    when 'coffee-roasted' then 'coffee'
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
