import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';

const ODARA_DEBUG_BUILD = 'ODARA_ORACLE_V1';

interface OraclePick {
  fragrance_id: string;
  name: string;
  family: string;
  reason: string;
  brand: string;
  notes: string[];
  accords: string[];
}

interface OracleLayer {
  fragrance_id: string;
  name: string;
  family: string;
  brand: string;
  notes: string[];
  accords: string[];
  reason: string;
}

interface OracleAlternate {
  fragrance_id: string;
  name: string;
  family: string;
  reason: string;
}

interface OracleResult {
  today_pick: OraclePick;
  layer: OracleLayer | null;
  alternates: OracleAlternate[];
}

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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? undefined } : null);
      setAuthLoading(false);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? undefined } : null);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Fetch oracle when user is authenticated
  useEffect(() => {
    if (!user) {
      setOracle(null);
      return;
    }
    const fetchOracle = async () => {
      setOracleLoading(true);
      setOracleError(null);
      try {
        const today = new Date().toISOString().split('T')[0];
        const { data, error: rpcError } = await supabase.rpc('get_todays_oracle_v3', {
          p_user_id: user.id,
          p_temperature: 75,
          p_context: 'casual',
          p_brand: 'Alexandria Fragrances',
          p_wear_date: today,
        });
        if (rpcError) {
          setOracleError(rpcError.message);
        } else {
          setOracle(data as unknown as OracleResult);
        }
      } catch (e: any) {
        setOracleError(e?.message || 'Unknown error');
      } finally {
        setOracleLoading(false);
      }
    };
    fetchOracle();
  }, [user]);

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
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth('google', {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        setError(result.error instanceof Error ? result.error.message : String(result.error));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (authLoading) {
    return (
      <div style={{ background: '#0a0a0a', color: '#888', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
        <p>Checking authentication…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ background: '#0a0a0a', color: '#e0e0e0', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', padding: 24 }}>
        <p style={{ fontSize: 10, color: '#555', marginBottom: 16 }}>{ODARA_DEBUG_BUILD}</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>ODARA</h1>
        <p style={{ fontSize: 14, color: '#888', marginBottom: 24 }}>{isSignUp ? 'Create your account' : 'Sign in to access your scent profile'}</p>

        <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ background: '#161616', border: '1px solid #333', borderRadius: 8, padding: '10px 14px', color: '#e0e0e0', fontSize: 14, outline: 'none' }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ background: '#161616', border: '1px solid #333', borderRadius: 8, padding: '10px 14px', color: '#e0e0e0', fontSize: 14, outline: 'none' }}
          />
          <button
            onClick={handleEmailAuth}
            disabled={loading || !email.trim() || !password.trim()}
            style={{ background: '#fff', color: '#0a0a0a', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}
          >
            {isSignUp ? 'Create Account' : 'Sign In'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
            <div style={{ flex: 1, height: 1, background: '#333' }} />
            <span style={{ fontSize: 11, color: '#666' }}>or</span>
            <div style={{ flex: 1, height: 1, background: '#333' }} />
          </div>

          <button
            onClick={handleGoogle}
            disabled={loading}
            style={{ background: '#161616', color: '#e0e0e0', border: '1px solid #333', borderRadius: 8, padding: '10px 0', fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}
          >
            Continue with Google
          </button>

          {error && <p style={{ fontSize: 12, color: error.startsWith('Check') ? '#6a6' : '#e55', textAlign: 'center' }}>{error}</p>}

          <p style={{ fontSize: 13, color: '#888', textAlign: 'center', marginTop: 8 }}>
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <span onClick={() => { setIsSignUp(!isSignUp); setError(''); }} style={{ color: '#aaa', cursor: 'pointer', textDecoration: 'underline' }}>
              {isSignUp ? 'Sign in' : 'Sign up'}
            </span>
          </p>
        </div>
      </div>
    );
  }

  // Authenticated view — live oracle data
  const pick = oracle?.today_pick;
  const layer = oracle?.layer;
  const alts = oracle?.alternates ?? [];

  return (
    <div style={{ background: '#0a0a0a', color: '#e0e0e0', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <p style={{ fontSize: 10, color: '#555' }}>{ODARA_DEBUG_BUILD}</p>
        <button onClick={handleSignOut} style={{ background: 'none', border: '1px solid #333', color: '#888', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Sign out</button>
      </div>
      <p style={{ fontSize: 10, color: '#444', marginBottom: 16 }}>uid: {user.id}</p>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>ODARA</h1>

      {oracleLoading && <p style={{ fontSize: 13, color: '#888', marginBottom: 32 }}>Loading oracle…</p>}
      {oracleError && <p style={{ fontSize: 13, color: '#e55', marginBottom: 32 }}>RPC error: {oracleError}</p>}

      {!oracleLoading && !oracleError && oracle && (
        <>
          <p style={{ fontSize: 13, color: '#888', marginBottom: 32 }}>Live data from oracle</p>

          <section style={{ marginBottom: 28 }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#666', marginBottom: 6 }}>Today's Pick</p>
            <div style={{ background: '#161616', borderRadius: 12, padding: 20, border: '1px solid #222' }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>{pick?.name ?? '—'}</h2>
              <p style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>{pick?.brand ?? '—'}</p>
              {pick?.family && (
                <span style={{ fontSize: 11, background: '#1a1a2e', color: '#8b7daa', padding: '3px 10px', borderRadius: 999 }}>{pick.family}</span>
              )}
              <p style={{ fontSize: 12, color: '#666', marginTop: 12 }}>{pick?.reason ?? ''}</p>
            </div>
          </section>

          {layer && (
            <section style={{ marginBottom: 28 }}>
              <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#666', marginBottom: 6 }}>Layer</p>
              <div style={{ background: '#161616', borderRadius: 12, padding: 16, border: '1px solid #222' }}>
                <h3 style={{ fontSize: 16, fontWeight: 500 }}>{layer.name}</h3>
                <p style={{ fontSize: 12, color: '#999' }}>{layer.brand}</p>
                <p style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{layer.reason}</p>
              </div>
            </section>
          )}

          {alts.length > 0 && (
            <section style={{ marginBottom: 28 }}>
              <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#666', marginBottom: 6 }}>Alternates</p>
              {alts.map((alt, i) => (
                <div key={alt.fragrance_id || i} style={{ background: '#161616', borderRadius: 12, padding: 16, border: '1px solid #222', marginBottom: 8 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 500 }}>{alt.name}</h3>
                  <p style={{ fontSize: 12, color: '#999' }}>{alt.reason}</p>
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {!oracleLoading && !oracleError && !oracle && (
        <p style={{ fontSize: 13, color: '#888', marginBottom: 32 }}>No oracle data returned</p>
      )}
    </div>
  );
};

export default Index;
