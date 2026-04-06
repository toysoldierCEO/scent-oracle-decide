import { useState, useEffect } from 'react';
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

  // Fetch oracle when user is authenticated or context changes
  useEffect(() => {
    if (!user) { setOracle(null); return; }
    const fetchOracle = async () => {
      setOracleLoading(true);
      setOracleError(null);
      try {
        const today = new Date().toISOString().split('T')[0];
        const { data, error: rpcError } = await odaraSupabase.rpc('get_todays_oracle_v3', {
          p_user_id: user.id,
          p_temperature: 75,
          p_context: selectedContext,
          p_brand: 'Alexandria Fragrances',
          p_wear_date: today,
        });
        if (rpcError) { setOracleError(rpcError.message); }
        else { setOracle(data as unknown as OracleResult); }
      } catch (e: any) {
        setOracleError(e?.message || 'Unknown error');
      } finally {
        setOracleLoading(false);
      }
    };
    fetchOracle();
  }, [user, selectedContext]);

  const handleEmailAuth = async () => {
    setError('');
    setLoading(true);
    try {
      if (isSignUp) {
        const { error: err } = await supabase.auth.signUp({ email: email.trim(), password: password.trim() });
        if (err) { setError(err.message); } else { setError('Check your email to confirm your account.'); }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password: password.trim() });
        if (err) setError(err.message);
      }
    } finally { setLoading(false); }
  };

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth('google', { redirect_uri: window.location.origin });
      if (result.error) {
        setError(result.error instanceof Error ? result.error.message : String(result.error));
      }
    } finally { setLoading(false); }
  };

  const handleSignOut = async () => { await supabase.auth.signOut(); };

  // Auth loading
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Checking authentication…</span>
      </div>
    );
  }

  // Signed out
  if (!user) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6" style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}>
        <span className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground/50 mb-4">{ODARA_DEBUG_BUILD}</span>
        <h1 className="text-xl tracking-[0.4em] font-bold uppercase mb-2">ODARA</h1>
        <p className="text-sm text-muted-foreground mb-8">
          {isSignUp ? 'Create your account' : 'Sign in to access your scent profile'}
        </p>

        <div className="w-full max-w-xs flex flex-col gap-3">
          <input
            type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)}
            className="bg-accent/50 border border-border/10 rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/20 transition-colors"
          />
          <input
            type="password" placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)}
            className="bg-accent/50 border border-border/10 rounded-lg px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/20 transition-colors"
          />
          <button
            onClick={handleEmailAuth}
            disabled={loading || !email.trim() || !password.trim()}
            className="bg-foreground text-background rounded-lg py-2.5 text-sm font-semibold hover:bg-foreground/90 disabled:opacity-50 transition-all"
          >
            {isSignUp ? 'Create Account' : 'Sign In'}
          </button>

          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-border/10" />
            <span className="text-[11px] text-muted-foreground/50">or</span>
            <div className="flex-1 h-px bg-border/10" />
          </div>

          <button
            onClick={handleGoogle} disabled={loading}
            className="bg-accent/50 text-foreground border border-border/10 rounded-lg py-2.5 text-sm font-medium hover:bg-accent/80 disabled:opacity-50 transition-all"
          >
            Continue with Google
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
        </div>
      </div>
    );
  }

  // Authenticated → premium Odara shell
  return (
    <OdaraScreen
      oracle={oracle}
      oracleLoading={oracleLoading}
      oracleError={oracleError}
      onSignOut={handleSignOut}
      selectedContext={selectedContext}
      onContextChange={setSelectedContext}
    />
  );
};

export default Index;
