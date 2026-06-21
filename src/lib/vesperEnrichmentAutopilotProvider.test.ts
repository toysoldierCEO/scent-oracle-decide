import { describe, expect, it } from 'vitest';

import {
  buildFragellaProviderHeaders,
  getFragellaProviderConfig,
  getVesperEnrichmentLaneOrder,
  normalizeFragellaProviderPayload,
} from '../../tools/enrichment/fragella_provider_client_v1.mjs';

const target = {
  name: 'Sienna Brume',
  brand: 'Mihan Aromatics',
};

describe('vesper enrichment Fragella provider lane', () => {
  it('runs Fragella before official verification and fallback lanes', () => {
    expect(getVesperEnrichmentLaneOrder()).toEqual([
      'fragella_provider',
      'official_brand_verification',
      'retailer_professional_community_fallback',
    ]);
  });

  it('supports preferred Fragella and compatibility Fragrella environment names without printing secrets', () => {
    expect(getFragellaProviderConfig({}).configured).toBe(false);

    const preferred = getFragellaProviderConfig({
      FRAGELLA_API_KEY: 'new-secret',
      FRAGELLA_API_BASE_URL: 'https://provider.example/v1/',
    });
    expect(preferred).toMatchObject({
      provider: 'Fragella',
      configured: true,
      apiKeyEnvName: 'FRAGELLA_API_KEY',
      apiBaseUrl: 'https://provider.example/v1',
    });

    const compatibility = getFragellaProviderConfig({
      FRAGRELLA_API_KEY: 'compatibility-secret',
      FRAGRELLA_API_BASE_URL: 'https://legacy.example/v1/',
    });
    expect(compatibility).toMatchObject({
      provider: 'Fragella',
      configured: true,
      apiKeyEnvName: 'FRAGRELLA_API_KEY',
      apiBaseUrl: 'https://legacy.example/v1',
    });
  });

  it('uses x-api-key auth without bearer headers', () => {
    const headers = buildFragellaProviderHeaders(getFragellaProviderConfig({
      FRAGELLA_API_KEY: 'header-test-secret',
    }));

    expect(headers).toMatchObject({
      'x-api-key': 'header-test-secret',
      accept: 'application/json',
    });
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('authorization');
  });

  it('normalizes Fragella payloads as non-official provider intelligence', () => {
    const normalized = normalizeFragellaProviderPayload(target, {
      name: 'Sienna Brume',
      brand: 'Mihan Aromatics',
      concentration: 'Eau de Parfum',
      confidence: 0.91,
      'Image URL Transparent': 'https://cdn.example/sienna.png',
      'Purchase URL': 'https://mihanaromatics.com/product/sienna-brume',
      Notes: {
        Top: ['Tangerine', 'Saffron'],
        Heart: ['Rose', 'Jasmine'],
        Base: ['Amber', 'Sandalwood'],
      },
      accords: ['amber', 'floral'],
      performance: {
        longevity: {
          moderate: 8,
          long_lasting: 16,
        },
        projection: {
          intimate: 3,
          moderate: 11,
        },
        sillage: {
          soft: 4,
          noticeable: 10,
        },
      },
    });

    expect(normalized).toMatchObject({
      provider: 'Fragella',
      official_registry_eligible: false,
      identity_supported: true,
      match_name: 'Sienna Brume',
      match_brand: 'Mihan Aromatics',
      concentration: 'Eau de Parfum',
      image_url: 'https://cdn.example/sienna.png',
      source_url: 'https://mihanaromatics.com/product/sienna-brume',
      source_confidence: 0.91,
    });
    expect(normalized.top_notes).toEqual(['Tangerine', 'Saffron']);
    expect(normalized.heart_notes).toEqual(['Rose', 'Jasmine']);
    expect(normalized.base_notes).toEqual(['Amber', 'Sandalwood']);
    expect(normalized.accords).toEqual(['amber', 'floral']);
    expect(normalized.community_performance).toMatchObject({
      provider: 'Fragella',
      evidence_type: 'community_performance',
      longevity_votes_total: 24,
      longevity_distribution: {
        moderate: 8,
        long_lasting: 16,
      },
      projection_votes_total: 14,
      sillage_votes_total: 14,
      source_confidence: null,
    });
  });

  it('does not invent source confidence when the provider payload omits it', () => {
    const normalized = normalizeFragellaProviderPayload(target, {
      name: 'Sienna Brume',
      brand: 'Mihan Aromatics',
      notes: ['Tangerine', 'Amber'],
    });

    expect(normalized.identity_supported).toBe(true);
    expect(normalized.source_confidence).toBeNull();
  });
});
