import { beforeEach, describe, expect, it } from 'vitest';

import {
  ODARA_AUTH_DEBUG_STORAGE_KEY,
  buildAuthDiagnosticSummary,
  dismissAuthDebugPanel,
  getNextAuthDebugTapCount,
  isAuthDebugSearchDisabled,
  isAuthDebugSearchEnabled,
  readAuthDebugEnabled,
  readAuthStoragePresence,
  removeAuthDebugSearchParamFromCurrentUrl,
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
    expect(isAuthDebugSearchEnabled('?odaraDetailDebug=1')).toBe(true);
    expect(isAuthDebugSearchEnabled('?odaraDetailDebug=true')).toBe(true);
    expect(isAuthDebugSearchEnabled('?other=1')).toBe(false);
    expect(isAuthDebugSearchDisabled('?odaraAuthDebug=0')).toBe(true);
    expect(isAuthDebugSearchDisabled('?odaraAuthDebug=false')).toBe(true);
    expect(isAuthDebugSearchDisabled('?odaraDetailDebug=0')).toBe(true);
    expect(isAuthDebugSearchDisabled('?odaraDetailDebug=false')).toBe(true);

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

  it('dismisses the diagnostic and removes the query flag so it does not stick after reload', () => {
    window.history.replaceState(null, '', '/?odaraAuthDebug=1&keep=true#top');
    expect(readAuthDebugEnabled()).toBe(true);

    expect(removeAuthDebugSearchParamFromCurrentUrl()).toBe(true);
    expect(window.location.search).toBe('?keep=true');
    expect(window.location.hash).toBe('#top');

    window.history.replaceState(null, '', '/?odaraDetailDebug=1&keep=true#top');
    expect(readAuthDebugEnabled()).toBe(true);
    expect(removeAuthDebugSearchParamFromCurrentUrl()).toBe(true);
    expect(window.location.search).toBe('?keep=true');
    expect(window.location.hash).toBe('#top');

    window.history.replaceState(null, '', '/?odaraAuthDebug=1');
    setAuthDebugEnabled(true);
    dismissAuthDebugPanel();

    expect(window.sessionStorage.getItem(ODARA_AUTH_DEBUG_STORAGE_KEY)).toBeNull();
    expect(window.location.search).toBe('');
    expect(readAuthDebugEnabled()).toBe(false);
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
      detailCommunityEvidenceTrace: [{
        accordCount: 10,
        approvedFragranticaRowPresent: true,
        buildCommit: 'abc1234',
        cacheComplete: false,
        cacheHit: true,
        cacheKey: 'sienna-id',
        cacheVersion: null,
        collectionPreviewChipSources: ['family'],
        communityEvidenceChecked: true,
        communityEvidenceMappedCount: 1,
        communityRowsReturnedCount: 1,
        communitySignalsCount: 9,
        decision: 'detail_sheet_render_ready',
        detailFetchAttempted: true,
        detailFetchStatus: 'success',
        detailOpen: true,
        detailOpenedFromCollection: true,
        fragranceBrand: 'Mihan Aromatics',
        fragranceId: 'sienna-id',
        fragranceName: 'Sienna Brume',
        intelligenceFetchAttempted: true,
        intelligenceFetchError: false,
        intelligenceFetchSuccess: true,
        mappedCount: 1,
        renderedAccordCount: 10,
        renderedAccordsSection: true,
        renderedCommunitySourceLabel: true,
        renderedCommunitySignalCount: 9,
        renderedCommunitySignalsSection: true,
        renderedTrustLabelCount: 1,
        resolverCacheVersion: 'community-evidence-v3',
        resolverDisabled: false,
        source: 'detail-render',
        timestamp: '2026-06-22T00:00:02.000Z',
        trustLabelCount: 1,
      }],
      reloadCrashTrace: [{
        accessMode: 'signed-in',
        authReady: true,
        closestControlLabel: 'Open Collection',
        contextKey: 'daily',
        decision: 'pagehide',
        detailLabel: 'Not For Sale / Alexandria Fragrances',
        detailOpen: true,
        event: 'pagehide',
        localAuthKeyExists: true,
        menuOpen: false,
        navigationType: 'reload',
        persisted: false,
        reason: 'page_lifecycle',
        routePath: '/',
        screen: 'oracle',
        searchOpen: false,
        selectedDate: '2026-06-24',
        sessionAuthKeyExists: false,
        source: 'page',
        storageKeyName: AUTH_KEY,
        storageMode: 'local',
        timestamp: '2026-06-22T00:00:01.000Z',
        userPresent: true,
        visibilityState: 'hidden',
      }],
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
        redirectOrigin: 'https://example.test',
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
        urlHasAuthParams: true,
        userPresent: true,
      }],
      userPresent: true,
    });

    expect(summary).toContain('build commit: abc1234');
    expect(summary).toContain('supabase project ref: projectref');
    expect(summary).toContain('local auth key exists: yes');
    expect(summary).toContain('event=SIGNED_IN');
    expect(summary).toContain('reload/crash events:');
    expect(summary).toContain('navigation=reload');
    expect(summary).toContain('detail community evidence events:');
    expect(summary).toContain('fragrance=Sienna Brume');
    expect(summary).toContain('brand=Mihan Aromatics');
    expect(summary).toContain('cacheKey=sienna-id');
    expect(summary).toContain('fetchStatus=success');
    expect(summary).toContain('intelligenceFetch=yes');
    expect(summary).toContain('intelligenceSuccess=yes');
    expect(summary).toContain('communityRows=1');
    expect(summary).toContain('fragranticaRow=yes');
    expect(summary).toContain('mapped=1');
    expect(summary).toContain('accords=10');
    expect(summary).toContain('signals=9');
    expect(summary).toContain('renderedAccords=10');
    expect(summary).toContain('accordsSection=yes');
    expect(summary).toContain('renderedSignals=9');
    expect(summary).toContain('signalsSection=yes');
    expect(summary).toContain('renderedTrustLabels=1');
    expect(summary).toContain('communitySourceLabel=yes');
    expect(summary).toContain('storage=local');
    expect(summary).toContain('storageKey=sb-test-auth-token');
    expect(summary).toContain('localAuthKey=yes');
    expect(summary).toContain('detail=Not For Sale / Alexandria Fragrances');
    expect(summary).toContain('control=Open Collection');
    expect(summary).toContain('origin=https://example.test');
    expect(summary).toContain('originChanged=no');
    expect(summary).toContain('redirectOrigin=https://example.test');
    expect(summary).toContain('urlAuthParams=yes');
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

  it('explains a signed-out mount when no logout was observed', () => {
    const summary = buildAuthDiagnosticSummary({
      accessMode: 'signed-out',
      authReady: true,
      buildCommit: 'abc1234',
      buildTime: '2026-06-22T00:00:00.000Z',
      getSessionConfirmsSession: false,
      guestOverride: false,
      host: 'example.test',
      origin: 'https://example.test',
      packageVersion: '0.0.0',
      pathname: '/',
      projectRef: 'projectref',
      detailCommunityEvidenceTrace: [],
      reloadCrashTrace: [],
      storageKeyName: AUTH_KEY,
      storageMode: 'local',
      storagePresence: {
        localAuthKeyExists: false,
        sessionAuthKeyExists: false,
      },
      trace: [{
        authReady: true,
        decision: 'loaded',
        reason: 'app_mount',
        sessionPresent: false,
        source: 'page',
        storageKeyName: AUTH_KEY,
        storageMode: 'local',
        timestamp: '2026-06-22T00:00:00.000Z',
        userPresent: false,
      }],
      userPresent: false,
    });

    expect(summary).toContain('No session was present when the app mounted. This diagnostic did not observe a logout.');
  });
});
