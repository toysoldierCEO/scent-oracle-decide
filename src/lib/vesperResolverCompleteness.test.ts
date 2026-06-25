import { describe, expect, it } from 'vitest';

import {
  ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION,
  isVesperResolverDetailCompleteForCache,
} from './vesperResolverCompleteness';

describe('isVesperResolverDetailCompleteForCache', () => {
  it('treats resolver-disabled details as complete without requiring resolver fields', () => {
    expect(isVesperResolverDetailCompleteForCache(null, true)).toBe(true);
    expect(isVesperResolverDetailCompleteForCache({}, true)).toBe(true);
  });

  it('does not treat legacy cached details as complete until community evidence has been fetched', () => {
    expect(isVesperResolverDetailCompleteForCache({
      vesper_intelligence: null,
      vesper_metadata: null,
    }, false)).toBe(false);
  });

  it('allows fetched official-only details to cache once community evidence resolved empty', () => {
    expect(isVesperResolverDetailCompleteForCache({
      vesper_intelligence: null,
      vesper_metadata: null,
      vesper_community_evidence: null,
      vesper_resolver_cache_version: ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION,
    }, false)).toBe(true);
  });

  it('invalidates old official-only details fetched before the community evidence cache generation', () => {
    expect(isVesperResolverDetailCompleteForCache({
      vesper_intelligence: null,
      vesper_metadata: null,
      vesper_community_evidence: null,
    }, false)).toBe(false);
  });

  it('keeps Sienna-style details cacheable after approved community evidence attaches', () => {
    expect(isVesperResolverDetailCompleteForCache({
      vesper_intelligence: { intelligence_source_type: 'official_brand' },
      vesper_metadata: { resolved_concentration: 'PARFUM' },
      vesper_community_evidence: {
        hasApprovedEvidence: true,
        sourceLabel: 'Fragrantica',
      },
      vesper_resolver_cache_version: ODARA_VESPER_RESOLVER_DETAIL_CACHE_VERSION,
    }, false)).toBe(true);
  });
});
