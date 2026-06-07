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
    'cinnamon',
    'Cinnamon',
    'material',
    'Spice Material',
    'spicy-warm',
    'Spice Material',
    'Cinnamon is a warm spice material used for sweet heat, dry bark warmth, and cozy spicy depth.',
    array['Dry cinnamon bark', 'sweet spice', 'gentle heat', 'clove-like warmth', 'and soft woods'],
    'Adding warmth to ambers, gourmands, tobacco blends, citrus spice, and woody compositions.',
    'Makes a fragrance feel warmer, sweeter, spicier, and more enveloping.',
    array['Orange', 'Vanilla', 'Clove', 'Tonka', 'Apple', 'Nutmeg', 'Sandalwood', 'Benzoin', 'Cardamom', 'Tobacco'],
    null,
    'high',
    'verified_secondary',
    'Approved Odara Scent Intel copy for cinnamon as a warm spice material. Keep the user-facing explanation focused on smell and function rather than extraction chemistry.'
  ),
  (
    'balsamic',
    'Balsamic',
    'accord',
    'Resinous Scent Effect',
    'oud-amber',
    'Scent Blend',
    'Balsamic is a warm resinous scent effect built around soft resins, balsams, vanilla-like sweetness, and ambered depth.',
    array['Warm resin', 'sweet balsam', 'vanilla warmth', 'soft woods', 'honeyed depth', 'and gentle powder'],
    'Softening ambers, resins, woods, incense, vanilla, and powdery compositions.',
    'Makes a fragrance feel smoother, warmer, rounder, and more cushioned.',
    array['Benzoin', 'Labdanum', 'Vanilla', 'Amber', 'Tonka', 'Incense', 'Sandalwood', 'Myrrh'],
    null,
    'medium',
    'source_light',
    'Approved Odara Scent Intel copy for balsamic as a broad resinous scent effect. Do not describe it as one raw material.'
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
  odara_read = coalesce(public.scent_terms.odara_read, excluded.odara_read),
  confidence = excluded.confidence,
  source_status = excluded.source_status,
  source_note = excluded.source_note,
  updated_at = now();

with target_terms as (
  select id, slug
  from public.scent_terms
  where slug in ('cinnamon', 'balsamic', 'aldehydic')
),
term_aliases as (
  select 'cinnamon'::text as slug, alias
  from unnest(array['cinnamon', 'cinnamon-bark', 'cinnamon-spice']::text[]) as alias
  union all
  select 'balsamic', alias
  from unnest(array['balsamic', 'balsam', 'balsams']::text[]) as alias
  union all
  select 'aldehydic', alias
  from unnest(array['aldehydic', 'aldehydes', 'aldehyde', 'aldehydic-notes', 'aldehydic-note']::text[]) as alias
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
