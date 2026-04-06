import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const ODARA_DEBUG_BUILD = 'ODARA_AUTH_GATE_V2';

const Index = () => {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

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

  const handleAuth = async () => {
    setError('');
    setMessage('');
    if (!email.trim() || !password.trim()) { setError('Enter email and password'); return; }
    setSending(true);

    if (isSignUp) {
      const { error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password: password.trim(),
      });
      setSending(false);
      if (authError) { setError(authError.message); return; }
      setMessage('Check your email for a confirmation link, then sign in.');
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim(),
      });
      setSending(false);
      if (authError) { setError(authError.message); return; }
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
        <p style={{ fontSize: 14, color: '#888', marginBottom: 24 }}>
          {isSignUp ? 'Create an account' : 'Sign in to access your scent profile'}
        </p>

        <div style={{ width: '100%', maxWidth: 300 }}>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #333', background: '#161616', color: '#e0e0e0', fontSize: 14, marginBottom: 10, boxSizing: 'border-box' }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAuth()}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #333', background: '#161616', color: '#e0e0e0', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
          />
          <button
            onClick={handleAuth}
            disabled={sending}
            style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', background: sending ? '#333' : '#fff', color: '#000', fontSize: 14, fontWeight: 600, cursor: sending ? 'default' : 'pointer' }}
          >
            {sending ? 'Please wait…' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
          {error && <p style={{ color: '#e55', fontSize: 12, marginTop: 8 }}>{error}</p>}
          {message && <p style={{ color: '#8b8', fontSize: 12, marginTop: 8 }}>{message}</p>}
          <button
            onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage(''); }}
            style={{ marginTop: 16, background: 'none', border: 'none', color: '#888', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
          >
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
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
