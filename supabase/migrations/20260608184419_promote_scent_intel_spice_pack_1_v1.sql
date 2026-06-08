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
    'clove',
    'Clove',
    'material',
    'Spice Material',
    'spicy-warm',
    'Spice Material',
    'Clove is a powerful warm spice material used for spicy heat, dark floral warmth, and classic aromatic depth.',
    array['Warm clove bud', 'dry spice', 'sweet heat', 'carnation-like spice', 'and a faint medicinal edge'],
    'Spicy florals, carnation effects, ambers, tobacco blends, woods, and vintage-style warmth.',
    'Adds heat, bite, richness, and old-school spicy depth.',
    array['Rose', 'Orange', 'Cinnamon', 'Sandalwood', 'Vanilla', 'Patchouli', 'Ylang-Ylang', 'Musk', 'Benzoin', 'Nutmeg'],
    null,
    'high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Clove as a spice material with classic warm depth.'
  ),
  (
    'nutmeg',
    'Nutmeg',
    'material',
    'Spice Material',
    'spicy-warm',
    'Spice Material',
    'Nutmeg is a warm seed spice material used for dry aromatic warmth and woody-spicy depth.',
    array['Fresh-grated nutmeg', 'dry wood', 'soft spice', 'faint pepper', 'clove warmth', 'and a subtle cooling edge'],
    'Spicy woods, ambers, aromatic blends, fougeres, and soft gourmand warmth.',
    'Adds textured warmth and dryness without the sharper bite of clove or pepper.',
    array['Sandalwood', 'Cedar', 'Cinnamon', 'Clove', 'Vanilla', 'Orange', 'Cardamom', 'Amber', 'Vetiver', 'Tobacco'],
    null,
    'high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Nutmeg as a warm spice material distinct from mace.'
  ),
  (
    'ginger',
    'Ginger',
    'material',
    'Spice Material',
    'citrus-aromatic',
    'Spice Material',
    'Ginger is a fresh spice note from the rhizome, used for bright heat and citrus-like sparkle.',
    array['Fresh-cut ginger', 'lemon-zest heat', 'clean spice', 'dry warmth', 'and slight sweetness'],
    'Fresh spicy openings, citrus woods, tea effects, aromatic blends, and energizing florals.',
    'Adds motion, brightness, and clean heat without heaviness.',
    array['Bergamot', 'Mandarin', 'Cardamom', 'Vetiver', 'Sandalwood', 'Rose', 'Honey', 'Black Tea', 'Pink Pepper', 'Musk'],
    null,
    'high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Ginger as a fresh spice material with bright heat.'
  ),
  (
    'pink-pepper',
    'Pink Pepper',
    'material',
    'Spice Material',
    'citrus-aromatic',
    'Spice Material',
    'Pink pepper is a bright spice material from pink peppercorn berries. It is fresher, rosier, and lighter than black pepper.',
    array['Crushed pink berries', 'fresh spice', 'rosy lift', 'light citrus', 'and clean woody sparkle'],
    'Modern openings, fresh woods, bright florals, citrus blends, and airy spicy contrast.',
    'Adds sparkle, color, and spicy freshness without much weight.',
    array['Rose', 'Bergamot', 'Grapefruit', 'Cedar', 'Vanilla', 'Incense', 'Vetiver', 'Musk', 'Sage', 'Pear'],
    null,
    'high',
    'verified_primary',
    'Approved Odara Scent Intel copy for Pink Pepper as a bright spice material distinct from black pepper.'
  ),
  (
    'black-pepper',
    'Black Pepper',
    'material',
    'Spice Material',
    'citrus-aromatic',
    'Spice Material',
    'Black pepper is a dry, fresh spice material used for crisp heat, woody bite, and top-note tension.',
    array['Fresh-cracked pepper', 'dry spice', 'woody bite', 'green edges', 'pine-like freshness', 'and faint citrus peel'],
    'Fresh spicy openings, woody aromatics, sharper florals, amber contrasts, and modern masculine styles.',
    'Adds brightness, dryness, tension, and a crisp animated texture.',
    array['Bergamot', 'Clary Sage', 'Lavender', 'Vetiver', 'Sandalwood', 'Pink Pepper', 'Rosemary', 'Cedar', 'Incense', 'Cardamom'],
    null,
    'high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Black Pepper as a fresh spice material distinct from pink pepper.'
  ),
  (
    'anise-licorice',
    'Anise / Licorice',
    'material',
    'Spice Material',
    'sweet-gourmand',
    'Spice Material / Sweet Aromatic Effect',
    'Anise / Licorice is a sweet aromatic spice effect used for licorice-like sweetness, herbal coolness, and distinctive contrast.',
    array['Black licorice', 'aniseed', 'fennel', 'sweet herbs', 'soft spice', 'and a cooling aromatic edge'],
    'Gourmand spices, herbal twists, tobacco blends, dark sweetness, and unusual aromatic accents.',
    'Adds anisic sweetness, cool-warm contrast, and a more distinctive aromatic signature.',
    array['Vanilla', 'Lavender', 'Tonka', 'Bergamot', 'Orange', 'Violet', 'Cedar', 'Musk', 'Cinnamon', 'Chocolate / Cacao'],
    null,
    'medium',
    'verified_secondary',
    'Approved Odara Scent Intel copy for Anise / Licorice as a shared anisic sweet aromatic spice effect.'
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
    'clove',
    'nutmeg',
    'ginger',
    'pink-pepper',
    'black-pepper',
    'anise-licorice'
  )
),
term_aliases as (
  select 'clove'::text as slug, alias
  from unnest(array[
    'clove',
    'cloves',
    'clove-bud',
    'clove-leaf'
  ]::text[]) as alias
  union all
  select 'nutmeg', alias
  from unnest(array[
    'nutmeg',
    'nutmeg-seed'
  ]::text[]) as alias
  union all
  select 'ginger', alias
  from unnest(array[
    'ginger',
    'ginger-root',
    'fresh-ginger'
  ]::text[]) as alias
  union all
  select 'pink-pepper', alias
  from unnest(array[
    'pink-pepper',
    'pink-peppercorn',
    'pink-peppercorns',
    'pink-berries',
    'baies-roses'
  ]::text[]) as alias
  union all
  select 'black-pepper', alias
  from unnest(array[
    'black-pepper',
    'pepper',
    'cracked-pepper',
    'black-peppercorn',
    'black-peppercorns'
  ]::text[]) as alias
  union all
  select 'anise-licorice', alias
  from unnest(array[
    'anise',
    'aniseed',
    'star-anise',
    'licorice',
    'liquorice'
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
