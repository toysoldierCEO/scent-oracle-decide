import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const boundarySource = readFileSync('src/components/OdaraErrorBoundary.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

describe('OdaraErrorBoundary', () => {
  it('records safe render crash breadcrumbs without touching auth', () => {
    expect(boundarySource).toContain('componentDidCatch');
    expect(boundarySource).toContain('recordOdaraReloadCrashEvent');
    expect(boundarySource).toContain("source: 'error-boundary'");
    expect(boundarySource).toContain("decision: 'render_error_caught'");
    expect(boundarySource).not.toContain('signOut');
    expect(boundarySource).not.toContain('localStorage.clear');
    expect(boundarySource).not.toContain('sessionStorage.clear');
  });

  it('wraps app routes with the recovery boundary', () => {
    expect(appSource).toContain('import { OdaraErrorBoundary }');
    expect(appSource).toContain('<OdaraErrorBoundary>');
    expect(appSource).toContain('</OdaraErrorBoundary>');
  });
});
