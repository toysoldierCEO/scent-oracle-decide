-- Taxonomy Operationalization Pass 3: targeted source repair and taxonomy completion for the final two Tier 1 blockers
begin;

with payload as (
  select * from (values
    ('f48cd341-8f8f-4bc5-8607-2b3843d0b541'::uuid, 'Dark Pleasure', 'Alexandria Fragrances', 'EDP', 'dark-leather', 'leather', 'https://alexandriafragrances.com/products/dark-pleasure', 0.99, '0.99', array['May Rose', 'Turkish Rose', 'Bulgarian Rose', 'Roasted Coffee', 'Patchouli', 'Incense', 'Black Pepper']::text[], array['floral', 'rose', 'coffee', 'incense', 'patchouli', 'spicy']::text[], array['May Rose', 'Turkish Rose', 'Bulgarian Rose']::text[], array['Roasted Coffee', 'Patchouli', 'Incense', 'Black Pepper']::text[], array[]::text[], 'already_enriched', '{"official_source_import":true,"source_name":"Dark Pleasure","source_brand":"Alexandria Fragrances","identity_match_status":"exact_official_product_page","top_notes":["May Rose","Turkish Rose","Bulgarian Rose"],"heart_notes":["Roasted Coffee","Patchouli","Incense","Black Pepper"],"base_notes":[],"extraction_method":"manual_official_product_page_review","import_batch":"taxonomy_operationalization_pass3_final_tier1_source_repair_2026_05_21","source_evidence":{"official_source_url":"https://alexandriafragrances.com/products/dark-pleasure","official_source_confidence":0.99,"official_source_excerpt":"Official product page describes three roses: May Rose, Turkish Rose, and Bulgarian Rose, then a heart of roasted coffee, spicy patchouli, incense, and black pepper.","contamination_repair":{"repaired":true,"issue":"Canonical accords contained prose fragments from an incorrect Darkwood Rose/Fragrantica-style scrape and were not safe for taxonomy use.","action":"Replaced malformed accords with exact official Alexandria note structure and clean source-backed accord descriptors only."}}}'::jsonb, 0.78, 'medium_confidence', array['floral', 'gourmand', 'incense', 'resin', 'spicy', 'woody']::text[], '[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}]'::jsonb, 'Official Alexandria page now provides a clean rose/coffee/patchouli/incense/black pepper structure, replacing the prior malformed prose-contaminated accords. The scent reads as a dark floral coffee-incense composition with enough density for a statement role, but not enough structure to reopen family assignment in this pass.', 'Exact official source repaired the contaminated canonical structure; facets and roles are now supportable from clean notes plus refreshed performance.', 'Legacy dark-leather family key was preserved because this pass repaired source structure and completed taxonomy operationalization only; family reclassification was not reopened.'),
    ('7cd07754-af56-4bb9-a445-ea548ade8542'::uuid, 'Valley of the Kings', 'Alexandria Fragrances', 'UNKNOWN', 'oud-amber', 'amber-oriental', 'https://alexandriafragrances.com/products/valley-of-the-kings', 0.99, '0.99', array['Rose', 'Black Currant', 'Citrus', 'Patchouli', 'Sandalwood', 'Musk']::text[], array['sweet', 'spicy', 'earthy']::text[], array[]::text[], array[]::text[], array[]::text[], 'already_enriched', '{"official_source_import":true,"source_name":"Valley of the Kings","source_brand":"Alexandria Fragrances","identity_match_status":"exact_official_product_page","top_notes":[],"heart_notes":[],"base_notes":[],"extraction_method":"manual_official_product_page_review","import_batch":"taxonomy_operationalization_pass3_final_tier1_source_repair_2026_05_21","source_evidence":{"official_source_url":"https://alexandriafragrances.com/products/valley-of-the-kings","official_source_confidence":0.99,"official_source_excerpt":"Official product page describes sweet elements of rose, black currant, and citrus together with spicy and earthy notes of patchouli, sandalwood, and musk.","contamination_repair":{"repaired":true,"issue":"Source gap: no usable canonical notes, accords, source metadata, or enrichment row existed before this pass.","action":"Inserted exact official Alexandria source-backed structure."}}}'::jsonb, 0.74, 'medium_confidence', array['citrus', 'floral', 'fruity', 'musk', 'spicy', 'woody']::text[], '[{"role_key":"anchor","role_priority":1},{"role_key":"bridge","role_priority":2}]'::jsonb, 'Official Alexandria page now provides a real note structure of rose, black currant, citrus, patchouli, sandalwood, and musk with sweet/spicy/earthy descriptors. That supports a grounded woody-musky anchor role with bridging utility, while legacy family remains preserved for compatibility in this non-family pass.', 'Exact official source resolved the source gap; facets and roles are now supportable from clean notes, accords, and refreshed performance.', 'Legacy oud-amber family key was preserved for compatibility in this pass even though the repaired official structure now provides a stronger evidence base for future family review.')
  ) as t(fragrance_id, fragrance_name, fragrance_brand, concentration, legacy_family_key, universal_equivalent, source_url, source_confidence_num, source_confidence_text, notes, accords, top_notes, heart_notes, base_notes, enrichment_status, enrichment_payload, review_confidence, review_status, facet_keys, role_rows, review_summary, review_reason, family_reassessment_note)
),
canonical_patch as (
  update public.fragrances f
  set
    notes = p.notes,
    accords = p.accords,
    top_notes = p.top_notes,
    heart_notes = p.heart_notes,
    base_notes = p.base_notes,
    data_source = 'alexandria_official_source_repair_v1',
    source_url = p.source_url,
    source_confidence = p.source_confidence_text,
    enriched_at = now(),
    updated_at = now()
  from payload p
  where f.id = p.fragrance_id
  returning f.id
),
enrichment_upsert as (
  insert into public.fragrance_text_enrichment (
    fragrance_id, provider, status, source_url, source_confidence, match_name, match_brand, proposed_family_key, concentration, notes, accords, provider_payload, last_error, last_enriched_at, updated_at
  )
  select
    p.fragrance_id,
    'alexandria_official',
    p.enrichment_status,
    p.source_url,
    p.source_confidence_num,
    p.fragrance_name,
    p.fragrance_brand,
    null,
    p.concentration,
    p.notes,
    p.accords,
    p.enrichment_payload,
    null,
    now(),
    now()
  from payload p
  on conflict (fragrance_id) do update set
    provider = excluded.provider,
    status = excluded.status,
    source_url = excluded.source_url,
    source_confidence = excluded.source_confidence,
    match_name = excluded.match_name,
    match_brand = excluded.match_brand,
    concentration = excluded.concentration,
    notes = excluded.notes,
    accords = excluded.accords,
    provider_payload = excluded.provider_payload,
    last_error = null,
    last_enriched_at = excluded.last_enriched_at,
    updated_at = excluded.updated_at
  returning fragrance_id
),
review_upsert as (
  insert into public.fragrance_taxonomy_review_v1 (
    fragrance_id, legacy_family_key, universal_equivalent, confidence, review_status, evidence_source, evidence_json, reviewed_by, updated_at
  )
  select
    p.fragrance_id,
    p.legacy_family_key,
    p.universal_equivalent,
    p.review_confidence,
    p.review_status,
    'odara_taxonomy_operationalization_pass3_final_tier1_source_repair_2026_05_21',
    jsonb_build_object(
      'assignment_scope', 'target_visible_wardrobe_final_tier1_repair',
      'repair_scope', 'source_repair_then_taxonomy_completion',
      'official_source_url', p.source_url,
      'official_source_confidence', p.source_confidence_text,
      'top_notes', p.top_notes,
      'heart_notes', p.heart_notes,
      'base_notes', p.base_notes,
      'canonical_notes', p.notes,
      'canonical_accords', p.accords,
      'facet_keys', p.facet_keys,
      'role_rows', p.role_rows,
      'compatibility_assignment', true,
      'literal_oud_claim', false,
      'family_preserved_in_this_pass', true,
      'family_reassessment_note', p.family_reassessment_note,
      'decision_reason', p.review_reason,
      'review_summary', p.review_summary,
      'source_repair_payload', p.enrichment_payload -> 'source_evidence'
    ),
    'odara_taxonomy_operationalization_pass3_final_tier1_source_repair_2026_05_21',
    now()
  from payload p
  on conflict (fragrance_id) do update set
    legacy_family_key = excluded.legacy_family_key,
    universal_equivalent = excluded.universal_equivalent,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    evidence_source = excluded.evidence_source,
    evidence_json = excluded.evidence_json,
    reviewed_by = excluded.reviewed_by,
    updated_at = excluded.updated_at
  returning fragrance_id
),
facet_upsert as (
  insert into public.fragrance_facets_v1 (fragrance_id, facet_key, confidence, evidence_source, evidence_json, updated_at)
  select
    p.fragrance_id,
    facet_key,
    p.review_confidence,
    'odara_taxonomy_operationalization_pass3_final_tier1_source_repair_2026_05_21',
    jsonb_build_object('official_source_url', p.source_url, 'official_source_confidence', p.source_confidence_text, 'notes_used', p.notes, 'accords_used', p.accords, 'decision_reason', p.review_reason),
    now()
  from payload p
  cross join lateral unnest(p.facet_keys) as facet_key
  on conflict (fragrance_id, facet_key) do update set
    confidence = excluded.confidence,
    evidence_source = excluded.evidence_source,
    evidence_json = excluded.evidence_json,
    updated_at = excluded.updated_at
  returning fragrance_id
),
role_upsert as (
  insert into public.fragrance_wardrobe_roles_v1 (fragrance_id, role_key, role_priority, confidence, evidence_source, evidence_json, updated_at)
  select
    p.fragrance_id,
    rr.value ->> 'role_key' as role_key,
    ((rr.value ->> 'role_priority')::integer) as role_priority,
    p.review_confidence,
    'odara_taxonomy_operationalization_pass3_final_tier1_source_repair_2026_05_21',
    jsonb_build_object('official_source_url', p.source_url, 'official_source_confidence', p.source_confidence_text, 'performance_summary', jsonb_build_object('note', 'refresh_fragrance_performance_features_v1 was run for this row in the live repair pass'), 'decision_reason', p.review_reason),
    now()
  from payload p
  cross join lateral jsonb_array_elements(p.role_rows) as rr(value)
  on conflict (fragrance_id, role_key) do update set
    role_priority = excluded.role_priority,
    confidence = excluded.confidence,
    evidence_source = excluded.evidence_source,
    evidence_json = excluded.evidence_json,
    updated_at = excluded.updated_at
  returning fragrance_id
)
select public.refresh_fragrance_performance_features_v1(fragrance_id)
from payload;

commit;
