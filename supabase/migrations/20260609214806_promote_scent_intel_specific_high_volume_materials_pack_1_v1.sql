do $$
begin
  if exists (
    select 1
    from public.scent_terms
    where slug in (
      'jasmine',
      'cardamom',
      'geranium',
      'oakmoss',
      'coriander',
      'pineapple',
      'guaiac-wood',
      'ylang-ylang',
      'cypress'
    )
  ) then
    raise exception 'Locked preflight failed: one or more new target slugs already exist.';
  end if;

  if not exists (
    select 1
    from public.scent_terms
    where slug = 'mandarin'
  ) then
    raise exception 'Locked preflight failed: mandarin is missing.';
  end if;

  if exists (
    select 1
    from public.scent_terms
    where slug = 'mandarin-orange'
  ) then
    raise exception 'Locked preflight failed: mandarin-orange already exists.';
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
    'jasmine',
    'Jasmine',
    'material',
    'Floral Material',
    null,
    'Floral Material',
    'Jasmine is a rich floral material used for white-floral body, petal sweetness, and sensual depth.',
    array['White petals', 'sweet floral nectar', 'green stems', 'tea-like softness', 'and slightly animalic warmth'],
    'White florals, floral ambers, musks, tea florals, tropical florals, and polished evening scents.',
    'Adds volume, softness, floral richness, and a more sensual heart.',
    array['White Floral', 'Orange Blossom', 'Neroli', 'Rose', 'Ylang-Ylang', 'Musk', 'Sandalwood', 'Tea', 'Amber', 'Coconut'],
    null,
    'high',
    'verified_primary',
    null
  ),
  (
    'cardamom',
    'Cardamom',
    'material',
    'Spice Material',
    null,
    'Spice Material',
    'Cardamom is a cool-warm spice material used for clean spice, soft sweetness, and aromatic lift.',
    array['Green cardamom pods', 'cool spice', 'soft sweetness', 'lemony lift', 'dry woods', 'and clean warmth'],
    'Fresh spicy openings, tea scents, woods, ambers, musks, and smooth masculine structures.',
    'Adds clean spice, lift, smooth warmth, and a polished aromatic edge.',
    array['Ginger', 'Black Pepper', 'Bergamot', 'Tea', 'Sandalwood', 'Cedar', 'Amber', 'Vanilla', 'Cinnamon', 'Rose'],
    null,
    'high',
    'verified_primary',
    null
  ),
  (
    'geranium',
    'Geranium',
    'material',
    'Floral Material',
    null,
    'Floral Herbal Material',
    'Geranium is a rosy green floral material used for fresh floral lift, herbal bite, and crisp structure.',
    array['Rosy petals', 'green leaves', 'minty freshness', 'peppery floral bite', 'and clean herbal stems'],
    'Rose structures, fougeres, fresh florals, aromatic woods, chypre-style blends, and clean masculine florals.',
    'Adds rosy freshness, green edge, and a crisp floral-herbal backbone.',
    array['Rose', 'Lavender', 'Mint', 'Patchouli', 'Vetiver', 'Citrus', 'Oakmoss', 'Musk', 'Clove', 'Neroli'],
    null,
    'high',
    'verified_primary',
    null
  ),
  (
    'oakmoss',
    'Oakmoss',
    'material',
    'Green Material',
    null,
    'Mossy Green Material',
    'Oakmoss is a mossy green material used for forest-floor depth, dry green structure, and classic chypre texture.',
    array['Damp moss', 'dry bark', 'forest floor', 'green earth', 'soft leather', 'and woody darkness'],
    'Chypre-style scents, fougeres, green florals, mossy woods, leather blends, and classic drydowns.',
    'Adds depth, dryness, mossy texture, and a grounded natural base.',
    array['Bergamot', 'Patchouli', 'Vetiver', 'Geranium', 'Rose', 'Galbanum', 'Leather', 'Earthy', 'Woody', 'Citrus'],
    null,
    'high',
    'verified_secondary',
    null
  ),
  (
    'coriander',
    'Coriander',
    'material',
    'Spice Material',
    null,
    'Spice Material',
    'Coriander is a bright aromatic spice material used for citrusy spice, dry herbal warmth, and clean lift.',
    array['Coriander seed', 'lemony spice', 'dry herbs', 'soft pepper', 'clean woods', 'and faint floral warmth'],
    'Citrus aromatics, fougeres, fresh spicy openings, tea effects, woods, and clean musks.',
    'Adds dry sparkle, herbal spice, and a clean aromatic lift.',
    array['Citrus', 'Cardamom', 'Ginger', 'Lavender', 'Geranium', 'Cedar', 'Vetiver', 'Musk', 'Neroli', 'Black Pepper'],
    null,
    'high',
    'verified_primary',
    null
  ),
  (
    'pineapple',
    'Pineapple',
    'note',
    'Fruit Note',
    null,
    'Fruit Note',
    'Pineapple is a tropical fruit note used for juicy brightness, tart sweetness, and playful fruit lift.',
    array['Pineapple juice', 'ripe tropical fruit', 'tart yellow sweetness', 'green rind', 'and syrupy freshness'],
    'Fruity scents, tropical blends, fresh musks, summer scents, and playful sweet compositions.',
    'Adds bright tropical sweetness, juicy lift, and a more energetic fruity opening.',
    array['Fruity', 'Coconut', 'Mango', 'Citrus', 'Blackcurrant / Cassis', 'Vanilla', 'Musk', 'Amber', 'Cedar', 'Fresh'],
    null,
    'medium',
    'source_light',
    null
  ),
  (
    'guaiac-wood',
    'Guaiac Wood',
    'material',
    'Wood Material',
    null,
    'Wood Material',
    'Guaiac Wood is a dense woody material used for smoky wood, dry warmth, and resinous depth.',
    array['Smoky wood', 'dry timber', 'soft tar', 'warm resin', 'leather-like darkness', 'and subtle spice'],
    'Woody scents, smoky ambers, leathers, tobacco blends, incense, and deep drydowns.',
    'Adds smoky warmth, density, and a darker woody backbone.',
    array['Cedar', 'Sandalwood', 'Vetiver', 'Incense', 'Leather', 'Tobacco', 'Amber', 'Vanilla', 'Patchouli', 'Smoke'],
    null,
    'high',
    'verified_primary',
    null
  ),
  (
    'ylang-ylang',
    'Ylang-Ylang',
    'material',
    'Floral Material',
    null,
    'Floral Material',
    'Ylang-Ylang is a rich yellow floral material used for creamy floral warmth, tropical softness, and sensual floral body.',
    array['Yellow flowers', 'creamy petals', 'soft banana-like sweetness', 'jasmine-like richness', 'and warm floral spice'],
    'White florals, tropical florals, floral ambers, coconut blends, musks, and warm evening scents.',
    'Adds creamy floral volume, tropical warmth, and a soft sensual finish.',
    array['Jasmine', 'Orange Blossom', 'Coconut', 'Vanilla', 'Amber', 'Sandalwood', 'Patchouli', 'Musk', 'Neroli', 'Floral'],
    null,
    'high',
    'verified_primary',
    null
  ),
  (
    'cypress',
    'Cypress',
    'material',
    'Wood Material',
    null,
    'Evergreen Wood Material',
    'Cypress is an evergreen wood material used for dry green wood, conifer freshness, and crisp aromatic structure.',
    array['Cypress needles', 'dry green wood', 'resin', 'cool conifer air', 'smoky bark', 'and clean forest dryness'],
    'Aromatic woods, fougeres, green scents, fresh woods, incense blends, and dry masculine structures.',
    'Adds crisp evergreen structure, dryness, and a clean woody edge.',
    array['Cedar', 'Vetiver', 'Citrus', 'Rosemary', 'Sage', 'Incense', 'Oakmoss', 'Woody', 'Rain', 'Mineral'],
    null,
    'high',
    'verified_secondary',
    null
  );

with target_terms as (
  select id, slug
  from public.scent_terms
  where slug in (
    'jasmine',
    'cardamom',
    'mandarin',
    'geranium',
    'oakmoss',
    'coriander',
    'pineapple',
    'guaiac-wood',
    'ylang-ylang',
    'cypress'
  )
),
term_alias_inputs as (
  select 'jasmine'::text as slug, alias_label
  from unnest(array[
    'jasmine',
    'jasmine absolute',
    'jasmine sambac',
    'jasmine grandiflorum',
    'jasmine flower',
    'jasmine petals'
  ]::text[]) as alias_label
  union all
  select 'cardamom', alias_label
  from unnest(array[
    'cardamom',
    'cardamom seed',
    'cardamom oil',
    'green cardamom'
  ]::text[]) as alias_label
  union all
  select 'mandarin', alias_label
  from unnest(array[
    'mandarin orange',
    'mandarin oranges'
  ]::text[]) as alias_label
  union all
  select 'geranium', alias_label
  from unnest(array[
    'geranium',
    'geranium oil',
    'rose geranium',
    'geranium leaf'
  ]::text[]) as alias_label
  union all
  select 'oakmoss', alias_label
  from unnest(array[
    'oakmoss',
    'oak moss',
    'oakmoss absolute',
    'oak moss absolute'
  ]::text[]) as alias_label
  union all
  select 'coriander', alias_label
  from unnest(array[
    'coriander',
    'coriander seed',
    'coriander oil'
  ]::text[]) as alias_label
  union all
  select 'pineapple', alias_label
  from unnest(array[
    'pineapple',
    'pineapple accord',
    'pineapple note',
    'ripe pineapple',
    'pineapple fruit'
  ]::text[]) as alias_label
  union all
  select 'guaiac-wood', alias_label
  from unnest(array[
    'guaiac wood',
    'guaiacwood',
    'gaiac wood',
    'guaiac wood oil',
    'guaiacwood oil'
  ]::text[]) as alias_label
  union all
  select 'ylang-ylang', alias_label
  from unnest(array[
    'ylang-ylang',
    'ylang ylang',
    'ylang-ylang oil',
    'ylang ylang oil'
  ]::text[]) as alias_label
  union all
  select 'cypress', alias_label
  from unnest(array[
    'cypress',
    'cypress wood',
    'cypress oil',
    'cypress leaf',
    'cypress needles'
  ]::text[]) as alias_label
),
term_aliases as (
  select distinct
    tai.slug,
    public.scent_term_slugify_v1(tai.alias_label) as alias
  from term_alias_inputs tai
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
    when 'mandarin-orange' then 'mandarin'
    when 'mandarin-oranges' then 'mandarin'
    when 'orange-flower' then 'orange-blossom'
    when 'orange-flowers' then 'orange-blossom'
    when 'orange-blossom-absolute' then 'orange-blossom'
    when 'neroli-oil' then 'neroli'
    when 'neroli-essence' then 'neroli'
    when 'petitgrain-oil' then 'petitgrain'
    when 'petit-grain' then 'petitgrain'
    when 'petitgrain-bigarade' then 'petitgrain'
    when 'beeswax' then 'honey'
    when 'jasmine-absolute' then 'jasmine'
    when 'jasmine-sambac' then 'jasmine'
    when 'jasmine-grandiflorum' then 'jasmine'
    when 'jasmine-flower' then 'jasmine'
    when 'jasmine-petals' then 'jasmine'
    when 'cardamom-seed' then 'cardamom'
    when 'cardamom-oil' then 'cardamom'
    when 'green-cardamom' then 'cardamom'
    when 'geranium-oil' then 'geranium'
    when 'rose-geranium' then 'geranium'
    when 'geranium-leaf' then 'geranium'
    when 'oak-moss' then 'oakmoss'
    when 'oakmoss-absolute' then 'oakmoss'
    when 'oak-moss-absolute' then 'oakmoss'
    when 'coriander-seed' then 'coriander'
    when 'coriander-oil' then 'coriander'
    when 'pineapple-accord' then 'pineapple'
    when 'pineapple-note' then 'pineapple'
    when 'ripe-pineapple' then 'pineapple'
    when 'pineapple-fruit' then 'pineapple'
    when 'guaiacwood' then 'guaiac-wood'
    when 'gaiac-wood' then 'guaiac-wood'
    when 'guaiac-wood-oil' then 'guaiac-wood'
    when 'guaiacwood-oil' then 'guaiac-wood'
    when 'ylang-ylang-oil' then 'ylang-ylang'
    when 'cypress-wood' then 'cypress'
    when 'cypress-oil' then 'cypress'
    when 'cypress-leaf' then 'cypress'
    when 'cypress-needles' then 'cypress'
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
    when 'sweet-notes' then 'sweet'
    when 'sweet-accord' then 'sweet'
    when 'sweetness' then 'sweet'
    when 'citrus-notes' then 'citrus'
    when 'citrus-accord' then 'citrus'
    when 'citruses' then 'citrus'
    when 'fruity-notes' then 'fruity'
    when 'fruity-accord' then 'fruity'
    when 'fruit-notes' then 'fruity'
    when 'fruit-accord' then 'fruity'
    when 'fresh-notes' then 'fresh'
    when 'fresh-accord' then 'fresh'
    when 'freshness' then 'fresh'
    when 'floral-notes' then 'floral'
    when 'floral-accord' then 'floral'
    when 'flowers' then 'floral'
    when 'white-florals' then 'white-floral'
    when 'white-flowers' then 'white-floral'
    when 'white-flower' then 'white-floral'
    when 'earthy-notes' then 'earthy'
    when 'earthy-accord' then 'earthy'
    when 'earth-notes' then 'earthy'
    when 'earth-accord' then 'earthy'
    when 'woody-notes' then 'woody'
    when 'wood-notes' then 'woody'
    when 'woods' then 'woody'
    when 'woody-accord' then 'woody'
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
