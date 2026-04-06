const ODARA_DEBUG_BUILD = 'ODARA_STATIC_SHELL_V1';

const Index = () => (
  <div style={{ background: '#0a0a0a', color: '#e0e0e0', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '24px 16px' }}>
    <p style={{ fontSize: 10, color: '#555', marginBottom: 8 }}>{ODARA_DEBUG_BUILD}</p>

    <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>ODARA STATIC SHELL</h1>
    <p style={{ fontSize: 13, color: '#888', marginBottom: 32 }}>Render test</p>

    {/* Today's Pick */}
    <section style={{ marginBottom: 28 }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#666', marginBottom: 6 }}>Today's Pick</p>
      <div style={{ background: '#161616', borderRadius: 12, padding: 20, border: '1px solid #222' }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Karnak Temple</h2>
        <p style={{ fontSize: 13, color: '#999', marginBottom: 8 }}>Alexandria Fragrances</p>
        <span style={{ fontSize: 11, background: '#1a1a2e', color: '#8b7daa', padding: '3px 10px', borderRadius: 999 }}>oud-amber</span>
        <p style={{ fontSize: 12, color: '#666', marginTop: 12 }}>Static render test only</p>
      </div>
    </section>

    {/* Layer */}
    <section style={{ marginBottom: 28 }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#666', marginBottom: 6 }}>Layer</p>
      <div style={{ background: '#161616', borderRadius: 12, padding: 16, border: '1px solid #222' }}>
        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Barricade</h3>
      </div>
    </section>

    {/* Alternate */}
    <section style={{ marginBottom: 28 }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', color: '#666', marginBottom: 6 }}>Alternate</p>
      <div style={{ background: '#161616', borderRadius: 12, padding: 16, border: '1px solid #222' }}>
        <h3 style={{ fontSize: 16, fontWeight: 500 }}>Miraculous Oud</h3>
      </div>
    </section>
  </div>
);

export default Index;
