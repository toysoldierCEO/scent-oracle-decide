export type OdaraAuthTraceAccessMode = 'signed-in' | 'guest' | 'signed-out' | 'unknown';

export type OdaraAuthTraceEntry = {
  accessMode?: OdaraAuthTraceAccessMode;
  authReady?: boolean;
  contextKey?: string;
  decision?: string;
  event?: string;
  nextDate?: string;
  oracleKeyPresent?: boolean;
  oracleSlotKeyPresent?: boolean;
  previousDate?: string;
  reason?: string;
  selectedDate?: string;
  sessionPresent?: boolean;
  source: 'Index' | 'OdaraScreen' | 'auth-debug' | 'day-selection' | 'oracle' | 'page' | 'storage' | 'access-mode';
  storageKeyName?: string;
  storageMode?: 'local' | 'session';
  targetDate?: string;
  timestamp: string;
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

function readPersistedAuthTrace(): OdaraAuthTraceEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(ODARA_AUTH_TRACE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_TRACE_ENTRIES) : [];
  } catch {
    return [];
  }
}

function persistAuthTrace(trace: OdaraAuthTraceEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ODARA_AUTH_TRACE_STORAGE_KEY, JSON.stringify(trace.slice(-MAX_TRACE_ENTRIES)));
  } catch {
    /* ignore storage failures */
  }
}

export function recordOdaraAuthTrace(entry: Omit<OdaraAuthTraceEntry, 'storageMode' | 'timestamp'>) {
  if (typeof window === 'undefined') return;
  const trace = window.__ODARA_AUTH_TRACE__ ?? readPersistedAuthTrace();
  const nextEntry = {
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
