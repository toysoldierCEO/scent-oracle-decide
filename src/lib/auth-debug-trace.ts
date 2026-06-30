import { ODARA_GUEST_OVERRIDE_STORAGE_KEY } from './access-mode';
import { ODARA_BUILD_INFO } from './build-info';

export type OdaraAuthTraceAccessMode = 'signed-in' | 'guest' | 'signed-out' | 'unknown';

export type OdaraAuthTraceEntry = {
  accessMode?: OdaraAuthTraceAccessMode;
  actionId?: string;
  authReady?: boolean;
  blocked?: boolean;
  buildCommit?: string;
  caller?: string;
  clearCaller?: string;
  contextKey?: string;
  decision?: string;
  defaultPrevented?: boolean;
  errorCategory?: string;
  errorCode?: string | null;
  errorName?: string;
  errorStatus?: number | null;
  event?: string;
  getSessionResult?: 'present' | 'null' | 'error';
  getUserResult?: 'valid' | 'null' | 'error';
  guestOverride?: boolean;
  host?: string;
  localAuthKeyExists?: boolean;
  menuOpen?: boolean;
  nextDate?: string;
  oracleKeyPresent?: boolean;
  oracleSlotKeyPresent?: boolean;
  origin?: string;
  originChanged?: boolean;
  path?: string;
  pointerType?: string;
  previousDate?: string;
  propagationStopped?: boolean;
  reason?: string;
  redirectOrigin?: string;
  redirectTarget?: string;
  routePath?: string;
  routeDecision?: string;
  safeDisplayMessage?: string;
  selectedDate?: string;
  sessionPresent?: boolean;
  sessionAuthKeyExists?: boolean;
  sessionUserIdHint?: string | null;
  source: 'Index' | 'OdaraScreen' | 'auth-debug' | 'day-selection' | 'oracle' | 'page' | 'storage' | 'access-mode';
  storageBackendUsed?: 'local' | 'session' | 'both' | 'none';
  storageKeyName?: string;
  storageMode?: 'local' | 'session';
  storageOperation?: 'getItem' | 'setItem' | 'removeItem';
  storageOutcome?: string;
  targetLabel?: string;
  targetDate?: string;
  timestamp: string;
  urlHasAuthParams?: boolean;
  userIdHint?: string | null;
  userPresent?: boolean;
};

const MAX_TRACE_ENTRIES = 120;
export const ODARA_AUTH_TRACE_STORAGE_KEY = 'odara_auth_trace_v1';

declare global {
  interface Window {
    __ODARA_AUTH_TRACE__?: OdaraAuthTraceEntry[];
  }
}

export function readSafeAuthStorageMode() {
  if (typeof window === 'undefined') return 'local';
  try {
    return window.localStorage.getItem('vesper_auth_persistence_mode') === 'session' ? 'session' : 'local';
  } catch {
    return 'local';
  }
}

function safeGetStorageItem(storage: Storage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorageItem(storage: Storage | null, key: string, value: string) {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore storage failures */
  }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function readPersistedOdaraAuthTrace(): OdaraAuthTraceEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = safeGetStorageItem(getLocalStorage(), ODARA_AUTH_TRACE_STORAGE_KEY)
      ?? safeGetStorageItem(getSessionStorage(), ODARA_AUTH_TRACE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_TRACE_ENTRIES) : [];
  } catch {
    return [];
  }
}

function persistAuthTrace(trace: OdaraAuthTraceEntry[]) {
  if (typeof window === 'undefined') return;
  const serialized = JSON.stringify(trace.slice(-MAX_TRACE_ENTRIES));
  safeSetStorageItem(getLocalStorage(), ODARA_AUTH_TRACE_STORAGE_KEY, serialized);
  safeSetStorageItem(getSessionStorage(), ODARA_AUTH_TRACE_STORAGE_KEY, serialized);
}

function getAuthStoragePresence(storageKeyName?: string) {
  if (!storageKeyName || typeof window === 'undefined') {
    return { localAuthKeyExists: undefined, sessionAuthKeyExists: undefined };
  }
  return {
    localAuthKeyExists: safeGetStorageItem(getLocalStorage(), storageKeyName) != null,
    sessionAuthKeyExists: safeGetStorageItem(getSessionStorage(), storageKeyName) != null,
  };
}

function readGuestOverrideFlag(): boolean | undefined {
  if (typeof window === 'undefined') return undefined;
  return safeGetStorageItem(getSessionStorage(), ODARA_GUEST_OVERRIDE_STORAGE_KEY) === '1';
}

export function hasPersistedOdaraAuthTrace(): boolean {
  return readPersistedOdaraAuthTrace().length > 0;
}

export function recordOdaraAuthTrace(entry: Omit<OdaraAuthTraceEntry, 'storageMode' | 'timestamp'>) {
  if (typeof window === 'undefined') return;
  const trace = window.__ODARA_AUTH_TRACE__ ?? readPersistedOdaraAuthTrace();
  const storagePresence = getAuthStoragePresence(entry.storageKeyName);
  const nextEntry = {
    buildCommit: ODARA_BUILD_INFO.commit,
    guestOverride: readGuestOverrideFlag(),
    host: window.location.host,
    localAuthKeyExists: storagePresence.localAuthKeyExists,
    origin: window.location.origin,
    path: window.location.pathname,
    sessionAuthKeyExists: storagePresence.sessionAuthKeyExists,
    ...entry,
    storageMode: readSafeAuthStorageMode(),
    timestamp: new Date().toISOString(),
  };
  trace.push(nextEntry);
  if (trace.length > MAX_TRACE_ENTRIES) {
    trace.splice(0, trace.length - MAX_TRACE_ENTRIES);
  }
  window.__ODARA_AUTH_TRACE__ = trace;
  persistAuthTrace(trace);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.odaraAuthTraceLength = String(trace.length);
    document.documentElement.dataset.odaraAuthLastDecision = nextEntry.decision ?? '';
    document.documentElement.dataset.odaraAuthLastSource = nextEntry.source;
    document.documentElement.dataset.odaraAuthLastEvent = nextEntry.event ?? '';
    const traceNodeId = 'odara-auth-trace';
    const existing = document.getElementById(traceNodeId);
    const traceNode = existing ?? document.createElement('script');
    traceNode.id = traceNodeId;
    traceNode.setAttribute('type', 'application/json');
    traceNode.textContent = JSON.stringify(trace);
    if (!existing) document.head.appendChild(traceNode);
  }
}
