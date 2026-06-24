import { describe, expect, it } from 'vitest';

import {
  buildCommunityEvidenceDisplayModel,
  isApprovedCommunityEvidenceInput,
  type CommunityEvidenceInput,
} from './communityEvidenceLane';

const siennaOfficialNotes = {
  topNotes: ['Sea Air', 'Bergamot'],
  middleNotes: ['Soft Coconut', 'Cucumber'],
  baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
};

const siennaCommunityEvidence: CommunityEvidenceInput = {
  canonicalFragranceId: 'c892b7e3-a829-4fee-91f1-09d3ffefacc6',
  sourceType: 'community_provider',
  sourceTier: 'community_provider_consensus',
  sourceName: 'Fragrantica',
  reviewStatus: 'approved_for_internal_use',
  evidenceStatus: 'usable_non_official_intelligence',
  usableForVesperIntelligence: true,
  officialRegistryEligible: false,
  patchSafeNow: false,
  normalizedAccords: [
    'coconut',
    'green',
    'ozonic',
    'aquatic',
    'fresh spicy',
    'woody',
    'sweet',
    'aromatic',
    'lactonic',
    'tropical',
  ],
  normalizedNotes: [
    'cucumber',
    'juniper berry',
    'white pepper',
    'coconut',
    'palm tree',
    'wood resin',
    'cedar',
    'woody notes',
    'amber',
  ],
};

describe('communityEvidenceLane', () => {
  it('requires approved non-official evidence before display or recommendation use', () => {
    expect(isApprovedCommunityEvidenceInput(siennaCommunityEvidence)).toBe(true);
    expect(isApprovedCommunityEvidenceInput({
      ...siennaCommunityEvidence,
      reviewStatus: 'proposed',
    })).toBe(false);
    expect(isApprovedCommunityEvidenceInput({
      ...siennaCommunityEvidence,
      officialRegistryEligible: true,
    })).toBe(false);
    expect(isApprovedCommunityEvidenceInput({
      ...siennaCommunityEvidence,
      sourceType: 'official_brand',
    })).toBe(false);
  });

  it('keeps Sienna official notes primary while surfacing community accords separately', () => {
    const display = buildCommunityEvidenceDisplayModel(
      [siennaCommunityEvidence],
      siennaOfficialNotes,
    );

    expect(display.hasApprovedEvidence).toBe(true);
    expect(display.officialRegistryEligible).toBe(false);
    expect(display.officialNotesPreserved).toBe(true);
    expect(display.sourceNames).toEqual(['Fragrantica']);
    expect(display.trustLine).toBe('Community/provider evidence · Fragrantica');
    expect(display.accords).toEqual([
      'coconut',
      'green',
      'ozonic',
      'aquatic',
      'fresh spicy',
      'woody',
      'sweet',
      'aromatic',
      'lactonic',
      'tropical',
    ]);
    expect(display.communityNotes).toContain('White Pepper');
    expect(display.communityNotes).toContain('Palm Tree');
    expect(display.communityNotes).not.toEqual(siennaOfficialNotes.topNotes);
    expect(display.conflictsWithOfficialNotes).toBe(true);
    expect(display.conflictSummary).toContain('official notes are preserved');
  });

  it('does not display proposed community evidence or let it drive recommendation signals', () => {
    const display = buildCommunityEvidenceDisplayModel([
      {
        ...siennaCommunityEvidence,
        reviewStatus: 'proposed',
      },
    ], siennaOfficialNotes);

    expect(display.hasApprovedEvidence).toBe(false);
    expect(display.accords).toEqual([]);
    expect(display.communityNotes).toEqual([]);
    expect(display.recommendationSignals.canSupplementMatching).toBe(false);
  });

  it('uses community performance only when real vote evidence exists', () => {
    const noPerformance = buildCommunityEvidenceDisplayModel([siennaCommunityEvidence], siennaOfficialNotes);
    expect(noPerformance.hasCommunityPerformance).toBe(false);

    const withPerformance = buildCommunityEvidenceDisplayModel([
      {
        ...siennaCommunityEvidence,
        communityPerformance: {
          longevity: {
            votesTotal: 43,
            distribution: {
              moderate: 12,
              long_lasting: 31,
            },
          },
        },
      },
    ], siennaOfficialNotes);

    expect(withPerformance.hasCommunityPerformance).toBe(true);
    expect(withPerformance.recommendationSignals.communityPerformanceAvailable).toBe(true);
  });
});
