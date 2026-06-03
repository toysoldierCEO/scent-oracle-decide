export const ODARA_DEBUG = import.meta.env.DEV && import.meta.env.VITE_ODARA_DEBUG === '1';

export function odaraDebugLog(...args: unknown[]) {
  if (!ODARA_DEBUG) return;
  console.log(...args);
}
