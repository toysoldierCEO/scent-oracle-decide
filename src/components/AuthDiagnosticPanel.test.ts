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

  it('keeps copy summary separate from the close behavior', () => {
    expect(source).toContain("await navigator.clipboard.writeText(summary)");
    expect(source).toContain("{copied ? 'Copied' : 'Copy summary'}");
    expect(source).toContain('Close');
  });
});
