/**
 * Normalized access-mode contract — single source of truth for
 * signed-in vs guest state across the entire app.
 */

/** Read-only fallback profile for guest mode browsing */
export const GUEST_FALLBACK_USER_ID = '330006e3-331c-4451-a321-d0e6f3ba454c';

export interface AccessMode {
  /** True when a real authenticated user session exists */
  isSignedIn: boolean;
  /** True when the user tapped "Skip for now" without signing in */
  isGuestMode: boolean;
  /** The user ID to use for read RPCs — real uid when signed in, fallback when guest */
  resolvedUserId: string | null;
  /** Whether the current session may perform authenticated writes */
  canWrite: boolean;
}

/**
 * Resolve access mode from raw auth + guest state.
 * Call once per render cycle; consume the result everywhere.
 */
export function resolveAccessMode(
  user: { id: string; email?: string } | null,
  guestMode: boolean,
): AccessMode {
  const isSignedIn = !!user;
  const isGuestMode = guestMode && !isSignedIn;

  return {
    isSignedIn,
    isGuestMode,
    resolvedUserId: isSignedIn
      ? user!.id
      : isGuestMode
        ? GUEST_FALLBACK_USER_ID
        : null,
    canWrite: isSignedIn,
  };
}
