export const ODARA_BUILD_INFO = {
  commit: import.meta.env.VITE_ODARA_BUILD_COMMIT ?? 'unknown',
  buildTime: import.meta.env.VITE_ODARA_BUILD_TIME ?? 'unknown',
  packageVersion: import.meta.env.PACKAGE_VERSION ?? '0.0.0',
} as const;

declare global {
  interface Window {
    __ODARA_BUILD__?: typeof ODARA_BUILD_INFO;
  }
}

export function exposeOdaraBuildInfo() {
  if (typeof window === 'undefined') return;
  window.__ODARA_BUILD__ = ODARA_BUILD_INFO;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.odaraBuildCommit = ODARA_BUILD_INFO.commit;
    document.documentElement.dataset.odaraBuildTime = ODARA_BUILD_INFO.buildTime;
  }
}
