export type SignedInDayDecisionSource =
  | 'locked'
  | 'manual'
  | 'carryover-main'
  | 'carryover-layer'
  | 'oracle';

export interface ResolveSignedInAddAsTodayGateInput {
  isGuestMode: boolean;
  selectedDayIsPast: boolean;
  hasResolvedLockTruth: boolean;
  resolvedDayDecisionSource?: SignedInDayDecisionSource | null;
}

export function resolveSignedInAddAsTodayLocked({
  isGuestMode,
  hasResolvedLockTruth,
}: Pick<ResolveSignedInAddAsTodayGateInput, 'isGuestMode' | 'hasResolvedLockTruth'>) {
  return !isGuestMode && hasResolvedLockTruth;
}

export function resolveSignedInAddAsTodayDisabledReason({
  isGuestMode,
  selectedDayIsPast,
  hasResolvedLockTruth,
}: ResolveSignedInAddAsTodayGateInput): string | null {
  if (isGuestMode) return null;
  if (selectedDayIsPast) return 'Past days are read-only';
  if (hasResolvedLockTruth) return 'Unlock to preview';
  return null;
}
