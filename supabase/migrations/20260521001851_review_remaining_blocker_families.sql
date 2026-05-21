begin;

do $$
declare
  v_invalid_targets text[];
begin
  with payload as (
    select * from (
      values
        (
          '9cd69cc6-4e26-4405-8dba-4b5280360a48'::uuid,
          'Cairo Summer',
          'Alexandria Fragrances',
          'citrus-cologne',
          0.72::numeric,
          'official_alexandria_manual_review',
          'Official citrus/aromatic structure led by bergamot and neroli with fresh/white-floral/citrus accords; woods and amber read as support rather than dominant family.',
          jsonb_build_object(
            'source_url', 'https://alexandriafragrances.com/products/cairo-summer',
            'source_confidence', 0.99,
            'official_notes', jsonb_build_array('Neroli','Bergamot','Jasmine','Cardamom','Pink Pepper','Nutmeg','Virginia Cedar','Amber','Guaiac Wood','Patchouli'),
            'official_accords', jsonb_build_array('citrus','white floral','woody','fresh spicy','aromatic','warm spicy','floral','soft spicy','amber','fresh'),
            'helper', jsonb_build_object(
              'suggested_family_key', null,
              'confidence', 0.30,
              'why', 'top family signals are too close'
            ),
            'review_basis', 'manual override toward citrus-cologne because citrus/neroli lift dominates official structure and product positioning'
          )
        ),
        (
          '59619159-2198-4b24-bb09-d15cab0be80a'::uuid,
          'Sichuan Tea X',
          'Alexandria Fragrances',
          'citrus-cologne',
          0.74::numeric,
          'official_alexandria_manual_review',
          'Official note pyramid is led by kumquat, lemon, lime, and Sichuan pepper with tea and peppermint over musk/bamboo; dominant structure reads bright citrus-aromatic rather than woody.',
          jsonb_build_object(
            'source_url', 'https://alexandriafragrances.com/products/shichuan-tea-x',
            'source_confidence', 0.99,
            'official_notes', jsonb_build_array('kumquat','lemon','lime','sichuan pepper','jasmine','sichuan tea leaves','peppermint','white tea','musk','bamboo'),
            'helper', jsonb_build_object(
              'suggested_family_key', null,
              'confidence', 0.25,
              'why', 'cologne signal too ambiguous'
            ),
            'material_signals', jsonb_build_array('lemon lift','tea lift','musk fixative'),
            'review_basis', 'manual override toward citrus-cologne because citrus and aromatic tea notes clearly lead while woods do not dominate'
          )
        ),
        (
          'f8066a44-e897-44f0-b168-bf14d35f1a7b'::uuid,
          'Sparkling Bergamot',
          'Alexandria Fragrances',
          'citrus-cologne',
          0.74::numeric,
          'official_alexandria_manual_review',
          'Official description is explicitly bergamot-led with cedar and orange blossom support; amber and vanilla sweeten the base but do not displace the citrus core.',
          jsonb_build_object(
            'source_url', 'https://alexandriafragrances.com/products/sparkling-bergamot',
            'source_confidence', 0.99,
            'official_notes', jsonb_build_array('bergamot','cedar','orange blossom petals','amber','vanilla'),
            'helper', jsonb_build_object(
              'suggested_family_key', null,
              'confidence', 0.25,
              'why', 'woody-clean signal too weak'
            ),
            'material_signals', jsonb_build_array('bergamot lift','orange lift','vanilla sweet base'),
            'review_basis', 'manual override toward citrus-cologne because the dominant official structure is bright bergamot rather than woody-clean woods'
          )
        ),
        (
          '9befd638-82c6-486e-89f7-f26a8ecef0b4'::uuid,
          'Sugi Noir',
          'Alexandria Fragrances',
          'woody-clean',
          0.79::numeric,
          'official_alexandria_manual_review',
          'Official note pyramid is dominated by hinoki, cypress, cedarwood, vetiver, soft musk, and aromatic herbs; this is a clean dry woods profile rather than amber or citrus.',
          jsonb_build_object(
            'source_url', 'https://alexandriafragrances.com/products/sugi-noir',
            'source_confidence', 0.99,
            'official_notes', jsonb_build_array('hinoki wood','cypress','cedarwood','incense','aromatic herbs','soft musk','vetiver','fresh spices'),
            'helper', jsonb_build_object(
              'suggested_family_key', null,
              'confidence', 0.25,
              'why', 'woody-clean signal too weak'
            ),
            'material_signals', jsonb_build_array('vetiver fixative','incense resin anchor','aromatic lift'),
            'review_basis', 'manual override toward woody-clean because woods and clean aromatic structure clearly dominate the official note pyramid'
          )
        ),
        (
          'a67fb37e-193a-44fc-99a7-e41788d296fb'::uuid,
          'Tea Rainfall',
          'Alexandria Fragrances',
          'woody-clean',
          0.73::numeric,
          'official_alexandria_manual_review',
          'Official structure blends citrus and tea into light woods and clean musk; the clean woody drydown and airy tea profile fit woody-clean more than a classic citrus-cologne lane.',
          jsonb_build_object(
            'source_url', 'https://alexandriafragrances.com/products/tea-rainfall',
            'source_confidence', 0.99,
            'official_notes', jsonb_build_array('lemongrass','fresh citrus','magnolia','green tea','soft florals','light woods','clean musk'),
            'helper', jsonb_build_object(
              'suggested_family_key', null,
              'confidence', 0.25,
              'why', 'woody-clean signal too weak'
            ),
            'material_signals', jsonb_build_array('clean musk fixative','tea lift','citrus lift'),
            'review_basis', 'manual override toward woody-clean because light woods and clean musk carry the fragrance identity beyond the opening citrus'
          )
        ),
        (
          '090bdcc8-5239-4fc3-a14f-562d2058aeb8'::uuid,
          'Turin 21',
          'Alexandria Fragrances',
          'citrus-cologne',
          0.80::numeric,
          'official_alexandria_manual_review',
          'Official note pyramid is mint, lemon, basil, thyme, rosemary, verbena, and lavender over light musk; helper already leans citrus-cologne and the aromatic citrus structure clearly leads.',
          jsonb_build_object(
            'source_url', 'https://alexandriafragrances.com/products/turin21',
            'source_confidence', 0.99,
            'official_notes', jsonb_build_array('mint','lemon','basil','thyme','jasmine','rosemary','blackcurrant','lavender','musk','verbena'),
            'helper', jsonb_build_object(
              'suggested_family_key', 'citrus-cologne',
              'confidence', 0.68,
              'why', 'aromatic, citrus'
            ),
            'material_signals', jsonb_build_array('mint lift','lemon lift','musk fixative'),
            'review_basis', 'manual confirmation of helper output because the official structure is unmistakably bright aromatic citrus'
          )
        )
    ) as t(
      fragrance_id,
      fragrance_name,
      fragrance_brand,
      new_family_key,
      evidence_confidence,
      evidence_source,
      assignment_reason,
      evidence_json
    )
  )
  select array_agg(format('%s [%s]', p.fragrance_name, p.fragrance_id))
  into v_invalid_targets
  from payload p
  left join public.fragrances f
    on f.id = p.fragrance_id
   and f.name = p.fragrance_name
   and f.brand = p.fragrance_brand
   and f.family_key is null
  left join public.fragrance_text_enrichment e
    on e.fragrance_id = f.id
   and coalesce(f.source_url, e.source_url) = p.evidence_json->>'source_url'
  where f.id is null;

  if coalesce(array_length(v_invalid_targets, 1), 0) > 0 then
    raise exception
      'Remaining blocker family review aborted; target rows missing, already assigned, or source_url mismatch: %',
      array_to_string(v_invalid_targets, '; ');
  end if;
end
$$;

with payload as (
  select * from (
    values
      (
        '9cd69cc6-4e26-4405-8dba-4b5280360a48'::uuid,
        'Cairo Summer',
        'Alexandria Fragrances',
        'citrus-cologne',
        0.72::numeric,
        'official_alexandria_manual_review',
        'Official citrus/aromatic structure led by bergamot and neroli with fresh/white-floral/citrus accords; woods and amber read as support rather than dominant family.',
        jsonb_build_object(
          'source_url', 'https://alexandriafragrances.com/products/cairo-summer',
          'source_confidence', 0.99,
          'official_notes', jsonb_build_array('Neroli','Bergamot','Jasmine','Cardamom','Pink Pepper','Nutmeg','Virginia Cedar','Amber','Guaiac Wood','Patchouli'),
          'official_accords', jsonb_build_array('citrus','white floral','woody','fresh spicy','aromatic','warm spicy','floral','soft spicy','amber','fresh'),
          'helper', jsonb_build_object(
            'suggested_family_key', null,
            'confidence', 0.30,
            'why', 'top family signals are too close'
          ),
          'review_basis', 'manual override toward citrus-cologne because citrus/neroli lift dominates official structure and product positioning'
        )
      ),
      (
        '59619159-2198-4b24-bb09-d15cab0be80a'::uuid,
        'Sichuan Tea X',
        'Alexandria Fragrances',
        'citrus-cologne',
        0.74::numeric,
        'official_alexandria_manual_review',
        'Official note pyramid is led by kumquat, lemon, lime, and Sichuan pepper with tea and peppermint over musk/bamboo; dominant structure reads bright citrus-aromatic rather than woody.',
        jsonb_build_object(
          'source_url', 'https://alexandriafragrances.com/products/shichuan-tea-x',
          'source_confidence', 0.99,
          'official_notes', jsonb_build_array('kumquat','lemon','lime','sichuan pepper','jasmine','sichuan tea leaves','peppermint','white tea','musk','bamboo'),
          'helper', jsonb_build_object(
            'suggested_family_key', null,
            'confidence', 0.25,
            'why', 'cologne signal too ambiguous'
          ),
          'material_signals', jsonb_build_array('lemon lift','tea lift','musk fixative'),
          'review_basis', 'manual override toward citrus-cologne because citrus and aromatic tea notes clearly lead while woods do not dominate'
        )
      ),
      (
        'f8066a44-e897-44f0-b168-bf14d35f1a7b'::uuid,
        'Sparkling Bergamot',
        'Alexandria Fragrances',
        'citrus-cologne',
        0.74::numeric,
        'official_alexandria_manual_review',
        'Official description is explicitly bergamot-led with cedar and orange blossom support; amber and vanilla sweeten the base but do not displace the citrus core.',
        jsonb_build_object(
          'source_url', 'https://alexandriafragrances.com/products/sparkling-bergamot',
          'source_confidence', 0.99,
          'official_notes', jsonb_build_array('bergamot','cedar','orange blossom petals','amber','vanilla'),
          'helper', jsonb_build_object(
            'suggested_family_key', null,
            'confidence', 0.25,
            'why', 'woody-clean signal too weak'
          ),
          'material_signals', jsonb_build_array('bergamot lift','orange lift','vanilla sweet base'),
          'review_basis', 'manual override toward citrus-cologne because the dominant official structure is bright bergamot rather than woody-clean woods'
        )
      ),
      (
        '9befd638-82c6-486e-89f7-f26a8ecef0b4'::uuid,
        'Sugi Noir',
        'Alexandria Fragrances',
        'woody-clean',
        0.79::numeric,
        'official_alexandria_manual_review',
        'Official note pyramid is dominated by hinoki, cypress, cedarwood, vetiver, soft musk, and aromatic herbs; this is a clean dry woods profile rather than amber or citrus.',
        jsonb_build_object(
          'source_url', 'https://alexandriafragrances.com/products/sugi-noir',
          'source_confidence', 0.99,
          'official_notes', jsonb_build_array('hinoki wood','cypress','cedarwood','incense','aromatic herbs','soft musk','vetiver','fresh spices'),
          'helper', jsonb_build_object(
            'suggested_family_key', null,
            'confidence', 0.25,
            'why', 'woody-clean signal too weak'
          ),
          'material_signals', jsonb_build_array('vetiver fixative','incense resin anchor','aromatic lift'),
          'review_basis', 'manual override toward woody-clean because woods and clean aromatic structure clearly dominate the official note pyramid'
        )
      ),
      (
        'a67fb37e-193a-44fc-99a7-e41788d296fb'::uuid,
        'Tea Rainfall',
        'Alexandria Fragrances',
        'woody-clean',
        0.73::numeric,
        'official_alexandria_manual_review',
        'Official structure blends citrus and tea into light woods and clean musk; the clean woody drydown and airy tea profile fit woody-clean more than a classic citrus-cologne lane.',
        jsonb_build_object(
          'source_url', 'https://alexandriafragrances.com/products/tea-rainfall',
          'source_confidence', 0.99,
          'official_notes', jsonb_build_array('lemongrass','fresh citrus','magnolia','green tea','soft florals','light woods','clean musk'),
          'helper', jsonb_build_object(
            'suggested_family_key', null,
            'confidence', 0.25,
            'why', 'woody-clean signal too weak'
          ),
          'material_signals', jsonb_build_array('clean musk fixative','tea lift','citrus lift'),
          'review_basis', 'manual override toward woody-clean because light woods and clean musk carry the fragrance identity beyond the opening citrus'
        )
      ),
      (
        '090bdcc8-5239-4fc3-a14f-562d2058aeb8'::uuid,
        'Turin 21',
        'Alexandria Fragrances',
        'citrus-cologne',
        0.80::numeric,
        'official_alexandria_manual_review',
        'Official note pyramid is mint, lemon, basil, thyme, rosemary, verbena, and lavender over light musk; helper already leans citrus-cologne and the aromatic citrus structure clearly leads.',
        jsonb_build_object(
          'source_url', 'https://alexandriafragrances.com/products/turin21',
          'source_confidence', 0.99,
          'official_notes', jsonb_build_array('mint','lemon','basil','thyme','jasmine','rosemary','blackcurrant','lavender','musk','verbena'),
          'helper', jsonb_build_object(
            'suggested_family_key', 'citrus-cologne',
            'confidence', 0.68,
            'why', 'aromatic, citrus'
          ),
          'material_signals', jsonb_build_array('mint lift','lemon lift','musk fixative'),
          'review_basis', 'manual confirmation of helper output because the official structure is unmistakably bright aromatic citrus'
        )
      )
  ) as t(
    fragrance_id,
    fragrance_name,
    fragrance_brand,
    new_family_key,
    evidence_confidence,
    evidence_source,
    assignment_reason,
    evidence_json
  )
),
family_update as (
  update public.fragrances f
  set
    family_key = p.new_family_key,
    updated_at = now()
  from payload p
  where f.id = p.fragrance_id
    and f.family_key is null
  returning
    f.id as fragrance_id,
    f.name as fragrance_name,
    f.brand as fragrance_brand,
    null::text as old_family_key,
    p.new_family_key,
    p.evidence_source,
    p.evidence_confidence,
    p.evidence_json,
    p.assignment_reason
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
  u.fragrance_id,
  u.fragrance_name,
  u.fragrance_brand,
  u.old_family_key,
  u.new_family_key,
  u.evidence_source,
  u.evidence_confidence,
  u.evidence_json,
  u.assignment_reason,
  'odara_source_backed_family_review_2026_05_20'
from family_update u;

commit;
