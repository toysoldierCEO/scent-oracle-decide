/**
 * Normalized access-mode contract — single source of truth for
 * signed-in vs guest state across the entire app.
 */

/** Read-only fallback profile for guest mode browsing */
export const GUEST_FALLBACK_USER_ID = '330006e3-331c-4451-a321-d0e6f3ba454c';
export const ODARA_GUEST_OVERRIDE_STORAGE_KEY = 'odara_guest_override_v1';

export interface AccessMode {
  /** True when a real authenticated user session exists, even if guest override is active */
  hasAuthenticatedSession: boolean;
  /** True when authenticated behavior is active for this app session */
  isSignedIn: boolean;
  /** True when the user tapped "Skip for now" for this app session */
  isGuestMode: boolean;
  /** Real authenticated user ID when a session exists */
  signedInUserId: string | null;
  /** Read identity for home-oracle slot scoping — real uid when signed in, fallback when guest */
  resolvedUserId: string | null;
  /** Whether the current session may perform authenticated writes */
  canWrite: boolean;
}

export function readGuestOverride(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(ODARA_GUEST_OVERRIDE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeGuestOverride(enabled: boolean) {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) {
      window.sessionStorage.setItem(ODARA_GUEST_OVERRIDE_STORAGE_KEY, '1');
    } else {
      window.sessionStorage.removeItem(ODARA_GUEST_OVERRIDE_STORAGE_KEY);
    }
  } catch {
    /* ignore storage failures */
  }
}

/**
 * Resolve access mode from raw auth + guest state.
 * Call once per render cycle; consume the result everywhere.
 */
export function resolveAccessMode(
  user: { id: string; email?: string } | null,
  guestMode: boolean,
): AccessMode {
  const hasAuthenticatedSession = !!user;
  const isGuestMode = guestMode;
  const isSignedIn = hasAuthenticatedSession && !isGuestMode;
  const signedInUserId = hasAuthenticatedSession ? user!.id : null;

  return {
    hasAuthenticatedSession,
    isSignedIn,
    isGuestMode,
    signedInUserId,
    resolvedUserId: isSignedIn
      ? signedInUserId
      : isGuestMode
        ? GUEST_FALLBACK_USER_ID
        : null,
    canWrite: isSignedIn,
  };
}
