export type AuthStateHydrationDecisionInput = {
  event: string;
  sessionBootstrapResolved: boolean;
  eventHasSession: boolean;
  currentUserPresent: boolean;
};

export type AuthStateHydrationDecision =
  | 'apply_session'
  | 'apply_signed_out'
  | 'ignore_transient_null'
  | 'confirm_signed_out';

export function resolveAuthStateHydrationDecision({
  event,
  sessionBootstrapResolved,
  eventHasSession,
  currentUserPresent: _currentUserPresent,
}: AuthStateHydrationDecisionInput): AuthStateHydrationDecision {
  if (event === 'SIGNED_OUT') return 'apply_signed_out';
  if (eventHasSession) return 'apply_session';
  if (!sessionBootstrapResolved) return 'ignore_transient_null';

  return 'confirm_signed_out';
}

export function shouldApplyAuthStateChangeDuringHydration(input: AuthStateHydrationDecisionInput) {
  const decision = resolveAuthStateHydrationDecision(input);
  return decision === 'apply_session' || decision === 'apply_signed_out';
}

export type AuthSessionBootstrapDecisionInput = {
  bootstrapHasSession: boolean;
  currentUserPresent: boolean;
};

export function shouldApplySessionBootstrapResult({
  bootstrapHasSession,
  currentUserPresent,
}: AuthSessionBootstrapDecisionInput) {
  return bootstrapHasSession || !currentUserPresent;
}
