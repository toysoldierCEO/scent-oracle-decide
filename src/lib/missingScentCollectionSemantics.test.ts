import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MISSING_SCENT_DESIRED_STATUS,
  MISSING_SCENT_DESIRED_STATUS_OPTIONS,
  getMissingScentDesiredStatusLabel,
  normalizeMissingScentDesiredStatus,
  shouldAutoApplyCollectionForMatchedIntake,
  shouldAutoApplyWishlistForMatchedIntake,
} from './missingScentCollectionSemantics';

describe('missingScentCollectionSemantics', () => {
  it('defaults missing scent requests to Collection, not Wishlist', () => {
    expect(DEFAULT_MISSING_SCENT_DESIRED_STATUS).toBe('owned');
    expect(MISSING_SCENT_DESIRED_STATUS_OPTIONS[0]).toEqual({ value: 'owned', label: 'Collection' });
    expect(normalizeMissingScentDesiredStatus(null)).toBe('owned');
    expect(normalizeMissingScentDesiredStatus('')).toBe('owned');
    expect(normalizeMissingScentDesiredStatus('unsupported')).toBe('owned');
  });

  it('preserves explicit wishlist intent only when the user chooses it', () => {
    expect(normalizeMissingScentDesiredStatus('wishlist')).toBe('wishlist');
    expect(getMissingScentDesiredStatusLabel('owned')).toBe('Collection');
    expect(getMissingScentDesiredStatusLabel('wishlist')).toBe('Wishlist');
  });

  it('keeps the missing scent save options collection-native and explicit', () => {
    expect(MISSING_SCENT_DESIRED_STATUS_OPTIONS.map((option) => option.value)).toEqual([
      'owned',
      'wishlist',
      'tried',
      'liked',
    ]);
    expect(getMissingScentDesiredStatusLabel('tried')).toBe('Tried');
    expect(getMissingScentDesiredStatusLabel('liked')).toBe('Liked');
  });

  it('auto-applies wishlist handoff only for explicit matched wishlist requests', () => {
    expect(shouldAutoApplyWishlistForMatchedIntake({
      desiredStatus: 'wishlist',
      isResolved: true,
      canonicalFragranceId: 'fragrance-id',
    })).toBe(true);

    expect(shouldAutoApplyWishlistForMatchedIntake({
      desiredStatus: 'owned',
      isResolved: true,
      canonicalFragranceId: 'fragrance-id',
    })).toBe(false);

    expect(shouldAutoApplyWishlistForMatchedIntake({
      desiredStatus: 'wishlist',
      isResolved: false,
      canonicalFragranceId: 'fragrance-id',
    })).toBe(false);

    expect(shouldAutoApplyWishlistForMatchedIntake({
      desiredStatus: 'wishlist',
      isResolved: true,
      canonicalFragranceId: 'fragrance-id',
      alreadyOwned: true,
    })).toBe(false);
  });

  it('auto-applies collection handoff only for matched Collection requests', () => {
    expect(shouldAutoApplyCollectionForMatchedIntake({
      desiredStatus: 'owned',
      isResolved: true,
      canonicalFragranceId: 'fragrance-id',
    })).toBe(true);

    expect(shouldAutoApplyCollectionForMatchedIntake({
      desiredStatus: 'wishlist',
      isResolved: true,
      canonicalFragranceId: 'fragrance-id',
    })).toBe(false);

    expect(shouldAutoApplyCollectionForMatchedIntake({
      desiredStatus: 'owned',
      isResolved: true,
      canonicalFragranceId: 'fragrance-id',
      alreadyOwned: true,
    })).toBe(false);

    expect(shouldAutoApplyCollectionForMatchedIntake({
      desiredStatus: 'owned',
      isResolved: false,
      canonicalFragranceId: 'fragrance-id',
    })).toBe(false);
  });
});
