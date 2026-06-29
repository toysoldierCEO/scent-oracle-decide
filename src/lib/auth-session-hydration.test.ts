import { describe, expect, it } from 'vitest';
import {
  resolveAuthStateHydrationDecision,
  shouldClearUserAfterGetUserConfirmation,
  shouldApplySessionBootstrapResult,
  shouldApplyAuthStateChangeDuringHydration,
} from './auth-session-hydration';

describe('auth session hydration', () => {
  it('ignores null auth events until session bootstrap resolves', () => {
    expect(shouldApplyAuthStateChangeDuringHydration({
      event: 'INITIAL_SESSION',
      sessionBootstrapResolved: false,
      eventHasSession: false,
      currentUserPresent: false,
    })).toBe(false);
    expect(resolveAuthStateHydrationDecision({
      event: 'INITIAL_SESSION',
      sessionBootstrapResolved: false,
      eventHasSession: false,
      currentUserPresent: false,
    })).toBe('ignore_transient_null');
  });

  it('accepts session-bearing events before bootstrap finishes', () => {
    expect(shouldApplyAuthStateChangeDuringHydration({
      event: 'INITIAL_SESSION',
      sessionBootstrapResolved: false,
      eventHasSession: true,
      currentUserPresent: false,
    })).toBe(true);
    expect(resolveAuthStateHydrationDecision({
      event: 'INITIAL_SESSION',
      sessionBootstrapResolved: false,
      eventHasSession: true,
      currentUserPresent: false,
    })).toBe('apply_session');
  });

  it('applies normal session-bearing auth events', () => {
    for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED']) {
      expect(resolveAuthStateHydrationDecision({
        event,
        sessionBootstrapResolved: true,
        eventHasSession: true,
        currentUserPresent: true,
      })).toBe('apply_session');
    }
  });

  it('clears user only for explicit signed-out events without confirmation', () => {
    expect(resolveAuthStateHydrationDecision({
      event: 'SIGNED_OUT',
      sessionBootstrapResolved: true,
      eventHasSession: false,
      currentUserPresent: true,
    })).toBe('apply_signed_out');
  });

  it('confirms null non-signout events after bootstrap instead of clearing established users', () => {
    expect(shouldApplyAuthStateChangeDuringHydration({
      event: 'TOKEN_REFRESHED',
      sessionBootstrapResolved: true,
      eventHasSession: false,
      currentUserPresent: true,
    })).toBe(false);
    expect(resolveAuthStateHydrationDecision({
      event: 'TOKEN_REFRESHED',
      sessionBootstrapResolved: true,
      eventHasSession: false,
      currentUserPresent: true,
    })).toBe('confirm_signed_out');
  });

  it('confirms null initial-session events after bootstrap before treating session as absent', () => {
    expect(resolveAuthStateHydrationDecision({
      event: 'INITIAL_SESSION',
      sessionBootstrapResolved: true,
      eventHasSession: false,
      currentUserPresent: false,
    })).toBe('confirm_signed_out');
  });

  it('does not let a late null bootstrap result clear a session-bearing event', () => {
    expect(shouldApplySessionBootstrapResult({
      bootstrapHasSession: false,
      currentUserPresent: true,
    })).toBe(false);
  });

  it('applies bootstrap when it has a session or no user has been established', () => {
    expect(shouldApplySessionBootstrapResult({
      bootstrapHasSession: true,
      currentUserPresent: true,
    })).toBe(true);
    expect(shouldApplySessionBootstrapResult({
      bootstrapHasSession: false,
      currentUserPresent: false,
    })).toBe(true);
  });

  it('keeps an established user when getUser still confirms a user after a null auth event', () => {
    expect(shouldClearUserAfterGetUserConfirmation({
      currentUserPresent: true,
      getUserHasUser: true,
    })).toBe(false);
  });

  it('clears an established user only when getUser confirms the session is invalid', () => {
    expect(shouldClearUserAfterGetUserConfirmation({
      currentUserPresent: true,
      getUserHasUser: false,
      getUserErrorName: 'AuthSessionMissingError',
    })).toBe(true);
    expect(shouldClearUserAfterGetUserConfirmation({
      currentUserPresent: true,
      getUserHasUser: false,
      getUserErrorStatus: 401,
    })).toBe(true);
  });

  it('does not clear an established user for an ambiguous getUser failure', () => {
    expect(shouldClearUserAfterGetUserConfirmation({
      currentUserPresent: true,
      getUserHasUser: false,
      getUserErrorMessage: 'Network request failed',
    })).toBe(false);
  });
});
