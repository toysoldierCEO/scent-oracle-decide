import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/AuthDiagnosticPanel.tsx', 'utf8');

describe('AuthDiagnosticPanel', () => {
  it('has an explicit close button that dismisses the diagnostic safely', () => {
    expect(source).toContain("dismissAuthDebugPanel()");
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('aria-label="Close auth diagnostic"');
    expect(source).toContain('type="button"');
    expect(source).toContain('diagnostic_close_button');
  });

  it('offers a same-page diagnostics reopen affordance after close', () => {
    expect(source).toContain('reopenAvailable');
    expect(source).toContain('aria-label="Open Odara diagnostics"');
    expect(source).toContain('diagnostic_reopen_button');
    expect(source).toContain('Diagnostics');
  });

  it('keeps copy summary separate from the close behavior', () => {
    expect(source).toContain("await navigator.clipboard.writeText(summary)");
    expect(source).toContain("{copied ? 'Copied' : 'Copy summary'}");
    expect(source).toContain('Close');
  });
});
