import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/main.tsx', 'utf8');

describe('Odara safe-mode entry', () => {
  it('installs recovery diagnostics before importing the full app', () => {
    const recorderIndex = source.indexOf('installOdaraEarlyBootRecorder()');
    const importAppIndex = source.indexOf('import("./App.tsx")');

    expect(recorderIndex).toBeGreaterThan(-1);
    expect(importAppIndex).toBeGreaterThan(-1);
    expect(recorderIndex).toBeLessThan(importAppIndex);
    expect(source).not.toContain('import App from "./App.tsx"');
  });

  it('renders safe mode before the Odara app shell when requested', () => {
    expect(source).toContain('isOdaraRecoveryModeSearchEnabled(window.location.search)');
    expect(source).toContain('renderOdaraRecoveryScreen(rootElement');
    expect(source).toContain('getSessionConfirmsSession');
    expect(source).toContain("recordOdaraBootPhase('boot_before_react_render')");
    expect(source).toContain("recordOdaraBootPhase('boot_after_react_render'");
  });
});
