import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';

const ODARA_DEBUG_BUILD = 'ODARA_AUTH_GATE_V3';

const Index = () => {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  return (
    <div style={{ background: '#0a0a0a', color: '#e0e0e0', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <p style={{ fontSize: 10, color: '#555' }}>{ODARA_DEBUG_BUILD}</p>
        <button onClick={handleSignOut} style={{ background: 'none', border: '1px solid #333', color: '#888', padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>Sign out</button>
      </div>
      <p style={{ fontSize: 10, color: '#444', marginBottom: 16 }}>uid: {user.id}</p>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>ODARA STATIC SHELL</h1>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 32 }}>Authenticated — awaiting RPC reintroduction</p>

      <section style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#666', marginBottom: 6 }}>Today's Pick</p>
        <div style={{ background: '#161616', borderRadius: 12, padding: 20, border: '1px solid #222' }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Karnak Temple</h2>
          <p style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>Alexandria Fragrances</p>
          <span style={{ fontSize: 11, background: '#1a1a2e', color: '#8b7daa', padding: '3px 10px', borderRadius: 999 }}>oud-amber</span>
          <p style={{ fontSize: 12, color: '#666', marginTop: 12 }}>Static render test only</p>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#666', marginBottom: 6 }}>Layer</p>
        <div style={{ background: '#161616', borderRadius: 12, padding: 16, border: '1px solid #222' }}>
          <h3 style={{ fontSize: 16, fontWeight: 500 }}>Barricade</h3>
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#666', marginBottom: 6 }}>Alternate</p>
        <div style={{ background: '#161616', borderRadius: 12, padding: 16, border: '1px solid #222' }}>
          <h3 style={{ fontSize: 16, fontWeight: 500 }}>Miraculous Oud</h3>
        </div>
      </section>
    </div>
  );
};

export default Index;
