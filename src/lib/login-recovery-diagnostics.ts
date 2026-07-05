import { ODARA_AUTH_TRACE_STORAGE_KEY, readPersistedOdaraAuthTrace } from './auth-debug-trace';
import { ODARA_BUILD_INFO } from './build-info';
import { ODARA_AUTH_STORAGE_KEY } from './odara-auth-constants';
import {
  ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY,
  readPersistedOdaraReloadCrashTrace,
} from './page-reload-crash-recorder';

export const ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY = 'odara_login_recovery_trace_v1';
export const ODARA_SAFE_MODE_QUERY_PARAM = 'odaraSafeMode';
export const ODARA_RECOVERY_QUERY_PARAM = 'odaraRecovery';

const MAX_RECOVERY_ENTRIES = 120;
const RECENT_LOGIN_WINDOW_MS = 20 * 60 * 1000;
const MAX_SAFE_TEXT_LENGTH = 160;

export type OdaraLoginRecoverySource =
  | 'auth'
  | 'boot'
  | 'login'
  | 'page'
  | 'recovery-ui'
  | 'runtime-error'
  | 'storage';

export type OdaraLoginRecoveryEntry = {
  authKeyExists?: boolean;
  buildCommit?: string;
  decision: string;
  errorCategory?: string;
  errorCode?: string | null;
  errorMessage?: string;
  errorName?: string;
  errorStatus?: number | null;
  event?: string;
  localAuthKeyExists?: boolean;
  navigationType?: string;
  origin?: string;
  originChanged?: boolean;
  path?: string;
  reason?: string;
  redirectOrigin?: string;
  redirectTarget?: string;
  returnedOrigin?: string;
  safeDisplayMessage?: string;
  sessionAuthKeyExists?: boolean;
  sessionPresent?: boolean;
  source: OdaraLoginRecoverySource;
  storageKeyName?: string;
  timestamp: string;
  urlHasAuthParams?: boolean;
  visibilityState?: DocumentVisibilityState;
};

export type OdaraRecoverySnapshot = {
  authKeyExists: boolean;
  getSessionConfirmsSession?: boolean | null;
  lastReloadCrashEvent: string;
  origin: string;
  path: string;
  possibleLoginPersistenceFailure: boolean;
  recentLoginAttempt: boolean;
  recoveryTrace: OdaraLoginRecoveryEntry[];
};

declare global {
  interface Window {
    __ODARA_EARLY_BOOT_RECORDER_INSTALLED__?: boolean;
    __ODARA_LOGIN_RECOVERY_TRACE__?: OdaraLoginRecoveryEntry[];
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

function safeRemoveStorageItem(storage: Storage | null, key: string) {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore storage failures */
  }
}

function sanitizeText(value: unknown, maxLength = MAX_SAFE_TEXT_LENGTH): string | undefined {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return undefined;

  const lower = text.toLowerCase();
  if (
    lower.includes('access_token')
    || lower.includes('refresh_token')
    || lower.includes('authorization')
    || lower.includes('bearer ')
    || lower.includes('password')
    || lower.includes('auth code')
    || lower.includes('magic link')
    || lower.includes('api_key')
    || lower.includes('apikey')
    || lower.includes('anon_key')
  ) {
    return '[redacted]';
  }

  const withoutEmail = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
  return withoutEmail.length <= maxLength ? withoutEmail : `${withoutEmail.slice(0, maxLength - 1)}…`;
}

function readNavigationType(): string | undefined {
  if (typeof performance === 'undefined') return undefined;
  const [navigationEntry] = performance.getEntriesByType?.('navigation') ?? [];
  const typedEntry = navigationEntry as PerformanceNavigationTiming | undefined;
  if (typedEntry?.type) return typedEntry.type;

  const legacyNavigation = (performance as Performance & { navigation?: { type?: number } }).navigation;
  if (!legacyNavigation) return undefined;
  if (legacyNavigation.type === 1) return 'reload';
  if (legacyNavigation.type === 2) return 'back_forward';
  if (legacyNavigation.type === 0) return 'navigate';
  return String(legacyNavigation.type);
}

function readAuthKeyPresence(storageKeyName = ODARA_AUTH_STORAGE_KEY) {
  const localAuthKeyExists = safeGetStorageItem(getLocalStorage(), storageKeyName) != null;
  const sessionAuthKeyExists = safeGetStorageItem(getSessionStorage(), storageKeyName) != null;
  return {
    authKeyExists: localAuthKeyExists || sessionAuthKeyExists,
    localAuthKeyExists,
    sessionAuthKeyExists,
  };
}

function readRecoveryTraceFromStorage(): OdaraLoginRecoveryEntry[] {
  const raw = safeGetStorageItem(getLocalStorage(), ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY)
    ?? safeGetStorageItem(getSessionStorage(), ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_RECOVERY_ENTRIES) : [];
  } catch {
    return [];
  }
}

function persistRecoveryTrace(trace: OdaraLoginRecoveryEntry[]) {
  const serialized = JSON.stringify(trace.slice(-MAX_RECOVERY_ENTRIES));
  safeSetStorageItem(getLocalStorage(), ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY, serialized);
  safeSetStorageItem(getSessionStorage(), ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY, serialized);
}

export function readPersistedOdaraLoginRecoveryTrace(): OdaraLoginRecoveryEntry[] {
  if (typeof window === 'undefined') return [];
  return readRecoveryTraceFromStorage();
}

export function readSafeOdaraLoginRecoveryTrace(): OdaraLoginRecoveryEntry[] {
  if (typeof window === 'undefined') return [];
  return (window.__ODARA_LOGIN_RECOVERY_TRACE__ ?? readPersistedOdaraLoginRecoveryTrace()).slice(-40);
}

export function recordOdaraLoginRecoveryEvent(entry: Omit<OdaraLoginRecoveryEntry, 'buildCommit' | 'timestamp'>) {
  if (typeof window === 'undefined') return;
  const trace = window.__ODARA_LOGIN_RECOVERY_TRACE__ ?? readPersistedOdaraLoginRecoveryTrace();
  const storagePresence = readAuthKeyPresence(entry.storageKeyName ?? ODARA_AUTH_STORAGE_KEY);
  const nextEntry: OdaraLoginRecoveryEntry = {
    ...storagePresence,
    ...entry,
    buildCommit: ODARA_BUILD_INFO.commit,
    decision: sanitizeText(entry.decision, 80) ?? 'unknown',
    errorCategory: sanitizeText(entry.errorCategory, 80),
    errorCode: sanitizeText(entry.errorCode, 80),
    errorMessage: sanitizeText(entry.errorMessage, 160),
    errorName: sanitizeText(entry.errorName, 80),
    errorStatus: typeof entry.errorStatus === 'number' && Number.isFinite(entry.errorStatus) ? entry.errorStatus : null,
    event: sanitizeText(entry.event, 80),
    navigationType: sanitizeText(entry.navigationType ?? readNavigationType(), 32),
    origin: sanitizeText(entry.origin ?? window.location.origin, 160),
    path: sanitizeText(entry.path ?? window.location.pathname, 96),
    reason: sanitizeText(entry.reason, 120),
    redirectOrigin: sanitizeText(entry.redirectOrigin, 160),
    returnedOrigin: sanitizeText(entry.returnedOrigin, 160),
    safeDisplayMessage: sanitizeText(entry.safeDisplayMessage, 160),
    storageKeyName: sanitizeText(entry.storageKeyName ?? ODARA_AUTH_STORAGE_KEY, 120),
    timestamp: new Date().toISOString(),
    visibilityState: typeof document === 'undefined' ? undefined : document.visibilityState,
  };
  trace.push(nextEntry);
  if (trace.length > MAX_RECOVERY_ENTRIES) {
    trace.splice(0, trace.length - MAX_RECOVERY_ENTRIES);
  }
  window.__ODARA_LOGIN_RECOVERY_TRACE__ = trace;
  persistRecoveryTrace(trace);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.odaraLoginRecoveryTraceLength = String(trace.length);
    document.documentElement.dataset.odaraLoginRecoveryLastDecision = nextEntry.decision;
  }
}

export function installOdaraEarlyBootRecorder() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__ODARA_EARLY_BOOT_RECORDER_INSTALLED__) return;
  window.__ODARA_EARLY_BOOT_RECORDER_INSTALLED__ = true;

  recordOdaraLoginRecoveryEvent({
    decision: 'boot_start',
    event: 'boot',
    reason: 'entry_module_started',
    source: 'boot',
    storageKeyName: ODARA_AUTH_STORAGE_KEY,
  });
  recordOdaraLoginRecoveryEvent({
    decision: 'auth_key_presence_at_boot',
    event: 'storage_check',
    reason: 'entry_module_started',
    source: 'storage',
    storageKeyName: ODARA_AUTH_STORAGE_KEY,
  });

  const handleVisibilityChange = () => {
    recordOdaraLoginRecoveryEvent({
      decision: document.visibilityState,
      event: 'visibilitychange',
      reason: 'page_visibility_change',
      source: 'page',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
  };
  const handlePageHide = (event: PageTransitionEvent) => {
    recordOdaraLoginRecoveryEvent({
      decision: 'pagehide',
      event: 'pagehide',
      reason: event.persisted ? 'page_lifecycle_persisted' : 'page_lifecycle',
      source: 'page',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
  };
  const handleBeforeUnload = () => {
    recordOdaraLoginRecoveryEvent({
      decision: 'beforeunload',
      event: 'beforeunload',
      reason: 'page_lifecycle',
      source: 'page',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
  };
  const handleUnload = () => {
    recordOdaraLoginRecoveryEvent({
      decision: 'unload',
      event: 'unload',
      reason: 'page_lifecycle',
      source: 'page',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
  };
  const handleError = (event: ErrorEvent) => {
    recordOdaraLoginRecoveryEvent({
      decision: 'runtime_error',
      errorMessage: event.message,
      errorName: event.error instanceof Error ? event.error.name : 'ErrorEvent',
      event: 'error',
      reason: 'window_error',
      source: 'runtime-error',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    recordOdaraLoginRecoveryEvent({
      decision: 'unhandledrejection',
      errorMessage: reason instanceof Error ? reason.message : String(reason ?? 'unknown rejection'),
      errorName: reason instanceof Error ? reason.name : 'UnhandledRejection',
      event: 'unhandledrejection',
      reason: 'unhandled_promise_rejection',
      source: 'runtime-error',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('beforeunload', handleBeforeUnload);
  window.addEventListener('unload', handleUnload);
  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
}

export function recordOdaraBootPhase(decision: string, reason = 'entry_module') {
  recordOdaraLoginRecoveryEvent({
    decision,
    event: 'boot',
    reason,
    source: 'boot',
    storageKeyName: ODARA_AUTH_STORAGE_KEY,
  });
}

export function isOdaraRecoveryModeSearchEnabled(search: string): boolean {
  const params = new URLSearchParams(search);
  const value = params.get(ODARA_SAFE_MODE_QUERY_PARAM) ?? params.get(ODARA_RECOVERY_QUERY_PARAM);
  if (value == null && !params.has(ODARA_SAFE_MODE_QUERY_PARAM) && !params.has(ODARA_RECOVERY_QUERY_PARAM)) return false;
  return value == null || value === '' || value === '1' || value.toLowerCase() === 'true';
}

function entryTime(entry: { timestamp?: string }): number {
  const parsed = Date.parse(entry.timestamp ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hasRecentLoginAttempt(trace = readPersistedOdaraLoginRecoveryTrace(), now = Date.now()): boolean {
  return trace.some((entry) => {
    const age = now - entryTime(entry);
    return age >= 0
      && age <= RECENT_LOGIN_WINDOW_MS
      && (
        entry.decision.startsWith('login_submit')
        || entry.decision.startsWith('login_request')
        || entry.decision.startsWith('login_result')
        || entry.decision === 'sign_in_submit'
        || entry.decision === 'sign_in_result_success'
      );
  });
}

export function hasRecentReloadOrCrash(trace = readPersistedOdaraReloadCrashTrace(), now = Date.now()): boolean {
  return trace.some((entry) => {
    const age = now - entryTime(entry);
    return age >= 0
      && age <= RECENT_LOGIN_WINDOW_MS
      && (
        entry.decision === 'pagehide'
        || entry.decision === 'beforeunload'
        || entry.decision === 'unload'
        || entry.decision === 'page_mount_after_reload'
        || entry.event === 'error'
        || entry.event === 'unhandledrejection'
      );
  });
}

export function shouldAutoShowOdaraRecoveryPanel({
  localAuthKeyExists,
  sessionAuthKeyExists,
  userPresent,
  now = Date.now(),
  recoveryTrace = readPersistedOdaraLoginRecoveryTrace(),
  reloadCrashTrace = readPersistedOdaraReloadCrashTrace(),
}: {
  localAuthKeyExists: boolean;
  now?: number;
  recoveryTrace?: OdaraLoginRecoveryEntry[];
  reloadCrashTrace?: ReturnType<typeof readPersistedOdaraReloadCrashTrace>;
  sessionAuthKeyExists: boolean;
  userPresent: boolean;
}): boolean {
  if (userPresent) return false;
  const recentLoginAttempt = hasRecentLoginAttempt(recoveryTrace, now);
  if (!recentLoginAttempt) return false;
  return (!localAuthKeyExists && !sessionAuthKeyExists) || hasRecentReloadOrCrash(reloadCrashTrace, now);
}

export function buildOdaraRecoverySnapshot({
  getSessionConfirmsSession = null,
}: {
  getSessionConfirmsSession?: boolean | null;
} = {}): OdaraRecoverySnapshot {
  const recoveryTrace = readSafeOdaraLoginRecoveryTrace();
  const storagePresence = readAuthKeyPresence();
  const reloadCrashTrace = readPersistedOdaraReloadCrashTrace();
  const lastReload = reloadCrashTrace[reloadCrashTrace.length - 1];
  const recentLoginAttempt = hasRecentLoginAttempt(recoveryTrace);
  const possibleLoginPersistenceFailure = recentLoginAttempt
    && !getSessionConfirmsSession
    && !storagePresence.authKeyExists;

  return {
    authKeyExists: storagePresence.authKeyExists,
    getSessionConfirmsSession,
    lastReloadCrashEvent: lastReload
      ? `${lastReload.decision ?? lastReload.event ?? 'unknown'} at ${lastReload.timestamp}`
      : 'none',
    origin: typeof window === 'undefined' ? 'unknown' : window.location.origin,
    path: typeof window === 'undefined' ? 'unknown' : window.location.pathname,
    possibleLoginPersistenceFailure,
    recentLoginAttempt,
    recoveryTrace,
  };
}

export function buildOdaraRecoveryReport({
  getSessionConfirmsSession = null,
}: {
  getSessionConfirmsSession?: boolean | null;
} = {}): string {
  const snapshot = buildOdaraRecoverySnapshot({ getSessionConfirmsSession });
  const authTrace = readPersistedOdaraAuthTrace().slice(-20);
  const reloadCrashTrace = readPersistedOdaraReloadCrashTrace().slice(-20);
  const lines = [
    'ODARA LOGIN RECOVERY REPORT',
    `build commit: ${ODARA_BUILD_INFO.commit}`,
    `build time: ${ODARA_BUILD_INFO.buildTime}`,
    `origin: ${snapshot.origin}`,
    `path: ${snapshot.path}`,
    `auth key exists: ${snapshot.authKeyExists ? 'yes' : 'no'}`,
    `getSession confirms session: ${getSessionConfirmsSession == null ? 'unknown' : getSessionConfirmsSession ? 'yes' : 'no'}`,
    `recent login attempt: ${snapshot.recentLoginAttempt ? 'yes' : 'no'}`,
    `possible login persistence failure: ${snapshot.possibleLoginPersistenceFailure ? 'yes' : 'no'}`,
    `last reload/crash event: ${snapshot.lastReloadCrashEvent}`,
    '',
    'recovery events:',
  ];

  snapshot.recoveryTrace.slice(-20).forEach((entry, index) => {
    lines.push([
      `${index + 1}.`,
      entry.timestamp,
      `source=${entry.source}`,
      `event=${entry.event ?? 'none'}`,
      `decision=${entry.decision}`,
      `origin=${entry.origin ?? 'unknown'}`,
      entry.redirectOrigin ? `redirectOrigin=${entry.redirectOrigin}` : null,
      entry.returnedOrigin ? `returnedOrigin=${entry.returnedOrigin}` : null,
      entry.originChanged == null ? null : `originChanged=${entry.originChanged ? 'yes' : 'no'}`,
      entry.urlHasAuthParams == null ? null : `urlAuthParams=${entry.urlHasAuthParams ? 'yes' : 'no'}`,
      entry.authKeyExists == null ? null : `authKey=${entry.authKeyExists ? 'yes' : 'no'}`,
      entry.localAuthKeyExists == null ? null : `localAuthKey=${entry.localAuthKeyExists ? 'yes' : 'no'}`,
      entry.sessionAuthKeyExists == null ? null : `sessionAuthKey=${entry.sessionAuthKeyExists ? 'yes' : 'no'}`,
      entry.sessionPresent == null ? null : `session=${entry.sessionPresent ? 'yes' : 'no'}`,
      entry.navigationType ? `navigation=${entry.navigationType}` : null,
      entry.visibilityState ? `visibility=${entry.visibilityState}` : null,
      entry.errorName ? `errorClass=${entry.errorName}` : null,
      entry.errorStatus == null ? null : `errorStatus=${entry.errorStatus}`,
      entry.errorCategory ? `errorCategory=${entry.errorCategory}` : null,
      entry.errorCode ? `errorCode=${entry.errorCode}` : null,
      entry.errorMessage ? `message=${entry.errorMessage}` : null,
      entry.safeDisplayMessage ? `safeMessage=${entry.safeDisplayMessage}` : null,
      `reason=${entry.reason ?? 'none'}`,
    ].filter(Boolean).join(' '));
  });

  lines.push('', 'auth events:');
  authTrace.forEach((entry, index) => {
    lines.push([
      `${index + 1}.`,
      entry.timestamp,
      `source=${entry.source}`,
      `event=${entry.event ?? 'none'}`,
      `decision=${entry.decision ?? 'none'}`,
      entry.origin ? `origin=${entry.origin}` : null,
      entry.redirectOrigin ? `redirectOrigin=${entry.redirectOrigin}` : null,
      entry.originChanged == null ? null : `originChanged=${entry.originChanged ? 'yes' : 'no'}`,
      entry.urlHasAuthParams == null ? null : `urlAuthParams=${entry.urlHasAuthParams ? 'yes' : 'no'}`,
      entry.localAuthKeyExists == null ? null : `localAuthKey=${entry.localAuthKeyExists ? 'yes' : 'no'}`,
      entry.sessionAuthKeyExists == null ? null : `sessionAuthKey=${entry.sessionAuthKeyExists ? 'yes' : 'no'}`,
      entry.sessionPresent == null ? null : `session=${entry.sessionPresent ? 'yes' : 'no'}`,
      `reason=${entry.reason ?? 'none'}`,
    ].filter(Boolean).join(' '));
  });

  lines.push('', 'reload/crash events:');
  reloadCrashTrace.forEach((entry, index) => {
    lines.push([
      `${index + 1}.`,
      entry.timestamp,
      `source=${entry.source}`,
      `event=${entry.event ?? 'none'}`,
      `decision=${entry.decision ?? 'none'}`,
      entry.navigationType ? `navigation=${entry.navigationType}` : null,
      entry.localAuthKeyExists == null ? null : `localAuthKey=${entry.localAuthKeyExists ? 'yes' : 'no'}`,
      entry.sessionAuthKeyExists == null ? null : `sessionAuthKey=${entry.sessionAuthKeyExists ? 'yes' : 'no'}`,
      entry.userPresent == null ? null : `user=${entry.userPresent ? 'yes' : 'no'}`,
      entry.errorName ? `error=${entry.errorName}` : null,
      entry.errorMessage ? `message=${entry.errorMessage}` : null,
      `reason=${entry.reason ?? 'none'}`,
    ].filter(Boolean).join(' '));
  });

  return lines.join('\n');
}

export function clearOdaraRecoveryLogs() {
  safeRemoveStorageItem(getLocalStorage(), ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY);
  safeRemoveStorageItem(getSessionStorage(), ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY);
  safeRemoveStorageItem(getLocalStorage(), ODARA_AUTH_TRACE_STORAGE_KEY);
  safeRemoveStorageItem(getSessionStorage(), ODARA_AUTH_TRACE_STORAGE_KEY);
  safeRemoveStorageItem(getLocalStorage(), ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY);
  safeRemoveStorageItem(getSessionStorage(), ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY);
  if (typeof window !== 'undefined') {
    window.__ODARA_LOGIN_RECOVERY_TRACE__ = [];
    window.__ODARA_AUTH_TRACE__ = [];
    window.__ODARA_RELOAD_CRASH_TRACE__ = [];
  }
}

function appendText(parent: HTMLElement, tagName: keyof HTMLElementTagNameMap, text: string, className?: string) {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
}

function removeRecoveryParamsFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete(ODARA_SAFE_MODE_QUERY_PARAM);
  url.searchParams.delete(ODARA_RECOVERY_QUERY_PARAM);
  const next = `${url.pathname}${url.search}${url.hash}` || '/';
  window.history.replaceState(window.history.state, '', next);
}

export function renderOdaraRecoveryScreen(rootElement: HTMLElement, options: {
  getSessionConfirmsSession?: () => Promise<boolean>;
  onContinue?: () => void;
} = {}) {
  let latestGetSessionConfirmsSession: boolean | null = null;
  recordOdaraLoginRecoveryEvent({
    decision: 'safe_mode_rendered',
    event: 'safe_mode',
    reason: 'query_param',
    source: 'recovery-ui',
    storageKeyName: ODARA_AUTH_STORAGE_KEY,
  });

  rootElement.innerHTML = '';
  const shell = document.createElement('main');
  shell.className = 'min-h-dvh bg-background px-5 py-8 text-foreground';
  shell.style.fontFamily = "'Geist Sans', system-ui, sans-serif";

  const panel = document.createElement('section');
  panel.className = 'mx-auto max-w-xl rounded-xl border border-border/40 bg-background p-4 shadow-sm';
  shell.appendChild(panel);

  appendText(panel, 'p', 'ODARA', 'text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground');
  appendText(panel, 'h1', 'Odara Recovery Diagnostics', 'mt-2 text-xl font-semibold text-foreground');
  appendText(
    panel,
    'p',
    'Lightweight safe mode. It does not load Collection, details, or the normal Odara app.',
    'mt-2 text-sm leading-6 text-muted-foreground',
  );

  const status = document.createElement('div');
  status.className = 'mt-4 space-y-1 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground';
  panel.appendChild(status);

  const renderStatus = (session: boolean | null) => {
    latestGetSessionConfirmsSession = session;
    const snapshot = buildOdaraRecoverySnapshot({ getSessionConfirmsSession: session });
    status.innerHTML = '';
    [
      `current origin: ${snapshot.origin}`,
      `auth key exists: ${snapshot.authKeyExists ? 'yes' : 'no'}`,
      `getSession session: ${session == null ? 'unknown' : session ? 'yes' : 'no'}`,
      `recent login attempt: ${snapshot.recentLoginAttempt ? 'yes' : 'no'}`,
      `possible login persistence failure: ${snapshot.possibleLoginPersistenceFailure ? 'yes' : 'no'}`,
      `last reload/crash event: ${snapshot.lastReloadCrashEvent}`,
    ].forEach((line) => appendText(status, 'p', line));
  };
  renderStatus(null);

  const pre = document.createElement('pre');
  pre.className = 'mt-4 max-h-[42vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted/30 p-3 font-mono text-[11px] leading-5 text-muted-foreground';
  pre.textContent = buildOdaraRecoveryReport();
  panel.appendChild(pre);

  const actions = document.createElement('div');
  actions.className = 'mt-4 flex flex-wrap gap-2';
  panel.appendChild(actions);

  const makeButton = (label: string, onClick: (event: MouseEvent) => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rounded-md border border-border/40 px-3 py-2 text-sm font-medium text-foreground';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(event);
    });
    actions.appendChild(button);
    return button;
  };

  makeButton('Copy recovery report', () => {
    const report = buildOdaraRecoveryReport({ getSessionConfirmsSession: latestGetSessionConfirmsSession });
    pre.textContent = report;
    void navigator.clipboard?.writeText(report);
    recordOdaraLoginRecoveryEvent({
      decision: 'recovery_report_copied',
      event: 'click',
      reason: 'safe_mode_copy_button',
      source: 'recovery-ui',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
  });

  makeButton('Clear recovery logs', () => {
    clearOdaraRecoveryLogs();
    renderStatus(null);
    pre.textContent = buildOdaraRecoveryReport();
  });

  makeButton('Continue to app', () => {
    recordOdaraLoginRecoveryEvent({
      decision: 'continue_to_app',
      event: 'click',
      reason: 'safe_mode_continue_button',
      source: 'recovery-ui',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
    if (options.onContinue) {
      options.onContinue();
      return;
    }
    removeRecoveryParamsFromUrl();
    window.location.reload();
  });

  rootElement.appendChild(shell);

  if (options.getSessionConfirmsSession) {
    void options.getSessionConfirmsSession()
      .then((session) => {
        renderStatus(session);
        pre.textContent = buildOdaraRecoveryReport({ getSessionConfirmsSession: session });
        recordOdaraLoginRecoveryEvent({
          decision: 'safe_mode_getSession_result',
          event: 'getSession',
          reason: 'safe_mode_status_check',
          sessionPresent: session,
          source: 'auth',
          storageKeyName: ODARA_AUTH_STORAGE_KEY,
        });
      })
      .catch(() => {
        renderStatus(false);
        pre.textContent = buildOdaraRecoveryReport({ getSessionConfirmsSession: false });
        recordOdaraLoginRecoveryEvent({
          decision: 'safe_mode_getSession_error',
          event: 'getSession',
          reason: 'safe_mode_status_check',
          sessionPresent: false,
          source: 'auth',
          storageKeyName: ODARA_AUTH_STORAGE_KEY,
        });
      });
  }
}
