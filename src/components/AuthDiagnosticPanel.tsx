import { useEffect, useMemo, useState } from 'react';
import type { OdaraAuthTraceAccessMode } from '@/lib/auth-debug-trace';
import {
  buildAuthDiagnosticSummary,
  getCurrentAuthDiagnosticBase,
  readAuthDebugEnabled,
} from '@/lib/auth-diagnostic';
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

  return (
    <section
      aria-label="Odara auth diagnostic"
      className="fixed inset-x-3 bottom-3 z-[9999] max-h-[46vh] overflow-hidden rounded-lg border border-border/40 bg-background/95 p-3 text-left text-xs text-foreground shadow-2xl backdrop-blur"
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
        <button
          className="shrink-0 rounded-md border border-border/40 px-2 py-1 text-[11px] font-medium text-foreground"
          onClick={copySummary}
          type="button"
        >
          {copied ? 'Copied' : 'Copy summary'}
        </button>
      </div>
      <pre className="max-h-[34vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
        {summary}
      </pre>
    </section>
  );
}
