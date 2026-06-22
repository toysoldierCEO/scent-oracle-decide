import { beforeEach, describe, expect, it } from 'vitest';

import {
  VESPER_AUTH_PERSISTENCE_MODE_KEY,
  primeVesperAuthPersistence,
  readVesperAuthPersistenceMode,
  vesperAuthStorage,
} from './auth-persistence';

const AUTH_KEY = 'sb-test-auth-token';

describe('auth-persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
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
  });

  it('does not remove an existing auth token while only priming a mode switch', () => {
    window.localStorage.setItem(AUTH_KEY, 'existing-persistent-session');

    primeVesperAuthPersistence(false, AUTH_KEY);

    expect(window.localStorage.getItem(AUTH_KEY)).toBe('existing-persistent-session');
    expect(vesperAuthStorage.getItem(AUTH_KEY)).toBe('existing-persistent-session');
  });

  it('removes auth keys from both storages', () => {
    window.localStorage.setItem(AUTH_KEY, 'persistent-session');
    window.sessionStorage.setItem(AUTH_KEY, 'session-only');

    vesperAuthStorage.removeItem(AUTH_KEY);

    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_KEY)).toBeNull();
  });
});
