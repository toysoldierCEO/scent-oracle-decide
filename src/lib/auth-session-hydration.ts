export type AuthStateHydrationDecisionInput = {
  sessionBootstrapResolved: boolean;
  eventHasSession: boolean;
};

export function shouldApplyAuthStateChangeDuringHydration({
  sessionBootstrapResolved,
  eventHasSession,
}: AuthStateHydrationDecisionInput) {
  return sessionBootstrapResolved || eventHasSession;
}
