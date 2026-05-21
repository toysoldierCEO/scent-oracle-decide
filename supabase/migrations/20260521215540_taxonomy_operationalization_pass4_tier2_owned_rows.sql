-- Taxonomy Operationalization Pass 4: Tier 2 owned-by-user facet, role, and review assignment
begin;

create temp table tmp_tier2_review_payload (
  fragrance_id uuid primary key,
  confidence numeric not null,
  review_status text not null,
  evidence_json jsonb not null
) on commit drop;

insert into tmp_tier2_review_payload (fragrance_id, confidence, review_status, evidence_json)
values
  (
    '1a9bfe1a-85ca-4772-aadc-1a82da0f02a2'::uuid,
    0.77,
    'medium_confidence',
    $${"assignment_scope":"tier2_owned_rows","based_on":["canonical_notes_accords","top_heart_base","material_signals","performance_features"],"source_kind":"canonical_structure","role_rows":[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}],"facet_keys":["amber","floral","leather","resin","spicy","woody"],"top_notes":["nutmeg","pepper","saffron"],"heart_notes":["labdanum","olibanum","rose"],"base_notes":["agarwood (oud)","amber","leather","patchouli","sandalwood"],"canonical_notes":["agarwood (oud)","amber","labdanum","leather","nutmeg","olibanum","patchouli","pepper","rose","saffron","sandalwood"],"canonical_accords":["amber","balsamic","earthy","leather","oud","patchouli","rose","smoky","warm spicy","woody"],"source_url":null,"source_confidence":null,"compatibility_assignment":true,"literal_oud_claim":false,"performance_summary":{"drydown_anchor_strength":"HIGH","transparency_score":0.297,"density_score":1,"base_weight_score":1,"lift_score":0,"beast_mode_band":"HIGH","masking_risk_band":"HIGH","fatigue_risk_band":"LOW","recommended_spray_caution":"one_spray_anchor","balancing_layer_strategy":"resin_softener"},"collection_context":{"owner_count":1,"collection_statuses":["liked"]},"decision_reason":"Clean canonical structure supports a resinous leathery amber-oud statement profile.","review_summary":"Full pyramid shows saffron-pepper top, labdanum-olibanum-rose heart, and oud/amber/leather/sandalwood base with dense high-base performance."}$$::jsonb
  ),
  (
    '6a5c2de7-376b-495b-9d86-35bbd5a3d3d7'::uuid,
    0.81,
    'confirmed',
    $${"assignment_scope":"tier2_owned_rows","based_on":["canonical_notes_accords","existing_fragella_enrichment","performance_features"],"source_kind":"existing_source_backed_enrichment","role_rows":[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}],"facet_keys":["amber","boozy","creamy","fruity","gourmand","woody"],"top_notes":[],"heart_notes":[],"base_notes":[],"canonical_notes":["almond","black cherry","cherry","cherry liqueur","liquor","pistachio"],"canonical_accords":["cherry","almond","sweet","nutty","woody","fruity","gourmand","alcohol","amber","balsamic","vanilla"],"source_url":"https://www.amazon.com/Fructus-virginis-2oz-Alexandria-Fragrances/dp/B07PJBBRGB","source_confidence":0.75,"compatibility_assignment":true,"literal_oud_claim":false,"performance_summary":{"drydown_anchor_strength":"MODERATE","transparency_score":0.437,"density_score":0.348,"base_weight_score":0.473,"lift_score":0,"beast_mode_band":"LOW","masking_risk_band":"LOW","fatigue_risk_band":"LOW","recommended_spray_caution":"none","balancing_layer_strategy":"soft_musk_rounding"},"collection_context":{"owner_count":1,"collection_statuses":["disliked"]},"decision_reason":"Existing source-backed enrichment is strong enough to support clear gourmand/boozy faceting and a statement role.","review_summary":"Cherry, cherry liqueur, pistachio and almond structure is source-backed by existing enrichment and reads as a distinctive boozy gourmand fruit profile."}$$::jsonb
  ),
  (
    '42164905-3549-48c7-becc-35f249a5f0df'::uuid,
    0.74,
    'medium_confidence',
    $${"assignment_scope":"tier2_owned_rows","based_on":["canonical_notes_accords","top_heart_base","material_signals","performance_features"],"source_kind":"canonical_structure","role_rows":[{"role_key":"brightener","role_priority":1},{"role_key":"bridge","role_priority":2}],"facet_keys":["aromatic","citrus","floral","green","spicy","woody"],"top_notes":["Bergamot","Galbanum","Lemon","Peppermint","Vervain"],"heart_notes":["Egyptian geranium","Lavender","Violet","Violet leaf"],"base_notes":["Ambergris","Cedarwood","Indian sandalwood","Oakmoss"],"canonical_notes":["Ambergris","Bergamot","Cedarwood","Egyptian geranium","Galbanum","Indian sandalwood","Lavender","Lemon","Oakmoss","Peppermint","Vervain","Violet","Violet leaf"],"canonical_accords":["Green"," Fresh"," Aquatic"," Woody"," Spicy"],"source_url":null,"source_confidence":null,"compatibility_assignment":true,"literal_oud_claim":false,"performance_summary":{"drydown_anchor_strength":"LOW","transparency_score":0.601,"density_score":0,"base_weight_score":0.106,"lift_score":0.621,"beast_mode_band":"LOW","masking_risk_band":"LOW","fatigue_risk_band":"LOW","recommended_spray_caution":"none","balancing_layer_strategy":"airy_lift_support"},"collection_context":{"owner_count":1,"collection_statuses":["disliked"]},"decision_reason":"Clean pyramid strongly supports a fresh green brightener with bridging utility.","review_summary":"Bergamot, lemon, peppermint, vervain, geranium, lavender and violet leaf over cedar/oakmoss create a classic lifted green aromatic wood structure."}$$::jsonb
  ),
  (
    '85de620b-0db4-4dc4-b847-b573eb3a2a51'::uuid,
    0.82,
    'confirmed',
    $${"assignment_scope":"tier2_owned_rows","based_on":["canonical_notes_accords","existing_source_backed_enrichment","performance_features"],"source_kind":"existing_source_backed_enrichment","role_rows":[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}],"facet_keys":["boozy","gourmand","resin","spicy","tobacco","woody"],"top_notes":[],"heart_notes":[],"base_notes":[],"canonical_notes":["Pink Pepper","Neroli","Lemon","Rum","Java vetiver oil","Clary Sage","Tobacco Leaf","Vanilla Bean","Styrax"],"canonical_accords":["Sweet"," Spicy"," Smoky"," Woody"," Gourmand"],"source_url":"https://www.fragrancenet.com/cologne/maison-margiela/replica-jazz-club/edt?mv_pc=LS&utm_campaign=MmJMBbLy6ow&utm_medium=Affiliate&utm_source=LS#356173","source_confidence":0.75,"compatibility_assignment":true,"literal_oud_claim":false,"performance_summary":{"drydown_anchor_strength":"LOW","transparency_score":0.597,"density_score":0,"base_weight_score":0,"lift_score":0.612,"beast_mode_band":"LOW","masking_risk_band":"LOW","fatigue_risk_band":"LOW","recommended_spray_caution":"none","balancing_layer_strategy":"airy_lift_support"},"collection_context":{"owner_count":1,"collection_statuses":["liked"]},"decision_reason":"Existing source-backed enrichment and clean canonical notes support a confident statement-role assignment.","review_summary":"Rum, tobacco leaf, vanilla, styrax and vetiver form a clear boozy tobacco wood signature with airy lift rather than a soft bridge profile."}$$::jsonb
  ),
  (
    'c14e72c8-3d6b-4b4c-9d4f-2f3e1a7a8e39'::uuid,
    0.76,
    'medium_confidence',
    $${"assignment_scope":"tier2_owned_rows","based_on":["canonical_notes_accords","top_heart_base","material_signals","performance_features"],"source_kind":"canonical_structure","role_rows":[{"role_key":"anchor","role_priority":1},{"role_key":"accent","role_priority":2}],"facet_keys":["amber","floral","fruity","gourmand","spicy","woody"],"top_notes":["Apple","Bergamot","Lavender","Mandarin orange"],"heart_notes":["Geranium","Jasmine","Violet"],"base_notes":["Cardamom","Gaiac wood","Patchouli","Pink pepper","Sandalwood","Vanilla"],"canonical_notes":["Apple","Bergamot","Cardamom","Gaiac wood","Geranium","Jasmine","Lavender","Mandarin orange","Patchouli","Pink pepper","Sandalwood","Vanilla","Violet"],"canonical_accords":["Sweet"," Spicy"," Fruity"," Woody"," Oriental"],"source_url":null,"source_confidence":null,"compatibility_assignment":true,"literal_oud_claim":false,"performance_summary":{"drydown_anchor_strength":"MODERATE","transparency_score":0.499,"density_score":0.285,"base_weight_score":0.451,"lift_score":0.319,"beast_mode_band":"LOW","masking_risk_band":"LOW","fatigue_risk_band":"LOW","recommended_spray_caution":"none","balancing_layer_strategy":"resin_softener"},"collection_context":{"owner_count":1,"collection_statuses":["liked"]},"decision_reason":"Full pyramid supports an anchored gourmand structure with enough personality for an accent edge.","review_summary":"Apple, bergamot and lavender lift into floral heart and vanilla/patchouli/sandalwood/cardamom base, giving a versatile sweet-spiced woody gourmand core."}$$::jsonb
  ),
  (
    '3f926642-655c-4463-9e5b-ca502ec7cc81'::uuid,
    0.62,
    'medium_confidence',
    $${"assignment_scope":"tier2_owned_rows","based_on":["canonical_accords","material_signals","performance_features"],"source_kind":"canonical_accords_only","role_rows":[{"role_key":"brightener","role_priority":1},{"role_key":"layer_tool","role_priority":2}],"facet_keys":["aromatic","citrus","green","musk","spicy","woody"],"top_notes":[],"heart_notes":[],"base_notes":[],"canonical_notes":[],"canonical_accords":["aromatic","citrus","earthy","fresh spicy","green","musky","soft spicy","sweet","warm spicy","woody"],"source_url":null,"source_confidence":null,"compatibility_assignment":true,"literal_oud_claim":false,"performance_summary":{"drydown_anchor_strength":"LOW","transparency_score":0.541,"density_score":0,"base_weight_score":0,"lift_score":0.24,"beast_mode_band":"LOW","masking_risk_band":"LOW","fatigue_risk_band":"LOW","recommended_spray_caution":"none","balancing_layer_strategy":"soft_musk_rounding"},"collection_context":{"owner_count":1,"collection_statuses":["owned"]},"decision_reason":"Accord-only evidence is still coherent enough for a cautious medium-confidence brightener/layer-tool assignment.","review_summary":"Clean accord set is aromatic/citrus/green/musky/woody with low density, low masking risk, and transparent performance suitable for lighter use."}$$::jsonb
  ),
  (
    'b2922836-befe-48ee-856c-3c6a24206471'::uuid,
    0.83,
    'confirmed',
    $${"assignment_scope":"tier2_owned_rows","based_on":["canonical_notes_accords","existing_fragella_enrichment","material_signals","performance_features"],"source_kind":"existing_source_backed_enrichment","role_rows":[{"role_key":"brightener","role_priority":1},{"role_key":"bridge","role_priority":2}],"facet_keys":["amber","aromatic","citrus","floral","green","woody"],"top_notes":[],"heart_notes":[],"base_notes":[],"canonical_notes":["Neroli","Lavender","Petitgrain","Rosemary","Jasmine","Geranium","Galbanum","Clary Sage","Amber","Vetiver","Sandalwood","Oak","Cedar"],"canonical_accords":["aromatic","fresh spicy","woody","white floral","green","citrus","lavender","herbal"],"source_url":"https://www.amazon.com/Old-Story-55-Alexandria-Fragrances/dp/B088DJTQ27","source_confidence":0.75,"compatibility_assignment":true,"literal_oud_claim":false,"performance_summary":{"drydown_anchor_strength":"MODERATE","transparency_score":0.722,"density_score":0.089,"base_weight_score":0.616,"lift_score":1,"beast_mode_band":"LOW","masking_risk_band":"LOW","fatigue_risk_band":"LOW","recommended_spray_caution":"none","balancing_layer_strategy":"airy_lift_support"},"collection_context":{"owner_count":2,"collection_statuses":["owned","disliked"]},"decision_reason":"Source-backed aromatic citrus wood structure supports a confident brightener/bridge assignment.","review_summary":"Neroli, lavender, petitgrain, rosemary, galbanum, clary sage, amber, vetiver and sandalwood create a clear aromatic green citrus wood with high lift."}$$::jsonb
  ),
  (
    '4d8790f5-075d-4ab7-99f7-c675caec51b3'::uuid,
    0.69,
    'medium_confidence',
    $${"assignment_scope":"tier2_owned_rows","based_on":["canonical_notes_accords","material_signals","performance_features"],"source_kind":"canonical_structure","role_rows":[{"role_key":"soloist","role_priority":1},{"role_key":"accent","role_priority":2}],"facet_keys":["citrus","green","resin","spicy","woody"],"top_notes":[],"heart_notes":[],"base_notes":[],"canonical_notes":["amberwood","geranium","olibanum","patchouli","vetiver"],"canonical_accords":["Citrus"," Woody"," Spicy"," Fresh"," Green"],"source_url":null,"source_confidence":null,"compatibility_assignment":true,"literal_oud_claim":false,"performance_summary":{"drydown_anchor_strength":"HIGH","transparency_score":0.415,"density_score":0.579,"base_weight_score":0.658,"lift_score":0.182,"beast_mode_band":"EXTREME","masking_risk_band":"HIGH","fatigue_risk_band":"HIGH","recommended_spray_caution":"avoid_stacking_loud","balancing_layer_strategy":"solo_or_one_spray_anchor"},"collection_context":{"owner_count":1,"collection_statuses":["disliked"]},"decision_reason":"Evidence supports real faceting, but role should stay statement-oriented because the performance profile is loud and not especially bridge-friendly.","review_summary":"Amberwood, olibanum, patchouli and vetiver over citrus/green accords combine with extreme dominance and high spray caution, reading as a forceful woody-spicy statement."}$$::jsonb
  ),
  (
    'bf5b3943-969e-476b-94ee-5784c9391edd'::uuid,
    0.84,
    'confirmed',
    $${"assignment_scope":"tier2_owned_rows","based_on":["canonical_notes_accords","existing_fragella_enrichment","material_signals","performance_features"],"source_kind":"existing_source_backed_enrichment","role_rows":[{"role_key":"bridge","role_priority":1},{"role_key":"anchor","role_priority":2}],"facet_keys":["amber","aromatic","citrus","fruity","green","spicy","woody"],"top_notes":[],"heart_notes":[],"base_notes":[],"canonical_notes":["Grapefruit","Lemon","Bergamot","Lime","Thyme","Artemisia","Galbanum","Vetiver","Black Currant","Cedar","Juniper Berries","Pink Pepper","Rose","Apple","Jasmine","Cypriol Oil or Nagarmotha","Lily-of-the-Valley","Ambergris","Benzoin","Leather","Labdanum","Vanilla"],"canonical_accords":["amber","animalic","aromatic","citrus","earthy","fresh spicy","fruity","green","woody"],"source_url":"https://www.amazon.com/zion-alexandria-fragrances/s?k=zion+alexandria+fragrances","source_confidence":0.75,"compatibility_assignment":true,"literal_oud_claim":false,"performance_summary":{"drydown_anchor_strength":"HIGH","transparency_score":0.584,"density_score":0.593,"base_weight_score":0.806,"lift_score":1,"beast_mode_band":"MODERATE","masking_risk_band":"MODERATE","fatigue_risk_band":"LOW","recommended_spray_caution":"none","balancing_layer_strategy":"citrus_tea_clarifier"},"collection_context":{"owner_count":1,"collection_statuses":["liked"]},"decision_reason":"Existing source-backed structure and performance profile make bridge-plus-anchor the cleanest wardrobe interpretation.","review_summary":"Large citrus-aromatic opening with thyme/artemisia/galbanum and woody amber/leather/vanilla drydown creates a versatile connector across bright and warm lanes."}$$::jsonb
  );

with settings as (
  select
    'odara_taxonomy_operationalization_pass4_tier2_owned_rows_2026_05_21'::text as marker,
    '2026-05-21T21:55:40.000Z'::timestamptz as ts
)
insert into public.fragrance_taxonomy_review_v1 (
  fragrance_id,
  legacy_family_key,
  universal_equivalent,
  confidence,
  review_status,
  evidence_source,
  evidence_json,
  reviewed_by,
  updated_at
)
select
  rp.fragrance_id,
  f.family_key,
  coalesce(fkr.universal_equivalent, f.family_key),
  rp.confidence,
  rp.review_status,
  s.marker,
  rp.evidence_json,
  s.marker,
  s.ts
from tmp_tier2_review_payload rp
cross join settings s
join public.fragrances f on f.id = rp.fragrance_id
left join public.family_key_reference_v1 fkr
  on fkr.family_key = f.family_key
 and fkr.active = true
on conflict (fragrance_id) do update set
  legacy_family_key = excluded.legacy_family_key,
  universal_equivalent = excluded.universal_equivalent,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  evidence_source = excluded.evidence_source,
  evidence_json = excluded.evidence_json,
  reviewed_by = excluded.reviewed_by,
  updated_at = excluded.updated_at;

with settings as (
  select
    'odara_taxonomy_operationalization_pass4_tier2_owned_rows_2026_05_21'::text as marker,
    '2026-05-21T21:55:40.000Z'::timestamptz as ts
)
insert into public.fragrance_facets_v1 (
  fragrance_id,
  facet_key,
  confidence,
  evidence_source,
  evidence_json,
  updated_at
)
select
  rp.fragrance_id,
  facet_key.facet_key,
  rp.confidence,
  s.marker,
  jsonb_build_object(
    'assignment_scope', 'tier2_owned_rows',
    'based_on', rp.evidence_json->'based_on',
    'review_status', rp.review_status,
    'decision_reason', rp.evidence_json->>'decision_reason',
    'source_kind', rp.evidence_json->>'source_kind',
    'source_url', rp.evidence_json->'source_url',
    'source_confidence', rp.evidence_json->'source_confidence'
  ),
  s.ts
from tmp_tier2_review_payload rp
cross join settings s
cross join lateral jsonb_array_elements_text(rp.evidence_json->'facet_keys') as facet_key(facet_key)
on conflict (fragrance_id, facet_key) do update set
  confidence = excluded.confidence,
  evidence_source = excluded.evidence_source,
  evidence_json = excluded.evidence_json,
  updated_at = excluded.updated_at;

with settings as (
  select
    'odara_taxonomy_operationalization_pass4_tier2_owned_rows_2026_05_21'::text as marker,
    '2026-05-21T21:55:40.000Z'::timestamptz as ts
)
insert into public.fragrance_wardrobe_roles_v1 (
  fragrance_id,
  role_key,
  role_priority,
  confidence,
  evidence_source,
  evidence_json,
  updated_at
)
select
  rp.fragrance_id,
  role_row.role_key,
  role_row.role_priority,
  rp.confidence,
  s.marker,
  jsonb_build_object(
    'assignment_scope', 'tier2_owned_rows',
    'based_on', rp.evidence_json->'based_on',
    'review_status', rp.review_status,
    'decision_reason', rp.evidence_json->>'decision_reason',
    'source_kind', rp.evidence_json->>'source_kind',
    'source_url', rp.evidence_json->'source_url',
    'source_confidence', rp.evidence_json->'source_confidence'
  ),
  s.ts
from tmp_tier2_review_payload rp
cross join settings s
cross join lateral jsonb_to_recordset(rp.evidence_json->'role_rows') as role_row(role_key text, role_priority int)
on conflict (fragrance_id, role_key) do update set
  role_priority = excluded.role_priority,
  confidence = excluded.confidence,
  evidence_source = excluded.evidence_source,
  evidence_json = excluded.evidence_json,
  updated_at = excluded.updated_at;

commit;
