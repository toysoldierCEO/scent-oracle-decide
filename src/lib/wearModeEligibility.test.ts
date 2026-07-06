import { describe, expect, it } from 'vitest';
import {
  LAYERING_UNLOCK_COUNT,
  isLayerEligibleCollectionItem,
  resolveLayeringEligibility,
} from './wearModeEligibility';

const eligibleScent = (index: number, overrides = {}) => ({
  fragrance_id: `fragrance-${index}`,
  name: `Scent ${index}`,
  brand: 'QA House',
  primary_status: 'owned',
  family_key: index % 2 === 0 ? 'woody' : 'fresh',
  notes: index % 2 === 0 ? ['cedar'] : ['bergamot'],
  ...overrides,
});

describe('wear mode layering eligibility', () => {
  it('locks layering below seven eligible scents and unlocks at seven', () => {
    expect(resolveLayeringEligibility([])).toMatchObject({
      eligibleCount: 0,
      isLayeringUnlocked: false,
      remainingToUnlock: LAYERING_UNLOCK_COUNT,
    });
    expect(resolveLayeringEligibility([eligibleScent(1)])).toMatchObject({
      eligibleCount: 1,
      isLayeringUnlocked: false,
      remainingToUnlock: 6,
    });
    expect(resolveLayeringEligibility(Array.from({ length: 6 }, (_, index) => eligibleScent(index + 1)))).toMatchObject({
      eligibleCount: 6,
      isLayeringUnlocked: false,
      remainingToUnlock: 1,
    });
    expect(resolveLayeringEligibility(Array.from({ length: 7 }, (_, index) => eligibleScent(index + 1)))).toMatchObject({
      eligibleCount: 7,
      isLayeringUnlocked: true,
      remainingToUnlock: 0,
    });
  });

  it('excludes wishlist-only, retired, disliked, unresolved, and Vesperizing scents', () => {
    const result = resolveLayeringEligibility([
      eligibleScent(1),
      eligibleScent(2, { primary_status: 'wishlist' }),
      eligibleScent(3, { retired: true }),
      eligibleScent(4, { preference_state: 'disliked' }),
      eligibleScent(5, { unresolved: true }),
      eligibleScent(6, { request_status: 'pending', canonical_fragrance_id: null }),
    ]);

    expect(result.eligibleCount).toBe(1);
    expect(result.isLayeringUnlocked).toBe(false);
  });

  it('requires usable profile data for recommendation participation', () => {
    expect(isLayerEligibleCollectionItem(eligibleScent(1))).toBe(true);
    expect(isLayerEligibleCollectionItem(eligibleScent(2, {
      family_key: null,
      family_label: null,
      notes: [],
      accords: [],
      top_notes: [],
      heart_notes: [],
      base_notes: [],
      item: null,
    }))).toBe(false);
  });

  it('counts owned collection payload rows even when primary status is omitted', () => {
    const result = resolveLayeringEligibility([
      eligibleScent(1, { primary_status: undefined, collection_status: undefined }),
      eligibleScent(2, { primary_status: undefined, collection_status: 'wishlist' }),
    ]);

    expect(result.eligibleCount).toBe(1);
  });
});

