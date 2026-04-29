/**
 * Subtle haptic feedback for premium single-screen interactions.
 * Uses the Web Vibration API where available (Android Chrome, some PWAs).
 * Silently no-ops on iOS Safari and other unsupported platforms.
 *
 * Patterns are intentionally short and gentle — never buzz-y.
 */

type HapticIntensity = 'light' | 'medium' | 'success' | 'selection';

const PATTERNS: Record<HapticIntensity, number | number[]> = {
  // Lightest possible tap — for selection / promotion.
  selection: 8,
  // Slightly stronger single tap — for star/favorite toggles.
  light: 12,
  // A confident single pulse — for lock engagement.
  medium: 18,
  // Two-step confirmation — for unlock / "saved" moments.
  success: [10, 40, 14],
};

export function haptic(intensity: HapticIntensity = 'light'): void {
  if (typeof window === 'undefined') return;
  const nav: any = window.navigator;
  if (!nav || typeof nav.vibrate !== 'function') return;
  try {
    nav.vibrate(PATTERNS[intensity]);
  } catch {
    /* no-op */
  }
}
