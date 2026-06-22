export type OdaraAuthTraceAccessMode = 'signed-in' | 'guest' | 'signed-out' | 'unknown';

export type OdaraAuthTraceEntry = {
  accessMode?: OdaraAuthTraceAccessMode;
  authReady?: boolean;
  decision?: string;
  event?: string;
  reason?: string;
  sessionPresent?: boolean;
  source: 'Index' | 'OdaraScreen' | 'storage' | 'access-mode';
  storageKeyName?: string;
  storageMode?: 'local' | 'session';
  timestamp: string;
  userPresent?: boolean;
};

const MAX_TRACE_ENTRIES = 120;

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

export function recordOdaraAuthTrace(entry: Omit<OdaraAuthTraceEntry, 'storageMode' | 'timestamp'>) {
  if (typeof window === 'undefined') return;
  const trace = window.__ODARA_AUTH_TRACE__ ?? [];
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
