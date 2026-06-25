import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent, type HTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AuthDiagnosticPanel } from '@/components/AuthDiagnosticPanel';
import { ODARA_AUTH_STORAGE_KEY, odaraSupabase } from '@/lib/odara-client';
import { primeVesperAuthPersistence } from '@/lib/auth-persistence';
import {
  ODARA_SHARED_PREVIEW_ORIGIN,
  resolveOdaraAuthRedirectOrigin,
} from '@/lib/auth-redirect';
import {
  resolveAuthStateHydrationDecision,
  shouldApplySessionBootstrapResult,
} from '@/lib/auth-session-hydration';
import {
  hasPersistedOdaraAuthTrace,
  readPersistedOdaraAuthTrace,
  readSafeAuthStorageMode,
  recordOdaraAuthTrace,
  type OdaraAuthTraceEntry,
  type OdaraAuthTraceAccessMode,
} from '@/lib/auth-debug-trace';
import { readAuthStoragePresence } from '@/lib/auth-diagnostic';
import {
  resolveSignOutGuard,
  type OdaraSignOutRequest,
} from '@/lib/auth-sign-out-guard';
import {
  installOdaraReloadCrashRecorder,
  recordOdaraReloadCrashEvent,
  updateOdaraReloadCrashContext,
} from '@/lib/page-reload-crash-recorder';
import OdaraScreen from './OdaraScreen';
import type { OracleResult } from './OdaraScreen';
import { useWeather } from '@/hooks/useWeather';
import { readGuestOverride, resolveAccessMode, writeGuestOverride } from '@/lib/access-mode';
import { fetchHomeOracle } from '@/lib/oracle-access';
// guest-recipe.ts is no longer called directly — get_guest_oracle_home_v6 decides card_type.

const ORACLE_FETCH_DEBOUNCE_MS = 200;
const ORACLE_FETCH_TIMEOUT_MS = 15000;

function createOracleTimeoutError() {
  return new Error('Odara is taking longer than expected. Please try again.');
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(createOracleTimeoutError()), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}



// --- Auth helpers ---
function normalizeUser(sessionUser: any): { id: string; email?: string } | null {
  return sessionUser ? { id: sessionUser.id, email: sessionUser.email ?? undefined } : null;
}

function sameUser(a: { id: string; email?: string } | null, b: { id: string; email?: string } | null): boolean {
  return (a?.id ?? null) === (b?.id ?? null) && (a?.email ?? null) === (b?.email ?? null);
}

function todayLocalKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const PASSWORD_MIN_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Remembered email (email only — never passwords/tokens) ---
const REMEMBER_EMAIL_KEY = 'vesper_remember_email';
const REMEMBER_ME_KEY = 'vesper_remember_me';

function readRememberedEmail(): string {
  try {
    if (localStorage.getItem(REMEMBER_ME_KEY) !== 'true') return '';
    return localStorage.getItem(REMEMBER_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function readRememberMePreference(): boolean {
  try {
    const stored = localStorage.getItem(REMEMBER_ME_KEY);
    // Default to checked when no prior preference exists.
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

function persistRememberedEmail(remember: boolean, emailValue: string) {
  try {
    if (remember) {
      localStorage.setItem(REMEMBER_ME_KEY, 'true');
      if (emailValue) localStorage.setItem(REMEMBER_EMAIL_KEY, emailValue);
    } else {
      localStorage.setItem(REMEMBER_ME_KEY, 'false');
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
  } catch {
    /* ignore storage failures */
  }
}

type SafeLoginTraceExtras = Partial<Pick<
  OdaraAuthTraceEntry,
  'event'
  | 'origin'
  | 'originChanged'
  | 'redirectOrigin'
  | 'sessionPresent'
  | 'urlHasAuthParams'
  | 'userPresent'
>>;

function hasAuthUrlParams(search: string, hash: string): boolean {
  const authParamNames = [
    'access_token',
    'code',
    'error',
    'error_code',
    'error_description',
    'refresh_token',
    'token_type',
  ];
  const searchParams = new URLSearchParams(search);
  const hashParams = new URLSearchParams(hash.replace(/^[#?]/, ''));
  return authParamNames.some((name) => searchParams.has(name) || hashParams.has(name));
}

function isLoginLifecycleDecision(decision: string | undefined): boolean {
  if (!decision) return false;
  return decision.startsWith('login_')
    || decision === 'auth_callback_detected'
    || decision === 'auth_key_exists_immediately_after_login'
    || decision === 'current_origin_at_login'
    || decision === 'getSession_immediately_after_login'
    || decision === 'returned_origin_after_login'
    || decision === 'session_after_login_reload'
    || decision === 'url_has_auth_params';
}

type AuthView = 'signIn' | 'signUp' | 'checkEmail';
type AuthField = 'firstName' | 'lastName' | 'email' | 'password' | 'confirmPassword';

type AuthFieldErrors = Partial<Record<AuthField, string>>;

interface AuthTextFieldProps {
  autoComplete: string;
  error?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  label: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  placeholder: string;
  showToggle?: boolean;
  toggleLabel?: string;
  onToggle?: () => void;
  type: 'email' | 'password' | 'text';
  value: string;
}

function validateSignInFields(email: string, password: string): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const normalizedEmail = email.trim();

  if (!normalizedEmail) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
    errors.email = 'Enter a valid email address.';
  }

  if (!password) {
    errors.password = 'Password is required.';
  }

  return errors;
}

function validateSignUpFields(
  firstName: string,
  lastName: string,
  email: string,
  password: string,
  confirmPassword: string,
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const normalizedEmail = email.trim();

  if (!firstName.trim()) {
    errors.firstName = 'First name is required.';
  }

  if (!lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }

  if (!normalizedEmail) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
    errors.email = 'Enter a valid email address.';
  }

  if (!password) {
    errors.password = 'Password is required.';
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }

  if (!confirmPassword) {
    errors.confirmPassword = 'Confirm your password.';
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords must match exactly.';
  }

  return errors;
}

function AuthTextField({
  autoComplete,
  error,
  inputMode,
  label,
  onBlur,
  onChange,
  placeholder,
  showToggle = false,
  toggleLabel,
  onToggle,
  type,
  value,
}: AuthTextFieldProps) {
  const labelSlug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const inputId = `auth-${labelSlug}`;
  const errorId = `${inputId}-error`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          autoComplete={autoComplete}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? 'true' : 'false'}
          className="h-12 w-full rounded-xl border border-border/12 bg-accent/40 px-4 pr-12 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors focus:border-foreground/24 focus:bg-accent/60"
          inputMode={inputMode}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={type}
          value={value}
        />
        {showToggle && onToggle ? (
          <button
            type="button"
            aria-label={toggleLabel ?? (type === 'password' ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`)}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground/65 transition-colors hover:text-foreground"
            onClick={onToggle}
          >
            {type === 'password' ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const Index = () => {
  const { weatherByDate, getTemperature, currentTemperature, weatherLoading } = useWeather();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const authUserRef = useRef<{ id: string; email?: string } | null>(null);
  const authReadyRef = useRef(false);
  const [authView, setAuthView] = useState<AuthView>('signIn');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(() => readRememberedEmail());
  const [rememberMe, setRememberMe] = useState(() => readRememberMePreference());

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestMode, setGuestMode] = useState(() => readGuestOverride());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Partial<Record<AuthField, boolean>>>({});
  const [signUpPasswordsVisible, setSignUpPasswordsVisible] = useState(false);
  const [signInPasswordVisible, setSignInPasswordVisible] = useState(false);
  // Recipe Mode state removed — v6 backend decides card_type ("standard" | "recipe").

  // Oracle state
  const [oracle, setOracle] = useState<OracleResult | null>(null);
  const [oracleLoading, setOracleLoading] = useState(false);
  const [oracleError, setOracleError] = useState<string | null>(null);
  const [selectedContext, setSelectedContext] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });

  // Oracle dedupe refs
  const oracleRequestIdRef = useRef(0);
  const oracleInFlightKeyRef = useRef<string | null>(null);
  const oracleSuccessKeyRef = useRef<string | null>(null);
  const oracleTemperatureBySlotRef = useRef<Record<string, number>>({});

  // Live temperature from weather hook — used for both UI and RPC
  const liveTemperature = getTemperature(selectedDate);

  // ── Normalized access mode — single source of truth ──
  const access = useMemo(() => resolveAccessMode(user, guestMode), [user, guestMode]);
  const diagnosticAccessMode: OdaraAuthTraceAccessMode = access.isSignedIn
    ? 'signed-in'
    : access.isGuestMode
      ? 'guest'
      : 'signed-out';
  const diagnosticAccessModeRef = useRef<OdaraAuthTraceAccessMode>(diagnosticAccessMode);
  const hadPersistedAuthTraceOnMountRef = useRef(hasPersistedOdaraAuthTrace());
  const hadPersistedLoginTraceOnMountRef = useRef(
    readPersistedOdaraAuthTrace().some((entry) => isLoginLifecycleDecision(entry.decision)),
  );
  const authRedirectResolution = useMemo(
    () => resolveOdaraAuthRedirectOrigin(window.location.origin),
    [],
  );
  const isEditorPreview = authRedirectResolution.isExternalPreviewRequired;
  const authRedirectOrigin = authRedirectResolution.redirectOrigin;
  const isSignUp = authView === 'signUp';
  const isCheckEmail = authView === 'checkEmail';
  const pendingEmail = pendingVerificationEmail || email.trim();
  const canResendVerification = !!pendingEmail;
  const activeFieldErrors = isSignUp
    ? validateSignUpFields(firstName, lastName, email, password, confirmPassword)
    : validateSignInFields(email, password);
  const socialButtonLabel = isEditorPreview
    ? 'Open shared preview to sign in with Google'
    : 'Continue with Google';
  const setGuestOverride = useCallback((enabled: boolean, reason = 'guest_override_toggle') => {
    const storedGuestMode = readGuestOverride();
    const changed = guestMode !== enabled || storedGuestMode !== enabled;
    if (storedGuestMode !== enabled) {
      writeGuestOverride(enabled);
    }
    setGuestMode((current) => (current === enabled ? current : enabled));
    recordOdaraAuthTrace({
      accessMode: enabled ? 'guest' : (authUserRef.current ? 'signed-in' : 'signed-out'),
      decision: changed
        ? (enabled ? 'enabled' : 'disabled')
        : (enabled ? 'already_enabled' : 'already_disabled'),
      reason,
      source: 'access-mode',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      userPresent: Boolean(authUserRef.current),
    });
  }, [guestMode]);

  const recordLoginTrace = useCallback((
    decision: string,
    reason: string,
    extras: SafeLoginTraceExtras = {},
  ) => {
    recordOdaraAuthTrace({
      accessMode: diagnosticAccessModeRef.current,
      authReady: authReadyRef.current,
      decision,
      origin: window.location.origin,
      redirectOrigin: authRedirectOrigin,
      reason,
      source: 'Index',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      urlHasAuthParams: hasAuthUrlParams(window.location.search, window.location.hash),
      userPresent: Boolean(authUserRef.current),
      ...extras,
    });
  }, [authRedirectOrigin]);

  const probeImmediateLoginSession = useCallback(async (
    reason: string,
    requestSessionPresent: boolean,
  ) => {
    recordLoginTrace('auth_key_exists_immediately_after_login', `${reason}_storage_check`, {
      sessionPresent: requestSessionPresent,
    });

    try {
      const { data: { session } } = await odaraSupabase.auth.getSession();
      const confirmedSession = Boolean(session?.user);
      recordLoginTrace('getSession_immediately_after_login', reason, {
        sessionPresent: confirmedSession,
        userPresent: confirmedSession || Boolean(authUserRef.current),
      });
    } catch {
      recordLoginTrace('getSession_immediately_after_login_error', reason, {
        sessionPresent: false,
      });
    }
  }, [recordLoginTrace]);

  useEffect(() => {
    authReadyRef.current = authReady;
  }, [authReady]);

  useEffect(() => {
    diagnosticAccessModeRef.current = diagnosticAccessMode;
  }, [diagnosticAccessMode]);

  useEffect(() => {
    if (!authReady || access.isSignedIn || access.isGuestMode) return;
    recordLoginTrace('login_form_rendered', isCheckEmail ? 'check_email_screen_render' : 'auth_screen_render');
  }, [access.isGuestMode, access.isSignedIn, authReady, isCheckEmail, recordLoginTrace]);

  useEffect(() => installOdaraReloadCrashRecorder(), []);

  useEffect(() => {
    const storagePresence = readAuthStoragePresence(ODARA_AUTH_STORAGE_KEY);
    updateOdaraReloadCrashContext({
      accessMode: diagnosticAccessMode,
      authReady,
      contextKey: selectedContext,
      localAuthKeyExists: storagePresence.localAuthKeyExists,
      routePath: window.location.pathname,
      screen: access.isSignedIn ? 'signed-in-home' : access.isGuestMode ? 'guest-home' : 'auth',
      selectedDate,
      sessionAuthKeyExists: storagePresence.sessionAuthKeyExists,
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      storageMode: readSafeAuthStorageMode(),
      userPresent: Boolean(user),
    });
  }, [access.isGuestMode, access.isSignedIn, authReady, diagnosticAccessMode, selectedContext, selectedDate, user]);

  useEffect(() => {
    const persistedTrace = readPersistedOdaraAuthTrace();
    const previousOrigin = [...persistedTrace].reverse().find((entry) => entry.origin)?.origin ?? null;
    const originChanged = previousOrigin ? previousOrigin !== window.location.origin : false;
    const hadPersistedTrace = hadPersistedAuthTraceOnMountRef.current;
    const hadPersistedLoginTrace = hadPersistedLoginTraceOnMountRef.current;
    const urlHasAuthParams = hasAuthUrlParams(window.location.search, window.location.hash);
    recordOdaraReloadCrashEvent({
      accessMode: diagnosticAccessMode,
      authReady,
      decision: hadPersistedTrace ? 'page_mount_after_reload' : 'loaded',
      event: 'app_mount',
      reason: 'app_mount',
      source: 'page',
      userPresent: Boolean(user),
    });
    recordOdaraAuthTrace({
      accessMode: diagnosticAccessMode,
      authReady,
      decision: hadPersistedTrace ? 'page_mount_after_reload' : 'loaded',
      originChanged,
      reason: 'app_mount',
      source: 'page',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      userPresent: Boolean(user),
    });
    recordOdaraAuthTrace({
      accessMode: diagnosticAccessMode,
      authReady,
      decision: 'auth_key_exists_after_reload',
      originChanged,
      reason: 'app_mount_storage_check',
      source: 'storage',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      userPresent: Boolean(user),
    });
    recordOdaraAuthTrace({
      accessMode: diagnosticAccessMode,
      authReady,
      decision: 'url_has_auth_params',
      originChanged,
      reason: urlHasAuthParams ? 'auth_callback_detected' : 'auth_callback_absent',
      source: 'Index',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      urlHasAuthParams,
      userPresent: Boolean(user),
    });
    if (urlHasAuthParams) {
      recordOdaraAuthTrace({
        accessMode: diagnosticAccessMode,
        authReady,
        decision: 'auth_callback_detected',
        originChanged,
        reason: 'safe_url_auth_params_present',
        source: 'Index',
        storageKeyName: ODARA_AUTH_STORAGE_KEY,
        urlHasAuthParams: true,
        userPresent: Boolean(user),
      });
    }
    if (hadPersistedLoginTrace) {
      recordOdaraAuthTrace({
        accessMode: diagnosticAccessMode,
        authReady,
        decision: 'app_mount_after_login_reload',
        originChanged,
        reason: 'login_trace_present_on_mount',
        source: 'Index',
        storageKeyName: ODARA_AUTH_STORAGE_KEY,
        urlHasAuthParams,
        userPresent: Boolean(user),
      });
      recordOdaraAuthTrace({
        accessMode: diagnosticAccessMode,
        authReady,
        decision: 'returned_origin_after_login',
        originChanged,
        reason: 'login_trace_present_on_mount',
        source: 'Index',
        storageKeyName: ODARA_AUTH_STORAGE_KEY,
        urlHasAuthParams,
        userPresent: Boolean(user),
      });
    }

    const handleVisibilityChange = () => {
      recordOdaraAuthTrace({
        accessMode: diagnosticAccessModeRef.current,
        authReady: authReadyRef.current,
        decision: document.visibilityState,
        reason: 'page_visibility_change',
        source: 'page',
        storageKeyName: ODARA_AUTH_STORAGE_KEY,
        userPresent: Boolean(authUserRef.current),
      });
    };
    const handleBeforeUnload = () => {
      recordOdaraAuthTrace({
        accessMode: diagnosticAccessModeRef.current,
        authReady: authReadyRef.current,
        decision: 'beforeunload',
        reason: 'beforeunload',
        source: 'page',
        storageKeyName: ODARA_AUTH_STORAGE_KEY,
        userPresent: Boolean(authUserRef.current),
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    recordOdaraAuthTrace({
      accessMode: diagnosticAccessMode,
      authReady,
      decision: 'resolved',
      reason: 'access_mode_render',
      source: 'access-mode',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      userPresent: Boolean(user),
    });
  }, [authReady, diagnosticAccessMode, user]);

  const oracleSlotKey =
    (authReady || access.isGuestMode) && access.resolvedUserId
      ? `${access.resolvedUserId}|${selectedContext}|${selectedDate}`
      : null;
  const isSelectedDateToday = selectedDate === todayLocalKey();
  const hasWeatherForSelectedDate = isSelectedDateToday
    ? currentTemperature != null
    : weatherByDate[selectedDate] != null;
  const shouldDelayOracleForWeather =
    weatherLoading
    && !hasWeatherForSelectedDate;
  const stableOracleTemperature = oracleSlotKey
    ? (oracleTemperatureBySlotRef.current[oracleSlotKey] ?? liveTemperature)
    : liveTemperature;

  // Compute oracle key — valid when we have a resolvedUserId (signed-in OR guest)
  const oracleKey = oracleSlotKey
    ? `${oracleSlotKey}|${stableOracleTemperature}`
    : null;

  // --- Auth bootstrap ---
  useEffect(() => {
    let active = true;
    let sessionBootstrapResolved = false;
    let authRevision = 0;

    const applySession = (session: any, source: string) => {
      if (!active) return;
      const nextUser = normalizeUser(session?.user);
      authUserRef.current = nextUser;
      recordOdaraAuthTrace({
        authReady: authReadyRef.current,
        decision: nextUser ? 'applied_session' : 'applied_signed_out',
        reason: source,
        sessionPresent: Boolean(session),
        source: 'Index',
        storageKeyName: ODARA_AUTH_STORAGE_KEY,
        userPresent: Boolean(nextUser),
      });
      setUser(prev => {
        if (sameUser(prev, nextUser)) return prev;
        return nextUser;
      });
    };

    const confirmCurrentSessionBeforeClearing = (revision: number, sourceEvent: string) => {
      void odaraSupabase.auth.getSession()
        .then(({ data: { session } }) => {
          if (!active || revision !== authRevision) return;
          sessionBootstrapResolved = true;
          recordOdaraAuthTrace({
            authReady: authReadyRef.current,
            decision: session?.user ? 'confirmed-session-present' : 'confirmed-signed-out',
            event: sourceEvent,
            reason: 'getSession_after_null_event',
            sessionPresent: Boolean(session?.user),
            source: 'Index',
            storageKeyName: ODARA_AUTH_STORAGE_KEY,
            userPresent: Boolean(authUserRef.current),
          });
          applySession(session, `confirm:${sourceEvent}`);
          if (active) setAuthReady(true);
        })
        .catch(() => {
          if (!active || revision !== authRevision) return;
          recordOdaraAuthTrace({
            authReady: authReadyRef.current,
            decision: 'confirm_failed',
            event: sourceEvent,
            reason: 'getSession_after_null_event_error',
            sessionPresent: false,
            source: 'Index',
            storageKeyName: ODARA_AUTH_STORAGE_KEY,
            userPresent: Boolean(authUserRef.current),
          });
          if (active) setAuthReady(true);
        });
    };

    const { data: { subscription } } = odaraSupabase.auth.onAuthStateChange((event, session) => {
      authRevision += 1;
      const revision = authRevision;
      const decision = resolveAuthStateHydrationDecision({
        event,
        sessionBootstrapResolved,
        eventHasSession: Boolean(session?.user),
        currentUserPresent: Boolean(authUserRef.current),
      });
      recordOdaraAuthTrace({
        authReady: authReadyRef.current,
        decision,
        event,
        reason: 'onAuthStateChange',
        sessionPresent: Boolean(session?.user),
        source: 'Index',
        storageKeyName: ODARA_AUTH_STORAGE_KEY,
        userPresent: Boolean(authUserRef.current),
      });

      if (decision === 'ignore_transient_null') return;

      if (decision === 'confirm_signed_out') {
        confirmCurrentSessionBeforeClearing(revision, event);
        return;
      }

      applySession(decision === 'apply_signed_out' ? null : session, event);
      setAuthReady(true);
    });

    odaraSupabase.auth.getSession()
      .then(({ data: { session } }) => {
        authRevision += 1;
        sessionBootstrapResolved = true;
        const shouldApplyBootstrap = shouldApplySessionBootstrapResult({
          bootstrapHasSession: Boolean(session?.user),
          currentUserPresent: Boolean(authUserRef.current),
        });
        recordOdaraAuthTrace({
          authReady: authReadyRef.current,
          decision: shouldApplyBootstrap ? 'apply_bootstrap' : 'ignore_stale_bootstrap_null',
          reason: 'getSession_bootstrap',
          sessionPresent: Boolean(session?.user),
          source: 'Index',
          storageKeyName: ODARA_AUTH_STORAGE_KEY,
          userPresent: Boolean(authUserRef.current),
        });
        if (hadPersistedAuthTraceOnMountRef.current) {
          recordOdaraAuthTrace({
            authReady: authReadyRef.current,
            decision: 'getSession_after_reload',
            reason: 'getSession_bootstrap',
            sessionPresent: Boolean(session?.user),
            source: 'Index',
            storageKeyName: ODARA_AUTH_STORAGE_KEY,
            userPresent: Boolean(authUserRef.current),
          });
        }
        if (hadPersistedLoginTraceOnMountRef.current) {
          recordOdaraAuthTrace({
            authReady: authReadyRef.current,
            decision: 'session_after_login_reload',
            reason: 'getSession_bootstrap',
            sessionPresent: Boolean(session?.user),
            source: 'Index',
            storageKeyName: ODARA_AUTH_STORAGE_KEY,
            userPresent: Boolean(authUserRef.current),
          });
        }
        if (shouldApplyBootstrap) {
          applySession(session, 'getSession');
        }
        if (active) setAuthReady(true);
      })
      .catch(() => {
        sessionBootstrapResolved = true;
        if (active) setAuthReady(true);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // --- Oracle effect: keyed state machine ---
  useEffect(() => {
    // For signed-in users, wait for authReady. For guests, proceed immediately.
    if (!access.isGuestMode && !authReady) return;

    if (shouldDelayOracleForWeather) {
      setOracleLoading(true);
      setOracleError(null);
      return;
    }

    if (!oracleKey) {
      setOracle(null);
      setOracleLoading(false);
      setOracleError(null);
      oracleInFlightKeyRef.current = null;
      oracleSuccessKeyRef.current = null;
      return;
    }

    // Dedupe: already in flight for this key
    if (oracleInFlightKeyRef.current === oracleKey) {
      return;
    }

    // Dedupe: already satisfied for this key
    if (oracleSuccessKeyRef.current === oracleKey) {
      return;
    }

    // Launch
    const requestId = ++oracleRequestIdRef.current;
    const requestTemperature = stableOracleTemperature;
    oracleInFlightKeyRef.current = oracleKey;
    let requestStarted = false;
    let cancelled = false;
    let launchTimerId: number | null = null;

    setOracleLoading(true);
    setOracleError(null);
    recordOdaraAuthTrace({
      accessMode: diagnosticAccessMode,
      authReady,
      contextKey: selectedContext,
      decision: 'oracle_refetch_started',
      oracleKeyPresent: Boolean(oracleKey),
      oracleSlotKeyPresent: Boolean(oracleSlotKey),
      reason: 'selected_date_or_context_changed',
      selectedDate,
      source: 'oracle',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      userPresent: Boolean(authUserRef.current),
    });

    launchTimerId = window.setTimeout(() => {
      requestStarted = true;

      if (oracleSlotKey && oracleTemperatureBySlotRef.current[oracleSlotKey] == null) {
        oracleTemperatureBySlotRef.current[oracleSlotKey] = requestTemperature;
      }

      (async () => {
        try {
          const result = await withTimeout((async () => {
            if (!access.isGuestMode) {
              recordOdaraAuthTrace({
                accessMode: diagnosticAccessModeRef.current,
                authReady: authReadyRef.current,
                contextKey: selectedContext,
                decision: 'getSession_before_oracle',
                oracleKeyPresent: Boolean(oracleKey),
                oracleSlotKeyPresent: Boolean(oracleSlotKey),
                reason: 'signed_in_oracle_preflight',
                selectedDate,
                source: 'oracle',
                storageKeyName: ODARA_AUTH_STORAGE_KEY,
                userPresent: Boolean(authUserRef.current),
              });
              const { data: sessionData } = await odaraSupabase.auth.getSession();
              const session = sessionData?.session;
              recordOdaraAuthTrace({
                accessMode: diagnosticAccessMode,
                authReady: authReadyRef.current,
                contextKey: selectedContext,
                decision: session ? 'getSession_result_session_present' : 'getSession_result_no_session',
                oracleKeyPresent: Boolean(oracleKey),
                oracleSlotKeyPresent: Boolean(oracleSlotKey),
                reason: 'signed_in_oracle_preflight',
                selectedDate,
                sessionPresent: Boolean(session?.user),
                source: 'oracle',
                storageKeyName: ODARA_AUTH_STORAGE_KEY,
                userPresent: Boolean(authUserRef.current),
              });
              if (!session) {
                throw new Error('No active session — cannot call oracle RPC');
              }
            }

            recordOdaraAuthTrace({
              accessMode: diagnosticAccessMode,
              authReady: authReadyRef.current,
              contextKey: selectedContext,
              decision: 'oracle_rpc_started',
              oracleKeyPresent: Boolean(oracleKey),
              oracleSlotKeyPresent: Boolean(oracleSlotKey),
              reason: 'fetch_home_oracle',
              selectedDate,
              source: 'oracle',
              storageKeyName: ODARA_AUTH_STORAGE_KEY,
              userPresent: Boolean(authUserRef.current),
            });
            return fetchHomeOracle({
              access,
              temperature: requestTemperature,
              context: selectedContext,
              brand: 'Alexandria Fragrances',
              wearDate: selectedDate,
              diagnostic: {
                requestGeneration: requestId,
                oracleKey,
                timeoutMs: ORACLE_FETCH_TIMEOUT_MS,
              },
            });
          })(), ORACLE_FETCH_TIMEOUT_MS);

          if (cancelled || requestId !== oracleRequestIdRef.current) return;

          const data = result.data;
          const slotTaggedData = data && typeof data === 'object'
            ? {
                ...data,
                requested_context: (data as any).requested_context ?? selectedContext,
                context_key: (data as any).context_key ?? selectedContext,
                wear_date: (data as any).wear_date ?? selectedDate,
                __v6: (data as any).__v6 && typeof (data as any).__v6 === 'object'
                  ? {
                      ...(data as any).__v6,
                      requested_context: (data as any).__v6.requested_context ?? (data as any).requested_context ?? selectedContext,
                      context_key: (data as any).__v6.context_key ?? (data as any).context_key ?? selectedContext,
                      wear_date: (data as any).__v6.wear_date ?? (data as any).wear_date ?? selectedDate,
                    }
                  : (data as any).__v6,
              }
            : data;

          setOracle(slotTaggedData as unknown as OracleResult);
          setOracleError(null);
          setOracleLoading(false);
          oracleSuccessKeyRef.current = oracleKey;
          oracleInFlightKeyRef.current = null;
          recordOdaraAuthTrace({
            accessMode: diagnosticAccessMode,
            authReady: authReadyRef.current,
            contextKey: selectedContext,
            decision: 'oracle_rpc_success',
            oracleKeyPresent: Boolean(oracleKey),
            oracleSlotKeyPresent: Boolean(oracleSlotKey),
            reason: 'fetch_home_oracle',
            selectedDate,
            source: 'oracle',
            storageKeyName: ODARA_AUTH_STORAGE_KEY,
            userPresent: Boolean(authUserRef.current),
          });
        } catch (e: any) {
          if (cancelled || requestId !== oracleRequestIdRef.current) return;

          setOracleError(e?.message || 'Unknown error');
          setOracleLoading(false);
          oracleInFlightKeyRef.current = null;
          recordOdaraAuthTrace({
            accessMode: diagnosticAccessMode,
            authReady: authReadyRef.current,
            contextKey: selectedContext,
            decision: 'oracle_rpc_error',
            oracleKeyPresent: Boolean(oracleKey),
            oracleSlotKeyPresent: Boolean(oracleSlotKey),
            reason: e?.message || 'Unknown error',
            selectedDate,
            source: 'oracle',
            storageKeyName: ODARA_AUTH_STORAGE_KEY,
            userPresent: Boolean(authUserRef.current),
          });
        }
      })();
    }, ORACLE_FETCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (launchTimerId !== null) {
        window.clearTimeout(launchTimerId);
      }
      if (!requestStarted && oracleInFlightKeyRef.current === oracleKey) {
        oracleInFlightKeyRef.current = null;
      }
    };
  }, [
    authReady,
    oracleKey,
    oracleSlotKey,
    stableOracleTemperature,
    shouldDelayOracleForWeather,
    access,
    diagnosticAccessMode,
    selectedContext,
    selectedDate,
  ]);

  // Accept / Skip RPCs — guarded by canWrite
  const handleAccept = useCallback(async (fragranceId: string, layerFragranceId: string | null = null) => {
    if (!access.canWrite || !user) {
      return;
    }
    const { error: err } = await odaraSupabase.rpc('accept_oracle_selection_v1' as any, {
      p_user: user.id,
      p_fragrance_id: fragranceId,
      p_layer_fragrance_id: layerFragranceId,
      p_context: selectedContext,
      p_wear_date: selectedDate,
    });
    if (err) {
      throw err;
    }
  }, [user, access.canWrite, selectedContext, selectedDate]);

  const handleSkip = useCallback(async (fragranceId: string) => {
    if (!access.canWrite || !user) {
      return null;
    }

    const { error: skipError } = await odaraSupabase.rpc('skip_oracle_selection_v1' as any, {
      p_user: user.id,
      p_fragrance_id: fragranceId,
      p_context: selectedContext,
      p_skip_date: selectedDate,
    });

    if (skipError) {
      throw skipError;
    }

    // Re-fetch oracle inline via normalized access layer
    oracleSuccessKeyRef.current = null;

    const { data } = await fetchHomeOracle({
      access,
      temperature: stableOracleTemperature,
      context: selectedContext,
      brand: 'Alexandria Fragrances',
      wearDate: selectedDate,
    });
    return data as unknown as OracleResult;
  }, [user, access, selectedContext, selectedDate, stableOracleTemperature]);

  const clearAuthMessages = useCallback(() => {
    setAuthError('');
    setAuthNotice('');
  }, []);

  const markFieldTouched = useCallback((field: AuthField) => {
    setTouchedFields((current) => (current[field] ? current : { ...current, [field]: true }));
  }, []);

  const resetAuthDraftState = useCallback((nextView: AuthView, nextEmail?: string) => {
    setAuthView(nextView);
    setSubmitAttempted(false);
    setTouchedFields({});
    setPassword('');
    setConfirmPassword('');
    setSignUpPasswordsVisible(false);
    setSignInPasswordVisible(false);
    setAuthError('');
    setAuthNotice('');
    if (nextView !== 'checkEmail') {
      setPendingVerificationEmail('');
    }
    if (nextEmail !== undefined) {
      setEmail(nextEmail);
    }
  }, []);

  const handleFieldChange = useCallback((field: AuthField, value: string) => {
    clearAuthMessages();
    if (submitAttempted) {
      setTouchedFields((current) => ({ ...current, [field]: true }));
    }

    switch (field) {
      case 'firstName':
        setFirstName(value);
        break;
      case 'lastName':
        setLastName(value);
        break;
      case 'email':
        setEmail(value);
        break;
      case 'password':
        setPassword(value);
        break;
      case 'confirmPassword':
        setConfirmPassword(value);
        break;
      default:
        break;
    }
  }, [clearAuthMessages, submitAttempted]);

  const handleRememberMeToggle = (next: boolean) => {
    setRememberMe(next);
    // Apply immediately so an unchecked box clears any previously remembered email.
    persistRememberedEmail(next, email.trim());
  };

  const handleGoogle = async () => {
    if (isEditorPreview) {
      recordLoginTrace('login_submit_clicked', 'google_oauth_editor_preview_open');
      recordLoginTrace('login_redirect_origin', 'google_oauth_editor_preview_open', {
        originChanged: window.location.origin !== ODARA_SHARED_PREVIEW_ORIGIN,
        redirectOrigin: ODARA_SHARED_PREVIEW_ORIGIN,
      });
      window.open(ODARA_SHARED_PREVIEW_ORIGIN, '_blank');
      return;
    }
    setGuestOverride(false, 'google_sign_in_submit_clear_guest_override');
    clearAuthMessages();
    persistRememberedEmail(rememberMe, email.trim());
    primeVesperAuthPersistence(rememberMe, ODARA_AUTH_STORAGE_KEY);
    recordLoginTrace('login_submit_clicked', 'google_oauth_submit');
    recordLoginTrace('current_origin_at_login', 'google_oauth_submit', {
      originChanged: false,
    });
    recordLoginTrace('login_redirect_origin', 'google_oauth_submit', {
      originChanged: window.location.origin !== authRedirectOrigin,
    });
    recordLoginTrace('login_request_started', 'google_oauth_request_started');
    recordOdaraAuthTrace({
      accessMode: diagnosticAccessMode,
      authReady: authReadyRef.current,
      decision: 'sign_in_submit',
      reason: 'google_oauth_submit',
      source: 'Index',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      userPresent: Boolean(authUserRef.current),
    });
    setLoading(true);
    try {
      const { error: err } = await odaraSupabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: authRedirectOrigin },
      });
      if (err) {
        recordLoginTrace('login_request_result_error', 'google_oauth_error', {
          sessionPresent: false,
        });
        recordOdaraAuthTrace({
          accessMode: diagnosticAccessMode,
          authReady: authReadyRef.current,
          decision: 'sign_in_result_error',
          reason: 'google_oauth_error',
          sessionPresent: false,
          source: 'Index',
          storageKeyName: ODARA_AUTH_STORAGE_KEY,
          userPresent: Boolean(authUserRef.current),
        });
        setAuthError(err.message);
      } else {
        recordLoginTrace('login_request_result_success', 'google_oauth_redirect_started', {
          sessionPresent: false,
        });
        recordLoginTrace('login_result_session_present', 'google_oauth_redirect_started', {
          sessionPresent: false,
        });
      }
    } finally { setLoading(false); }
  };

  const handleResendVerification = async () => {
    if (!canResendVerification) return;
    clearAuthMessages();
    setLoading(true);
    try {
      const { error: err } = await odaraSupabase.auth.resend({
        type: 'signup',
        email: pendingEmail,
        options: {
          emailRedirectTo: authRedirectOrigin,
        },
      });
      if (err) {
        setAuthError(err.message);
      } else {
        setAuthNotice(`Verification email resent to ${pendingEmail}.`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async (request?: OdaraSignOutRequest) => {
    const guard = resolveSignOutGuard(request);
    if (!guard.allowed) {
      recordOdaraAuthTrace({
        accessMode: diagnosticAccessMode,
        actionId: guard.actionId ?? undefined,
        authReady: authReadyRef.current,
        blocked: true,
        caller: request?.caller ?? undefined,
        decision: 'sign_out_blocked',
        defaultPrevented: request?.defaultPrevented ?? undefined,
        menuOpen: request?.menuOpen ?? undefined,
        pointerType: request?.pointerType ?? undefined,
        propagationStopped: request?.propagationStopped ?? undefined,
        reason: guard.reason,
        routePath: window.location.pathname,
        source: 'Index',
        storageKeyName: ODARA_AUTH_STORAGE_KEY,
        targetLabel: request?.targetLabel ?? undefined,
        userPresent: Boolean(authUserRef.current),
      });
      return;
    }

    if (access.isGuestMode) {
      // Guest sign-out: just return to auth screen
      setGuestOverride(false, 'menu_auth_action_clear_guest_override');
      setOracle(null);
      setOracleError(null);
      oracleSuccessKeyRef.current = null;
      oracleInFlightKeyRef.current = null;
      return;
    }
    if (guestMode) {
      setGuestOverride(false, 'menu_sign_out_clear_guest_override');
    }
    recordOdaraAuthTrace({
      accessMode: diagnosticAccessMode,
      actionId: guard.actionId ?? undefined,
      authReady: authReadyRef.current,
      caller: request?.caller ?? undefined,
      decision: 'sign_out_called',
      defaultPrevented: request?.defaultPrevented ?? undefined,
      menuOpen: request?.menuOpen ?? undefined,
      pointerType: request?.pointerType ?? undefined,
      propagationStopped: request?.propagationStopped ?? undefined,
      reason: guard.reason,
      routePath: window.location.pathname,
      source: 'Index',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
      targetLabel: request?.targetLabel ?? undefined,
      userPresent: Boolean(authUserRef.current),
    });
    await odaraSupabase.auth.signOut();
  };

  const handleEmailAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    recordLoginTrace('login_submit_clicked', isSignUp ? 'email_signup_submit' : 'password_sign_in_submit');
    recordLoginTrace('login_submit_prevent_default_applied', isSignUp ? 'email_signup_submit' : 'password_sign_in_submit');
    clearAuthMessages();
    setSubmitAttempted(true);

    const validationErrors = isSignUp
      ? validateSignUpFields(firstName, lastName, email, password, confirmPassword)
      : validateSignInFields(email, password);

    if (Object.keys(validationErrors).length > 0) {
      recordLoginTrace('login_request_result_error', 'client_validation_error', {
        sessionPresent: false,
      });
      setTouchedFields((current) => ({
        ...current,
        ...Object.fromEntries(Object.keys(validationErrors).map((key) => [key, true])) as Partial<Record<AuthField, boolean>>,
      }));
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim();
      setGuestOverride(false, 'email_auth_submit_clear_guest_override');
      recordLoginTrace('current_origin_at_login', isSignUp ? 'email_signup_submit' : 'password_sign_in_submit', {
        originChanged: false,
      });
      recordLoginTrace('login_redirect_origin', isSignUp ? 'email_signup_submit' : 'password_sign_in_submit', {
        originChanged: window.location.origin !== authRedirectOrigin,
      });
      recordLoginTrace('login_request_started', isSignUp ? 'email_signup_request_started' : 'password_sign_in_request_started');
      recordOdaraAuthTrace({
        accessMode: diagnosticAccessMode,
        authReady: authReadyRef.current,
        decision: 'sign_in_submit',
        reason: isSignUp ? 'email_signup_submit' : 'password_sign_in_submit',
        source: 'Index',
        storageKeyName: ODARA_AUTH_STORAGE_KEY,
        userPresent: Boolean(authUserRef.current),
      });

      if (isSignUp) {
        primeVesperAuthPersistence(true, ODARA_AUTH_STORAGE_KEY);
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
        const { data, error: err } = await odaraSupabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: authRedirectOrigin,
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              full_name: fullName,
              name: fullName,
            },
          },
        });

        if (err) {
          recordLoginTrace('login_request_result_error', 'email_signup_error', {
            sessionPresent: false,
          });
          recordOdaraAuthTrace({
            accessMode: diagnosticAccessMode,
            authReady: authReadyRef.current,
            decision: 'sign_in_result_error',
            reason: 'email_signup_error',
            sessionPresent: false,
            source: 'Index',
            storageKeyName: ODARA_AUTH_STORAGE_KEY,
            userPresent: Boolean(authUserRef.current),
          });
          setAuthError(err.message);
          return;
        }

        recordLoginTrace('login_request_result_success', 'email_signup_result', {
          sessionPresent: Boolean(data.session?.user),
        });
        recordLoginTrace('login_result_session_present', 'email_signup_result', {
          sessionPresent: Boolean(data.session?.user),
        });
        recordOdaraAuthTrace({
          accessMode: diagnosticAccessMode,
          authReady: authReadyRef.current,
          decision: data.session ? 'sign_in_result_success' : 'sign_up_verification_required',
          reason: 'email_signup_result',
          sessionPresent: Boolean(data.session?.user),
          source: 'Index',
          storageKeyName: ODARA_AUTH_STORAGE_KEY,
          userPresent: Boolean(data.session?.user ?? authUserRef.current),
        });
        recordOdaraAuthTrace({
          accessMode: diagnosticAccessMode,
          authReady: authReadyRef.current,
          decision: 'auth_key_exists_immediately_after_sign_in',
          reason: 'email_signup_result_storage_check',
          sessionPresent: Boolean(data.session?.user),
          source: 'storage',
          storageKeyName: ODARA_AUTH_STORAGE_KEY,
          userPresent: Boolean(data.session?.user ?? authUserRef.current),
        });
        await probeImmediateLoginSession('email_signup_result', Boolean(data.session?.user));

        if (!data.session) {
          setPendingVerificationEmail(normalizedEmail);
          setPassword('');
          setConfirmPassword('');
          setSubmitAttempted(false);
          setTouchedFields({});
          setSignUpPasswordsVisible(false);
          setAuthView('checkEmail');
        }

        return;
      }

      primeVesperAuthPersistence(rememberMe, ODARA_AUTH_STORAGE_KEY);
      const { data, error: err } = await odaraSupabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (err) {
        recordLoginTrace('login_request_result_error', 'password_sign_in_error', {
          sessionPresent: false,
        });
        recordOdaraAuthTrace({
          accessMode: diagnosticAccessMode,
          authReady: authReadyRef.current,
          decision: 'sign_in_result_error',
          reason: 'password_sign_in_error',
          sessionPresent: false,
          source: 'Index',
          storageKeyName: ODARA_AUTH_STORAGE_KEY,
          userPresent: Boolean(authUserRef.current),
        });
        setAuthError(err.message);
      } else {
        recordLoginTrace('login_request_result_success', 'password_sign_in_result', {
          sessionPresent: Boolean(data.session?.user),
        });
        recordLoginTrace('login_result_session_present', 'password_sign_in_result', {
          sessionPresent: Boolean(data.session?.user),
        });
        recordOdaraAuthTrace({
          accessMode: diagnosticAccessMode,
          authReady: authReadyRef.current,
          decision: 'sign_in_result_success',
          reason: 'password_sign_in_result',
          sessionPresent: Boolean(data.session?.user),
          source: 'Index',
          storageKeyName: ODARA_AUTH_STORAGE_KEY,
          userPresent: Boolean(data.session?.user ?? authUserRef.current),
        });
        recordOdaraAuthTrace({
          accessMode: diagnosticAccessMode,
          authReady: authReadyRef.current,
          decision: 'auth_key_exists_immediately_after_sign_in',
          reason: 'password_sign_in_result_storage_check',
          sessionPresent: Boolean(data.session?.user),
          source: 'storage',
          storageKeyName: ODARA_AUTH_STORAGE_KEY,
          userPresent: Boolean(data.session?.user ?? authUserRef.current),
        });
        await probeImmediateLoginSession('password_sign_in_result', Boolean(data.session?.user));
        persistRememberedEmail(rememberMe, normalizedEmail);
      }
    } finally {
      setLoading(false);
    }
  };

  // Wait for auth bootstrap (but NOT when in guest mode — guest skips auth entirely)
  if (!authReady && !guestMode) {
    return (
      <>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <span className="text-sm text-muted-foreground">Checking authentication…</span>
        </div>
        <AuthDiagnosticPanel
          accessMode={diagnosticAccessMode}
          authReady={authReady}
          guestOverride={guestMode}
          userPresent={Boolean(user)}
        />
      </>
    );
  }

  // Show auth screen only when not signed in AND not in guest mode
  if (!access.isSignedIn && !access.isGuestMode) {
    return (
      <>
        <div
          className="min-h-dvh overflow-y-auto bg-background text-foreground"
          style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}
        >
          <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10 sm:py-14" style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}>
            <div className="mx-auto w-full max-w-sm">
              <div className="mb-8 text-center">
                <div className="mb-4 flex flex-col items-center gap-1.5 text-[10px] uppercase tracking-[0.24em] text-muted-foreground/50">
                  <span>WELCOME</span>
                  <span>TO</span>
                </div>
                <h1
                  className="select-none text-xl font-bold uppercase tracking-[0.4em]"
                  data-odara-auth-debug-trigger
                >
                  VESPER
                </h1>
                {isCheckEmail ? (
                  <>
                    <h2 className="mt-3 text-lg font-medium text-foreground">Check your email</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      We sent a verification email to <span className="text-foreground">{pendingEmail}</span>. Confirm your account, then return to sign in.
                    </p>
                  </>
                ) : null}
              </div>

              <div>
                {isCheckEmail ? (
                  <div className="space-y-3">
                  {authError ? (
                    <p className="rounded-xl border border-red-400/18 bg-red-500/8 px-4 py-3 text-sm text-red-300">
                      {authError}
                    </p>
                  ) : null}
                  {authNotice ? (
                    <p className="rounded-xl border border-emerald-400/18 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-300">
                      {authNotice}
                    </p>
                  ) : null}
                  {canResendVerification ? (
                    <button
                      type="button"
                      className="h-12 w-full rounded-xl border border-border/12 bg-accent/40 text-sm font-medium text-foreground transition-colors hover:bg-accent/70 disabled:opacity-50"
                      disabled={loading}
                      onClick={handleResendVerification}
                    >
                      {loading ? 'Sending…' : 'Resend Email'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="h-12 w-full rounded-xl bg-foreground text-sm font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
                    disabled={loading}
                    onClick={() => resetAuthDraftState('signIn', pendingEmail)}
                  >
                    Back to Sign In
                  </button>
                  </div>
                ) : (
                  <form className="space-y-3" noValidate onSubmit={handleEmailAuth}>
                  {isSignUp ? (
                    <>
                      <AuthTextField
                        autoComplete="given-name"
                        error={(submitAttempted || touchedFields.firstName) ? activeFieldErrors.firstName : undefined}
                        label="First name"
                        onBlur={() => markFieldTouched('firstName')}
                        onChange={(value) => handleFieldChange('firstName', value)}
                        placeholder="First name"
                        type="text"
                        value={firstName}
                      />
                      <AuthTextField
                        autoComplete="family-name"
                        error={(submitAttempted || touchedFields.lastName) ? activeFieldErrors.lastName : undefined}
                        label="Last name"
                        onBlur={() => markFieldTouched('lastName')}
                        onChange={(value) => handleFieldChange('lastName', value)}
                        placeholder="Last name"
                        type="text"
                        value={lastName}
                      />
                    </>
                  ) : null}

                  <AuthTextField
                    autoComplete="email"
                    error={(submitAttempted || touchedFields.email) ? activeFieldErrors.email : undefined}
                    inputMode="email"
                    label="Email"
                    onBlur={() => markFieldTouched('email')}
                    onChange={(value) => handleFieldChange('email', value)}
                    placeholder="Email"
                    type="email"
                    value={email}
                  />

                  <AuthTextField
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    error={(submitAttempted || touchedFields.password) ? activeFieldErrors.password : undefined}
                    label="Password"
                    onBlur={() => markFieldTouched('password')}
                    onChange={(value) => handleFieldChange('password', value)}
                    onToggle={() => isSignUp ? setSignUpPasswordsVisible((current) => !current) : setSignInPasswordVisible((current) => !current)}
                    placeholder="Password"
                    showToggle
                    toggleLabel={isSignUp
                      ? (signUpPasswordsVisible ? 'Hide sign-up passwords' : 'Show sign-up passwords')
                      : (signInPasswordVisible ? 'Hide password' : 'Show password')}
                    type={isSignUp
                      ? (signUpPasswordsVisible ? 'text' : 'password')
                      : (signInPasswordVisible ? 'text' : 'password')}
                    value={password}
                  />

                  {isSignUp ? (
                    <AuthTextField
                      autoComplete="new-password"
                      error={(submitAttempted || touchedFields.confirmPassword) ? activeFieldErrors.confirmPassword : undefined}
                      label="Confirm password"
                      onBlur={() => markFieldTouched('confirmPassword')}
                      onChange={(value) => handleFieldChange('confirmPassword', value)}
                      onToggle={() => setSignUpPasswordsVisible((current) => !current)}
                      placeholder="Confirm password"
                      showToggle
                      toggleLabel={signUpPasswordsVisible ? 'Hide sign-up passwords' : 'Show sign-up passwords'}
                      type={signUpPasswordsVisible ? 'text' : 'password'}
                      value={confirmPassword}
                    />
                  ) : null}

                  {!isSignUp ? (
                    <label className="flex select-none items-center gap-2.5 px-1 pt-0.5 text-[12px] text-muted-foreground/70">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(event) => handleRememberMeToggle(event.target.checked)}
                        className="h-4 w-4 cursor-pointer appearance-none rounded-[5px] border border-border/25 bg-accent/40 transition-colors checked:border-foreground/40 checked:bg-foreground/90 checked:bg-[length:11px_11px] checked:bg-center checked:bg-no-repeat checked:[background-image:url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22black%22%20stroke-width=%223%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22><polyline%20points=%2220%206%209%2017%204%2012%22/></svg>')]"
                      />
                      Remember me
                    </label>
                  ) : null}

                  {isSignUp ? (
                    <p className="px-1 text-[11px] leading-5 text-muted-foreground/55">
                      Passwords currently require at least {PASSWORD_MIN_LENGTH} characters. Final policy should still be confirmed in Supabase Auth settings.
                    </p>
                  ) : null}

                  {authError ? (
                    <p className="rounded-xl border border-red-400/18 bg-red-500/8 px-4 py-3 text-sm text-red-300">
                      {authError}
                    </p>
                  ) : null}
                  {authNotice ? (
                    <p className="rounded-xl border border-emerald-400/18 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-300">
                      {authNotice}
                    </p>
                  ) : null}

                  <button
                    className="mt-2 h-12 w-full rounded-xl bg-foreground text-sm font-semibold text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
                    disabled={loading}
                    type="submit"
                  >
                    {loading ? (isSignUp ? 'Creating account…' : 'Signing in…') : (isSignUp ? 'Create Account' : 'Sign In')}
                  </button>

                  <div className="flex items-center gap-3 py-1">
                    <div className="h-px flex-1 bg-border/10" />
                    <span className="text-[11px] text-muted-foreground/50">or</span>
                    <div className="h-px flex-1 bg-border/10" />
                  </div>

                  <button
                    className="h-12 w-full rounded-xl border border-border/12 bg-accent/40 text-sm font-medium text-foreground transition-colors hover:bg-accent/70 disabled:opacity-50"
                    disabled={loading}
                    onClick={handleGoogle}
                    type="button"
                  >
                    {socialButtonLabel}
                  </button>

                  <p className="pt-1 text-center text-[13px] text-muted-foreground">
                    {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
                    <button
                      className="text-foreground/80 underline underline-offset-2"
                      onClick={() => resetAuthDraftState(isSignUp ? 'signIn' : 'signUp')}
                      type="button"
                    >
                      {isSignUp ? 'Sign in' : 'Sign up'}
                    </button>
                  </p>

                  <button
                    className="mt-5 w-full text-center text-[12px] text-muted-foreground/45 underline underline-offset-2 transition-colors hover:text-muted-foreground/80"
                    onClick={() => setGuestOverride(true)}
                    type="button"
                  >
                    Skip for now
                  </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
        <AuthDiagnosticPanel
          accessMode={diagnosticAccessMode}
          authReady={authReady}
          guestOverride={guestMode}
          userPresent={Boolean(user)}
        />
      </>
    );
  }

  // ── App shell — both signed-in and guest reach here ──
  return (
    <>
      <OdaraScreen
        oracle={oracle}
        oracleLoading={oracleLoading}
        oracleError={oracleError}
        onSignOut={handleSignOut}
        selectedContext={selectedContext}
        onContextChange={setSelectedContext}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        onAccept={handleAccept}
        onSkip={handleSkip}
        userId={access.isGuestMode ? null : access.signedInUserId}
        resolvedTemperature={liveTemperature}
        isGuestMode={access.isGuestMode}
      />
      {/* Recipe Mode button removed — guest home now always uses get_guest_oracle_home_v6
          which decides standard vs recipe card_type on the backend. */}
      <AuthDiagnosticPanel
        accessMode={diagnosticAccessMode}
        authReady={authReady}
        guestOverride={guestMode}
        userPresent={Boolean(user)}
      />
    </>
  );
};

export default Index;
