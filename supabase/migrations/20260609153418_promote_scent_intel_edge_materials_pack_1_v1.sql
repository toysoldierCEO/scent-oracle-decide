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
    'orange-blossom',
    'Orange Blossom',
    'material',
    'Floral Material',
    null,
    'Citrus Floral Material',
    'Orange Blossom is the richer floral side of the bitter orange flower. It is sweeter, warmer, and more floral than Neroli.',
    array['White orange flowers', 'honeyed petals', 'orange nectar', 'soft soap', 'and warm floral sweetness'],
    'White florals, honeyed florals, ambers, clean musks, and bright floral-gourmand blends.',
    'Adds floral sweetness, softness, brightness, and a warmer citrus-floral body.',
    array['Neroli', 'Petitgrain', 'Honey', 'Jasmine', 'Musk', 'Amber', 'Vanilla', 'Bergamot', 'Sandalwood', 'Lavender'],
    null,
    'high',
    'verified_primary',
    null
  ),
  (
    'mace',
    'Mace',
    'material',
    'Spice Material',
    null,
    'Spice Material',
    'Mace is a warm spice material from the outer covering of the nutmeg seed. It is related to Nutmeg but should remain separate.',
    array['Warm spice', 'nutmeg-like warmth', 'dry wood', 'soft pepper', 'orange peel', 'and smooth aromatic heat'],
    'Spicy woods, ambers, fougeres, warm tobacco blends, and smooth spice structures.',
    'Adds dry spice warmth, smooth aromatic heat, and a polished spicy texture.',
    array['Nutmeg', 'Clove', 'Cinnamon', 'Cardamom', 'Orange', 'Sandalwood', 'Amber', 'Tobacco', 'Vanilla', 'Cedar'],
    null,
    'high',
    'verified_secondary',
    null
  ),
  (
    'absinthe',
    'Absinthe',
    'accord',
    'Herbal Effect',
    null,
    'Bitter Herbal Accord',
    'Absinthe is a bitter herbal accord inspired by the liqueur. In perfume, it suggests wormwood-like bitterness, anise-like sweetness, and green herbal sharpness.',
    array['Bitter green herbs', 'anise-like sweetness', 'wormwood', 'dry leaves', 'green liqueur', 'and soft herbal sweetness'],
    'Dark green scents, aromatic fougeres, tobacco blends, herbal gourmands, and unusual bitter accents.',
    'Adds bitter green bite, cool herbal contrast, and a distinctive liqueur-like edge.',
    array['Artemisia', 'Anise / Licorice', 'Lavender', 'Bergamot', 'Tobacco', 'Vetiver', 'Cedar', 'Vanilla', 'Mint', 'Black Pepper'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'ambergris',
    'Ambergris',
    'material',
    'Material Effect',
    null,
    'Marine Animalic Material Effect',
    'Ambergris is a marine-animalic material effect used to suggest salty skin, dry amber warmth, musk, and sea-air depth.',
    array['Salty skin', 'warm amber', 'marine air', 'dry musk', 'driftwood', 'mineral warmth', 'and soft animalic depth'],
    'Marine ambers, musks, woods, salty skin scents, fresh ambers, and long drydowns.',
    'Adds salty warmth, musky depth, dry texture, and a smoother long finish.',
    array['Salt', 'Marine / Aquatic', 'Musk', 'Amber', 'Cedar', 'Vetiver', 'Bergamot', 'Labdanum', 'Incense', 'Rain'],
    null,
    'medium',
    'source_light',
    null
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
    'orange-blossom',
    'mace',
    'absinthe',
    'ambergris'
  )
),
term_aliases as (
  select 'orange-blossom'::text as slug, alias
  from unnest(array[
    'orange-blossom',
    'orange-flower',
    'orange-flowers',
    'orange-blossom-absolute'
  ]::text[]) as alias
  union all
  select 'mace', alias
  from unnest(array[
    'mace',
    'mace-spice',
    'mace-oil'
  ]::text[]) as alias
  union all
  select 'absinthe', alias
  from unnest(array[
    'absinthe',
    'absinthe-accord',
    'absinthe-notes',
    'absinth',
    'green-absinthe'
  ]::text[]) as alias
  union all
  select 'ambergris', alias
  from unnest(array[
    'ambergris',
    'ambergris-accord',
    'ambergris-notes'
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
    when 'orange-flower' then 'orange-blossom'
    when 'orange-flowers' then 'orange-blossom'
    when 'orange-blossom-absolute' then 'orange-blossom'
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
    when 'mace-spice' then 'mace'
    when 'mace-oil' then 'mace'
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
    when 'absinthe-accord' then 'absinthe'
    when 'absinthe-notes' then 'absinthe'
    when 'absinth' then 'absinthe'
    when 'green-absinthe' then 'absinthe'
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
    when 'sea-salt' then 'salt'
    when 'salt-accord' then 'salt'
    when 'salty' then 'salt'
    when 'salty-notes' then 'salt'
    when 'salted' then 'salt'
    when 'ambergris-accord' then 'ambergris'
    when 'ambergris-notes' then 'ambergris'
    when 'metallic-notes' then 'metallic'
    when 'metallic-accord' then 'metallic'
    when 'metal-note' then 'metallic'
    when 'metal-accord' then 'metallic'
    when 'cold-metal' then 'metallic'
    when 'steel' then 'metallic'
    when 'ozone' then 'ozonic'
    when 'ozonic-notes' then 'ozonic'
    when 'ozonic-accord' then 'ozonic'
    when 'airy-notes' then 'ozonic'
    when 'air-accord' then 'ozonic'
    when 'fresh-air' then 'ozonic'
    when 'rain-accord' then 'rain'
    when 'rain-notes' then 'rain'
    when 'rainwater' then 'rain'
    when 'rain-water' then 'rain'
    when 'wet-pavement' then 'rain'
    when 'wet-air' then 'rain'
    when 'cotton-accord' then 'cotton'
    when 'cotton-notes' then 'cotton'
    when 'clean-cotton' then 'cotton'
    when 'white-cotton' then 'cotton'
    when 'laundry-accord' then 'laundry'
    when 'laundry-notes' then 'laundry'
    when 'fresh-laundry' then 'laundry'
    when 'clean-laundry' then 'laundry'
    when 'laundry-musk' then 'laundry'
    when 'washed-clothes' then 'laundry'
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
