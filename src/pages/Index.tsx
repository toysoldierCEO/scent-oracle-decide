import { useState, useEffect, useCallback } from 'react';
import { odaraSupabase } from '@/lib/odara-client';
import OdaraScreen from './OdaraScreen';
import type { OracleResult } from './OdaraScreen';

const ODARA_DEBUG_BUILD = 'ODARA_PREMIUM_V2';

const Index = () => {
  const [authLoading, setAuthLoading] = useState(true);
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

  const fetchOracleFor = useCallback(async (userId: string, context: string, wearDate: string) => {
    const { data, error: rpcError } = await odaraSupabase.rpc('get_todays_oracle_v3', {
      p_user_id: userId,
      p_temperature: 75,
      p_context: context,
      p_brand: 'Alexandria Fragrances',
      p_wear_date: wearDate,
    });

    if (rpcError) {
      throw rpcError;
    }

    return data as unknown as OracleResult;
  }, []);

  useEffect(() => {
    const { data: { subscription } } = odaraSupabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? undefined } : null);
      setAuthLoading(false);
    });
    odaraSupabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? undefined } : null);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fetch oracle when user, context, or date changes
  useEffect(() => {
    if (!user) { setOracle(null); return; }
    const fetchOracle = async () => {
      setOracleLoading(true);
      setOracleError(null);
      try {
        const nextOracle = await fetchOracleFor(user.id, selectedContext, selectedDate);
        setOracle(nextOracle);
      } catch (e: any) {
        setOracleError(e?.message || 'Unknown error');
      } finally {
        setOracleLoading(false);
      }
    };
    fetchOracle();
  }, [fetchOracleFor, user, selectedContext, selectedDate]);

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

    return await fetchOracleFor(user.id, selectedContext, selectedDate);
  }, [fetchOracleFor, user, selectedContext, selectedDate]);

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

  if (authLoading) {
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
          {/* TEMPORARY: preview/testing bypass using real Odara test account via edge function */}
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
                // Set real Odara session using returned tokens
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
    />
  );
};

export default Index;
