import { describe, expect, it } from 'vitest';

import {
  buildFragellaProviderDiscovery,
  classifyTarget,
  runFragellaFirstProviderLane,
  shouldRunFragellaProviderForIntakeTarget,
} from '../../tools/enrichment/vesperizer_intake_autopilot_v1.mjs';

const baseBlankBrandTarget = {
  id: 'intake-sienna',
  submitted_name: 'Sienna Brume',
  submitted_brand: null,
  desired_status: 'owned',
  request_status: 'pending',
  canonical_fragrance_id: null,
  canonical_collection_status: null,
  canonical: null,
};

const mihanCandidate = {
  name: 'Sienna Brume',
  brand: 'Mihan Aromatics',
  source_url: 'https://mihanaromatics.com/product/sienna-brume',
  source_type: 'official_brand',
  confidence: 0.92,
  confidence_reasons: [
    'source text contains exact submitted fragrance name',
    'source text contains candidate brand',
  ],
  ambiguity_warnings: [],
  next_action: 'review candidate; if accepted, continue source/evidence capture using this brand',
};

const skippedSourceDiscovery = {
  status: 'skipped_identity_candidate_ready',
  attempts: [],
  best: null,
};

const canonicalProfileWithoutPerformance = {
  id: 'fragrance-sienna',
  name: 'Sienna Brume',
  brand: 'Mihan Aromatics',
  exact: true,
  confidence: 0.99,
  family_key: 'fresh-floral',
  notes: ['Tangerine', 'Amber'],
  top_notes: [],
  heart_notes: [],
  base_notes: [],
  source_url: 'https://mihanaromatics.com/product/sienna-brume',
  longevity_score: null,
  projection_score: null,
};

const notForSaleTarget = {
  id: 'intake-not-for-sale',
  submitted_name: 'Not For Sale',
  submitted_brand: 'Alexandria Fragrances',
  submitted_source_url: 'https://alexandriafragrances.com/products/not-for-sale',
  desired_status: 'owned',
  request_status: 'pending',
  canonical_fragrance_id: null,
  canonical_collection_status: null,
  canonical: null,
};

describe('vesperizer intake identity resolver', () => {
  it('routes a blank-brand exact identity candidate to identity_candidates_ready', () => {
    const result = classifyTarget(
      baseBlankBrandTarget,
      [],
      null,
      {
        status: 'identity_candidates_ready',
        attempts: [],
        candidates: [mihanCandidate],
      },
      skippedSourceDiscovery,
    );

    expect(result.summary.state).toBe('identity_candidates_ready');
    expect(result.summary.sourceNotFound).toBeUndefined();
    expect(result.sourceNotFound).toBeNull();
    expect(result.identityCandidates).toHaveLength(1);
    expect(result.identityCandidates[0]).toMatchObject({
      intake_id: 'intake-sienna',
      name: 'Sienna Brume',
      brand: 'Mihan Aromatics',
      source_type: 'official_brand',
      confidence: 0.92,
    });
    expect(result.summary.next_action).toContain('selected brand');
  });

  it('routes multiple plausible identity candidates to confirmation', () => {
    const secondCandidate = {
      ...mihanCandidate,
      brand: 'Example House',
      source_url: 'https://example.com/product/sienna-brume',
      confidence: 0.74,
      ambiguity_warnings: ['secondary plausible identity'],
    };

    const result = classifyTarget(
      baseBlankBrandTarget,
      [],
      null,
      {
        status: 'needs_identity_confirmation',
        attempts: [],
        candidates: [mihanCandidate, secondCandidate],
      },
      skippedSourceDiscovery,
    );

    expect(result.summary.state).toBe('needs_identity_confirmation');
    expect(result.needsReview?.review_type).toBe('identity_confirmation');
    expect(result.identityCandidates.map((candidate) => candidate.brand)).toEqual([
      'Mihan Aromatics',
      'Example House',
    ]);
  });

  it('uses source_not_found only after identity discovery and source discovery both fail', () => {
    const result = classifyTarget(
      baseBlankBrandTarget,
      [],
      null,
      {
        status: 'no_identity_candidates',
        attempts: [{ url: 'https://example.com/product/sienna-brume', status: 'fetch_failed' }],
        candidates: [],
      },
      {
        status: 'no_source_candidates',
        attempts: [],
        best: null,
      },
    );

    expect(result.summary.state).toBe('source_not_found_after_attempts');
    expect(result.summary.identity_summary.status).toBe('no_identity_candidates');
    expect(result.sourceNotFound).toMatchObject({
      state: 'source_not_found_after_attempts',
      next_action: 'manual source search or add exact official URL to intake',
    });
  });

  it('uses a selected identity candidate to continue into source-backed canonical candidate review', () => {
    const selectedTarget = {
      ...baseBlankBrandTarget,
      submitted_brand: 'Mihan Aromatics',
      selected_identity_candidate: {
        candidate_name: 'Sienna Brume',
        candidate_brand: 'Mihan Aromatics',
        candidate_source_url: 'https://mihanaromatics.com/product/sienna-brume',
        source_type: 'official_brand',
        confidence: 0.92,
        selection_state: 'auto_selected',
      },
    };

    const result = classifyTarget(
      selectedTarget,
      [],
      null,
      {
        status: 'selected_identity_candidate',
        attempts: [],
        candidates: [{
          ...mihanCandidate,
          candidate_id: 'candidate-id',
          selection_state: 'auto_selected',
        }],
      },
      {
        status: 'official_source_found',
        attempts: [{
          url: 'https://mihanaromatics.com/product/sienna-brume',
          status: 'fetched',
          source_type: 'official_brand',
          identity: {
            exact_name_support: true,
            brand_support: true,
            url_identity_support: true,
            confidence: 0.86,
          },
        }],
        best: {
          url: 'https://mihanaromatics.com/product/sienna-brume',
          source_type: 'official_brand',
          identity: {
            exact_name_support: true,
            brand_support: true,
            url_identity_support: true,
            confidence: 0.86,
          },
        },
      },
    );

    expect(result.summary.state).toBe('canonical_candidate_ready');
    expect(result.summary.identity_summary.status).toBe('selected_identity_candidate');
    expect(result.summary.source_summary.status).toBe('official_source_found');
    expect(result.canonicalCandidate).toMatchObject({
      submitted_name: 'Sienna Brume',
      submitted_brand: 'Mihan Aromatics',
      source_type: 'official_brand',
      confidence: 0.86,
    });
    expect(result.sourceNotFound).toBeNull();
  });

  it('runs Fragella first even when the missing scent intake already has a supplied brand', async () => {
    expect(shouldRunFragellaProviderForIntakeTarget(notForSaleTarget, null)).toBe(true);

    const providerDiscovery = await runFragellaFirstProviderLane(
      notForSaleTarget,
      {
        provider: 'Fragella',
        configured: true,
        apiKey: 'test-key-not-a-secret',
        apiBaseUrl: 'https://provider.example/api',
      },
      {
        enabled: true,
        queryProvider: async () => ({
          ok: false,
          status: 'provider_identity_rejected',
          http_status: 200,
          query: 'Alexandria Fragrances Not For Sale',
          reason: 'Fragella provider returned hits, but the identity guard rejected them for this target.',
        }),
      },
    );

    expect(providerDiscovery).toMatchObject({
      provider: 'Fragella',
      invoked: true,
      ordered_before_official: true,
      status: 'provider_identity_rejected',
      identity_guard_result: 'rejected',
      rejection_reason: 'wrong_name_or_brand',
      fields_used: false,
      official_registry_eligible: false,
    });

    const result = classifyTarget(
      notForSaleTarget,
      [],
      null,
      {
        status: 'provider_identity_rejected_brand_supplied',
        attempts: [],
        candidates: [],
        provider_status: 'provider_identity_rejected',
        provider_identity_guard_result: 'rejected',
        provider_rejection_reason: 'wrong_name_or_brand',
      },
      {
        status: 'official_source_found',
        attempts: [{
          url: 'https://alexandriafragrances.com/products/not-for-sale',
          status: 'fetched',
          source_type: 'official_brand',
          identity: {
            exact_name_support: true,
            brand_support: true,
            url_identity_support: true,
            confidence: 0.86,
          },
        }],
        best: {
          url: 'https://alexandriafragrances.com/products/not-for-sale',
          source_type: 'official_brand',
          identity: {
            exact_name_support: true,
            brand_support: true,
            url_identity_support: true,
            confidence: 0.86,
          },
        },
      },
      providerDiscovery,
    );

    expect(result.summary.state).toBe('canonical_candidate_ready');
    expect(result.summary.provider_summary).toMatchObject({
      invoked: true,
      ordered_before_official: true,
      identity_guard_result: 'rejected',
      rejection_reason: 'wrong_name_or_brand',
      fields_used: false,
      official_registry_eligible: false,
    });
    expect(result.summary.source_summary.status).toBe('official_source_found');
    expect(result.sourceNotFound).toBeNull();
    expect(result.canonicalCandidate).toMatchObject({
      submitted_name: 'Not For Sale',
      submitted_brand: 'Alexandria Fragrances',
      source_type: 'official_brand',
      confidence: 0.86,
    });
  });

  it('keeps accepted Fragella data non-official and outside official evidence fields', () => {
    const discovery = buildFragellaProviderDiscovery(
      { name: 'Not For Sale', brand: 'Alexandria Fragrances' },
      {
        ok: true,
        status: 'success',
        http_status: 200,
        query: 'Alexandria Fragrances Not For Sale',
        hit: {
          name: 'Not For Sale',
          brand: 'Alexandria Fragrances',
          notes: ['Grapefruit', 'Bergamot'],
          accords: ['citrus', 'fresh'],
        },
      },
    );

    expect(discovery).toMatchObject({
      provider: 'Fragella',
      invoked: true,
      ordered_before_official: true,
      identity_guard_result: 'accepted',
      provider_data_non_official: true,
      official_registry_eligible: false,
      fields_used: false,
    });
    expect(discovery.provider_fields_available).toMatchObject({
      identity: true,
      brand: true,
      notes: true,
      accords: true,
    });
  });

  it('treats owned Collection scents with usable profiles as recommendation eligible even without performance', () => {
    const result = classifyTarget(
      {
        ...baseBlankBrandTarget,
        canonical_fragrance_id: 'fragrance-sienna',
        canonical_collection_status: 'owned',
      },
      [canonicalProfileWithoutPerformance],
      canonicalProfileWithoutPerformance,
      { status: 'not_needed', attempts: [], candidates: [] },
      { status: 'not_needed', attempts: [], best: null },
    );

    expect(result.summary.state).toBe('matched_existing_catalog');
    expect(result.summary.canonical_profile).toMatchObject({
      collection_status: 'owned',
      collection_recommendation_eligible: true,
      recommendation_ready: true,
      layer_ready: true,
      performance_present: false,
      performance_confidence: 'wear_strength_not_verified',
      recommendation_gate_reason: 'owned_collection_profile_present_wear_strength_not_verified',
    });
  });

  it('excludes Retired and Disliked scents from recommendation rotation', () => {
    const retired = classifyTarget(
      {
        ...baseBlankBrandTarget,
        canonical_fragrance_id: 'fragrance-sienna',
        canonical_collection_status: 'retired',
      },
      [canonicalProfileWithoutPerformance],
      canonicalProfileWithoutPerformance,
      { status: 'not_needed', attempts: [], candidates: [] },
      { status: 'not_needed', attempts: [], best: null },
    );

    const disliked = classifyTarget(
      {
        ...baseBlankBrandTarget,
        canonical_fragrance_id: 'fragrance-sienna',
        canonical_collection_status: 'disliked',
      },
      [canonicalProfileWithoutPerformance],
      canonicalProfileWithoutPerformance,
      { status: 'not_needed', attempts: [], candidates: [] },
      { status: 'not_needed', attempts: [], best: null },
    );

    expect(retired.summary.canonical_profile).toMatchObject({
      recommendation_ready: false,
      layer_ready: false,
      recommendation_gate_reason: 'retired_explicitly_removed_from_rotation',
    });
    expect(disliked.summary.canonical_profile).toMatchObject({
      recommendation_ready: false,
      layer_ready: false,
      recommendation_gate_reason: 'disliked_hard_negative',
    });
  });

  it('does not treat Wishlist as owned Collection recommendation pool', () => {
    const result = classifyTarget(
      {
        ...baseBlankBrandTarget,
        canonical_fragrance_id: 'fragrance-sienna',
        canonical_collection_status: 'wishlist',
      },
      [canonicalProfileWithoutPerformance],
      canonicalProfileWithoutPerformance,
      { status: 'not_needed', attempts: [], candidates: [] },
      { status: 'not_needed', attempts: [], best: null },
    );

    expect(result.summary.canonical_profile).toMatchObject({
      collection_status: 'wishlist',
      recommendation_ready: false,
      layer_ready: false,
      recommendation_gate_reason: 'wishlist_is_purchase_intent_not_owned_collection',
    });
  });
});
