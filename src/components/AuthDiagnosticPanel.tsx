import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { OdaraAuthTraceAccessMode } from '@/lib/auth-debug-trace';
import {
  buildAuthDiagnosticSummary,
  dismissAuthDebugPanel,
  getNextAuthDebugTapCount,
  getCurrentAuthDiagnosticBase,
  readAuthDebugEnabled,
  setAuthDebugEnabled,
} from '@/lib/auth-diagnostic';
import { recordOdaraAuthTrace } from '@/lib/auth-debug-trace';
import { ODARA_AUTH_STORAGE_KEY, ODARA_SUPABASE_PROJECT_REF, odaraSupabase } from '@/lib/odara-client';

type AuthDiagnosticPanelProps = {
  accessMode: OdaraAuthTraceAccessMode;
  authReady: boolean;
  guestOverride: boolean;
  userPresent: boolean;
};

export function AuthDiagnosticPanel({
  accessMode,
  authReady,
  guestOverride,
  userPresent,
}: AuthDiagnosticPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [getSessionConfirmsSession, setGetSessionConfirmsSession] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setEnabled(readAuthDebugEnabled());
    const handleEnabled = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled?: boolean }>;
      setEnabled(customEvent.detail?.enabled ?? readAuthDebugEnabled());
    };
    window.addEventListener('odara-auth-debug-enabled', handleEnabled);
    return () => window.removeEventListener('odara-auth-debug-enabled', handleEnabled);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const refreshSessionStatus = () => {
      void odaraSupabase.auth.getSession()
        .then(({ data }) => {
          if (!active) return;
          setGetSessionConfirmsSession(Boolean(data?.session?.user));
        })
        .catch(() => {
          if (!active) return;
          setGetSessionConfirmsSession(false);
        });
    };
    refreshSessionStatus();
    const interval = window.setInterval(() => {
      setTick((current) => current + 1);
      refreshSessionStatus();
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [enabled]);

  useEffect(() => {
    let pressTimer: number | null = null;
    let tapCount = 0;
    let lastTapAt: number | null = null;

    const clearPressTimer = () => {
      if (pressTimer == null) return;
      window.clearTimeout(pressTimer);
      pressTimer = null;
    };

    const enableFromGesture = (reason: string) => {
      clearPressTimer();
      setAuthDebugEnabled(true);
      recordOdaraAuthTrace({
        accessMode,
        authReady,
        decision: 'enabled',
        reason,
        source: 'auth-debug',
        storageKeyName: ODARA_AUTH_STORAGE_KEY,
        userPresent,
      });
    };

    const isTrigger = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      if (!element) return false;
      if (element.closest('[data-odara-auth-debug-ignore]')) return false;
      if (element.closest('button, a, input, textarea, select') && !element.closest('[data-odara-auth-debug-trigger]')) {
        return false;
      }
      return Boolean(element.closest('[data-odara-auth-debug-trigger]'));
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!isTrigger(event.target)) return;
      clearPressTimer();
      pressTimer = window.setTimeout(() => enableFromGesture('logo_long_press'), 1000);
    };

    const handlePointerEnd = () => {
      clearPressTimer();
    };

    const handleClick = (event: MouseEvent) => {
      if (!isTrigger(event.target)) return;
      const now = Date.now();
      tapCount = getNextAuthDebugTapCount({ lastTapAt, now, previousCount: tapCount });
      lastTapAt = now;
      if (tapCount >= 7) {
        tapCount = 0;
        lastTapAt = null;
        enableFromGesture('logo_seven_taps');
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointerup', handlePointerEnd);
    document.addEventListener('pointercancel', handlePointerEnd);
    document.addEventListener('click', handleClick);
    return () => {
      clearPressTimer();
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerup', handlePointerEnd);
      document.removeEventListener('pointercancel', handlePointerEnd);
      document.removeEventListener('click', handleClick);
    };
  }, [accessMode, authReady, userPresent]);

  const summary = useMemo(() => {
    if (!enabled) return '';
    return buildAuthDiagnosticSummary({
      ...getCurrentAuthDiagnosticBase(ODARA_AUTH_STORAGE_KEY, ODARA_SUPABASE_PROJECT_REF),
      accessMode,
      authReady,
      getSessionConfirmsSession,
      guestOverride,
      userPresent,
    });
  }, [accessMode, authReady, enabled, getSessionConfirmsSession, guestOverride, tick, userPresent]);

  if (!enabled) return null;

  const copySummary = async () => {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const closePanel = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dismissAuthDebugPanel();
    setEnabled(false);
    setCopied(false);
    recordOdaraAuthTrace({
      accessMode,
      authReady,
      decision: 'disabled',
      reason: 'diagnostic_close_button',
      source: 'auth-debug',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      userPresent,
    });
  };

  return (
    <section
      aria-label="Odara auth diagnostic"
      className="fixed inset-x-3 bottom-3 z-[9999] max-h-[min(46vh,24rem)] overflow-hidden rounded-lg border border-border/40 bg-background/95 p-3 text-left text-xs text-foreground shadow-2xl backdrop-blur"
      data-odara-auth-debug-ignore
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Auth Diagnostic
          </p>
          <p className="text-[11px] text-muted-foreground">
            Safe summary only. No tokens, keys, headers, passwords, or sensitive auth values.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="rounded-md border border-border/40 px-2 py-1 text-[11px] font-medium text-foreground"
            onClick={copySummary}
            type="button"
          >
            {copied ? 'Copied' : 'Copy summary'}
          </button>
          <button
            aria-label="Close auth diagnostic"
            className="rounded-md border border-border/40 px-2 py-1 text-[11px] font-medium text-foreground"
            onClick={closePanel}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
      <pre className="max-h-[34vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
        {summary}
      </pre>
    </section>
  );
}
