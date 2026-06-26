import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ODARA_AUTH_TRACE_STORAGE_KEY } from './auth-debug-trace';
import {
  ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY,
  clearOdaraRecoveryLogs,
  hasRecentLoginAttempt,
  installOdaraEarlyBootRecorder,
  isOdaraRecoveryModeSearchEnabled,
  readPersistedOdaraLoginRecoveryTrace,
  recordOdaraLoginRecoveryEvent,
  renderOdaraRecoveryScreen,
  shouldAutoShowOdaraRecoveryPanel,
} from './login-recovery-diagnostics';
import { ODARA_AUTH_STORAGE_KEY } from './odara-auth-constants';
import { ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY, recordOdaraReloadCrashEvent } from './page-reload-crash-recorder';

describe('login recovery diagnostics', () => {
  beforeEach(() => {
    delete window.__ODARA_EARLY_BOOT_RECORDER_INSTALLED__;
    delete window.__ODARA_LOGIN_RECOVERY_TRACE__;
    delete window.__ODARA_AUTH_TRACE__;
    delete window.__ODARA_RELOAD_CRASH_TRACE__;
    document.body.innerHTML = '<div id="root"></div>';
    document.documentElement.removeAttribute('data-odara-login-recovery-trace-length');
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('recognizes safe-mode recovery query params', () => {
    expect(isOdaraRecoveryModeSearchEnabled('?odaraSafeMode=1')).toBe(true);
    expect(isOdaraRecoveryModeSearchEnabled('?odaraRecovery=true')).toBe(true);
    expect(isOdaraRecoveryModeSearchEnabled('?odaraSafeMode=0')).toBe(false);
    expect(isOdaraRecoveryModeSearchEnabled('?other=1')).toBe(false);
  });

  it('persists login breadcrumbs across reload-like remounts without secrets', () => {
    recordOdaraLoginRecoveryEvent({
      decision: 'login_submit_clicked',
      errorMessage: 'access_token=secret user@example.test',
      reason: 'password_sign_in_submit',
      source: 'login',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });

    expect(hasRecentLoginAttempt()).toBe(true);
    expect(window.localStorage.getItem(ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY)).toContain('login_submit_clicked');
    expect(window.localStorage.getItem(ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY)).not.toContain('access_token=secret');
    expect(window.localStorage.getItem(ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY)).not.toContain('user@example.test');

    delete window.__ODARA_LOGIN_RECOVERY_TRACE__;
    expect(readPersistedOdaraLoginRecoveryTrace()).toHaveLength(1);
  });

  it('auto-shows recovery after a recent login attempt signed-out boot with no auth key', () => {
    recordOdaraLoginRecoveryEvent({
      decision: 'login_request_started',
      reason: 'password_sign_in_request_started',
      source: 'login',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });

    expect(shouldAutoShowOdaraRecoveryPanel({
      localAuthKeyExists: false,
      sessionAuthKeyExists: false,
      userPresent: false,
    })).toBe(true);

    expect(shouldAutoShowOdaraRecoveryPanel({
      localAuthKeyExists: true,
      sessionAuthKeyExists: false,
      userPresent: false,
    })).toBe(false);
  });

  it('installs early boot recorder and captures runtime errors', () => {
    installOdaraEarlyBootRecorder();
    installOdaraEarlyBootRecorder();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));

    const trace = readPersistedOdaraLoginRecoveryTrace();
    expect(trace.some((entry) => entry.decision === 'boot_start')).toBe(true);
    expect(trace.some((entry) => entry.decision === 'auth_key_presence_at_boot')).toBe(true);
    expect(trace.filter((entry) => entry.decision === 'boot_start')).toHaveLength(1);
    expect(trace.some((entry) => entry.decision === 'runtime_error')).toBe(true);
  });

  it('renders safe mode without the full app and supports copy/clear/continue controls', async () => {
    const root = document.getElementById('root')!;
    const onContinue = vi.fn();
    renderOdaraRecoveryScreen(root, {
      getSessionConfirmsSession: async () => false,
      onContinue,
    });

    expect(root.textContent).toContain('Odara Recovery Diagnostics');
    expect(root.textContent).toContain('Lightweight safe mode');
    expect(root.textContent).toContain('Copy recovery report');
    expect(root.textContent).toContain('Clear recovery logs');
    expect(root.textContent).toContain('Continue to app');
    expect(root.textContent).toContain('It does not load Collection');

    const buttons = Array.from(root.querySelectorAll('button'));
    expect(buttons.every((button) => button.type === 'button')).toBe(true);

    buttons.find((button) => button.textContent === 'Copy recovery report')?.click();
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    window.localStorage.setItem(ODARA_AUTH_STORAGE_KEY, 'auth-value-must-stay');
    window.localStorage.setItem(ODARA_AUTH_TRACE_STORAGE_KEY, '[{"decision":"test"}]');
    window.localStorage.setItem(ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY, '[{"decision":"test"}]');
    buttons.find((button) => button.textContent === 'Clear recovery logs')?.click();
    expect(window.localStorage.getItem(ODARA_AUTH_STORAGE_KEY)).toBe('auth-value-must-stay');
    expect(window.localStorage.getItem(ODARA_AUTH_TRACE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(ODARA_LOGIN_RECOVERY_TRACE_STORAGE_KEY)).toBeNull();

    buttons.find((button) => button.textContent === 'Continue to app')?.click();
    expect(onContinue).toHaveBeenCalled();
  });

  it('uses reload/crash events as supporting recovery evidence', () => {
    recordOdaraLoginRecoveryEvent({
      decision: 'login_request_started',
      reason: 'password_sign_in_request_started',
      source: 'login',
      storageKeyName: ODARA_AUTH_STORAGE_KEY,
    });
    recordOdaraReloadCrashEvent({
      decision: 'pagehide',
      event: 'pagehide',
      reason: 'page_lifecycle',
      source: 'page',
    });

    expect(shouldAutoShowOdaraRecoveryPanel({
      localAuthKeyExists: true,
      sessionAuthKeyExists: false,
      userPresent: false,
    })).toBe(true);
  });
});
