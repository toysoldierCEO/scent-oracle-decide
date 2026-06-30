import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildTodaysPickScoringTrace,
  readTodaysPickScoringTrace,
  recordTodaysPickScoringTrace,
  scoreTodaysPickCandidate,
  scoreTodaysPickCandidates,
  type TodaysPickProfile,
} from './todaysPickScoring';

const amberAppleVanilla: TodaysPickProfile = {
  id: 'amber-apple',
  name: 'Amber Apple Woods',
  brand: 'Fixture House',
  familyKey: 'woody-amber',
  collectionStatus: 'owned',
  owned: true,
  officialSourceBacked: true,
  sourceConfidence: 'high',
  notes: ['Apple', 'Amber', 'Vanilla', 'Cedar', 'Musk'],
  topNotes: ['Apple', 'Bergamot'],
  heartNotes: ['Musk', 'Cedar'],
  baseNotes: ['Amber', 'Vanilla'],
  providerStructuredAccords: ['amber', 'woody', 'musky'],
  providerStructuredAccordsApproved: true,
};

const freshWorkScent: TodaysPickProfile = {
  id: 'fresh-work',
  name: 'Fresh Green Musk',
  brand: 'Fixture House',
  familyKey: 'fresh-aromatic',
  collectionStatus: 'owned',
  owned: true,
  officialSourceBacked: true,
  notes: ['Bergamot', 'Green Tea', 'Clean Musk', 'Cedar'],
  topNotes: ['Bergamot', 'Lemon'],
  heartNotes: ['Green Tea', 'Clean Musk'],
  baseNotes: ['Cedar'],
  providerStructuredAccords: ['green', 'citrus', 'musky'],
  providerStructuredAccordsApproved: true,
};

const metallicClone: TodaysPickProfile = {
  id: 'metallic-clone',
  name: 'Metallic Aventus Cloud',
  brand: 'Fixture House',
  familyKey: 'fruity-blue',
  collectionStatus: 'owned',
  owned: true,
  notes: ['Pineapple', 'Birch', 'Metallic Notes', 'Sugar'],
  topNotes: ['Pineapple'],
  heartNotes: ['Metallic Notes'],
  baseNotes: ['Sugar', 'Ambroxan'],
  providerStructuredAccords: ['fruity', 'metallic', 'sweet'],
  providerStructuredAccordsApproved: true,
};

describe('todaysPickScoring', () => {
  beforeEach(() => {
    delete window.__ODARA_TODAYS_PICK_SCORING_TRACE__;
  });

  it('keeps owned Collection scents eligible and hard-excludes Retired, Disliked, Wishlist-only, and unresolved scents', () => {
    expect(scoreTodaysPickCandidate(amberAppleVanilla).eligible).toBe(true);
    expect(scoreTodaysPickCandidate({ ...amberAppleVanilla, retired: true }).exclusions).toContain('retired');
    expect(scoreTodaysPickCandidate({ ...amberAppleVanilla, disliked: true }).eligible).toBe(false);
    expect(scoreTodaysPickCandidate({ ...amberAppleVanilla, collectionStatus: 'wishlist' }).exclusions).toContain('wishlist_only');
    expect(scoreTodaysPickCandidate({ ...amberAppleVanilla, unresolved: true }).exclusions).toContain('unresolved_or_provisional');
    expect(scoreTodaysPickCandidate({ ...amberAppleVanilla, profileReady: false }).exclusions).toContain('profile_not_ready');
  });

  it('does not exclude or weaken a candidate just because performance is missing', () => {
    const missingPerformance = scoreTodaysPickCandidate(amberAppleVanilla);

    expect(missingPerformance.eligible).toBe(true);
    expect(missingPerformance.evidence.performanceEvidencePresent).toBe(false);
    expect(missingPerformance.components.performanceFit).toBe(0);
    expect(missingPerformance.reasonChipExplanation).not.toMatch(/all day|long lasting|projects|projection/i);
  });

  it('uses evidence-backed performance only, with unknown performance neutral', () => {
    const backed = scoreTodaysPickCandidate({
      ...freshWorkScent,
      performance: {
        longevityScore: 0.76,
        longevityEvidenceBacked: true,
        projectionScore: 0.52,
        projectionEvidenceBacked: true,
      },
    });
    const unsupported = scoreTodaysPickCandidate({
      ...freshWorkScent,
      performance: {
        longevityScore: 0.95,
        longevityEvidenceBacked: false,
        projectionScore: 0.95,
        projectionEvidenceBacked: false,
      },
    });

    expect(backed.evidence.performanceEvidencePresent).toBe(true);
    expect(backed.components.performanceFit).toBeGreaterThan(0);
    expect(unsupported.evidence.performanceEvidencePresent).toBe(false);
    expect(unsupported.components.performanceFit).toBe(0);
  });

  it('rewards official notes and approved provider structured accords over community evidence', () => {
    const providerSupported = scoreTodaysPickCandidate(amberAppleVanilla, {
      preferredTerms: ['amber', 'vanilla', 'woody', 'musk'],
    });
    const communityOnly = scoreTodaysPickCandidate({
      id: 'community-only',
      name: 'Community Mineral',
      brand: 'Fixture House',
      familyKey: 'abstract',
      collectionStatus: 'owned',
      owned: true,
      notes: ['Ink'],
      topNotes: [],
      heartNotes: [],
      baseNotes: [],
      providerStructuredAccords: ['amber', 'vanilla', 'woody'],
      providerStructuredAccordsApproved: false,
      communityAccords: ['amber', 'vanilla', 'woody', 'musk'],
      communityNotes: ['apple', 'incense'],
    }, {
      preferredTerms: ['amber', 'vanilla', 'woody', 'musk'],
    });

    expect(providerSupported.components.providerAccordSupport).toBeGreaterThan(0);
    expect(providerSupported.trace.reasonCodes).toContain('provider_structured_accord_support');
    expect(communityOnly.components.providerAccordSupport).toBe(0);
    expect(communityOnly.components.communitySupport).toBeGreaterThanOrEqual(0);
    expect(providerSupported.finalScore).toBeGreaterThan(communityOnly.finalScore);
  });

  it('uses the user taste fixture without treating negative profiles as good daily winners', () => {
    const loved = scoreTodaysPickCandidate(amberAppleVanilla);
    const negative = scoreTodaysPickCandidate(metallicClone);
    const cleanVanilla = scoreTodaysPickCandidate({
      id: 'clean-vanilla',
      name: 'Clean Vanilla Musk',
      brand: 'Fixture House',
      familyKey: 'clean musk',
      collectionStatus: 'owned',
      owned: true,
      officialSourceBacked: true,
      topNotes: ['Bergamot'],
      heartNotes: ['Clean Musk'],
      baseNotes: ['Vanilla', 'Cedar'],
    });
    const sugaryVanilla = scoreTodaysPickCandidate({
      id: 'sugary-vanilla',
      name: 'Sugary Vanilla',
      brand: 'Fixture House',
      familyKey: 'gourmand',
      collectionStatus: 'owned',
      owned: true,
      officialSourceBacked: true,
      topNotes: ['Sugar'],
      heartNotes: ['Caramel'],
      baseNotes: ['Vanilla'],
      providerStructuredAccords: ['sweet'],
      providerStructuredAccordsApproved: true,
    });
    const aromaticJuniper = scoreTodaysPickCandidate({
      id: 'aromatic-juniper',
      name: 'Aromatic Juniper',
      brand: 'Fixture House',
      familyKey: 'aromatic',
      collectionStatus: 'owned',
      owned: true,
      officialSourceBacked: true,
      topNotes: ['Bergamot'],
      heartNotes: ['Juniper Berry'],
      baseNotes: ['Cedar'],
    });

    expect(loved.components.userTasteFit).toBeGreaterThan(0);
    expect(negative.components.userTasteFit).toBeLessThan(0);
    expect(loved.finalScore).toBeGreaterThan(negative.finalScore);
    expect(cleanVanilla.trace.reasonCodes).not.toContain('negative_taste_caution');
    expect(sugaryVanilla.trace.reasonCodes).toContain('negative_taste_caution');
    expect(aromaticJuniper.trace.reasonCodes).not.toContain('negative_taste_caution');
  });

  it('applies context fit for weather and occasion without fake performance claims', () => {
    const warmWork = scoreTodaysPickCandidate(freshWorkScent, {
      occasion: 'work',
      temperatureF: 82,
      weather: 'humid',
    });
    const denseSweet = scoreTodaysPickCandidate({
      ...amberAppleVanilla,
      id: 'dense-sweet',
      name: 'Dense Sweet Oud',
      familyKey: 'oud-amber',
      notes: ['Oud', 'Leather', 'Vanilla', 'Sugar'],
      topNotes: ['Saffron'],
      heartNotes: ['Leather'],
      baseNotes: ['Oud', 'Vanilla', 'Amber'],
      providerStructuredAccords: ['oud', 'sweet', 'leather'],
    }, {
      occasion: 'work',
      temperatureF: 82,
    });

    expect(warmWork.trace.reasonCodes).toContain('warm_weather_fit');
    expect(warmWork.trace.reasonCodes).toContain('work_context_fit');
    expect(warmWork.finalScore).toBeGreaterThan(denseSweet.finalScore);
    expect(warmWork.reasonChipExplanation).not.toMatch(/long lasting|projects well/i);
  });

  it('adds repetition penalties and diversity bonuses so the same scent/family does not over-repeat', () => {
    const fresh = scoreTodaysPickCandidate(freshWorkScent, {
      recentFragranceIds: [],
      recentFamilyKeys: ['woody-amber'],
      recentBrandNames: ['Other Brand'],
    });
    const repeated = scoreTodaysPickCandidate(freshWorkScent, {
      recentFragranceIds: ['fresh-work'],
      recentFamilyKeys: ['fresh-aromatic'],
      recentBrandNames: ['fixture house'],
    });

    expect(fresh.components.diversityAdjustment).toBeGreaterThan(0);
    expect(repeated.components.repetitionPenalty).toBeLessThan(0);
    expect(repeated.trace.reasonCodes).toEqual(expect.arrayContaining(['recent_winner_penalty', 'recent_family_penalty']));
    expect(fresh.finalScore).toBeGreaterThan(repeated.finalScore);
  });

  it('selects the best eligible winner and reports excluded candidates separately', () => {
    const result = scoreTodaysPickCandidates([
      { ...metallicClone, sourceRank: 1 },
      { ...amberAppleVanilla, sourceRank: 2 },
      { ...freshWorkScent, sourceRank: 3, retired: true },
    ], {
      preferredTerms: ['amber', 'vanilla', 'woody', 'musk'],
      recentFragranceIds: ['metallic-clone'],
    });

    expect(result.winner?.id).toBe('amber-apple');
    expect(result.excluded.map((candidate) => candidate.id)).toContain('fresh-work');
  });

  it('builds and records a safe debug trace without raw secret-like terms', () => {
    const result = scoreTodaysPickCandidates([
      {
        ...amberAppleVanilla,
        notes: ['Amber', 'password=secret', 'access_token'],
        providerStructuredAccords: ['woody', 'refresh_token'],
      },
    ]);

    const trace = buildTodaysPickScoringTrace(result, { occasion: 'daily', temperatureF: 70 });
    const serialized = JSON.stringify(trace);

    expect(serialized).not.toContain('password=secret');
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('refresh_token');
    expect(recordTodaysPickScoringTrace(result, { occasion: 'daily' })).toBeTruthy();
    expect(readTodaysPickScoringTrace()).toHaveLength(1);
  });
});
