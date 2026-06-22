import { describe, expect, it } from 'vitest';
import { shouldApplyAuthStateChangeDuringHydration } from './auth-session-hydration';

describe('auth session hydration', () => {
  it('ignores null auth events until session bootstrap resolves', () => {
    expect(shouldApplyAuthStateChangeDuringHydration({
      sessionBootstrapResolved: false,
      eventHasSession: false,
    })).toBe(false);
  });

  it('accepts session-bearing events before bootstrap finishes', () => {
    expect(shouldApplyAuthStateChangeDuringHydration({
      sessionBootstrapResolved: false,
      eventHasSession: true,
    })).toBe(true);
  });

  it('accepts signed-out state after session bootstrap resolves', () => {
    expect(shouldApplyAuthStateChangeDuringHydration({
      sessionBootstrapResolved: true,
      eventHasSession: false,
    })).toBe(true);
  });
});
