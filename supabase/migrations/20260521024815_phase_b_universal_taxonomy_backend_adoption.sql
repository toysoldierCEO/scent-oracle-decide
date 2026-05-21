insert into public.family_key_reference_v1 (
  family_key,
  display_label,
  universal_equivalent,
  definition,
  qualifies_when,
  disqualifies_when,
  examples,
  active
)
values
  (
    'woody-clean',
    'Woody / Clean',
    'woody',
    'Legacy compatibility family retained for current Odara surfaces. Universal family resolves to woody; clean behaves as a supporting facet, not a separate primary family.',
    'Use when woods, musks, aromatic lift, or airy woody structure dominate the lasting profile.',
    'Do not use for dense amber-oriental, leather-dominant, gourmand-dominant, or clearly aquatic structures.',
    '["Bleu Mémoire L’Exclusif","Sugi Noir","Ghostbusters","Tea Rainfall"]'::jsonb,
    true
  ),
  (
    'oud-amber',
    'Oud / Amber',
    'amber-oriental',
    'Legacy compatibility family retained for current Odara surfaces. Universal family resolves to amber-oriental; this key does not require literal oud and may cover resinous, spicy, or oriental structures.',
    'Use when amber, resin, warm woods, cypriol, or oriental depth dominate the heart/base.',
    'Do not use for clean woods, bright citrus-cologne builds, or marine-fresh structures.',
    '["Blue Turquoise"]'::jsonb,
    true
  ),
  (
    'sweet-gourmand',
    'Sweet / Gourmand',
    'gourmand',
    'Legacy compatibility family retained for sweet edible structures. Universal family resolves to gourmand.',
    'Use when vanilla, pastry, syrup, confection, or edible sweetness dominates.',
    'Do not use when sweetness is only supportive and the main structure is woody, amber, or fresh.',
    '["Apple Crumb","Black Origami"]'::jsonb,
    true
  ),
  (
    'citrus-cologne',
    'Citrus / Cologne',
    'citrus-cologne',
    'Legacy family already aligns closely with the universal citrus-cologne lane, including classical hesperidic and aromatic-cologne structures.',
    'Use when citrus and aromatic lift are the main structural signal.',
    'Do not use for dense amber, leather, or marine-resin structures.',
    '["Cairo Summer","Sparkling Bergamot","Turin 21"]'::jsonb,
    true
  ),
  (
    'dark-leather',
    'Dark / Leather',
    'leather',
    'Legacy compatibility family retained for leather-dominant dark structures. Universal family resolves to leather.',
    'Use when leather, smoke, tar, or darker animalic structure dominates.',
    'Do not use for amber without leather or for airy woody florals.',
    '[]'::jsonb,
    true
  ),
  (
    'fresh-blue',
    'Fresh / Blue',
    'fresh-aquatic',
    'Legacy compatibility family retained for current Odara surfaces. Universal family resolves to fresh-aquatic; “blue” here is a modern aesthetic shorthand, not a classical family term.',
    'Use when marine, aquatic, ozonic, salty, or fresh-air structure dominates the heart/base.',
    'Do not use when aquatic freshness is only a top accent and the core remains amber-oriental or woody.',
    '["Smooth Sailing"]'::jsonb,
    true
  ),
  (
    'tobacco-boozy',
    'Tobacco / Boozy',
    'amber-oriental',
    'Legacy compatibility family retained for current Odara surfaces. Tobacco and boozy are usually facets layered over amber, woody, or leather structures; universal family resolves conservatively to amber-oriental for read-model use.',
    'Use when tobacco and boozy facets dominate a warm amber, woody, or leathery structure.',
    'Do not use when tobacco or boozy character is only a brief top-note accent.',
    '[]'::jsonb,
    true
  )
on conflict (family_key) do update
set
  display_label = excluded.display_label,
  universal_equivalent = excluded.universal_equivalent,
  definition = excluded.definition,
  qualifies_when = excluded.qualifies_when,
  disqualifies_when = excluded.disqualifies_when,
  examples = excluded.examples,
  active = excluded.active,
  updated_at = now();

create or replace view public.fragrance_taxonomy_resolved_v1 as
with facet_rows as (
  select
    ff.fragrance_id,
    jsonb_agg(
      jsonb_build_object(
        'facet_key', ff.facet_key,
        'display_label', fkr.display_label,
        'confidence', ff.confidence,
        'evidence_source', ff.evidence_source
      )
      order by ff.confidence desc nulls last, ff.facet_key
    ) as facet_tags
  from public.fragrance_facets_v1 ff
  join public.facet_key_reference_v1 fkr
    on fkr.facet_key = ff.facet_key
   and fkr.active
  group by ff.fragrance_id
),
role_rows as (
  select
    fr.fragrance_id,
    jsonb_agg(
      jsonb_build_object(
        'role_key', fr.role_key,
        'display_label', wrr.display_label,
        'role_priority', fr.role_priority,
        'confidence', fr.confidence,
        'evidence_source', fr.evidence_source
      )
      order by fr.role_priority, fr.role_key
    ) as wardrobe_roles
  from public.fragrance_wardrobe_roles_v1 fr
  join public.wardrobe_role_reference_v1 wrr
    on wrr.role_key = fr.role_key
   and wrr.active
  group by fr.fragrance_id
)
select
  f.id as fragrance_id,
  f.name,
  f.brand,
  f.family_key as legacy_family_key,
  coalesce(
    fkr.display_label,
    fk.label,
    case when f.family_key is not null then initcap(replace(f.family_key, '-', ' ')) end
  ) as legacy_family_label,
  uv.universal_family_key,
  uv.universal_family_label,
  coalesce(
    uv.universal_family_label,
    fkr.display_label,
    fk.label,
    case when f.family_key is not null then initcap(replace(f.family_key, '-', ' ')) end
  ) as family_display_label,
  coalesce(
    ftr.confidence,
    case
      when f.family_key is not null and uv.universal_family_key is not null then 0.55
      else null
    end
  ) as family_confidence,
  coalesce(
    ftr.review_status,
    case
      when f.family_key is not null and uv.universal_family_key is not null then 'medium_confidence'
      else null
    end
  ) as review_status,
  coalesce(frw.facet_tags, '[]'::jsonb) as facet_tags,
  coalesce(rrw.wardrobe_roles, '[]'::jsonb) as wardrobe_roles,
  jsonb_strip_nulls(
    jsonb_build_object(
      'evidence_source',
        coalesce(
          ftr.evidence_source,
          case
            when f.family_key is not null and fkr.family_key is not null then 'family_key_reference_v1 compatibility mapping'
            else null
          end
        ),
      'official_source_url',
        coalesce(ftr.evidence_json->>'official_source_url', f.source_url),
      'official_source_confidence',
        coalesce(ftr.evidence_json->>'official_source_confidence', f.source_confidence),
      'source_excerpt',
        ftr.evidence_json->>'official_source_excerpt',
      'compatibility_assignment',
        case
          when ftr.evidence_json ? 'compatibility_assignment' then ftr.evidence_json->'compatibility_assignment'
          when f.family_key is not null and fkr.family_key is not null then to_jsonb(true)
          else null
        end,
      'compatibility_note',
        coalesce(
          ftr.evidence_json->>'compatibility_note',
          case f.family_key
            when 'oud-amber' then 'Legacy oud-amber key is preserved for compatibility; universal family resolves to amber-oriental and does not imply literal oud.'
            when 'fresh-blue' then 'Legacy fresh-blue key is preserved for compatibility; universal family resolves to fresh-aquatic.'
            when 'tobacco-boozy' then 'Legacy tobacco-boozy key is preserved for compatibility; tobacco and boozy behave primarily as facets.'
            when 'woody-clean' then 'Legacy woody-clean key is preserved for compatibility; clean behaves as a facet while universal family resolves to woody.'
            else null
          end
        ),
      'literal_oud_claim',
        case
          when ftr.evidence_json ? 'literal_oud_claim' then ftr.evidence_json->'literal_oud_claim'
          else to_jsonb(false)
        end,
      'accord_tags',
        coalesce(ftr.evidence_json->'accord_tags', '[]'::jsonb),
      'reference_definition',
        fkr.definition,
      'reviewed_by',
        ftr.reviewed_by
    )
  ) as evidence_summary,
  coalesce(ftr.evidence_json->>'official_source_url', f.source_url) as source_url,
  f.updated_at,
  coalesce(ftr.updated_at, f.updated_at) as reviewed_at
from public.fragrances f
left join public.family_keys fk
  on fk.family_key = f.family_key
left join public.family_key_reference_v1 fkr
  on fkr.family_key = f.family_key
 and fkr.active
left join public.fragrance_taxonomy_review_v1 ftr
  on ftr.fragrance_id = f.id
left join facet_rows frw
  on frw.fragrance_id = f.id
left join role_rows rrw
  on rrw.fragrance_id = f.id
left join lateral (
  select
    coalesce(ftr.universal_equivalent, fkr.universal_equivalent) as universal_family_key,
    case coalesce(ftr.universal_equivalent, fkr.universal_equivalent)
      when 'woody' then 'Woody'
      when 'amber-oriental' then 'Amber / Oriental'
      when 'gourmand' then 'Gourmand'
      when 'citrus-cologne' then 'Citrus Cologne'
      when 'leather' then 'Leather'
      when 'fresh-aquatic' then 'Fresh Aquatic'
      else case
        when coalesce(ftr.universal_equivalent, fkr.universal_equivalent) is not null
        then initcap(replace(coalesce(ftr.universal_equivalent, fkr.universal_equivalent), '-', ' '))
        else null
      end
    end as universal_family_label
) uv on true;

revoke all on table public.fragrance_taxonomy_resolved_v1 from public;
revoke all on table public.fragrance_taxonomy_resolved_v1 from anon;
revoke all on table public.fragrance_taxonomy_resolved_v1 from authenticated;
grant select on table public.fragrance_taxonomy_resolved_v1 to service_role;

create or replace function public.get_fragrance_taxonomy_profile_v1(p_fragrance_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_fragrance_id is null then
    raise exception 'p_fragrance_id is required.';
  end if;

  return (
    select
      case
        when not exists (
          select 1
          from public.fragrance_taxonomy_resolved_v1 tx
          where tx.fragrance_id = p_fragrance_id
        ) then jsonb_build_object(
          'found', false,
          'error', 'Fragrance taxonomy not found.'
        )
        else (
          select jsonb_build_object(
            'found', true,
            'fragrance_id', tx.fragrance_id,
            'name', tx.name,
            'brand', tx.brand,
            'legacy_family_key', tx.legacy_family_key,
            'legacy_family_label', tx.legacy_family_label,
            'universal_family_key', tx.universal_family_key,
            'universal_family_label', tx.universal_family_label,
            'family_display_label', tx.family_display_label,
            'family_confidence', tx.family_confidence,
            'review_status', tx.review_status,
            'facet_tags', tx.facet_tags,
            'wardrobe_roles', tx.wardrobe_roles,
            'evidence_summary', tx.evidence_summary,
            'source_url', tx.source_url,
            'updated_at', tx.updated_at,
            'reviewed_at', tx.reviewed_at
          )
          from public.fragrance_taxonomy_resolved_v1 tx
          where tx.fragrance_id = p_fragrance_id
          limit 1
        )
      end
  );
end;
$function$;

create or replace function public.get_user_collection_taxonomy_v1(p_user uuid default null::uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_user_id uuid := coalesce(p_user, v_auth_user);
begin
  if v_user_id is null then
    raise exception 'Signed-in collection taxonomy requires p_user or auth.uid().';
  end if;

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and v_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user must match auth.uid().';
  end if;

  return (
    with collection as (
      select
        item.representative_fragrance_id as fragrance_id,
        coalesce(item.representative_name, f.name) as name,
        coalesce(item.representative_brand, f.brand) as brand,
        case
          when item.has_signature or item.effective_status = 'signature' then 'signature'
          else 'owned'
        end as collection_status
      from public.user_collection_effective_items_v2 item
      left join public.fragrances f
        on f.id = item.representative_fragrance_id
      where item.user_id = v_user_id
        and (item.has_owned or item.has_signature)
    ),
    ratings as (
      select fragrance_id, rating
      from public.user_fragrance_ratings_v1
      where user_id = v_user_id
        and rating_source = 'collection'
        and rating_context = 'solo'
    ),
    retired as (
      select fragrance_id, true as retired
      from public.user_fragrance_retirement_preferences_v1
      where user_id = v_user_id
    ),
    items as (
      select
        c.fragrance_id,
        c.name,
        c.brand,
        c.collection_status,
        r.rating,
        coalesce(rt.retired, false) as retired,
        tx.legacy_family_key,
        tx.legacy_family_label,
        tx.universal_family_key,
        tx.universal_family_label,
        tx.family_display_label,
        tx.family_confidence,
        tx.review_status,
        tx.facet_tags,
        tx.wardrobe_roles,
        tx.evidence_summary,
        tx.source_url,
        tx.updated_at,
        tx.reviewed_at
      from collection c
      left join ratings r
        on r.fragrance_id = c.fragrance_id
      left join retired rt
        on rt.fragrance_id = c.fragrance_id
      left join public.fragrance_taxonomy_resolved_v1 tx
        on tx.fragrance_id = c.fragrance_id
    )
    select jsonb_build_object(
      'taxonomy_contract_version', 'collection_taxonomy_v1',
      'surface_type', 'signed_in',
      'visible_count', (select count(*) from items),
      'classified_count', (select count(*) from items where legacy_family_key is not null),
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'fragrance_id', i.fragrance_id,
              'name', i.name,
              'brand', i.brand,
              'collection_status', i.collection_status,
              'rating', i.rating,
              'retired', i.retired,
              'taxonomy', jsonb_build_object(
                'legacy_family_key', i.legacy_family_key,
                'legacy_family_label', i.legacy_family_label,
                'universal_family_key', i.universal_family_key,
                'universal_family_label', i.universal_family_label,
                'family_display_label', i.family_display_label,
                'confidence', i.family_confidence,
                'review_status', i.review_status,
                'facets', i.facet_tags,
                'wardrobe_roles', i.wardrobe_roles,
                'evidence_summary', i.evidence_summary,
                'source_url', i.source_url,
                'updated_at', i.updated_at,
                'reviewed_at', i.reviewed_at
              )
            )
            order by lower(coalesce(i.brand, '')), lower(coalesce(i.name, '')), i.fragrance_id
          )
          from items i
        ),
        '[]'::jsonb
      )
    )
  );
end;
$function$;

create or replace function public.get_user_dossier_taxonomy_v1(p_user uuid default null::uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_user_id uuid := coalesce(p_user, v_auth_user);
begin
  if v_user_id is null then
    raise exception 'Signed-in dossier taxonomy requires p_user or auth.uid().';
  end if;

  if not (
    auth.role() = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and v_user_id = v_auth_user)
  ) then
    raise exception 'Access denied: p_user must match auth.uid().';
  end if;

  return (
    with collection as (
      select distinct
        item.representative_fragrance_id as fragrance_id
      from public.user_collection_effective_items_v2 item
      where item.user_id = v_user_id
        and (item.has_owned or item.has_signature)
    ),
    taxonomy as (
      select tx.*
      from collection c
      join public.fragrance_taxonomy_resolved_v1 tx
        on tx.fragrance_id = c.fragrance_id
    ),
    counts as (
      select
        count(*) as visible_count,
        count(*) filter (where legacy_family_key is not null) as legacy_classified_count,
        count(*) filter (where universal_family_key is not null) as universal_classified_count
      from taxonomy
    ),
    legacy_counts as (
      select
        legacy_family_key as family_key,
        legacy_family_label as label,
        count(*) as cnt
      from taxonomy
      where legacy_family_key is not null
      group by 1, 2
    ),
    universal_counts as (
      select
        universal_family_key as family_key,
        universal_family_label as label,
        count(*) as cnt
      from taxonomy
      where universal_family_key is not null
      group by 1, 2
    ),
    facet_counts as (
      select
        fr.value->>'facet_key' as facet_key,
        fr.value->>'display_label' as label,
        count(*) as cnt
      from taxonomy t
      cross join lateral jsonb_array_elements(t.facet_tags) as fr(value)
      group by 1, 2
    ),
    role_counts as (
      select
        rr.value->>'role_key' as role_key,
        rr.value->>'display_label' as label,
        count(*) as cnt
      from taxonomy t
      cross join lateral jsonb_array_elements(t.wardrobe_roles) as rr(value)
      group by 1, 2
    )
    select jsonb_build_object(
      'taxonomy_contract_version', 'dossier_taxonomy_v1',
      'surface_type', 'signed_in',
      'visible_count', coalesce((select visible_count from counts), 0),
      'legacy_classified_count', coalesce((select legacy_classified_count from counts), 0),
      'universal_classified_count', coalesce((select universal_classified_count from counts), 0),
      'legacy_family_counts', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'family_key', lc.family_key,
              'label', lc.label,
              'count', lc.cnt,
              'pct', case
                when (select legacy_classified_count from counts) > 0
                then round((lc.cnt::numeric / (select legacy_classified_count from counts)::numeric) * 100.0)
                else 0
              end
            )
            order by lc.cnt desc, lc.family_key
          )
          from legacy_counts lc
        ),
        '[]'::jsonb
      ),
      'legacy_family_segment_sum', coalesce((select sum(cnt) from legacy_counts), 0),
      'universal_family_counts', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'family_key', uc.family_key,
              'label', uc.label,
              'count', uc.cnt,
              'pct', case
                when (select universal_classified_count from counts) > 0
                then round((uc.cnt::numeric / (select universal_classified_count from counts)::numeric) * 100.0)
                else 0
              end
            )
            order by uc.cnt desc, uc.family_key
          )
          from universal_counts uc
        ),
        '[]'::jsonb
      ),
      'universal_family_segment_sum', coalesce((select sum(cnt) from universal_counts), 0),
      'facet_summary', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'facet_key', fc.facet_key,
              'label', fc.label,
              'count', fc.cnt
            )
            order by fc.cnt desc, fc.facet_key
          )
          from facet_counts fc
        ),
        '[]'::jsonb
      ),
      'wardrobe_role_summary', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'role_key', rc.role_key,
              'label', rc.label,
              'count', rc.cnt
            )
            order by rc.cnt desc, rc.role_key
          )
          from role_counts rc
        ),
        '[]'::jsonb
      )
    )
  );
end;
$function$;

revoke all on function public.get_fragrance_taxonomy_profile_v1(uuid) from public;
revoke all on function public.get_fragrance_taxonomy_profile_v1(uuid) from anon;
revoke all on function public.get_fragrance_taxonomy_profile_v1(uuid) from authenticated;
grant execute on function public.get_fragrance_taxonomy_profile_v1(uuid) to authenticated;
grant execute on function public.get_fragrance_taxonomy_profile_v1(uuid) to service_role;

revoke all on function public.get_user_collection_taxonomy_v1(uuid) from public;
revoke all on function public.get_user_collection_taxonomy_v1(uuid) from anon;
revoke all on function public.get_user_collection_taxonomy_v1(uuid) from authenticated;
grant execute on function public.get_user_collection_taxonomy_v1(uuid) to authenticated;
grant execute on function public.get_user_collection_taxonomy_v1(uuid) to service_role;

revoke all on function public.get_user_dossier_taxonomy_v1(uuid) from public;
revoke all on function public.get_user_dossier_taxonomy_v1(uuid) from anon;
revoke all on function public.get_user_dossier_taxonomy_v1(uuid) from authenticated;
grant execute on function public.get_user_dossier_taxonomy_v1(uuid) to authenticated;
grant execute on function public.get_user_dossier_taxonomy_v1(uuid) to service_role;
