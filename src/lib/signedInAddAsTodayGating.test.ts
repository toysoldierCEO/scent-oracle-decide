import { describe, expect, it } from 'vitest';

import {
  resolveSignedInAddAsTodayDisabledReason,
  resolveSignedInAddAsTodayLocked,
} from './signedInAddAsTodayGating';

describe('signed-in add-as-today gating', () => {
  it('blocks add/set-as-today while the current card has a resolved lock truth', () => {
    expect(resolveSignedInAddAsTodayLocked({
      isGuestMode: false,
      hasResolvedLockTruth: true,
    })).toBe(true);
    expect(resolveSignedInAddAsTodayDisabledReason({
      isGuestMode: false,
      selectedDayIsPast: false,
      hasResolvedLockTruth: true,
      resolvedDayDecisionSource: 'locked',
    })).toBe('Unlock to preview');
  });

  it('clears the unlock disabled reason when only the decision source is stale locked', () => {
    expect(resolveSignedInAddAsTodayLocked({
      isGuestMode: false,
      hasResolvedLockTruth: false,
    })).toBe(false);
    expect(resolveSignedInAddAsTodayDisabledReason({
      isGuestMode: false,
      selectedDayIsPast: false,
      hasResolvedLockTruth: false,
      resolvedDayDecisionSource: 'locked',
    })).toBeNull();
  });

  it('does not let unlocking one context imply another context is unlocked', () => {
    expect(resolveSignedInAddAsTodayDisabledReason({
      isGuestMode: false,
      selectedDayIsPast: false,
      hasResolvedLockTruth: true,
      resolvedDayDecisionSource: 'locked',
    })).toBe('Unlock to preview');
  });

  it('keeps past-day restrictions independent of lock state', () => {
    expect(resolveSignedInAddAsTodayDisabledReason({
      isGuestMode: false,
      selectedDayIsPast: true,
      hasResolvedLockTruth: false,
      resolvedDayDecisionSource: 'manual',
    })).toBe('Past days are read-only');
  });

  it('does not apply signed-in add gates to guest mode', () => {
    expect(resolveSignedInAddAsTodayLocked({
      isGuestMode: true,
      hasResolvedLockTruth: true,
    })).toBe(false);
    expect(resolveSignedInAddAsTodayDisabledReason({
      isGuestMode: true,
      selectedDayIsPast: true,
      hasResolvedLockTruth: true,
      resolvedDayDecisionSource: 'locked',
    })).toBeNull();
  });
});
