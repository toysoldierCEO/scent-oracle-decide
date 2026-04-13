import { useState, useEffect, useCallback, useRef } from 'react';
import { odaraSupabase } from '@/lib/odara-client';
import OdaraScreen from './OdaraScreen';
import type { OracleResult } from './OdaraScreen';

const ODARA_DEBUG_BUILD = 'ODARA_PREMIUM_V2';
const RPC_TEMPERATURE = 75;

// --- Auth helpers ---
function normalizeUser(sessionUser: any): { id: string; email?: string } | null {
  return sessionUser ? { id: sessionUser.id, email: sessionUser.email ?? undefined } : null;
}

function sameUser(a: { id: string; email?: string } | null, b: { id: string; email?: string } | null): boolean {
  return (a?.id ?? null) === (b?.id ?? null) && (a?.email ?? null) === (b?.email ?? null);
}

const Index = () => {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Oracle state
  const [oracle, setOracle] = useState<OracleResult | null>(null);
  const [oracleLoading, setOracleLoading] = useState(false);
  const [oracleError, setOracleError] = useState<string | null>(null);
  const [selectedContext, setSelectedContext] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Oracle dedupe refs
  const oracleRequestIdRef = useRef(0);
  const oracleInFlightKeyRef = useRef<string | null>(null);
  const oracleSuccessKeyRef = useRef<string | null>(null);

  // Compute oracle key — only valid when auth is ready and user exists
  const oracleKey =
    authReady && user?.id
      ? `${user.id}|${selectedContext}|${selectedDate}|${RPC_TEMPERATURE}`
      : null;

  // Debug render log
  console.log('[Odara] render summary', {
    authReady,
    userId: user?.id ?? null,
    oracleKey,
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
      // authReady may already be true; this is fine
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
    if (!authReady) return;

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
    if (oracleSuccessKeyRef.current === oracleKey && oracle && !oracleError) {
      console.log('[Odara] oracle launch skipped satisfied', { oracleKey });
      return;
    }

    // Launch
    const requestId = ++oracleRequestIdRef.current;
    oracleInFlightKeyRef.current = oracleKey;

    console.log('[Odara] oracle launch', {
      oracleKey,
      requestId,
    });

    setOracleLoading(true);
    setOracleError(null);

    (async () => {
      try {
        const { data, error: rpcError } = await odaraSupabase.rpc('get_todays_oracle_v3', {
          p_user_id: user!.id,
          p_temperature: RPC_TEMPERATURE,
          p_context: selectedContext,
          p_brand: 'Alexandria Fragrances',
          p_wear_date: selectedDate,
        });
        if (requestId !== oracleRequestIdRef.current) return;
        if (rpcError) throw rpcError;

        console.log('[Odara] oracle success', { requestId, oracleKey });
        setOracle(data as unknown as OracleResult);
        setOracleError(null);
        setOracleLoading(false);
        oracleSuccessKeyRef.current = oracleKey;
        oracleInFlightKeyRef.current = null;
      } catch (e: any) {
        if (requestId !== oracleRequestIdRef.current) return;
        console.error('[Odara] oracle fail', { requestId, oracleKey, msg: e?.message || e });
        setOracleError(e?.message || 'Unknown error');
        setOracleLoading(false);
        oracleInFlightKeyRef.current = null;
        // Do NOT set oracleSuccessKeyRef — allows retry
      }
    })();
  }, [authReady, oracleKey]);

  // Accept / Skip RPCs
  const handleAccept = useCallback(async (fragranceId: string) => {
    if (!user) return;
    await odaraSupabase.rpc('accept_today_pick_v1', {
      p_user: user.id,
      p_fragrance_id: fragranceId,
      p_context: selectedContext,
    });
  }, [user, selectedContext]);

  const handleSkip = useCallback(async (fragranceId: string) => {
    if (!user) return null;

    const { error: skipError } = await odaraSupabase.rpc('skip_today_pick_v1', {
      p_user: user.id,
      p_fragrance_id: fragranceId,
      p_context: selectedContext,
    });

    if (skipError) {
      throw skipError;
    }

    // Re-fetch oracle inline — also invalidate success key so effect can re-run if needed
    oracleSuccessKeyRef.current = null;

    const { data, error: rpcError } = await odaraSupabase.rpc('get_todays_oracle_v3', {
      p_user_id: user.id,
      p_temperature: RPC_TEMPERATURE,
      p_context: selectedContext,
      p_brand: 'Alexandria Fragrances',
      p_wear_date: selectedDate,
    });
    if (rpcError) throw rpcError;
    return data as unknown as OracleResult;
  }, [user, selectedContext, selectedDate]);

  const handleEmailAuth = async () => {
    setError('');
    setLoading(true);
    try {
      if (isSignUp) {
        const { error: err } = await odaraSupabase.auth.signUp({ email: email.trim(), password: password.trim() });
        if (err) { setError(err.message); } else { setError('Check your email to confirm your account.'); }
      } else {
        const { error: err } = await odaraSupabase.auth.signInWithPassword({ email: email.trim(), password: password.trim() });
        if (err) setError(err.message);
      }
    } finally { setLoading(false); }
  };

  const SHARED_PREVIEW_ORIGIN = 'https://id-preview--20427402-64b7-4dc9-80aa-727b1e4a3e69.lovable.app';
  const isEditorPreview = window.location.hostname !== new URL(SHARED_PREVIEW_ORIGIN).hostname;

  const handleGoogle = async () => {
    if (isEditorPreview) {
      window.open(SHARED_PREVIEW_ORIGIN, '_blank');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { error: err } = await odaraSupabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: SHARED_PREVIEW_ORIGIN },
      });
      if (err) setError(err.message);
    } finally { setLoading(false); }
  };

  const handleSignOut = async () => { await odaraSupabase.auth.signOut(); };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Checking authentication…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6" style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}>
        <span className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground/50 mb-4">{ODARA_DEBUG_BUILD}</span>
        <h1 className="text-xl tracking-[0.4em] font-bold uppercase mb-2">ODARA</h1>
        <p className="text-sm text-muted-foreground mb-8">
          {isSignUp ? 'Create your account' : 'Sign in to access your scent profile'}
        </p>
        <div className="w-full max-w-xs flex flex-col gap-3">
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
            className="bg-accent/50 border border-border/10 rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/20 transition-colors" />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
            className="bg-accent/50 border border-border/10 rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/20 transition-colors" />
          <button onClick={handleEmailAuth} disabled={loading || !email.trim() || !password.trim()}
            className="bg-foreground text-background rounded-lg py-2.5 text-sm font-semibold hover:bg-foreground/90 disabled:opacity-50 transition-all">
            {isSignUp ? 'Create Account' : 'Sign In'}
          </button>
          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-border/10" />
            <span className="text-[11px] text-muted-foreground/50">or</span>
            <div className="flex-1 h-px bg-border/10" />
          </div>
          <button onClick={handleGoogle} disabled={loading}
            className="bg-accent/50 text-foreground border border-border/10 rounded-lg py-2.5 text-sm font-medium hover:bg-accent/80 disabled:opacity-50 transition-all">
            {isEditorPreview ? 'Open shared preview to sign in with Google' : 'Continue with Google'}
          </button>
          {error && (
            <p className={`text-xs text-center ${error.startsWith('Check') ? 'text-green-400' : 'text-red-400'}`}>{error}</p>
          )}
          <p className="text-[13px] text-muted-foreground text-center mt-2">
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <span onClick={() => { setIsSignUp(!isSignUp); setError(''); }} className="text-foreground/70 cursor-pointer underline underline-offset-2">
              {isSignUp ? 'Sign in' : 'Sign up'}
            </span>
          </p>
          {/* TEMPORARY: preview/testing bypass */}
          <button
            onClick={async () => {
              setError('');
              setLoading(true);
              try {
                const res = await fetch(
                  `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/odara-test-login`,
                  { method: 'POST', headers: { 'Content-Type': 'application/json' } }
                );
                const json = await res.json();
                if (!res.ok || json.error) {
                  setError(json.error || 'Test login failed');
                  return;
                }
                const { error: sessionErr } = await odaraSupabase.auth.setSession({
                  access_token: json.access_token,
                  refresh_token: json.refresh_token,
                });
                if (sessionErr) setError(sessionErr.message);
              } catch (e: any) {
                setError(e?.message || 'Test login failed');
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            className="mt-6 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 underline underline-offset-2 transition-colors disabled:opacity-30"
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  return (
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
      userId={user.id}
      resolvedTemperature={RPC_TEMPERATURE}
    />
  );
};

export default Index;
