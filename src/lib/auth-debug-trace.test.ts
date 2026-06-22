import { beforeEach, describe, expect, it } from 'vitest';

import { recordOdaraAuthTrace } from './auth-debug-trace';

describe('auth-debug-trace', () => {
  beforeEach(() => {
    delete window.__ODARA_AUTH_TRACE__;
    document.documentElement.removeAttribute('data-odara-auth-trace-length');
    document.documentElement.removeAttribute('data-odara-auth-last-decision');
    document.documentElement.removeAttribute('data-odara-auth-last-source');
    document.documentElement.removeAttribute('data-odara-auth-last-event');
    document.getElementById('odara-auth-trace')?.remove();
    window.localStorage.clear();
  });

  it('records only safe auth metadata in window and DOM surfaces', () => {
    window.localStorage.setItem('vesper_auth_persistence_mode', 'local');

    recordOdaraAuthTrace({
      authReady: true,
      decision: 'apply_session',
      event: 'SIGNED_IN',
      reason: 'unit_test',
      sessionPresent: true,
      source: 'Index',
      storageKeyName: 'sb-test-auth-token',
      userPresent: true,
    });

    expect(window.__ODARA_AUTH_TRACE__).toHaveLength(1);
    expect(window.__ODARA_AUTH_TRACE__?.[0]).toMatchObject({
      decision: 'apply_session',
      event: 'SIGNED_IN',
      sessionPresent: true,
      storageKeyName: 'sb-test-auth-token',
      storageMode: 'local',
      userPresent: true,
    });
    expect(JSON.stringify(window.__ODARA_AUTH_TRACE__)).not.toContain('access_token');
    expect(JSON.stringify(window.__ODARA_AUTH_TRACE__)).not.toContain('refresh_token');
    expect(document.documentElement.dataset.odaraAuthTraceLength).toBe('1');
    expect(document.documentElement.dataset.odaraAuthLastDecision).toBe('apply_session');
    expect(document.documentElement.dataset.odaraAuthLastEvent).toBe('SIGNED_IN');
    expect(document.getElementById('odara-auth-trace')?.textContent).toContain('apply_session');
  });
});
