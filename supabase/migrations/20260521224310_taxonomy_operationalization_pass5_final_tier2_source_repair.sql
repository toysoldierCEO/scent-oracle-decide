-- Taxonomy Operationalization Pass 5: targeted source repair and taxonomy completion for the final two Tier 2 owned blockers
begin;

with payload as (
  select * from (values
    ('4013ea4b-26e6-46a2-ab5c-c5f70590cbbc'::uuid, 'Barricade', 'Alexandria Fragrances', 'UNKNOWN', 'woody-clean', 'woody', 'https://alexandriafragrances.com/products/barricade', 0.99, '0.99', array['Woods', 'Spices', 'Leather', 'Mango', 'Oud', 'Amber', 'Pepper', 'Tomato Leaf']::text[], array['woody', 'spicy', 'leather', 'fruity', 'amber', 'green']::text[], array[]::text[], array['Leather', 'Oud', 'Amber']::text[], array[]::text[], 'already_enriched', '{"official_source_import":true,"source_name":"Barricade","source_brand":"Alexandria Fragrances","identity_match_status":"exact_official_product_page","top_notes":[],"heart_notes":["Leather","Oud","Amber"],"base_notes":[],"extraction_method":"manual_official_product_page_review","import_batch":"taxonomy_operationalization_pass5_final_tier2_source_repair_2026_05_21","source_evidence":{"official_source_url":"https://alexandriafragrances.com/products/barricade","official_source_confidence":0.99,"official_source_excerpt":"Official Alexandria page describes robust woods, protective spices, smooth leather, and vibrant notes of mango, then says warm heart notes are rooted in leather, oud, and amber, with vivacious freshness from mango, spicy pepper, and tomato leaf.","contamination_repair":{"repaired":true,"issue":"Canonical accords contained prose fragments such as sentence pieces and mixed descriptors without a clean source record.","action":"Replaced malformed accords with clean official-source-backed note and accord structure from the exact Alexandria product page."}}}'::jsonb, 0.78, 'medium_confidence', array['amber', 'fruity', 'green', 'leather', 'spicy', 'woody']::text[], '[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}]'::jsonb, 'Official Barricade page supports woods, spices, leather, mango, oud, amber, pepper, and tomato leaf, with explicit heart notes rooted in leather, oud, and amber. Refreshed performance now shows high density, high base weight, high masking risk, and strong anchor strength.', 'Contaminated accords are repaired with exact official structure, and the repaired row now supports a strong leather-amber statement profile with fresh contrast.', 'Legacy woody-clean family key was preserved because this pass repaired contaminated source structure and completed taxonomy operationalization only; family reassessment was not reopened.'),
    ('1b79acd6-485c-41dd-952f-fdcb39ff3a01'::uuid, 'Zion Noir', 'Alexandria Fragrances', 'EXTRAIT', 'oud-amber', 'amber-oriental', 'https://alexandriafragrances.com/products/zion-noir', 0.99, '0.99', array[]::text[], array['amber', 'aromatic', 'fresh spicy', 'fruity', 'warm spicy', 'woody', 'musky']::text[], array[]::text[], array[]::text[], array[]::text[], 'already_enriched', '{"official_source_import":true,"source_name":"Zion Noir","source_brand":"Alexandria Fragrances","identity_match_status":"exact_official_product_page","top_notes":[],"heart_notes":[],"base_notes":[],"extraction_method":"manual_official_product_page_review","import_batch":"taxonomy_operationalization_pass5_final_tier2_source_repair_2026_05_21","source_evidence":{"official_source_url":"https://alexandriafragrances.com/products/zion-noir","official_source_confidence":0.99,"official_source_excerpt":"Official Alexandria page describes Zion Noir as a smooth amber-aromatic experience and lists main accords of Amber, Aromatic, Fresh Spicy, Fruity, Warm Spicy, Woody, and Musky, with a long-lasting extrait profile.","source_gap_closure":{"repaired":true,"issue":"No usable notes, accords, source metadata, or enrichment row existed before this pass.","action":"Inserted exact official Alexandria accord structure from the product page without inventing unsupported note pyramid data."}}}'::jsonb, 0.71, 'medium_confidence', array['amber', 'aromatic', 'fruity', 'musk', 'spicy', 'woody']::text[], '[{"role_key":"bridge","role_priority":1},{"role_key":"aura","role_priority":2}]'::jsonb, 'Official Zion Noir page gives an exact accord structure of amber, aromatic, fresh spicy, fruity, warm spicy, woody, and musky, plus a description of a polished scent that balances freshness and richness. Refreshed performance remains low-beast and moderately transparent.', 'The source gap is now closed by exact official accords, which are sufficient for cautious medium-confidence faceting and a bridge-oriented role without inventing unsupported notes.', 'Legacy oud-amber family key was preserved for compatibility in this pass even though official accords now close the prior source gap; this is not a literal oud claim.')
  ) as t(fragrance_id, fragrance_name, fragrance_brand, concentration, legacy_family_key, universal_equivalent, source_url, source_confidence_num, source_confidence_text, notes, accords, top_notes, heart_notes, base_notes, enrichment_status, enrichment_payload, review_confidence, review_status, facet_keys, role_rows, review_summary, review_reason, family_reassessment_note)
),
canonical_patch as (
  update public.fragrances f
  set
    notes = nullif(p.notes, array[]::text[]),
    accords = nullif(p.accords, array[]::text[]),
    top_notes = nullif(p.top_notes, array[]::text[]),
    heart_notes = nullif(p.heart_notes, array[]::text[]),
    base_notes = nullif(p.base_notes, array[]::text[]),
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
    nullif(p.notes, array[]::text[]),
    nullif(p.accords, array[]::text[]),
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
feature_refresh as (
  select public.refresh_fragrance_performance_features_v1(fragrance_id) as refresh_result
  from payload
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
    'odara_taxonomy_operationalization_pass5_final_tier2_source_repair_2026_05_21',
    jsonb_build_object(
      'assignment_scope', 'tier2_owned_rows_final_source_repair',
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
    'odara_taxonomy_operationalization_pass5_final_tier2_source_repair_2026_05_21',
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
    'odara_taxonomy_operationalization_pass5_final_tier2_source_repair_2026_05_21',
    jsonb_build_object('official_source_url', p.source_url, 'official_source_confidence', p.source_confidence_text, 'notes_used', p.notes, 'accords_used', p.accords, 'decision_reason', p.review_reason, 'review_status', p.review_status),
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
    'odara_taxonomy_operationalization_pass5_final_tier2_source_repair_2026_05_21',
    jsonb_build_object('official_source_url', p.source_url, 'official_source_confidence', p.source_confidence_text, 'decision_reason', p.review_reason, 'review_status', p.review_status),
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
select count(*) from feature_refresh;

commit;
