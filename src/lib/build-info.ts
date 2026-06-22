declare const __ODARA_BUILD_COMMIT__: string;
declare const __ODARA_BUILD_TIME__: string;

export const ODARA_BUILD_INFO = {
  commit: typeof __ODARA_BUILD_COMMIT__ === 'string' ? __ODARA_BUILD_COMMIT__ : 'unknown',
  buildTime: typeof __ODARA_BUILD_TIME__ === 'string' ? __ODARA_BUILD_TIME__ : 'unknown',
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
}
