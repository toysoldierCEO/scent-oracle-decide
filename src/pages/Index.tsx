import { useState, useEffect, useCallback, useRef, type FormEvent, type HTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { odaraSupabase } from '@/lib/odara-client';
import OdaraScreen from './OdaraScreen';
import type { OracleResult } from './OdaraScreen';
import { useWeather } from '@/hooks/useWeather';
import { resolveAccessMode } from '@/lib/access-mode';
import { fetchHomeOracle } from '@/lib/oracle-access';
// guest-recipe.ts is no longer called directly — get_guest_oracle_home_v6 decides card_type.



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
      localStorage.removeItem(REMEMBER_ME_KEY);
      localStorage.removeItem(REMEMBER_EMAIL_KEY);
    }
  } catch {
    /* ignore storage failures */
  }
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
  const { getTemperature, currentTemperature, weatherLoading } = useWeather();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
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
  const [guestMode, setGuestMode] = useState(false);
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
  const access = resolveAccessMode(user, guestMode);
  const SHARED_PREVIEW_ORIGIN = 'https://id-preview--20427402-64b7-4dc9-80aa-727b1e4a3e69.lovable.app';
  const isEditorPreview = window.location.hostname !== new URL(SHARED_PREVIEW_ORIGIN).hostname;
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

  const oracleSlotKey =
    (authReady || access.isGuestMode) && access.resolvedUserId
      ? `${access.resolvedUserId}|${selectedContext}|${selectedDate}`
      : null;
  const isSelectedDateToday = selectedDate === todayLocalKey();
  const shouldDelaySignedInOracleForWeather =
    !access.isGuestMode
    && isSelectedDateToday
    && currentTemperature == null
    && weatherLoading;
  const stableOracleTemperature = oracleSlotKey
    ? (oracleTemperatureBySlotRef.current[oracleSlotKey] ?? liveTemperature)
    : liveTemperature;

  // Compute oracle key — valid when we have a resolvedUserId (signed-in OR guest)
  const oracleKey = oracleSlotKey
    ? `${oracleSlotKey}|${stableOracleTemperature}`
    : null;

  // Debug render log
  console.log('[Odara] render summary', {
    authReady,
    userId: user?.id ?? null,
    isGuestMode: access.isGuestMode,
    resolvedUserId: access.resolvedUserId,
    canWrite: access.canWrite,
    oracleSlotKey,
    oracleKey,
    liveTemperature,
    stableOracleTemperature,
    oracleLoading,
    hasOracle: !!oracle,
    oracleError,
  });

  // --- Auth bootstrap ---
  useEffect(() => {
    const applySession = (session: any, source: string) => {
      const nextUser = normalizeUser(session?.user);
      setUser(prev => {
        if (sameUser(prev, nextUser)) {
          console.log(`[Odara] auth session skipped duplicate (${source})`);
          return prev;
        }
        console.log(`[Odara] auth session applied (${source})`, { userId: nextUser?.id ?? null });
        return nextUser;
      });
    };

    const { data: { subscription } } = odaraSupabase.auth.onAuthStateChange((_event, session) => {
      applySession(session, 'onAuthStateChange');
      setAuthReady(true);
    });

    odaraSupabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session, 'getSession');
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- Oracle effect: keyed state machine ---
  useEffect(() => {
    // For signed-in users, wait for authReady. For guests, proceed immediately.
    if (!access.isGuestMode && !authReady) return;

    if (shouldDelaySignedInOracleForWeather) {
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
      console.log('[Odara] oracle launch skipped in-flight', { oracleKey });
      return;
    }

    // Dedupe: already satisfied for this key
    if (oracleSuccessKeyRef.current === oracleKey) {
      console.log('[Odara] oracle launch skipped satisfied', { oracleKey });
      return;
    }

    // Launch
    const requestId = ++oracleRequestIdRef.current;
    const requestTemperature = stableOracleTemperature;
    if (oracleSlotKey && oracleTemperatureBySlotRef.current[oracleSlotKey] == null) {
      oracleTemperatureBySlotRef.current[oracleSlotKey] = requestTemperature;
    }
    oracleInFlightKeyRef.current = oracleKey;

    console.log('[Odara] oracle launch', {
      oracleKey,
      oracleSlotKey,
      requestTemperature,
      requestId,
      isGuestMode: access.isGuestMode,
    });

    setOracleLoading(true);
    setOracleError(null);

    (async () => {
      // For signed-in users, verify session before RPC
      if (!access.isGuestMode) {
        const { data: sessionData } = await odaraSupabase.auth.getSession();
        const session = sessionData?.session;
        console.log('[Odara] pre-oracle session check', {
          hasSession: !!session,
          sessionUserId: session?.user?.id ?? null,
          rpc: 'get_todays_oracle_home_v1',
          oracleKey,
          requestId,
        });
        if (!session) {
          if (requestId !== oracleRequestIdRef.current) return;
          const msg = 'No active session — cannot call oracle RPC';
          console.error('[Odara] oracle blocked: no session', { requestId });
          setOracleError(msg);
          setOracleLoading(false);
          oracleInFlightKeyRef.current = null;
          return;
        }
      }

      try {
        let data: any;
        let rpcUsed: string;
        const result = await fetchHomeOracle({
          access,
          temperature: requestTemperature,
          context: selectedContext,
          brand: 'Alexandria Fragrances',
          wearDate: selectedDate,
        });
        if (requestId !== oracleRequestIdRef.current) return;
        data = result.data;
        rpcUsed = result.rpcUsed;

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

        console.log('[Odara] oracle success', { requestId, oracleKey, rpcUsed });
        setOracle(slotTaggedData as unknown as OracleResult);
        setOracleError(null);
        setOracleLoading(false);
        oracleSuccessKeyRef.current = oracleKey;
        oracleInFlightKeyRef.current = null;
      } catch (e: any) {
        if (requestId !== oracleRequestIdRef.current) return;
        const isNetworkError = !e?.code && !e?.message?.includes('row-level');
        console.error('[Odara] oracle fail', {
          requestId, oracleKey,
          type: isNetworkError ? 'network/preflight failure' : 'rpc error',
          msg: e?.message || e,
          code: e?.code,
          details: e?.details,
          hint: e?.hint,
        });
        setOracleError(e?.message || 'Unknown error');
        setOracleLoading(false);
        oracleInFlightKeyRef.current = null;
      }
    })();
  }, [authReady, oracleKey, oracleSlotKey, stableOracleTemperature, shouldDelaySignedInOracleForWeather, access.isGuestMode, selectedContext, selectedDate]);

  // Accept / Skip RPCs — guarded by canWrite
  const handleAccept = useCallback(async (fragranceId: string, layerFragranceId: string | null = null) => {
    if (!access.canWrite || !user) {
      console.log('[Odara] accept blocked — guest mode or no user');
      return;
    }
    console.log('[Odara] accept rpc start', { userId: user.id, fragranceId, layerFragranceId, context: selectedContext, wearDate: selectedDate, rpc: 'accept_oracle_selection_v1' });
    const { error: err } = await odaraSupabase.rpc('accept_oracle_selection_v1' as any, {
      p_user: user.id,
      p_fragrance_id: fragranceId,
      p_layer_fragrance_id: layerFragranceId,
      p_context: selectedContext,
      p_wear_date: selectedDate,
    });
    if (err) {
      console.error('[Odara] accept rpc fail', { userId: user.id, fragranceId, layerFragranceId, context: selectedContext, wearDate: selectedDate, rpc: 'accept_oracle_selection_v1', error: err.message });
      throw err;
    } else {
      console.log('[Odara] accept rpc success', { userId: user.id, fragranceId, layerFragranceId, context: selectedContext, wearDate: selectedDate, rpc: 'accept_oracle_selection_v1' });
    }
  }, [user, access.canWrite, selectedContext, selectedDate]);

  const handleSkip = useCallback(async (fragranceId: string) => {
    if (!access.canWrite || !user) {
      console.log('[Odara] skip blocked — guest mode or no user');
      return null;
    }

    console.log('[Odara] skip rpc start', { userId: user.id, fragranceId, context: selectedContext, skipDate: selectedDate, rpc: 'skip_oracle_selection_v1' });
    const { error: skipError } = await odaraSupabase.rpc('skip_oracle_selection_v1' as any, {
      p_user: user.id,
      p_fragrance_id: fragranceId,
      p_context: selectedContext,
      p_skip_date: selectedDate,
    });

    if (skipError) {
      console.error('[Odara] skip rpc fail', { userId: user.id, fragranceId, context: selectedContext, skipDate: selectedDate, rpc: 'skip_oracle_selection_v1', error: skipError.message });
      throw skipError;
    }
    console.log('[Odara] skip rpc success', { userId: user.id, fragranceId, context: selectedContext, skipDate: selectedDate, rpc: 'skip_oracle_selection_v1' });

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
      window.open(SHARED_PREVIEW_ORIGIN, '_blank');
      return;
    }
    clearAuthMessages();
    persistRememberedEmail(rememberMe, email.trim());
    setLoading(true);
    try {
      const { error: err } = await odaraSupabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: SHARED_PREVIEW_ORIGIN },
      });
      if (err) setAuthError(err.message);
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
          emailRedirectTo: SHARED_PREVIEW_ORIGIN,
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

  const handleSignOut = async () => {
    if (access.isGuestMode) {
      // Guest sign-out: just return to auth screen
      setGuestMode(false);
      setOracle(null);
      setOracleError(null);
      oracleSuccessKeyRef.current = null;
      oracleInFlightKeyRef.current = null;
      return;
    }
    await odaraSupabase.auth.signOut();
  };

  const handleEmailAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearAuthMessages();
    setSubmitAttempted(true);

    const validationErrors = isSignUp
      ? validateSignUpFields(firstName, lastName, email, password, confirmPassword)
      : validateSignInFields(email, password);

    if (Object.keys(validationErrors).length > 0) {
      setTouchedFields((current) => ({
        ...current,
        ...Object.fromEntries(Object.keys(validationErrors).map((key) => [key, true])) as Partial<Record<AuthField, boolean>>,
      }));
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim();

      if (isSignUp) {
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
        const { data, error: err } = await odaraSupabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: SHARED_PREVIEW_ORIGIN,
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              full_name: fullName,
              name: fullName,
            },
          },
        });

        if (err) {
          setAuthError(err.message);
          return;
        }

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

      const { error: err } = await odaraSupabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (err) {
        setAuthError(err.message);
      } else {
        persistRememberedEmail(rememberMe, normalizedEmail);
      }
    } finally {
      setLoading(false);
    }
  };

  // Wait for auth bootstrap (but NOT when in guest mode — guest skips auth entirely)
  if (!authReady && !guestMode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Checking authentication…</span>
      </div>
    );
  }

  // Show auth screen only when not signed in AND not in guest mode
  if (!access.isSignedIn && !access.isGuestMode) {
    return (
      <div
        className="min-h-dvh overflow-y-auto bg-background text-foreground"
        style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}
      >
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10 sm:py-14" style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}>
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-8 text-center">
              <span className="mb-4 block text-[10px] uppercase tracking-[0.24em] text-muted-foreground/50">
                Welcome to Vesper
              </span>
              <h1 className="text-xl font-bold uppercase tracking-[0.4em]">ODARA</h1>
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
                    onClick={() => setGuestMode(true)}
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
        userId={access.resolvedUserId!}
        resolvedTemperature={liveTemperature}
        isGuestMode={access.isGuestMode}
      />
      {/* Recipe Mode button removed — guest home now always uses get_guest_oracle_home_v6
          which decides standard vs recipe card_type on the backend. */}
    </>
  );
};

export default Index;
