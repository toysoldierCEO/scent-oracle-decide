import { describe, expect, it } from 'vitest';

import { ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION } from './vesperResolverCompleteness';
import {
  hasCurrentVesperResolverSurfaceFields,
  mergeVesperResolverSurfaceFields,
} from './vesperResolverSurfaceMerge';

describe('vesper resolver surface merge', () => {
  it('treats current-version checked resolver fields as complete', () => {
    expect(hasCurrentVesperResolverSurfaceFields({
      vesper_community_evidence_checked: true,
      vesper_resolver_cache_version: ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION,
    })).toBe(true);
  });

  it('lets hydrated community evidence replace an unchecked detail seed', () => {
    const merged = mergeVesperResolverSurfaceFields(
      {
        vesper_intelligence: null,
        vesper_community_evidence: null,
        vesper_community_evidence_checked: false,
        vesper_resolver_cache_version: null,
      },
      {
        vesper_intelligence: { intelligence_source_type: 'official_brand' },
        vesper_metadata: { resolved_concentration: 'PARFUM' },
        vesper_community_evidence: {
          accords: ['Coconut', 'Green'],
          communityNotes: ['Cucumber'],
          sourceNames: ['Fragrantica'],
          trustLine: 'Community/provider evidence · Fragrantica',
        },
        vesper_community_evidence_checked: true,
        vesper_resolver_cache_version: ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION,
      },
    );

    expect(merged.vesper_community_evidence_checked).toBe(true);
    expect(merged.vesper_community_evidence).toMatchObject({
      sourceNames: ['Fragrantica'],
      accords: ['Coconut', 'Green'],
    });
    expect(merged.vesper_metadata).toEqual({ resolved_concentration: 'PARFUM' });
  });

  it('does not let stale incoming resolver fields replace a current checked surface', () => {
    const merged = mergeVesperResolverSurfaceFields(
      {
        vesper_community_evidence: {
          sourceNames: ['Fragrantica'],
          trustLine: 'Community/provider evidence · Fragrantica',
        },
        vesper_community_evidence_checked: true,
        vesper_resolver_cache_version: ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION,
      },
      {
        vesper_community_evidence: null,
        vesper_community_evidence_checked: true,
        vesper_resolver_cache_version: 'old-generation',
      },
    );

    expect(merged.vesper_community_evidence).toMatchObject({
      sourceNames: ['Fragrantica'],
    });
    expect(merged.vesper_resolver_cache_version).toBe(ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION);
  });
});
