import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const indexSource = readFileSync('src/pages/Index.tsx', 'utf8');
const diagnosticSource = readFileSync('src/lib/auth-diagnostic.ts', 'utf8');

describe('Index reload/crash recorder wiring', () => {
  it('installs the reload/crash recorder and updates safe app context', () => {
    expect(indexSource).toContain('installOdaraReloadCrashRecorder');
    expect(indexSource).toContain('updateOdaraReloadCrashContext');
    expect(indexSource).toContain("event: 'app_mount'");
    expect(indexSource).toContain("source: 'page'");
  });

  it('exposes reload/crash breadcrumbs in the copyable diagnostic summary', () => {
    expect(diagnosticSource).toContain('readSafeOdaraReloadCrashTrace');
    expect(diagnosticSource).toContain('reload/crash events:');
    expect(diagnosticSource).toContain('navigation=');
    expect(diagnosticSource).toContain('detail=');
  });
});
