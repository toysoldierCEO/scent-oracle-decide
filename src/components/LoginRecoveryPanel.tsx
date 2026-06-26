import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import {
  buildOdaraRecoveryReport,
  recordOdaraLoginRecoveryEvent,
  shouldAutoShowOdaraRecoveryPanel,
} from '@/lib/login-recovery-diagnostics';
import { ODARA_AUTH_STORAGE_KEY, odaraSupabase } from '@/lib/odara-client';
import { readAuthStoragePresence } from '@/lib/auth-diagnostic';

type LoginRecoveryPanelProps = {
  userPresent: boolean;
};

export function LoginRecoveryPanel({ userPresent }: LoginRecoveryPanelProps) {
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [getSessionConfirmsSession, setGetSessionConfirmsSession] = useState<boolean | null>(null);
  const storagePresence = readAuthStoragePresence(ODARA_AUTH_STORAGE_KEY);
  const shouldShow = useMemo(() => shouldAutoShowOdaraRecoveryPanel({
    localAuthKeyExists: storagePresence.localAuthKeyExists,
    sessionAuthKeyExists: storagePresence.sessionAuthKeyExists,
    userPresent,
  }), [storagePresence.localAuthKeyExists, storagePresence.sessionAuthKeyExists, userPresent]);

  useEffect(() => {
    if (!shouldShow || dismissed) return undefined;
    let active = true;
    void odaraSupabase.auth.getSession()
      .then(({ data }) => {
        if (!active) return;
        setGetSessionConfirmsSession(Boolean(data?.session?.user));
      })
      .catch(() => {
        if (!active) return;
        setGetSessionConfirmsSession(false);
      });
    return () => {
      active = false;
    };
  }, [dismissed, shouldShow]);

  const summary = useMemo(() => buildOdaraRecoveryReport({
    getSessionConfirmsSession,
  }), [getSessionConfirmsSession]);

  if (!shouldShow || dismissed) return null;

  const copyReport = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCopied(false);
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    recordOdaraLoginRecoveryEvent({
      decision: 'recovery_report_copied',
      event: 'click',
      reason: 'auth_screen_recovery_panel_copy',
      source: 'recovery-ui',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
  };

  const closePanel = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDismissed(true);
    recordOdaraLoginRecoveryEvent({
      decision: 'recovery_panel_dismissed',
      event: 'click',
      reason: 'auth_screen_recovery_panel_close',
      source: 'recovery-ui',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
  };

  return (
    <section
      aria-label="Last login recovery report"
      className="mb-4 rounded-xl border border-amber-300/25 bg-amber-500/8 px-4 py-3 text-left"
      data-odara-auth-debug-ignore
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200/80">
            Last login/reload recovery report
          </p>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
            The app started signed out. This diagnostic did not observe a logout. It found a recent login attempt/reload record.
          </p>
        </div>
        <button
          aria-label="Close login recovery report"
          className="shrink-0 rounded-md border border-border/30 px-2 py-1 text-[11px] text-foreground"
          onClick={closePanel}
          type="button"
        >
          Close
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-1 rounded-lg bg-background/30 p-2 text-[11px] text-muted-foreground">
        <span>Auth key: {storagePresence.localAuthKeyExists || storagePresence.sessionAuthKeyExists ? 'present' : 'not present'}</span>
        <span>Session check: {getSessionConfirmsSession == null ? 'checking' : getSessionConfirmsSession ? 'present' : 'not present'}</span>
        <span>Safe mode: add <span className="font-mono">?odaraSafeMode=1</span> to open the lightweight recovery screen.</span>
      </div>
      <button
        className="mt-3 rounded-md border border-border/30 px-3 py-2 text-[12px] font-medium text-foreground"
        onClick={copyReport}
        type="button"
      >
        {copied ? 'Copied' : 'Copy recovery report'}
      </button>
    </section>
  );
}
