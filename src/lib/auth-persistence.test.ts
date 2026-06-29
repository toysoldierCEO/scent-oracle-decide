import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  VESPER_AUTH_PERSISTENCE_MODE_KEY,
  primeVesperAuthPersistence,
  readVesperAuthPersistenceMode,
  vesperAuthStorage,
} from './auth-persistence';
import { readPersistedOdaraAuthTrace } from './auth-debug-trace';

const AUTH_KEY = 'sb-test-auth-token';

describe('auth-persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to persistent local storage mode', () => {
    expect(readVesperAuthPersistenceMode()).toBe('local');
  });

  it('routes auth session writes to localStorage when remember me is enabled', () => {
    primeVesperAuthPersistence(true, AUTH_KEY);
    vesperAuthStorage.setItem(AUTH_KEY, 'persistent-session');

    expect(window.localStorage.getItem(VESPER_AUTH_PERSISTENCE_MODE_KEY)).toBe('local');
    expect(window.localStorage.getItem(AUTH_KEY)).toBe('persistent-session');
    expect(window.sessionStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it('routes auth session writes to sessionStorage when remember me is disabled', () => {
    window.localStorage.setItem(AUTH_KEY, 'old-persistent-session');

    primeVesperAuthPersistence(false, AUTH_KEY);
    vesperAuthStorage.setItem(AUTH_KEY, 'session-only');

    expect(window.localStorage.getItem(VESPER_AUTH_PERSISTENCE_MODE_KEY)).toBe('session');
    expect(window.sessionStorage.getItem(AUTH_KEY)).toBe('session-only');
    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it('reads from fallback storage when a session already exists there', () => {
    window.localStorage.setItem(AUTH_KEY, 'existing-session');

    expect(vesperAuthStorage.getItem(AUTH_KEY)).toBe('existing-session');
    expect(readPersistedOdaraAuthTrace().at(-1)).toMatchObject({
      decision: 'get_preferred',
      source: 'storage',
      storageBackendUsed: 'local',
      storageOperation: 'getItem',
      storageOutcome: 'preferred_hit',
    });
  });

  it('does not remove an existing auth token while only priming a mode switch', () => {
    window.localStorage.setItem(AUTH_KEY, 'existing-persistent-session');

    primeVesperAuthPersistence(false, AUTH_KEY);

    expect(window.localStorage.getItem(AUTH_KEY)).toBe('existing-persistent-session');
    expect(vesperAuthStorage.getItem(AUTH_KEY)).toBe('existing-persistent-session');
  });

  it('falls back to localStorage when sessionStorage rejects the session write', () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (this === window.sessionStorage && key === AUTH_KEY) {
        throw new Error('sessionStorage unavailable');
      }
      return originalSetItem.call(this, key, value);
    });

    primeVesperAuthPersistence(false, AUTH_KEY);
    vesperAuthStorage.setItem(AUTH_KEY, 'mobile-session');

    expect(window.sessionStorage.getItem(AUTH_KEY)).toBeNull();
    expect(window.localStorage.getItem(AUTH_KEY)).toBe('mobile-session');
    expect(vesperAuthStorage.getItem(AUTH_KEY)).toBe('mobile-session');
    expect(readPersistedOdaraAuthTrace().at(-1)).toMatchObject({
      decision: 'get_fallback',
      source: 'storage',
      storageBackendUsed: 'local',
      storageOperation: 'getItem',
    });
  });

  it('falls back to sessionStorage when localStorage rejects a remembered session write', () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (this === window.localStorage && key === AUTH_KEY) {
        throw new Error('localStorage unavailable');
      }
      return originalSetItem.call(this, key, value);
    });

    primeVesperAuthPersistence(true, AUTH_KEY);
    vesperAuthStorage.setItem(AUTH_KEY, 'fallback-session');

    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_KEY)).toBe('fallback-session');
    expect(vesperAuthStorage.getItem(AUTH_KEY)).toBe('fallback-session');
  });

  it('removes auth keys from both storages', () => {
    window.localStorage.setItem(AUTH_KEY, 'persistent-session');
    window.sessionStorage.setItem(AUTH_KEY, 'session-only');

    vesperAuthStorage.removeItem(AUTH_KEY);

    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_KEY)).toBeNull();
  });
});
