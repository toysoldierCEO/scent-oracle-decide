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
  trace.push({
    ...entry,
    storageMode: readSafeAuthStorageMode(),
    timestamp: new Date().toISOString(),
  });
  if (trace.length > MAX_TRACE_ENTRIES) {
    trace.splice(0, trace.length - MAX_TRACE_ENTRIES);
  }
  window.__ODARA_AUTH_TRACE__ = trace;
}
