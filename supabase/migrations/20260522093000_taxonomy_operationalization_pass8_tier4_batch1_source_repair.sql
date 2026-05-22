-- Taxonomy Operationalization Pass 8: Tier 4 Batch 1 source-gap and contaminated-data repair
-- Controlled Batch 1 only. Exact official-source repair plus taxonomy assignment for 11 rows.

begin;

create temporary table pg_temp.pass8_payload (
  fragrance_id uuid primary key,
  name text not null,
  brand text not null,
  blocker_type text not null,
  legacy_family_key text not null,
  universal_family_key text not null,
  source_url text not null,
  source_confidence numeric(4,2) not null,
  notes text[] not null,
  accords text[] not null,
  top_notes text[] not null,
  heart_notes text[] not null,
  base_notes text[] not null,
  facet_keys text[] not null,
  role_rows jsonb not null,
  confidence numeric(4,2) not null,
  review_status text not null,
  source_summary text not null
) on commit drop;

insert into pg_temp.pass8_payload (
  fragrance_id,
  name,
  brand,
  blocker_type,
  legacy_family_key,
  universal_family_key,
  source_url,
  source_confidence,
  notes,
  accords,
  top_notes,
  heart_notes,
  base_notes,
  facet_keys,
  role_rows,
  confidence,
  review_status,
  source_summary
)
values
  (
    'ef106c78-4ed2-4a57-8337-ce3c1dec5cc8'::uuid,
    'A Private Man',
    'Alexandria Fragrances',
    'contaminated_data',
    'woody-clean',
    'woody',
    'https://alexandriafragrances.com/products/a-private-man',
    0.99,
    array['Black Leather', 'Whiskey', 'Tonka Bean', 'Cardamom', 'Benzoin', 'Lavender', 'Woody Notes', 'Grapefruit', 'Pomelo', 'Red Thyme', 'Sage']::text[],
    array['leather', 'boozy', 'spicy', 'powdery', 'woody', 'citrus', 'aromatic']::text[],
    array[]::text[],
    array[]::text[],
    array[]::text[],
    array['leather', 'boozy', 'spicy', 'powdery', 'woody', 'citrus', 'aromatic']::text[],
    '[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}]'::jsonb,
    0.82,
    'confirmed',
    'Exact official Alexandria page with explicit leather, whiskey, tonka, cardamom, benzoin, lavender, woods, grapefruit, pomelo, thyme, and sage structure.'
  ),
  (
    'a155cc3e-b891-4f1c-9edb-965bf27d8723'::uuid,
    'Afternoon Splash',
    'Alexandria Fragrances',
    'contaminated_data',
    'citrus-cologne',
    'citrus-cologne',
    'https://alexandriafragrances.com/products/afternoon-splash',
    0.99,
    array['Bergamot', 'Mandarin Orange', 'Sicilian Orange', 'Ambergris', 'Sea Salt']::text[],
    array['citrus', 'fruity', 'marine', 'salty', 'fresh']::text[],
    array['Bergamot', 'Mandarin Orange', 'Sicilian Orange']::text[],
    array[]::text[],
    array['Ambergris', 'Sea Salt']::text[],
    array['citrus', 'fruity', 'marine', 'salty', 'mineral']::text[],
    '[{"role_key":"brightener","role_priority":1},{"role_key":"layer_tool","role_priority":2}]'::jsonb,
    0.78,
    'medium_confidence',
    'Exact official Alexandria page with direct citrus opening and ambergris plus sea-salt drydown structure.'
  ),
  (
    '89134f42-3ed7-40b8-b6ea-5a861476b99f'::uuid,
    'Blue Stallion',
    'Alexandria Fragrances',
    'contaminated_data',
    'fresh-blue',
    'fresh-aquatic',
    'https://alexandriafragrances.com/products/blue-stallion-inspired-by-sedley-pdm',
    0.99,
    array['Geranium Bourbon', 'Lavender Spearmint', 'Bergamot', 'Apple Blossom', 'Mint Leaves', 'Green Verbena Leaf']::text[],
    array['aromatic', 'citrus', 'floral', 'green', 'spicy']::text[],
    array[]::text[],
    array[]::text[],
    array[]::text[],
    array['aromatic', 'citrus', 'floral', 'green', 'spicy']::text[],
    '[{"role_key":"brightener","role_priority":1},{"role_key":"bridge","role_priority":2}]'::jsonb,
    0.80,
    'confirmed',
    'Exact official Alexandria page with geranium, lavender-spearmint, bergamot, apple blossom, mint, and verbena structure.'
  ),
  (
    'f942f5ba-db6f-4327-a3ad-4b96ca7a3254'::uuid,
    'Dirty Neroli',
    'Alexandria Fragrances',
    'contaminated_data',
    'citrus-cologne',
    'citrus-cologne',
    'https://alexandriafragrances.com/products/dirty-neroli',
    0.99,
    array['Neroli', 'Citrus']::text[],
    array['citrus', 'floral', 'fruity']::text[],
    array[]::text[],
    array[]::text[],
    array[]::text[],
    array['citrus', 'floral', 'fruity']::text[],
    '[{"role_key":"brightener","role_priority":1}]'::jsonb,
    0.67,
    'medium_confidence',
    'Exact official Alexandria page describing a sweet neroli and citrus structure.'
  ),
  (
    '2da5f49e-05a6-4d6c-b225-60785184b324'::uuid,
    'Egyptian Angel',
    'Alexandria Fragrances',
    'contaminated_data',
    'sweet-gourmand',
    'gourmand',
    'https://alexandriafragrances.com/products/egyptian-angel',
    0.99,
    array['Virginia Cedar', 'Rum', 'Patchouli', 'Dried Fruits', 'Nutmeg', 'Vanilla', 'Jasmine']::text[],
    array['woody', 'boozy', 'fruity', 'spicy', 'gourmand', 'floral']::text[],
    array[]::text[],
    array['Patchouli', 'Dried Fruits', 'Nutmeg']::text[],
    array['Vanilla', 'Jasmine']::text[],
    array['woody', 'boozy', 'fruity', 'spicy', 'gourmand', 'floral']::text[],
    '[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}]'::jsonb,
    0.77,
    'medium_confidence',
    'Exact official Alexandria page with cedar and rum opening, patchouli-dried-fruit-nutmeg heart, and vanilla-jasmine base.'
  ),
  (
    '2ec8c519-f933-473f-ba72-8b07703e9bd4'::uuid,
    'Egyptian Attitude',
    'Alexandria Fragrances',
    'contaminated_data',
    'oud-amber',
    'amber-oriental',
    'https://alexandriafragrances.com/products/egyptian-attitude',
    0.99,
    array['Coffee', 'Patchouli', 'Sicilian Lemon', 'Amber', 'Lavender', 'Cardamom', 'Resin', 'Chinese Cedar', 'Opoponax']::text[],
    array['amber', 'spicy', 'citrus', 'woody', 'aromatic', 'resin']::text[],
    array[]::text[],
    array[]::text[],
    array[]::text[],
    array['amber', 'spicy', 'citrus', 'woody', 'aromatic', 'resin']::text[],
    '[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}]'::jsonb,
    0.79,
    'medium_confidence',
    'Exact official Alexandria page with coffee, patchouli, Sicilian lemon, amber, resin, lavender, cardamom, cedar, and opoponax structure.'
  ),
  (
    '1e0cbe73-f76b-414c-aa45-4220a191c011'::uuid,
    'Egyptian King',
    'Alexandria Fragrances',
    'contaminated_data',
    'oud-amber',
    'amber-oriental',
    'https://alexandriafragrances.com/products/egyptian-king',
    0.99,
    array['Warm Spices', 'Cleopatra''s Rose', 'Ritual Incense', 'Smooth Sandalwood', 'Smoky Amber']::text[],
    array['spicy', 'floral', 'smoky', 'amber', 'woody', 'powdery']::text[],
    array[]::text[],
    array[]::text[],
    array[]::text[],
    array['spicy', 'floral', 'incense', 'amber', 'woody', 'powdery']::text[],
    '[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}]'::jsonb,
    0.74,
    'medium_confidence',
    'Exact official Alexandria page with warm spices, rose, ritual incense, sandalwood, smoky amber, and powdery support.'
  ),
  (
    '8c86e0d4-de66-440f-8f6d-a42e4a8cd38d'::uuid,
    'Bitter Soft',
    'Alexandria Fragrances',
    'source_gap',
    'woody-clean',
    'woody',
    'https://alexandriafragrances.com/products/bitter-soft',
    0.99,
    array['Thyme', 'Raspberry', 'Leather', 'Birch Tar', 'Amber', 'Jasmine', 'Olibanum', 'Saffron', 'Suede', 'Woody Notes']::text[],
    array['leather', 'fruity', 'smoky', 'spicy', 'amber', 'woody', 'resin']::text[],
    array[]::text[],
    array[]::text[],
    array[]::text[],
    array['leather', 'fruity', 'incense', 'amber', 'spicy', 'woody', 'floral']::text[],
    '[{"role_key":"accent","role_priority":1},{"role_key":"bridge","role_priority":2}]'::jsonb,
    0.82,
    'confirmed',
    'Exact official Alexandria page plus official tags covering thyme, raspberry, leather, birch tar, amber, jasmine, olibanum, saffron, suede, and woods.'
  ),
  (
    'ed5c5034-9029-49e1-84fe-a93a747a2e86'::uuid,
    'Black Panther',
    'Alexandria Fragrances',
    'source_gap',
    'fresh-blue',
    'fresh-aquatic',
    'https://alexandriafragrances.com/products/black-panther',
    0.99,
    array['Grapefruit', 'Ambroxan', 'Musk', 'Woody Notes']::text[],
    array['fresh', 'citrus', 'musky', 'woody']::text[],
    array['Grapefruit']::text[],
    array[]::text[],
    array['Ambroxan', 'Musk', 'Woody Notes']::text[],
    array['citrus', 'musk', 'woody']::text[],
    '[{"role_key":"brightener","role_priority":1},{"role_key":"bridge","role_priority":2}]'::jsonb,
    0.80,
    'confirmed',
    'Exact official Alexandria page with grapefruit opening and ambroxan-musk-woods base structure.'
  ),
  (
    '3332ca07-c61f-4f3e-aa45-ae822ca603df'::uuid,
    'Visionary',
    'Alexandria Fragrances',
    'source_gap',
    'woody-clean',
    'woody',
    'https://alexandriafragrances.com/products/visionary',
    0.99,
    array['Calabrian Bergamot', 'Sicilian Orange', 'Tunisian Neroli', 'Ginger', 'Ceylon Cinnamon', 'Chinese Black Tea', 'Guaiac Wood', 'Ambroxan']::text[],
    array['citrus', 'marine', 'aromatic', 'tea', 'woody', 'spicy']::text[],
    array[]::text[],
    array[]::text[],
    array[]::text[],
    array['citrus', 'marine', 'aromatic', 'tea', 'woody', 'spicy']::text[],
    '[{"role_key":"brightener","role_priority":1},{"role_key":"bridge","role_priority":2}]'::jsonb,
    0.82,
    'confirmed',
    'Exact official Alexandria page listing bergamot, orange, neroli, ginger, cinnamon, black tea, guaiac wood, and ambroxan.'
  ),
  (
    '196018fc-47c4-4acc-bc4f-ac7ecc555011'::uuid,
    'Hafez Gold',
    'Alexandria Fragrances',
    'source_gap',
    'oud-amber',
    'amber-oriental',
    'https://alexandriafragrances.com/products/hafez-gold',
    0.99,
    array['Incense', 'Frankincense', 'Vanilla', 'Cinnamon', 'Sandalwood', 'Amber', 'Royal Spices']::text[],
    array['amber', 'balsamic', 'woody', 'spicy', 'creamy', 'sweet', 'resin']::text[],
    array[]::text[],
    array[]::text[],
    array[]::text[],
    array['amber', 'incense', 'spicy', 'woody', 'creamy', 'gourmand', 'resin']::text[],
    '[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}]'::jsonb,
    0.80,
    'confirmed',
    'Exact official Alexandria page with incense, frankincense, vanilla, cinnamon, sandalwood, amber, and royal-spice structure.'
  );

update public.fragrances f
set
  notes = p.notes,
  accords = p.accords,
  top_notes = case when cardinality(p.top_notes) = 0 then null else p.top_notes end,
  heart_notes = case when cardinality(p.heart_notes) = 0 then null else p.heart_notes end,
  base_notes = case when cardinality(p.base_notes) = 0 then null else p.base_notes end,
  data_source = 'alexandria_official',
  source_url = p.source_url,
  source_confidence = p.source_confidence,
  enriched_at = now(),
  updated_at = now()
from pg_temp.pass8_payload p
where f.id = p.fragrance_id;

insert into public.fragrance_text_enrichment (
  fragrance_id,
  provider,
  status,
  source_url,
  source_confidence,
  match_name,
  match_brand,
  proposed_family_key,
  concentration,
  notes,
  accords,
  provider_payload,
  last_error,
  last_enriched_at,
  updated_at
)
select
  p.fragrance_id,
  'alexandria_official',
  'already_enriched',
  p.source_url,
  p.source_confidence,
  p.name,
  p.brand,
  null,
  coalesce(f.concentration, 'UNKNOWN'),
  p.notes,
  p.accords,
  jsonb_build_object(
    'top_notes', p.top_notes,
    'heart_notes', p.heart_notes,
    'base_notes', p.base_notes,
    'source_name', p.name,
    'source_brand', p.brand,
    'blocker_type', p.blocker_type,
    'import_batch', 'taxonomy_operationalization_pass8_tier4_batch1_source_repair_2026_05_22',
    'source_evidence', jsonb_build_object(
      'official_source_url', p.source_url,
      'official_source_summary', p.source_summary,
      'official_source_confidence', p.source_confidence,
      'contamination_repair',
        case
          when p.blocker_type = 'contaminated_data' then jsonb_build_object(
            'issue', 'Existing canonical notes or accords contained prose fragments, placeholders, SEO copy, or malformed text that could not be used as taxonomy evidence.',
            'action', 'Replaced contaminated scent structure with clean official-source-backed notes and accords from the exact Alexandria product page.',
            'repaired', true
          )
          else null
        end,
      'source_gap_closure',
        case
          when p.blocker_type = 'source_gap' then jsonb_build_object(
            'issue', 'No usable canonical notes, accords, pyramid, or source metadata existed before this pass.',
            'action', 'Closed the source gap using the exact official Alexandria product page for this fragrance.',
            'repaired', true
          )
          else null
        end
    ),
    'extraction_method', 'manual_official_product_page_review',
    'identity_match_status', 'exact_official_product_page',
    'official_source_import', true
  ),
  null,
  now(),
  now()
from pg_temp.pass8_payload p
join public.fragrances f
  on f.id = p.fragrance_id
on conflict (fragrance_id) do update
set
  provider = excluded.provider,
  status = excluded.status,
  source_url = excluded.source_url,
  source_confidence = excluded.source_confidence,
  match_name = excluded.match_name,
  match_brand = excluded.match_brand,
  proposed_family_key = excluded.proposed_family_key,
  concentration = excluded.concentration,
  notes = excluded.notes,
  accords = excluded.accords,
  provider_payload = excluded.provider_payload,
  last_error = excluded.last_error,
  last_enriched_at = now(),
  updated_at = now();

select public.refresh_fragrance_performance_features_v1(fragrance_id)
from pg_temp.pass8_payload;

insert into public.fragrance_facets_v1 (
  fragrance_id,
  facet_key,
  confidence,
  evidence_source,
  evidence_json
)
select
  p.fragrance_id,
  facet_key,
  p.confidence,
  'odara_taxonomy_operationalization_pass8_tier4_batch1_source_repair_2026_05_22',
  jsonb_build_object(
    'notes_used', p.notes,
    'accords_used', p.accords,
    'top_notes', p.top_notes,
    'heart_notes', p.heart_notes,
    'base_notes', p.base_notes,
    'review_status', p.review_status,
    'blocker_type', p.blocker_type,
    'official_source_url', p.source_url,
    'official_source_confidence', p.source_confidence::text,
    'decision_reason',
      case
        when p.blocker_type = 'contaminated_data'
          then 'Contaminated canonical scent structure was replaced with exact official Alexandria source data, making the row safe for backend-owned taxonomy assignment.'
        else 'An exact official Alexandria source closed the source gap with note and accord evidence sufficient for backend-owned taxonomy assignment.'
      end
  )
from pg_temp.pass8_payload p
cross join lateral unnest(p.facet_keys) as facet_key
on conflict (fragrance_id, facet_key) do update
set
  confidence = excluded.confidence,
  evidence_source = excluded.evidence_source,
  evidence_json = excluded.evidence_json,
  updated_at = now();

insert into public.fragrance_wardrobe_roles_v1 (
  fragrance_id,
  role_key,
  role_priority,
  confidence,
  evidence_source,
  evidence_json
)
select
  p.fragrance_id,
  role.role_key,
  role.role_priority,
  p.confidence,
  'odara_taxonomy_operationalization_pass8_tier4_batch1_source_repair_2026_05_22',
  jsonb_build_object(
    'review_status', p.review_status,
    'blocker_type', p.blocker_type,
    'official_source_url', p.source_url,
    'official_source_confidence', p.source_confidence::text,
    'performance_summary', jsonb_strip_nulls(jsonb_build_object(
      'lift_score', perf.lift_score,
      'density_score', perf.density_score,
      'beast_mode_band', perf.beast_mode_band,
      'base_weight_score', perf.base_weight_score,
      'fatigue_risk_band', perf.fatigue_risk_band,
      'masking_risk_band', perf.masking_risk_band,
      'transparency_score', perf.transparency_score,
      'drydown_anchor_strength', perf.drydown_anchor_strength,
      'balancing_layer_strategy', perf.balancing_layer_strategy,
      'recommended_spray_caution', perf.recommended_spray_caution
    )),
    'decision_reason',
      case
        when p.blocker_type = 'contaminated_data'
          then 'Contaminated canonical scent structure was replaced with exact official Alexandria source data, making the row safe for backend-owned taxonomy assignment.'
        else 'An exact official Alexandria source closed the source gap with note and accord evidence sufficient for backend-owned taxonomy assignment.'
      end
  )
from pg_temp.pass8_payload p
cross join lateral jsonb_to_recordset(p.role_rows) as role(role_key text, role_priority integer)
left join public.fragrance_performance_features_v1 perf
  on perf.fragrance_id = p.fragrance_id
on conflict (fragrance_id, role_key) do update
set
  role_priority = excluded.role_priority,
  confidence = excluded.confidence,
  evidence_source = excluded.evidence_source,
  evidence_json = excluded.evidence_json,
  updated_at = now();

insert into public.fragrance_taxonomy_review_v1 (
  fragrance_id,
  legacy_family_key,
  universal_equivalent,
  confidence,
  review_status,
  evidence_source,
  evidence_json,
  reviewed_by
)
select
  p.fragrance_id,
  p.legacy_family_key,
  p.universal_family_key,
  p.confidence,
  p.review_status,
  'odara_taxonomy_operationalization_pass8_tier4_batch1_source_repair_2026_05_22',
  jsonb_build_object(
    'role_rows', p.role_rows,
    'facet_keys', p.facet_keys,
    'top_notes', p.top_notes,
    'heart_notes', p.heart_notes,
    'base_notes', p.base_notes,
    'canonical_notes', p.notes,
    'canonical_accords', p.accords,
    'repair_scope', 'source_repair_then_taxonomy_completion',
    'assignment_scope', 'tier4_batch1_source_repair',
    'batch_marker', 'odara_taxonomy_operationalization_pass8_tier4_batch1_source_repair_2026_05_22',
    'literal_oud_claim', false,
    'official_source_url', p.source_url,
    'official_source_confidence', p.source_confidence::text,
    'review_summary', format(
      'Official %s page supports %s.',
      p.brand,
      array_to_string(p.notes, ', ')
    ),
    'performance_summary', jsonb_strip_nulls(jsonb_build_object(
      'lift_score', perf.lift_score,
      'density_score', perf.density_score,
      'beast_mode_band', perf.beast_mode_band,
      'base_weight_score', perf.base_weight_score,
      'fatigue_risk_band', perf.fatigue_risk_band,
      'masking_risk_band', perf.masking_risk_band,
      'transparency_score', perf.transparency_score,
      'drydown_anchor_strength', perf.drydown_anchor_strength,
      'balancing_layer_strategy', perf.balancing_layer_strategy,
      'recommended_spray_caution', perf.recommended_spray_caution
    )),
    'source_repair_payload', jsonb_build_object(
      'official_source_url', p.source_url,
      'official_source_summary', p.source_summary,
      'official_source_confidence', p.source_confidence,
      'contamination_repair',
        case
          when p.blocker_type = 'contaminated_data' then jsonb_build_object(
            'issue', 'Existing canonical notes or accords contained prose fragments, placeholders, SEO copy, or malformed text that could not be used as taxonomy evidence.',
            'action', 'Replaced contaminated scent structure with clean official-source-backed notes and accords from the exact Alexandria product page.',
            'repaired', true
          )
          else null
        end,
      'source_gap_closure',
        case
          when p.blocker_type = 'source_gap' then jsonb_build_object(
            'issue', 'No usable canonical notes, accords, pyramid, or source metadata existed before this pass.',
            'action', 'Closed the source gap using the exact official Alexandria product page for this fragrance.',
            'repaired', true
          )
          else null
        end
    ),
    'compatibility_assignment', true,
    'family_reassessment_note', 'Legacy family key was preserved because this pass repaired source structure and completed taxonomy operationalization only; family reassessment was not reopened.',
    'family_preserved_in_this_pass', true,
    'decision_reason',
      case
        when p.blocker_type = 'contaminated_data'
          then 'Contaminated canonical scent structure was replaced with exact official Alexandria source data, making the row safe for backend-owned taxonomy assignment.'
        else 'An exact official Alexandria source closed the source gap with note and accord evidence sufficient for backend-owned taxonomy assignment.'
      end
  ),
  'odara_taxonomy_operationalization_pass8_tier4_batch1_source_repair_2026_05_22'
from pg_temp.pass8_payload p
left join public.fragrance_performance_features_v1 perf
  on perf.fragrance_id = p.fragrance_id
on conflict (fragrance_id) do update
set
  legacy_family_key = excluded.legacy_family_key,
  universal_equivalent = excluded.universal_equivalent,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  evidence_source = excluded.evidence_source,
  evidence_json = excluded.evidence_json,
  reviewed_by = excluded.reviewed_by,
  updated_at = now();

commit;
