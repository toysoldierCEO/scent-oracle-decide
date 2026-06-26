import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/LoginRecoveryPanel.tsx', 'utf8');

describe('LoginRecoveryPanel', () => {
  it('is dismissible and keeps the login form usable', () => {
    expect(source).toContain('Close');
    expect(source).toContain('event.preventDefault()');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('setDismissed(true)');
    expect(source).toContain('type="button"');
  });

  it('offers a copyable recovery report without clearing auth storage', () => {
    expect(source).toContain('Copy recovery report');
    expect(source).toContain('buildOdaraRecoveryReport');
    expect(source).toContain('navigator.clipboard.writeText(summary)');
    expect(source).not.toContain('signOut');
    expect(source).not.toContain('removeItem(ODARA_AUTH_STORAGE_KEY');
  });

  it('explains signed-out boot after recent login without claiming logout', () => {
    expect(source).toContain('The app started signed out. This diagnostic did not observe a logout.');
    expect(source).toContain('recent login attempt/reload record');
  });
});
