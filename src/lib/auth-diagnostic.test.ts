import { beforeEach, describe, expect, it } from 'vitest';

import {
  ODARA_AUTH_DEBUG_STORAGE_KEY,
  buildAuthDiagnosticSummary,
  getNextAuthDebugTapCount,
  isAuthDebugSearchDisabled,
  isAuthDebugSearchEnabled,
  readAuthDebugEnabled,
  readAuthStoragePresence,
  setAuthDebugEnabled,
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

  it('can be enabled by in-app gesture without URL editing', () => {
    const events: Array<{ enabled?: boolean }> = [];
    window.addEventListener('odara-auth-debug-enabled', ((event: CustomEvent<{ enabled?: boolean }>) => {
      events.push(event.detail ?? {});
    }) as EventListener);

    setAuthDebugEnabled(true);
    expect(readAuthDebugEnabled()).toBe(true);
    expect(window.sessionStorage.getItem(ODARA_AUTH_DEBUG_STORAGE_KEY)).toBe('1');
    expect(events[events.length - 1]).toEqual({ enabled: true });

    setAuthDebugEnabled(false);
    expect(readAuthDebugEnabled()).toBe(false);
    expect(window.sessionStorage.getItem(ODARA_AUTH_DEBUG_STORAGE_KEY)).toBeNull();
    expect(events[events.length - 1]).toEqual({ enabled: false });
  });

  it('counts rapid logo taps and resets outside the gesture window', () => {
    expect(getNextAuthDebugTapCount({ lastTapAt: null, now: 1000, previousCount: 0 })).toBe(1);
    expect(getNextAuthDebugTapCount({ lastTapAt: 1000, now: 2000, previousCount: 1 })).toBe(2);
    expect(getNextAuthDebugTapCount({ lastTapAt: 1000, now: 5000, previousCount: 2 })).toBe(1);
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
        contextKey: 'work',
        decision: 'applied_session',
        event: 'SIGNED_IN',
        guestOverride: false,
        localAuthKeyExists: true,
        nextDate: '2026-06-23',
        oracleKeyPresent: true,
        oracleSlotKeyPresent: true,
        origin: 'https://example.test',
        originChanged: false,
        previousDate: '2026-06-22',
        reason: 'unit_test',
        selectedDate: '2026-06-22',
        sessionPresent: true,
        sessionAuthKeyExists: false,
        source: 'Index',
        storageKeyName: AUTH_KEY,
        storageMode: 'local',
        targetDate: '2026-06-23',
        timestamp: '2026-06-22T00:00:00.000Z',
        userPresent: true,
      }],
      userPresent: true,
    });

    expect(summary).toContain('build commit: abc1234');
    expect(summary).toContain('supabase project ref: projectref');
    expect(summary).toContain('local auth key exists: yes');
    expect(summary).toContain('event=SIGNED_IN');
    expect(summary).toContain('origin=https://example.test');
    expect(summary).toContain('originChanged=no');
    expect(summary).toContain('localAuthKey=yes');
    expect(summary).toContain('sessionAuthKey=no');
    expect(summary).toContain('guestOverride=no');
    expect(summary).toContain('previousDate=2026-06-22');
    expect(summary).toContain('nextDate=2026-06-23');
    expect(summary).toContain('targetDate=2026-06-23');
    expect(summary).toContain('oracleKey=yes');
    expect(summary).toContain('oracleSlotKey=yes');
    expect(summary).not.toContain('access_token');
    expect(summary).not.toContain('refresh_token');
    expect(summary).not.toContain('raw session');
  });
});
