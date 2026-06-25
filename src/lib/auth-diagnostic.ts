import { ODARA_BUILD_INFO } from './build-info';
import {
  type OdaraAuthTraceAccessMode,
  type OdaraAuthTraceEntry,
  readPersistedOdaraAuthTrace,
  readSafeAuthStorageMode,
} from './auth-debug-trace';
import {
  type OdaraReloadCrashEntry,
  readSafeOdaraReloadCrashTrace,
} from './page-reload-crash-recorder';
import {
  type OdaraDetailCommunityEvidenceTraceEntry,
  readSafeOdaraDetailCommunityEvidenceTrace,
} from './detailCommunityEvidenceDiagnostic';

export const ODARA_AUTH_DEBUG_QUERY_PARAM = 'odaraAuthDebug';
export const ODARA_DETAIL_DEBUG_QUERY_PARAM = 'odaraDetailDebug';
export const ODARA_AUTH_DEBUG_STORAGE_KEY = 'odara_auth_debug_enabled_v1';
export const ODARA_AUTH_DEBUG_TAP_WINDOW_MS = 2500;
export const ODARA_AUTH_DEBUG_REQUIRED_TAPS = 7;

export type AuthDiagnosticStoragePresence = {
  localAuthKeyExists: boolean;
  sessionAuthKeyExists: boolean;
};

export type AuthDiagnosticSummaryInput = {
  accessMode: OdaraAuthTraceAccessMode;
  authReady: boolean;
  buildCommit?: string;
  buildTime?: string;
  getSessionConfirmsSession: boolean | null;
  guestOverride: boolean;
  host: string;
  origin: string;
  packageVersion?: string;
  pathname: string;
  projectRef: string;
  detailCommunityEvidenceTrace: OdaraDetailCommunityEvidenceTraceEntry[];
  reloadCrashTrace: OdaraReloadCrashEntry[];
  storageKeyName: string;
  storageMode: 'local' | 'session';
  storagePresence: AuthDiagnosticStoragePresence;
  trace: OdaraAuthTraceEntry[];
  userPresent: boolean;
};

export function isAuthDebugSearchEnabled(search: string): boolean {
  const params = new URLSearchParams(search);
  if (!params.has(ODARA_AUTH_DEBUG_QUERY_PARAM) && !params.has(ODARA_DETAIL_DEBUG_QUERY_PARAM)) return false;
  const value = params.has(ODARA_AUTH_DEBUG_QUERY_PARAM)
    ? params.get(ODARA_AUTH_DEBUG_QUERY_PARAM)
    : params.get(ODARA_DETAIL_DEBUG_QUERY_PARAM);
  return value == null || value === '' || value === '1' || value.toLowerCase() === 'true';
}

export function isAuthDebugSearchDisabled(search: string): boolean {
  const params = new URLSearchParams(search);
  if (!params.has(ODARA_AUTH_DEBUG_QUERY_PARAM) && !params.has(ODARA_DETAIL_DEBUG_QUERY_PARAM)) return false;
  const value = params.has(ODARA_AUTH_DEBUG_QUERY_PARAM)
    ? params.get(ODARA_AUTH_DEBUG_QUERY_PARAM)
    : params.get(ODARA_DETAIL_DEBUG_QUERY_PARAM);
  return value === '0' || value?.toLowerCase() === 'false';
}

export function readAuthDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (isAuthDebugSearchEnabled(window.location.search)) {
      window.sessionStorage.setItem(ODARA_AUTH_DEBUG_STORAGE_KEY, '1');
      return true;
    }
    if (isAuthDebugSearchDisabled(window.location.search)) {
      window.sessionStorage.removeItem(ODARA_AUTH_DEBUG_STORAGE_KEY);
      return false;
    }
    return window.sessionStorage.getItem(ODARA_AUTH_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return isAuthDebugSearchEnabled(window.location.search);
  }
}

export function setAuthDebugEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) {
      window.sessionStorage.setItem(ODARA_AUTH_DEBUG_STORAGE_KEY, '1');
    } else {
      window.sessionStorage.removeItem(ODARA_AUTH_DEBUG_STORAGE_KEY);
    }
  } catch {
    /* ignore storage failures */
  }
  window.dispatchEvent(new CustomEvent('odara-auth-debug-enabled', { detail: { enabled } }));
}

export function removeAuthDebugSearchParamFromCurrentUrl(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(ODARA_AUTH_DEBUG_QUERY_PARAM) && !url.searchParams.has(ODARA_DETAIL_DEBUG_QUERY_PARAM)) return false;
    url.searchParams.delete(ODARA_AUTH_DEBUG_QUERY_PARAM);
    url.searchParams.delete(ODARA_DETAIL_DEBUG_QUERY_PARAM);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl || '/');
    return true;
  } catch {
    return false;
  }
}

export function dismissAuthDebugPanel() {
  setAuthDebugEnabled(false);
  removeAuthDebugSearchParamFromCurrentUrl();
}

export function getNextAuthDebugTapCount({
  lastTapAt,
  now,
  previousCount,
}: {
  lastTapAt: number | null;
  now: number;
  previousCount: number;
}) {
  return lastTapAt != null && now - lastTapAt <= ODARA_AUTH_DEBUG_TAP_WINDOW_MS
    ? previousCount + 1
    : 1;
}

export function readAuthStoragePresence(storageKeyName: string): AuthDiagnosticStoragePresence {
  if (typeof window === 'undefined') {
    return { localAuthKeyExists: false, sessionAuthKeyExists: false };
  }

  let localAuthKeyExists = false;
  let sessionAuthKeyExists = false;

  try {
    localAuthKeyExists = window.localStorage.getItem(storageKeyName) != null;
  } catch {
    localAuthKeyExists = false;
  }

  try {
    sessionAuthKeyExists = window.sessionStorage.getItem(storageKeyName) != null;
  } catch {
    sessionAuthKeyExists = false;
  }

  return { localAuthKeyExists, sessionAuthKeyExists };
}

export function readSafeAuthTrace(): OdaraAuthTraceEntry[] {
  if (typeof window === 'undefined') return [];
  const trace = window.__ODARA_AUTH_TRACE__;
  return Array.isArray(trace) ? trace.slice(-40) : readPersistedOdaraAuthTrace().slice(-40);
}

export function buildAuthDiagnosticSummary(input: AuthDiagnosticSummaryInput): string {
  const observedLogout = input.trace.some((entry) => (
    entry.event === 'SIGNED_OUT'
    || entry.decision === 'sign_out_called'
    || (entry.source === 'storage' && entry.decision === 'removed')
  ));
  const lines = [
    'ODARA AUTH DIAGNOSTIC',
    `build commit: ${input.buildCommit ?? ODARA_BUILD_INFO.commit}`,
    `build time: ${input.buildTime ?? ODARA_BUILD_INFO.buildTime}`,
    `package version: ${input.packageVersion ?? ODARA_BUILD_INFO.packageVersion}`,
    `origin: ${input.origin}`,
    `host: ${input.host}`,
    `path: ${input.pathname}`,
    `supabase project ref: ${input.projectRef}`,
    `auth storage mode: ${input.storageMode}`,
    `auth storage key name: ${input.storageKeyName}`,
    `local auth key exists: ${input.storagePresence.localAuthKeyExists ? 'yes' : 'no'}`,
    `session auth key exists: ${input.storagePresence.sessionAuthKeyExists ? 'yes' : 'no'}`,
    `authReady: ${input.authReady ? 'yes' : 'no'}`,
    `user present: ${input.userPresent ? 'yes' : 'no'}`,
    `access mode: ${input.accessMode}`,
    `guest override: ${input.guestOverride ? 'yes' : 'no'}`,
    `getSession confirms session: ${input.getSessionConfirmsSession == null ? 'unknown' : input.getSessionConfirmsSession ? 'yes' : 'no'}`,
  ];

  if (
    !input.userPresent
    && input.getSessionConfirmsSession === false
    && !input.storagePresence.localAuthKeyExists
    && !input.storagePresence.sessionAuthKeyExists
    && !observedLogout
  ) {
    lines.push('signed-out note: No session was present when the app mounted. This diagnostic did not observe a logout.');
  }

  lines.push('auth events:');

  input.trace.slice(-20).forEach((entry, index) => {
    lines.push([
      `${index + 1}.`,
      entry.timestamp,
      `source=${entry.source}`,
      `event=${entry.event ?? 'none'}`,
      `decision=${entry.decision ?? 'none'}`,
      entry.origin ? `origin=${entry.origin}` : null,
      entry.originChanged == null ? null : `originChanged=${entry.originChanged ? 'yes' : 'no'}`,
      entry.redirectOrigin ? `redirectOrigin=${entry.redirectOrigin}` : null,
      entry.urlHasAuthParams == null ? null : `urlAuthParams=${entry.urlHasAuthParams ? 'yes' : 'no'}`,
      entry.localAuthKeyExists == null ? null : `localAuthKey=${entry.localAuthKeyExists ? 'yes' : 'no'}`,
      entry.sessionAuthKeyExists == null ? null : `sessionAuthKey=${entry.sessionAuthKeyExists ? 'yes' : 'no'}`,
      `session=${entry.sessionPresent == null ? 'unknown' : entry.sessionPresent ? 'yes' : 'no'}`,
      `user=${entry.userPresent == null ? 'unknown' : entry.userPresent ? 'yes' : 'no'}`,
      `authReady=${entry.authReady == null ? 'unknown' : entry.authReady ? 'yes' : 'no'}`,
      `access=${entry.accessMode ?? 'unknown'}`,
      entry.guestOverride == null ? null : `guestOverride=${entry.guestOverride ? 'yes' : 'no'}`,
      `reason=${entry.reason ?? 'none'}`,
      entry.previousDate ? `previousDate=${entry.previousDate}` : null,
      entry.nextDate ? `nextDate=${entry.nextDate}` : null,
      entry.targetDate ? `targetDate=${entry.targetDate}` : null,
      entry.selectedDate ? `selectedDate=${entry.selectedDate}` : null,
      entry.contextKey ? `context=${entry.contextKey}` : null,
      entry.oracleKeyPresent == null ? null : `oracleKey=${entry.oracleKeyPresent ? 'yes' : 'no'}`,
      entry.oracleSlotKeyPresent == null ? null : `oracleSlotKey=${entry.oracleSlotKeyPresent ? 'yes' : 'no'}`,
    ].filter(Boolean).join(' '));
  });

  lines.push('reload/crash events:');
  input.reloadCrashTrace.slice(-20).forEach((entry, index) => {
    lines.push([
      `${index + 1}.`,
      entry.timestamp,
      `source=${entry.source}`,
      `event=${entry.event ?? 'none'}`,
      `decision=${entry.decision ?? 'none'}`,
      entry.navigationType ? `navigation=${entry.navigationType}` : null,
      entry.visibilityState ? `visibility=${entry.visibilityState}` : null,
      entry.persisted == null ? null : `persisted=${entry.persisted ? 'yes' : 'no'}`,
      entry.routePath ? `path=${entry.routePath}` : null,
      entry.screen ? `screen=${entry.screen}` : null,
      entry.accessMode ? `access=${entry.accessMode}` : null,
      entry.storageMode ? `storage=${entry.storageMode}` : null,
      entry.storageKeyName ? `storageKey=${entry.storageKeyName}` : null,
      entry.localAuthKeyExists == null ? null : `localAuthKey=${entry.localAuthKeyExists ? 'yes' : 'no'}`,
      entry.sessionAuthKeyExists == null ? null : `sessionAuthKey=${entry.sessionAuthKeyExists ? 'yes' : 'no'}`,
      entry.authReady == null ? null : `authReady=${entry.authReady ? 'yes' : 'no'}`,
      entry.userPresent == null ? null : `user=${entry.userPresent ? 'yes' : 'no'}`,
      entry.selectedDate ? `selectedDate=${entry.selectedDate}` : null,
      entry.contextKey ? `context=${entry.contextKey}` : null,
      entry.menuOpen == null ? null : `menuOpen=${entry.menuOpen ? 'yes' : 'no'}`,
      entry.menuPage ? `menuPage=${entry.menuPage}` : null,
      entry.searchOpen == null ? null : `searchOpen=${entry.searchOpen ? 'yes' : 'no'}`,
      entry.detailOpen == null ? null : `detailOpen=${entry.detailOpen ? 'yes' : 'no'}`,
      entry.detailLabel ? `detail=${entry.detailLabel}` : null,
      entry.bottomSheetOpen == null ? null : `sheetOpen=${entry.bottomSheetOpen ? 'yes' : 'no'}`,
      entry.tagName ? `tag=${entry.tagName}` : null,
      entry.role ? `role=${entry.role}` : null,
      entry.actionLabel ? `action=${entry.actionLabel}` : null,
      entry.closestControlLabel ? `control=${entry.closestControlLabel}` : null,
      entry.href ? `href=${entry.href}` : null,
      entry.errorName ? `error=${entry.errorName}` : null,
      entry.errorMessage ? `message=${entry.errorMessage}` : null,
      `reason=${entry.reason ?? 'none'}`,
    ].filter(Boolean).join(' '));
  });

  lines.push('detail community evidence events:');
  input.detailCommunityEvidenceTrace.slice(-20).forEach((entry, index) => {
    lines.push([
      `${index + 1}.`,
      entry.timestamp,
      `source=${entry.source}`,
      `decision=${entry.decision}`,
      entry.fragranceId ? `fragranceId=${entry.fragranceId}` : null,
      entry.fragranceName ? `fragrance=${entry.fragranceName}` : null,
      entry.fragranceBrand ? `brand=${entry.fragranceBrand}` : null,
      entry.cacheKey ? `cacheKey=${entry.cacheKey}` : null,
      entry.cacheHit == null ? null : `cacheHit=${entry.cacheHit ? 'yes' : 'no'}`,
      entry.cacheComplete == null ? null : `cacheComplete=${entry.cacheComplete ? 'yes' : 'no'}`,
      entry.cacheVersion ? `cacheVersion=${entry.cacheVersion}` : null,
      entry.communityEvidenceChecked == null ? null : `communityChecked=${entry.communityEvidenceChecked ? 'yes' : 'no'}`,
      entry.detailOpenedFromCollection == null ? null : `fromCollection=${entry.detailOpenedFromCollection ? 'yes' : 'no'}`,
      entry.detailFetchAttempted == null ? null : `fetchAttempted=${entry.detailFetchAttempted ? 'yes' : 'no'}`,
      entry.detailFetchStatus ? `fetchStatus=${entry.detailFetchStatus}` : null,
      entry.intelligenceFetchAttempted == null ? null : `intelligenceFetch=${entry.intelligenceFetchAttempted ? 'yes' : 'no'}`,
      entry.intelligenceFetchSuccess == null ? null : `intelligenceSuccess=${entry.intelligenceFetchSuccess ? 'yes' : 'no'}`,
      entry.intelligenceFetchError == null ? null : `intelligenceError=${entry.intelligenceFetchError ? 'yes' : 'no'}`,
      entry.resolverCacheVersion ? `resolverVersion=${entry.resolverCacheVersion}` : null,
      entry.resolverDisabled == null ? null : `resolverDisabled=${entry.resolverDisabled ? 'yes' : 'no'}`,
      entry.collectionPreviewChipCount == null ? null : `previewChips=${entry.collectionPreviewChipCount}`,
      entry.collectionPreviewCommunityChipCount == null ? null : `previewCommunityChips=${entry.collectionPreviewCommunityChipCount}`,
      entry.collectionPreviewFamilyChipCount == null ? null : `previewFamilyChips=${entry.collectionPreviewFamilyChipCount}`,
      entry.collectionPreviewChipSources?.length ? `previewSources=${entry.collectionPreviewChipSources.join(',')}` : null,
      entry.communityRowsReturnedCount == null ? null : `communityRows=${entry.communityRowsReturnedCount}`,
      entry.approvedFragranticaRowPresent == null ? null : `fragranticaRow=${entry.approvedFragranticaRowPresent ? 'yes' : 'no'}`,
      entry.mappedCount == null ? null : `mapped=${entry.mappedCount}`,
      entry.communityEvidenceMappedCount == null ? null : `mappedEvidence=${entry.communityEvidenceMappedCount}`,
      entry.accordCount == null ? null : `accords=${entry.accordCount}`,
      entry.communitySignalsCount == null ? null : `signals=${entry.communitySignalsCount}`,
      entry.trustLabelCount == null ? null : `trustLabels=${entry.trustLabelCount}`,
      entry.renderedAccordCount == null ? null : `renderedAccords=${entry.renderedAccordCount}`,
      entry.renderedAccordsSection == null ? null : `accordsSection=${entry.renderedAccordsSection ? 'yes' : 'no'}`,
      entry.renderedCommunitySignalCount == null ? null : `renderedSignals=${entry.renderedCommunitySignalCount}`,
      entry.renderedCommunitySignalsSection == null ? null : `signalsSection=${entry.renderedCommunitySignalsSection ? 'yes' : 'no'}`,
      entry.renderedTrustLabelCount == null ? null : `renderedTrustLabels=${entry.renderedTrustLabelCount}`,
      entry.renderedCommunitySourceLabel == null ? null : `communitySourceLabel=${entry.renderedCommunitySourceLabel ? 'yes' : 'no'}`,
    ].filter(Boolean).join(' '));
  });

  return lines.join('\n');
}

export function getCurrentAuthDiagnosticBase(storageKeyName: string, projectRef: string) {
  return {
    buildCommit: ODARA_BUILD_INFO.commit,
    buildTime: ODARA_BUILD_INFO.buildTime,
    host: typeof window === 'undefined' ? 'unknown' : window.location.host,
    origin: typeof window === 'undefined' ? 'unknown' : window.location.origin,
    packageVersion: ODARA_BUILD_INFO.packageVersion,
    pathname: typeof window === 'undefined' ? 'unknown' : window.location.pathname,
    projectRef,
    detailCommunityEvidenceTrace: readSafeOdaraDetailCommunityEvidenceTrace(),
    reloadCrashTrace: readSafeOdaraReloadCrashTrace(),
    storageKeyName,
    storageMode: readSafeAuthStorageMode(),
    storagePresence: readAuthStoragePresence(storageKeyName),
    trace: readSafeAuthTrace(),
  };
}
