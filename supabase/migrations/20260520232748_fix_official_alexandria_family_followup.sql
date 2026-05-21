begin;

with payload as (
  select * from (
    values
      (
        '29818d76-cb39-4349-86c9-f1c39d9a5b73'::uuid,
        'Cagliari',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/cagliari-inspired-by-papilefiko-nishane',
        '0.99',
        array['coriander','cardamom','lavender','artemisia','fir balsam','moss']::text[],
        array['coriander','cardamom']::text[],
        array['lavender','artemisia']::text[],
        array['fir balsam','moss']::text[],
        'woody-clean',
        0.80::numeric,
        'alexandria_official+suggest_family_key_v1',
        'Official Alexandria structured top/heart/base notes plus suggest_family_key_v1 = woody-clean (0.80, aromatic, woody).',
        jsonb_build_object(
          'source_url', 'https://alexandriafragrances.com/products/cagliari-inspired-by-papilefiko-nishane',
          'source_confidence', 0.99,
          'suggest_family_key_v1', jsonb_build_object(
            'suggested_family_key', 'woody-clean',
            'confidence', 0.80,
            'why', 'aromatic, woody'
          )
        )
      ),
      (
        'f7ea787d-3838-416a-bcea-1cf793232382'::uuid,
        'Japanese Princess',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/japanese-princess-inspired-by-matsukita-clive-christian',
        '0.99',
        array['bergamot','pink pepper','nutmeg','chinese jasmine','jasmine sambac','smoky mate','guaiac wood','balsam fir','musk']::text[],
        array['bergamot','pink pepper','nutmeg']::text[],
        array['chinese jasmine','jasmine sambac','smoky mate','guaiac wood']::text[],
        array['balsam fir','musk','woodsy notes']::text[],
        'woody-clean',
        0.80::numeric,
        'alexandria_official+suggest_family_key_v1',
        'Official Alexandria structured top/heart/base notes plus suggest_family_key_v1 = woody-clean (0.80, citrus, woody).',
        jsonb_build_object(
          'source_url', 'https://alexandriafragrances.com/products/japanese-princess-inspired-by-matsukita-clive-christian',
          'source_confidence', 0.99,
          'suggest_family_key_v1', jsonb_build_object(
            'suggested_family_key', 'woody-clean',
            'confidence', 0.80,
            'why', 'citrus, woody'
          )
        )
      )
  ) as t(
    fragrance_id,
    fragrance_name,
    fragrance_brand,
    source_url,
    source_confidence,
    notes,
    top_notes,
    heart_notes,
    base_notes,
    family_key,
    evidence_confidence,
    evidence_source,
    assignment_reason,
    evidence_json
  )
),
canonical_patch as (
  update public.fragrances f
  set
    notes = p.notes,
    top_notes = p.top_notes,
    heart_notes = p.heart_notes,
    base_notes = p.base_notes,
    data_source = 'alexandria_official_import_v1',
    source_url = p.source_url,
    source_confidence = p.source_confidence,
    updated_at = now(),
    enriched_at = now()
  from payload p
  where f.id = p.fragrance_id
  returning f.id
)
insert into public.fragrance_family_assignment_audit_v1 (
  fragrance_id,
  fragrance_name,
  fragrance_brand,
  old_family_key,
  new_family_key,
  evidence_source,
  evidence_confidence,
  evidence_json,
  assignment_reason,
  assigned_by
)
select
  p.fragrance_id,
  p.fragrance_name,
  p.fragrance_brand,
  null::text,
  p.family_key,
  p.evidence_source,
  p.evidence_confidence,
  p.evidence_json,
  p.assignment_reason,
  'odara_official_source_import_2026_05_20'
from payload p
where not exists (
  select 1
  from public.fragrance_family_assignment_audit_v1 audit
  where audit.fragrance_id = p.fragrance_id
    and audit.new_family_key = p.family_key
    and audit.assigned_by = 'odara_official_source_import_2026_05_20'
);

commit;
