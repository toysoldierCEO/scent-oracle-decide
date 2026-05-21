begin;

do $$
declare
  v_missing_targets text[];
begin
  with payload as (
    select * from (
      values
        (
          '9cd69cc6-4e26-4405-8dba-4b5280360a48'::uuid,
          'Cairo Summer',
          'Alexandria Fragrances',
          'Cairo Summer',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/cairo-summer',
          0.99::numeric,
          'matched',
          array['green notes','neroli','amber','virginia cedar']::text[],
          null::text[],
          null::text[],
          null::text[],
          null::text[],
          'skip_existing_canonical',
          jsonb_build_object(
            'official_excerpt',
            'Official Alexandria product page describes bold notes of fresh greens and sweet neroli with a hint of amber and Virginia cedar.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          '9befd638-82c6-486e-89f7-f26a8ecef0b4'::uuid,
          'Sugi Noir',
          'Alexandria Fragrances',
          'Sugi Noir',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/sugi-noir',
          0.99::numeric,
          'matched',
          array['hinoki wood','cypress','cedarwood','incense','aromatic herbs','soft musk','vetiver','fresh spices']::text[],
          null::text[],
          array['hinoki wood','cypress']::text[],
          array['cedarwood','incense','aromatic herbs']::text[],
          array['soft musk','vetiver','fresh spices']::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Fragrance Notes – Sugi Noir. Top Notes: Hinoki wood, Cypress. Middle Notes: Cedarwood, Incense, Aromatic herbs. Base Notes: Soft musk, Vetiver, Fresh spices.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          'b212a5ff-9365-4029-a8a6-f2f5b3351279'::uuid,
          'Bleu Mémoire L’Exclusif',
          'Alexandria Fragrances',
          'Bleu Mémoire L’Exclusif',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/bleu-memoire-lexclusif',
          0.99::numeric,
          'matched',
          null::text[],
          array['woody','amber','powdery','musky','balsamic']::text[],
          null::text[],
          null::text[],
          null::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Main Accords: Woody, Amber, Powdery, Musky, Balsamic.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          '86b3eab8-6a10-437e-90d9-54c4a41ed8de'::uuid,
          'Blue Turquoise',
          'Alexandria Fragrances',
          'Blue Turquoise',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/blue-turquoise',
          0.99::numeric,
          'matched',
          array['ylang-ylang','indian jasmine','nagarmotha','vanilla','green moss','sandalwood']::text[],
          array['amber spicy','salty','spicy','sweet']::text[],
          null::text[],
          array['ylang-ylang','indian jasmine','nagarmotha']::text[],
          array['vanilla','green moss','sandalwood']::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Official page describes an amber spicy fragrance with salty, spicy, and sweet notes; heart notes of ylang-ylang, Indian jasmine, and nagarmotha; and base notes of vanilla, moss, and sandalwood.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          '29818d76-cb39-4349-86c9-f1c39d9a5b73'::uuid,
          'Cagliari',
          'Alexandria Fragrances',
          'Cagliari',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/cagliari-inspired-by-papilefiko-nishane',
          0.99::numeric,
          'matched',
          array['coriander','cardamom','lavender','artemisia','fir balsam','moss']::text[],
          null::text[],
          array['coriander','cardamom']::text[],
          array['lavender','artemisia']::text[],
          array['fir balsam','moss']::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Official page states top notes of coriander and cardamom, heart of lavender and artemisia, and base of fir balsam and moss.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          '68c00144-0a80-4ed5-9016-237aa83b5b81'::uuid,
          'Ghostbusters',
          'Alexandria Fragrances',
          'Ghostbusters',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/ghostbusters-inspired-by-mojave-ghost-byredo',
          0.99::numeric,
          'matched',
          array['magnolia','violet','sapodilla','ambergris']::text[],
          array['fruity','floral','woody']::text[],
          null::text[],
          null::text[],
          null::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Official page describes a blend of Magnolia, Violet, Sapodilla, and Ambergris with a fruity and floral opening followed by woody notes.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          'f7ea787d-3838-416a-bcea-1cf793232382'::uuid,
          'Japanese Princess',
          'Alexandria Fragrances',
          'Japanese Princess',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/japanese-princess-inspired-by-matsukita-clive-christian',
          0.99::numeric,
          'matched',
          array['bergamot','pink pepper','nutmeg','chinese jasmine','jasmine sambac','smoky mate','guaiac wood','balsam fir','musk']::text[],
          null::text[],
          array['bergamot','pink pepper','nutmeg']::text[],
          array['chinese jasmine','jasmine sambac','smoky mate','guaiac wood']::text[],
          array['balsam fir','musk','woodsy notes']::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Official page describes bergamot, pink pepper, and nutmeg in the opening; Chinese jasmine, jasmine sambac, smoky mate, and guaiac wood in the heart; and balsam fir, musk, and woodsy notes in the base.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          '59619159-2198-4b24-bb09-d15cab0be80a'::uuid,
          'Sichuan Tea X',
          'Alexandria Fragrances',
          'Sichuan Tea X',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/shichuan-tea-x',
          0.99::numeric,
          'matched',
          array['kumquat','lemon','lime','sichuan pepper','jasmine','sichuan tea leaves','peppermint','white tea','musk','bamboo']::text[],
          null::text[],
          array['kumquat','lemon','lime','sichuan pepper']::text[],
          array['jasmine','sichuan tea leaves','peppermint','white tea']::text[],
          array['musk','bamboo']::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Official page describes kumquat, lemon, lime, and Sichuan pepper in the opening; jasmine, Sichuan tea leaves, peppermint, and white tea in the heart; and musk and bamboo in the base.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          'b267df6b-3bab-4e6d-a6ea-15eeeaed7e54'::uuid,
          'Smooth Sailing',
          'Alexandria Fragrances',
          'Smooth Sailing',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/smooth-sailing',
          0.99::numeric,
          'matched',
          array['candied fruits','boozy liqueur','incense']::text[],
          array['marine','saltwater','fresh air','powdery','amber']::text[],
          array['candied fruits','boozy liqueur']::text[],
          array['saltwater','fresh air']::text[],
          array['incense','amber']::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Official page describes opening notes of candied fruits and sweet boozy liqueur, marine mists with saltwater and fresh air accords, and a drydown of powdery incense grains and amber.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          'f8066a44-e897-44f0-b168-bf14d35f1a7b'::uuid,
          'Sparkling Bergamot',
          'Alexandria Fragrances',
          'Sparkling Bergamot',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/sparkling-bergamot',
          0.99::numeric,
          'matched',
          array['bergamot','cedar','orange blossom petals','amber','vanilla']::text[],
          null::text[],
          null::text[],
          null::text[],
          null::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Official page describes bergamot rounded by cedar, orange blossom petals, amber, and vanilla.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          'a67fb37e-193a-44fc-99a7-e41788d296fb'::uuid,
          'Tea Rainfall',
          'Alexandria Fragrances',
          'Tea Rainfall',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/tea-rainfall',
          0.99::numeric,
          'matched',
          array['lemongrass','fresh citrus','magnolia','green tea','soft florals','light woods','clean musk']::text[],
          null::text[],
          array['lemongrass','fresh citrus']::text[],
          array['magnolia','green tea','soft florals']::text[],
          array['light woods','clean musk']::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Official page lists top notes of lemongrass and fresh citrus, heart notes of magnolia, green tea, and soft florals, and base notes of light woods and clean musk.',
            'source_type',
            'official_product_page'
          )
        ),
        (
          '090bdcc8-5239-4fc3-a14f-562d2058aeb8'::uuid,
          'Turin 21',
          'Alexandria Fragrances',
          'Turin 21',
          'Alexandria Fragrances',
          'https://alexandriafragrances.com/products/turin21',
          0.99::numeric,
          'matched',
          array['mint','lemon','basil','thyme','jasmine','rosemary','blackcurrant','lavender','musk','verbena']::text[],
          null::text[],
          array['mint','lemon','basil','thyme']::text[],
          array['jasmine','rosemary','blackcurrant','lavender']::text[],
          array['musk','verbena']::text[],
          'promote_exact_official',
          jsonb_build_object(
            'official_excerpt',
            'Official page lists top notes of mint, lemon, basil, and thyme, middle notes of jasmine, rosemary, blackcurrant, and lavender, and base notes of musk and verbena.',
            'source_type',
            'official_product_page'
          )
        )
    ) as t(
      fragrance_id,
      fragrance_name,
      fragrance_brand,
      source_name,
      source_brand,
      source_url,
      source_confidence,
      identity_match_status,
      notes,
      accords,
      top_notes,
      heart_notes,
      base_notes,
      canonical_write_mode,
      source_evidence_json
    )
  )
  select array_agg(format('%s [%s]', p.fragrance_name, p.fragrance_id))
  into v_missing_targets
  from payload p
  left join public.fragrances f
    on f.id = p.fragrance_id
   and f.name = p.fragrance_name
   and f.brand = p.fragrance_brand
  where f.id is null;

  if coalesce(array_length(v_missing_targets, 1), 0) > 0 then
    raise exception
      'Official Alexandria blocker import aborted; missing target fragrance rows: %',
      array_to_string(v_missing_targets, '; ');
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
        'Cairo Summer',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/cairo-summer',
        0.99::numeric,
        'matched',
        array['green notes','neroli','amber','virginia cedar']::text[],
        null::text[],
        null::text[],
        null::text[],
        null::text[],
        'skip_existing_canonical',
        jsonb_build_object(
          'official_excerpt',
          'Official Alexandria product page describes bold notes of fresh greens and sweet neroli with a hint of amber and Virginia cedar.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        '9befd638-82c6-486e-89f7-f26a8ecef0b4'::uuid,
        'Sugi Noir',
        'Alexandria Fragrances',
        'Sugi Noir',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/sugi-noir',
        0.99::numeric,
        'matched',
        array['hinoki wood','cypress','cedarwood','incense','aromatic herbs','soft musk','vetiver','fresh spices']::text[],
        null::text[],
        array['hinoki wood','cypress']::text[],
        array['cedarwood','incense','aromatic herbs']::text[],
        array['soft musk','vetiver','fresh spices']::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Fragrance Notes – Sugi Noir. Top Notes: Hinoki wood, Cypress. Middle Notes: Cedarwood, Incense, Aromatic herbs. Base Notes: Soft musk, Vetiver, Fresh spices.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        'b212a5ff-9365-4029-a8a6-f2f5b3351279'::uuid,
        'Bleu Mémoire L’Exclusif',
        'Alexandria Fragrances',
        'Bleu Mémoire L’Exclusif',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/bleu-memoire-lexclusif',
        0.99::numeric,
        'matched',
        null::text[],
        array['woody','amber','powdery','musky','balsamic']::text[],
        null::text[],
        null::text[],
        null::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Main Accords: Woody, Amber, Powdery, Musky, Balsamic.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        '86b3eab8-6a10-437e-90d9-54c4a41ed8de'::uuid,
        'Blue Turquoise',
        'Alexandria Fragrances',
        'Blue Turquoise',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/blue-turquoise',
        0.99::numeric,
        'matched',
        array['ylang-ylang','indian jasmine','nagarmotha','vanilla','green moss','sandalwood']::text[],
        array['amber spicy','salty','spicy','sweet']::text[],
        null::text[],
        array['ylang-ylang','indian jasmine','nagarmotha']::text[],
        array['vanilla','green moss','sandalwood']::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Official page describes an amber spicy fragrance with salty, spicy, and sweet notes; heart notes of ylang-ylang, Indian jasmine, and nagarmotha; and base notes of vanilla, moss, and sandalwood.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        '29818d76-cb39-4349-86c9-f1c39d9a5b73'::uuid,
        'Cagliari',
        'Alexandria Fragrances',
        'Cagliari',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/cagliari-inspired-by-papilefiko-nishane',
        0.99::numeric,
        'matched',
        array['coriander','cardamom','lavender','artemisia','fir balsam','moss']::text[],
        null::text[],
        array['coriander','cardamom']::text[],
        array['lavender','artemisia']::text[],
        array['fir balsam','moss']::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Official page states top notes of coriander and cardamom, heart of lavender and artemisia, and base of fir balsam and moss.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        '68c00144-0a80-4ed5-9016-237aa83b5b81'::uuid,
        'Ghostbusters',
        'Alexandria Fragrances',
        'Ghostbusters',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/ghostbusters-inspired-by-mojave-ghost-byredo',
        0.99::numeric,
        'matched',
        array['magnolia','violet','sapodilla','ambergris']::text[],
        array['fruity','floral','woody']::text[],
        null::text[],
        null::text[],
        null::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Official page describes a blend of Magnolia, Violet, Sapodilla, and Ambergris with a fruity and floral opening followed by woody notes.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        'f7ea787d-3838-416a-bcea-1cf793232382'::uuid,
        'Japanese Princess',
        'Alexandria Fragrances',
        'Japanese Princess',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/japanese-princess-inspired-by-matsukita-clive-christian',
        0.99::numeric,
        'matched',
        array['bergamot','pink pepper','nutmeg','chinese jasmine','jasmine sambac','smoky mate','guaiac wood','balsam fir','musk']::text[],
        null::text[],
        array['bergamot','pink pepper','nutmeg']::text[],
        array['chinese jasmine','jasmine sambac','smoky mate','guaiac wood']::text[],
        array['balsam fir','musk','woodsy notes']::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Official page describes bergamot, pink pepper, and nutmeg in the opening; Chinese jasmine, jasmine sambac, smoky mate, and guaiac wood in the heart; and balsam fir, musk, and woodsy notes in the base.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        '59619159-2198-4b24-bb09-d15cab0be80a'::uuid,
        'Sichuan Tea X',
        'Alexandria Fragrances',
        'Sichuan Tea X',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/shichuan-tea-x',
        0.99::numeric,
        'matched',
        array['kumquat','lemon','lime','sichuan pepper','jasmine','sichuan tea leaves','peppermint','white tea','musk','bamboo']::text[],
        null::text[],
        array['kumquat','lemon','lime','sichuan pepper']::text[],
        array['jasmine','sichuan tea leaves','peppermint','white tea']::text[],
        array['musk','bamboo']::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Official page describes kumquat, lemon, lime, and Sichuan pepper in the opening; jasmine, Sichuan tea leaves, peppermint, and white tea in the heart; and musk and bamboo in the base.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        'b267df6b-3bab-4e6d-a6ea-15eeeaed7e54'::uuid,
        'Smooth Sailing',
        'Alexandria Fragrances',
        'Smooth Sailing',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/smooth-sailing',
        0.99::numeric,
        'matched',
        array['candied fruits','boozy liqueur','incense']::text[],
        array['marine','saltwater','fresh air','powdery','amber']::text[],
        array['candied fruits','boozy liqueur']::text[],
        array['saltwater','fresh air']::text[],
        array['incense','amber']::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Official page describes opening notes of candied fruits and sweet boozy liqueur, marine mists with saltwater and fresh air accords, and a drydown of powdery incense grains and amber.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        'f8066a44-e897-44f0-b168-bf14d35f1a7b'::uuid,
        'Sparkling Bergamot',
        'Alexandria Fragrances',
        'Sparkling Bergamot',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/sparkling-bergamot',
        0.99::numeric,
        'matched',
        array['bergamot','cedar','orange blossom petals','amber','vanilla']::text[],
        null::text[],
        null::text[],
        null::text[],
        null::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Official page describes bergamot rounded by cedar, orange blossom petals, amber, and vanilla.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        'a67fb37e-193a-44fc-99a7-e41788d296fb'::uuid,
        'Tea Rainfall',
        'Alexandria Fragrances',
        'Tea Rainfall',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/tea-rainfall',
        0.99::numeric,
        'matched',
        array['lemongrass','fresh citrus','magnolia','green tea','soft florals','light woods','clean musk']::text[],
        null::text[],
        array['lemongrass','fresh citrus']::text[],
        array['magnolia','green tea','soft florals']::text[],
        array['light woods','clean musk']::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Official page lists top notes of lemongrass and fresh citrus, heart notes of magnolia, green tea, and soft florals, and base notes of light woods and clean musk.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      ),
      (
        '090bdcc8-5239-4fc3-a14f-562d2058aeb8'::uuid,
        'Turin 21',
        'Alexandria Fragrances',
        'Turin 21',
        'Alexandria Fragrances',
        'https://alexandriafragrances.com/products/turin21',
        0.99::numeric,
        'matched',
        array['mint','lemon','basil','thyme','jasmine','rosemary','blackcurrant','lavender','musk','verbena']::text[],
        null::text[],
        array['mint','lemon','basil','thyme']::text[],
        array['jasmine','rosemary','blackcurrant','lavender']::text[],
        array['musk','verbena']::text[],
        'promote_exact_official',
        jsonb_build_object(
          'official_excerpt',
          'Official page lists top notes of mint, lemon, basil, and thyme, middle notes of jasmine, rosemary, blackcurrant, and lavender, and base notes of musk and verbena.',
          'source_type',
          'official_product_page',
          'import_batch',
          'alexandria_official_blockers_2026_05_20'
        )
      )
  ) as t(
    fragrance_id,
    fragrance_name,
    fragrance_brand,
    source_name,
    source_brand,
    source_url,
    source_confidence,
    identity_match_status,
    notes,
    accords,
    top_notes,
    heart_notes,
    base_notes,
    canonical_write_mode,
    source_evidence_json
  )
),
family_candidates as (
  select * from (
    values
      (
        '29818d76-cb39-4349-86c9-f1c39d9a5b73'::uuid,
        'Cagliari',
        'Alexandria Fragrances',
        null::text,
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
        null::text,
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
    old_family_key,
    new_family_key,
    evidence_confidence,
    evidence_source,
    assignment_reason,
    evidence_json
  )
),
enrichment_upsert as (
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
    case
      when p.canonical_write_mode = 'skip_existing_canonical' then 'skipped_existing_good_data'
      else 'already_enriched'
    end,
    p.source_url,
    p.source_confidence,
    p.source_name,
    p.source_brand,
    fc.new_family_key,
    f.concentration,
    coalesce(p.notes, '{}'::text[]),
    coalesce(p.accords, '{}'::text[]),
    jsonb_build_object(
      'official_source_import', true,
      'source_name', p.source_name,
      'source_brand', p.source_brand,
      'identity_match_status', p.identity_match_status,
      'top_notes', p.top_notes,
      'heart_notes', p.heart_notes,
      'base_notes', p.base_notes,
      'extraction_method', 'manual_official_product_page_review',
      'import_batch', 'alexandria_official_blockers_2026_05_20',
      'source_evidence', p.source_evidence_json
    ),
    null,
    now(),
    now()
  from payload p
  join public.fragrances f
    on f.id = p.fragrance_id
  left join family_candidates fc
    on fc.fragrance_id = p.fragrance_id
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
    last_error = null,
    last_enriched_at = excluded.last_enriched_at,
    updated_at = excluded.updated_at
  returning fragrance_id
),
canonical_enrichment_patch as (
  update public.fragrances f
  set
    notes = coalesce(p.notes, f.notes),
    accords = coalesce(p.accords, f.accords),
    top_notes = coalesce(p.top_notes, f.top_notes),
    heart_notes = coalesce(p.heart_notes, f.heart_notes),
    base_notes = coalesce(p.base_notes, f.base_notes),
    data_source = 'alexandria_official_import_v1',
    source_url = p.source_url,
    source_confidence = p.source_confidence::text,
    enriched_at = now(),
    updated_at = now()
  from payload p
  where f.id = p.fragrance_id
    and p.canonical_write_mode = 'promote_exact_official'
  returning f.id
),
family_patch as (
  update public.fragrances f
  set
    family_key = fc.new_family_key,
    updated_at = now()
  from family_candidates fc
  where f.id = fc.fragrance_id
    and (f.family_key is null or f.family_key <> fc.new_family_key)
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
  fc.fragrance_id,
  fc.fragrance_name,
  fc.fragrance_brand,
  fc.old_family_key,
  fc.new_family_key,
  fc.evidence_source,
  fc.evidence_confidence,
  fc.evidence_json,
  fc.assignment_reason,
  'odara_official_source_import_2026_05_20'
from family_candidates fc
where exists (
  select 1
  from public.fragrances f
  where f.id = fc.fragrance_id
    and f.family_key = fc.new_family_key
)
and not exists (
  select 1
  from public.fragrance_family_assignment_audit_v1 audit
  where audit.fragrance_id = fc.fragrance_id
    and audit.new_family_key = fc.new_family_key
    and audit.assigned_by = 'odara_official_source_import_2026_05_20'
);

commit;
