import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MISSING_SCENT_DESIRED_STATUS,
  MISSING_SCENT_DESIRED_STATUS_OPTIONS,
  getMissingScentDesiredStatusLabel,
  isMissingScentIntakeResolved,
  normalizeMissingScentDesiredStatus,
  shouldAutoApplyCollectionForMatchedIntake,
  shouldPollMissingScentIntake,
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

  it('keeps Vesperizing refresh active only for unresolved non-rejected intakes', () => {
    expect(shouldPollMissingScentIntake({
      requestStatus: 'pending',
      canonicalFragranceId: null,
    })).toBe(true);

    expect(shouldPollMissingScentIntake({
      requestStatus: 'needs_review',
      canonicalFragranceId: null,
    })).toBe(true);

    expect(shouldPollMissingScentIntake({
      requestStatus: 'matched_existing',
      canonicalFragranceId: 'fragrance-id',
    })).toBe(false);

    expect(shouldPollMissingScentIntake({
      requestStatus: 'rejected',
      canonicalFragranceId: null,
    })).toBe(false);
  });

  it('treats canonical-linked intakes as graduated even before status text catches up', () => {
    expect(isMissingScentIntakeResolved({
      requestStatus: 'pending',
      canonicalFragranceId: 'fragrance-id',
    })).toBe(true);

    expect(isMissingScentIntakeResolved({
      requestStatus: 'resolved',
      canonicalFragranceId: null,
    })).toBe(true);

    expect(isMissingScentIntakeResolved({
      requestStatus: 'source_found',
      canonicalFragranceId: null,
    })).toBe(false);
  });
});
