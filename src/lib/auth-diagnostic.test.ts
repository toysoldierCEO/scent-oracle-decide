import { beforeEach, describe, expect, it } from 'vitest';

import {
  ODARA_AUTH_DEBUG_STORAGE_KEY,
  buildAuthDiagnosticSummary,
  isAuthDebugSearchDisabled,
  isAuthDebugSearchEnabled,
  readAuthDebugEnabled,
  readAuthStoragePresence,
} from './auth-diagnostic';

const AUTH_KEY = 'sb-test-auth-token';

describe('auth-diagnostic', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('enables and disables the real-device diagnostic from a query param', () => {
    expect(isAuthDebugSearchEnabled('?odaraAuthDebug=1')).toBe(true);
    expect(isAuthDebugSearchEnabled('?odaraAuthDebug=true')).toBe(true);
    expect(isAuthDebugSearchDisabled('?odaraAuthDebug=0')).toBe(true);
    expect(isAuthDebugSearchDisabled('?odaraAuthDebug=false')).toBe(true);

    window.history.replaceState(null, '', '/?odaraAuthDebug=1');
    expect(readAuthDebugEnabled()).toBe(true);
    expect(window.sessionStorage.getItem(ODARA_AUTH_DEBUG_STORAGE_KEY)).toBe('1');

    window.history.replaceState(null, '', '/?odaraAuthDebug=0');
    expect(readAuthDebugEnabled()).toBe(false);
    expect(window.sessionStorage.getItem(ODARA_AUTH_DEBUG_STORAGE_KEY)).toBeNull();
  });

  it('reports only auth key presence, never stored auth values', () => {
    window.localStorage.setItem(AUTH_KEY, 'access_token_should_not_render');

    expect(readAuthStoragePresence(AUTH_KEY)).toEqual({
      localAuthKeyExists: true,
      sessionAuthKeyExists: false,
    });
  });

  it('formats a copyable summary without tokens or raw session data', () => {
    const summary = buildAuthDiagnosticSummary({
      accessMode: 'signed-in',
      authReady: true,
      buildCommit: 'abc1234',
      buildTime: '2026-06-22T00:00:00.000Z',
      getSessionConfirmsSession: true,
      guestOverride: false,
      host: 'example.test',
      origin: 'https://example.test',
      packageVersion: '0.0.0',
      pathname: '/',
      projectRef: 'projectref',
      storageKeyName: AUTH_KEY,
      storageMode: 'local',
      storagePresence: {
        localAuthKeyExists: true,
        sessionAuthKeyExists: false,
      },
      trace: [{
        authReady: true,
        decision: 'applied_session',
        event: 'SIGNED_IN',
        reason: 'unit_test',
        sessionPresent: true,
        source: 'Index',
        storageKeyName: AUTH_KEY,
        storageMode: 'local',
        timestamp: '2026-06-22T00:00:00.000Z',
        userPresent: true,
      }],
      userPresent: true,
    });

    expect(summary).toContain('build commit: abc1234');
    expect(summary).toContain('supabase project ref: projectref');
    expect(summary).toContain('local auth key exists: yes');
    expect(summary).toContain('event=SIGNED_IN');
    expect(summary).not.toContain('access_token');
    expect(summary).not.toContain('refresh_token');
    expect(summary).not.toContain('raw session');
  });
});
