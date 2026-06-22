import { beforeEach, describe, expect, it } from 'vitest';

import {
  ODARA_GUEST_OVERRIDE_STORAGE_KEY,
  readGuestOverride,
  resolveAccessMode,
  writeGuestOverride,
} from './access-mode';

describe('access-mode', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('keeps authenticated session identity separate from guest override', () => {
    const access = resolveAccessMode({ id: 'real-user-id', email: 'user@example.com' }, true);

    expect(access.hasAuthenticatedSession).toBe(true);
    expect(access.signedInUserId).toBe('real-user-id');
    expect(access.isSignedIn).toBe(false);
    expect(access.isGuestMode).toBe(true);
    expect(access.canWrite).toBe(false);
  });

  it('guest override only toggles its own session flag', () => {
    window.sessionStorage.setItem('unrelated-auth-token', 'still-here');

    writeGuestOverride(true);

    expect(readGuestOverride()).toBe(true);
    expect(window.sessionStorage.getItem(ODARA_GUEST_OVERRIDE_STORAGE_KEY)).toBe('1');
    expect(window.sessionStorage.getItem('unrelated-auth-token')).toBe('still-here');

    writeGuestOverride(false);

    expect(readGuestOverride()).toBe(false);
    expect(window.sessionStorage.getItem('unrelated-auth-token')).toBe('still-here');
  });
});
