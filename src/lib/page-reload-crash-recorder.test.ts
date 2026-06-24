import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY,
  installOdaraReloadCrashRecorder,
  readPersistedOdaraReloadCrashTrace,
  recordOdaraReloadCrashEvent,
  updateOdaraReloadCrashContext,
} from './page-reload-crash-recorder';

describe('page-reload-crash-recorder', () => {
  beforeEach(() => {
    delete window.__ODARA_RELOAD_CRASH_CONTEXT__;
    delete window.__ODARA_RELOAD_CRASH_RECORDER_INSTALLED__;
    delete window.__ODARA_RELOAD_CRASH_TRACE__;
    document.body.innerHTML = '';
    document.getElementById('odara-reload-crash-trace')?.remove();
    document.documentElement.removeAttribute('data-odara-reload-crash-trace-length');
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('persists safe reload and interaction breadcrumbs across reload-like remounts', () => {
    updateOdaraReloadCrashContext({
      accessMode: 'signed-in',
      authReady: true,
      detailLabel: 'Not For Sale / Alexandria Fragrances',
      detailOpen: true,
      selectedDate: '2026-06-24',
      userPresent: true,
    });

    recordOdaraReloadCrashEvent({
      decision: 'pagehide',
      event: 'pagehide',
      persisted: false,
      reason: 'page_lifecycle',
      source: 'page',
    });

    expect(window.localStorage.getItem(ODARA_RELOAD_CRASH_TRACE_STORAGE_KEY)).toContain('pagehide');
    expect(readPersistedOdaraReloadCrashTrace()).toHaveLength(1);
    delete window.__ODARA_RELOAD_CRASH_TRACE__;

    recordOdaraReloadCrashEvent({
      decision: 'page_mount_after_reload',
      event: 'app_mount',
      reason: 'app_mount',
      source: 'page',
    });

    expect(window.__ODARA_RELOAD_CRASH_TRACE__).toHaveLength(2);
    expect(window.__ODARA_RELOAD_CRASH_TRACE__?.[0]).toMatchObject({
      decision: 'pagehide',
      detailLabel: 'Not For Sale / Alexandria Fragrances',
      persisted: false,
      selectedDate: '2026-06-24',
      userPresent: true,
    });
    expect(document.documentElement.dataset.odaraReloadCrashTraceLength).toBe('2');
  });

  it('redacts secrets and emails from runtime error breadcrumbs', () => {
    recordOdaraReloadCrashEvent({
      errorMessage: 'access_token=secret refresh_token=secret user@example.test',
      errorName: 'Error',
      event: 'error',
      reason: 'window_error',
      source: 'runtime-error',
    });

    const serialized = JSON.stringify(window.__ODARA_RELOAD_CRASH_TRACE__);
    expect(serialized).toContain('[redacted]');
    expect(serialized).not.toContain('access_token=secret');
    expect(serialized).not.toContain('refresh_token=secret');
    expect(serialized).not.toContain('user@example.test');
  });

  it('captures pointer labels without raw input values', () => {
    const cleanup = installOdaraReloadCrashRecorder();
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Open Collection');
    button.textContent = 'Open Collection';
    document.body.appendChild(button);

    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    button.click();

    const serialized = JSON.stringify(window.__ODARA_RELOAD_CRASH_TRACE__);
    expect(serialized).toContain('Open Collection');
    expect(serialized).toContain('pointerdown');
    expect(serialized).toContain('click');
    cleanup();
  });

  it('installs safe lifecycle and error listeners once', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const cleanup = installOdaraReloadCrashRecorder();
    installOdaraReloadCrashRecorder();

    expect(addSpy.mock.calls.filter(([event]) => event === 'pagehide')).toHaveLength(1);
    expect(addSpy.mock.calls.filter(([event]) => event === 'unhandledrejection')).toHaveLength(1);
    cleanup();
    addSpy.mockRestore();
  });
});
