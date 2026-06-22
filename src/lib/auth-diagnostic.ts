import { ODARA_BUILD_INFO } from './build-info';
import {
  type OdaraAuthTraceAccessMode,
  type OdaraAuthTraceEntry,
  readSafeAuthStorageMode,
} from './auth-debug-trace';

export const ODARA_AUTH_DEBUG_QUERY_PARAM = 'odaraAuthDebug';
export const ODARA_AUTH_DEBUG_STORAGE_KEY = 'odara_auth_debug_enabled_v1';

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
  storageKeyName: string;
  storageMode: 'local' | 'session';
  storagePresence: AuthDiagnosticStoragePresence;
  trace: OdaraAuthTraceEntry[];
  userPresent: boolean;
};

export function isAuthDebugSearchEnabled(search: string): boolean {
  const params = new URLSearchParams(search);
  if (!params.has(ODARA_AUTH_DEBUG_QUERY_PARAM)) return false;
  const value = params.get(ODARA_AUTH_DEBUG_QUERY_PARAM);
  return value == null || value === '' || value === '1' || value.toLowerCase() === 'true';
}

export function isAuthDebugSearchDisabled(search: string): boolean {
  const params = new URLSearchParams(search);
  if (!params.has(ODARA_AUTH_DEBUG_QUERY_PARAM)) return false;
  const value = params.get(ODARA_AUTH_DEBUG_QUERY_PARAM);
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
  return Array.isArray(trace) ? trace.slice(-40) : [];
}

export function buildAuthDiagnosticSummary(input: AuthDiagnosticSummaryInput): string {
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
    'events:',
  ];

  input.trace.slice(-20).forEach((entry, index) => {
    lines.push([
      `${index + 1}.`,
      entry.timestamp,
      `source=${entry.source}`,
      `event=${entry.event ?? 'none'}`,
      `decision=${entry.decision ?? 'none'}`,
      `session=${entry.sessionPresent == null ? 'unknown' : entry.sessionPresent ? 'yes' : 'no'}`,
      `user=${entry.userPresent == null ? 'unknown' : entry.userPresent ? 'yes' : 'no'}`,
      `authReady=${entry.authReady == null ? 'unknown' : entry.authReady ? 'yes' : 'no'}`,
      `access=${entry.accessMode ?? 'unknown'}`,
      `reason=${entry.reason ?? 'none'}`,
    ].join(' '));
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
    storageKeyName,
    storageMode: readSafeAuthStorageMode(),
    storagePresence: readAuthStoragePresence(storageKeyName),
    trace: readSafeAuthTrace(),
  };
}
