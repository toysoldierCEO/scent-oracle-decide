import { ODARA_BUILD_INFO } from './build-info';
import type { OdaraAuthTraceAccessMode } from './auth-debug-trace';

export const ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY = 'odara_reload_crash_trace_v1';

const MAX_TRACE_ENTRIES = 120;
const MAX_SAFE_TEXT_LENGTH = 120;

export type OdaraReloadCrashSource =
  | 'app-context'
  | 'error-boundary'
  | 'page'
  | 'pointer'
  | 'resource'
  | 'runtime-error';

export type OdaraReloadCrashContext = {
  accessMode?: OdaraAuthTraceAccessMode;
  authReady?: boolean;
  bottomSheetOpen?: boolean;
  contextKey?: string;
  detailLabel?: string;
  detailOpen?: boolean;
  localAuthKeyExists?: boolean;
  menuOpen?: boolean;
  menuPage?: string | null;
  missingIntakeOpen?: boolean;
  routePath?: string;
  screen?: string;
  searchOpen?: boolean;
  selectedDate?: string;
  sessionAuthKeyExists?: boolean;
  storageKeyName?: string;
  storageMode?: 'local' | 'session';
  userPresent?: boolean;
};

export type OdaraReloadCrashEntry = OdaraReloadCrashContext & {
  actionLabel?: string;
  buildCommit?: string;
  closestControlLabel?: string;
  componentStack?: string;
  decision?: string;
  errorMessage?: string;
  errorName?: string;
  event?: string;
  href?: string;
  navigationType?: string;
  persisted?: boolean;
  pointerType?: string;
  reason?: string;
  role?: string;
  source: OdaraReloadCrashSource;
  tagName?: string;
  targetLabel?: string;
  timestamp: string;
  visibilityState?: DocumentVisibilityState;
};

declare global {
  interface Window {
    __ODARA_RELOAD_CRASH_CONTEXT__?: OdaraReloadCrashContext;
    __ODARA_RELOAD_CRASH_RECORDER_INSTALLED__?: boolean;
    __ODARA_RELOAD_CRASH_TRACE__?: OdaraReloadCrashEntry[];
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
    || lower.includes('api_key')
    || lower.includes('apikey')
    || lower.includes('anon_key')
    || lower.includes('auth header')
  ) {
    return '[redacted]';
  }

  const withoutEmail = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
  if (withoutEmail.length <= maxLength) return withoutEmail;
  return `${withoutEmail.slice(0, maxLength - 1)}…`;
}

function sanitizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function sanitizeContext(context: OdaraReloadCrashContext): OdaraReloadCrashContext {
  return {
    accessMode: context.accessMode,
    authReady: sanitizeBoolean(context.authReady),
    bottomSheetOpen: sanitizeBoolean(context.bottomSheetOpen),
    contextKey: sanitizeText(context.contextKey, 48),
    detailLabel: sanitizeText(context.detailLabel, 96),
    detailOpen: sanitizeBoolean(context.detailOpen),
    localAuthKeyExists: sanitizeBoolean(context.localAuthKeyExists),
    menuOpen: sanitizeBoolean(context.menuOpen),
    menuPage: context.menuPage == null ? context.menuPage : sanitizeText(context.menuPage, 48),
    missingIntakeOpen: sanitizeBoolean(context.missingIntakeOpen),
    routePath: sanitizeText(context.routePath, 96),
    screen: sanitizeText(context.screen, 48),
    searchOpen: sanitizeBoolean(context.searchOpen),
    selectedDate: sanitizeText(context.selectedDate, 32),
    sessionAuthKeyExists: sanitizeBoolean(context.sessionAuthKeyExists),
    storageKeyName: sanitizeText(context.storageKeyName, 120),
    storageMode: context.storageMode,
    userPresent: sanitizeBoolean(context.userPresent),
  };
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

function safeUrlLabel(rawUrl: string | null | undefined): string | undefined {
  const text = sanitizeText(rawUrl, 160);
  if (!text) return undefined;
  try {
    const url = new URL(text, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return text.split('?')[0]?.slice(0, 120);
  }
}

function getElementControlLabel(element: Element | null): {
  actionLabel?: string;
  closestControlLabel?: string;
  href?: string;
  role?: string;
  tagName?: string;
  targetLabel?: string;
} {
  if (!element) return {};
  const closestControl = element.closest('button, a, [role="button"], [data-menu-action], [data-action], [aria-label]');
  const labelSource = closestControl ?? element;
  const ariaLabel = labelSource.getAttribute('aria-label');
  const dataMenuAction = labelSource.getAttribute('data-menu-action');
  const dataAction = labelSource.getAttribute('data-action');
  const role = labelSource.getAttribute('role') ?? undefined;
  const textLabel = labelSource.textContent;
  const href = labelSource instanceof HTMLAnchorElement
    ? safeUrlLabel(labelSource.getAttribute('href'))
    : undefined;

  return {
    actionLabel: sanitizeText(dataMenuAction ?? dataAction, 80),
    closestControlLabel: sanitizeText(ariaLabel ?? dataMenuAction ?? dataAction ?? textLabel, 100),
    href,
    role: sanitizeText(role, 40),
    tagName: sanitizeText(labelSource.tagName.toLowerCase(), 24),
    targetLabel: sanitizeText(element.getAttribute('aria-label') ?? element.textContent, 100),
  };
}

function readTraceFromStorage(): OdaraReloadCrashEntry[] {
  const raw = safeGetStorageItem(getLocalStorage(), ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY)
    ?? safeGetStorageItem(getSessionStorage(), ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_TRACE_ENTRIES) : [];
  } catch {
    return [];
  }
}

function persistTrace(trace: OdaraReloadCrashEntry[]) {
  const serialized = JSON.stringify(trace.slice(-MAX_TRACE_ENTRIES));
  safeSetStorageItem(getLocalStorage(), ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY, serialized);
  safeSetStorageItem(getSessionStorage(), ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY, serialized);
}

export function readPersistedOdaraReloadCrashTrace(): OdaraReloadCrashEntry[] {
  if (typeof window === 'undefined') return [];
  return readTraceFromStorage();
}

export function readSafeOdaraReloadCrashTrace(): OdaraReloadCrashEntry[] {
  if (typeof window === 'undefined') return [];
  return (window.__ODARA_RELOAD_CRASH_TRACE__ ?? readPersistedOdaraReloadCrashTrace()).slice(-40);
}

export function updateOdaraReloadCrashContext(context: OdaraReloadCrashContext) {
  if (typeof window === 'undefined') return;
  window.__ODARA_RELOAD_CRASH_CONTEXT__ = sanitizeContext({
    ...(window.__ODARA_RELOAD_CRASH_CONTEXT__ ?? {}),
    ...context,
  });
}

export function recordOdaraReloadCrashEvent(entry: Omit<OdaraReloadCrashEntry, 'buildCommit' | 'timestamp'>) {
  if (typeof window === 'undefined') return;
  const trace = window.__ODARA_RELOAD_CRASH_TRACE__ ?? readPersistedOdaraReloadCrashTrace();
  const context = sanitizeContext(window.__ODARA_RELOAD_CRASH_CONTEXT__ ?? {});
  const nextEntry: OdaraReloadCrashEntry = {
    ...context,
    ...entry,
    actionLabel: sanitizeText(entry.actionLabel, 80),
    buildCommit: ODARA_BUILD_INFO.commit,
    closestControlLabel: sanitizeText(entry.closestControlLabel, 100),
    componentStack: sanitizeText(entry.componentStack, 500),
    decision: sanitizeText(entry.decision, 80),
    errorMessage: sanitizeText(entry.errorMessage, 160),
    errorName: sanitizeText(entry.errorName, 80),
    event: sanitizeText(entry.event, 80),
    href: safeUrlLabel(entry.href),
    navigationType: sanitizeText(entry.navigationType ?? readNavigationType(), 32),
    reason: sanitizeText(entry.reason, 120),
    role: sanitizeText(entry.role, 40),
    routePath: sanitizeText(entry.routePath ?? window.location.pathname, 96),
    tagName: sanitizeText(entry.tagName, 24),
    targetLabel: sanitizeText(entry.targetLabel, 100),
    timestamp: new Date().toISOString(),
    visibilityState: typeof document === 'undefined' ? undefined : document.visibilityState,
  };
  trace.push(nextEntry);
  if (trace.length > MAX_TRACE_ENTRIES) {
    trace.splice(0, trace.length - MAX_TRACE_ENTRIES);
  }
  window.__ODARA_RELOAD_CRASH_TRACE__ = trace;
  persistTrace(trace);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.odaraReloadCrashTraceLength = String(trace.length);
    document.documentElement.dataset.odaraReloadCrashLastSource = nextEntry.source;
    document.documentElement.dataset.odaraReloadCrashLastEvent = nextEntry.event ?? '';
    document.documentElement.dataset.odaraReloadCrashLastDecision = nextEntry.decision ?? '';
    const traceNodeId = 'odara-reload-crash-trace';
    const existing = document.getElementById(traceNodeId);
    const traceNode = existing ?? document.createElement('script');
    traceNode.id = traceNodeId;
    traceNode.setAttribute('type', 'application/json');
    traceNode.textContent = JSON.stringify(trace);
    if (!existing) document.head.appendChild(traceNode);
  }
}

function recordPointerEvent(event: PointerEvent | MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  recordOdaraReloadCrashEvent({
    ...getElementControlLabel(target),
    event: event.type,
    pointerType: 'pointerType' in event ? event.pointerType : 'mouse',
    reason: 'user_interaction',
    source: 'pointer',
  });
}

function recordResourceError(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const url = target.getAttribute('src') ?? target.getAttribute('href');
  recordOdaraReloadCrashEvent({
    ...getElementControlLabel(target),
    event: 'resource_error',
    href: url ?? undefined,
    reason: 'resource_load_error',
    source: 'resource',
  });
}

export function installOdaraReloadCrashRecorder() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (window.__ODARA_RELOAD_CRASH_RECORDER_INSTALLED__) return () => {};
  window.__ODARA_RELOAD_CRASH_RECORDER_INSTALLED__ = true;

  recordOdaraReloadCrashEvent({
    decision: 'recorder_started',
    event: 'install',
    reason: 'app_mount',
    source: 'page',
  });

  const handlePointerDown = (event: PointerEvent) => recordPointerEvent(event);
  const handleClick = (event: MouseEvent) => recordPointerEvent(event);
  const handleVisibilityChange = () => {
    recordOdaraReloadCrashEvent({
      decision: document.visibilityState,
      event: 'visibilitychange',
      reason: 'page_visibility_change',
      source: 'page',
    });
  };
  const handlePageHide = (event: PageTransitionEvent) => {
    recordOdaraReloadCrashEvent({
      decision: 'pagehide',
      event: 'pagehide',
      persisted: event.persisted,
      reason: 'page_lifecycle',
      source: 'page',
    });
  };
  const handlePageShow = (event: PageTransitionEvent) => {
    recordOdaraReloadCrashEvent({
      decision: 'pageshow',
      event: 'pageshow',
      persisted: event.persisted,
      reason: 'page_lifecycle',
      source: 'page',
    });
  };
  const handleBeforeUnload = () => {
    recordOdaraReloadCrashEvent({
      decision: 'beforeunload',
      event: 'beforeunload',
      reason: 'page_lifecycle',
      source: 'page',
    });
  };
  const handleUnload = () => {
    recordOdaraReloadCrashEvent({
      decision: 'unload',
      event: 'unload',
      reason: 'page_lifecycle',
      source: 'page',
    });
  };
  const handleFreeze = () => {
    recordOdaraReloadCrashEvent({
      decision: 'freeze',
      event: 'freeze',
      reason: 'page_lifecycle',
      source: 'page',
    });
  };
  const handleResume = () => {
    recordOdaraReloadCrashEvent({
      decision: 'resume',
      event: 'resume',
      reason: 'page_lifecycle',
      source: 'page',
    });
  };
  const handleError = (event: ErrorEvent | Event) => {
    recordResourceError(event);
    if (event instanceof ErrorEvent) {
      recordOdaraReloadCrashEvent({
        errorMessage: event.message,
        errorName: event.error instanceof Error ? event.error.name : 'ErrorEvent',
        event: 'error',
        reason: 'window_error',
        source: 'runtime-error',
      });
    }
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    recordOdaraReloadCrashEvent({
      errorMessage: reason instanceof Error ? reason.message : String(reason ?? 'unknown rejection'),
      errorName: reason instanceof Error ? reason.name : 'UnhandledRejection',
      event: 'unhandledrejection',
      reason: 'unhandled_promise_rejection',
      source: 'runtime-error',
    });
  };

  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  window.addEventListener('beforeunload', handleBeforeUnload);
  window.addEventListener('unload', handleUnload);
  window.addEventListener('freeze', handleFreeze);
  window.addEventListener('resume', handleResume);
  window.addEventListener('error', handleError, true);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  return () => {
    document.removeEventListener('pointerdown', handlePointerDown, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('pageshow', handlePageShow);
    window.removeEventListener('beforeunload', handleBeforeUnload);
    window.removeEventListener('unload', handleUnload);
    window.removeEventListener('freeze', handleFreeze);
    window.removeEventListener('resume', handleResume);
    window.removeEventListener('error', handleError, true);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    window.__ODARA_RELOAD_CRASH_RECORDER_INSTALLED__ = false;
  };
}
