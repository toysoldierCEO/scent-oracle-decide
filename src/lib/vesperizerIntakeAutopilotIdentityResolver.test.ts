import { describe, expect, it } from 'vitest';

import { classifyTarget } from '../../tools/enrichment/vesperizer_intake_autopilot_v1.mjs';

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
});
