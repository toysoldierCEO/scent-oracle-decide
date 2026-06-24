export const ODARA_ALLOWED_SIGN_OUT_ACTION_ID = 'menu_sign_out_button';

export type OdaraSignOutRequest = {
  actionId?: string | null;
  caller?: string | null;
  defaultPrevented?: boolean | null;
  menuOpen?: boolean | null;
  pointerType?: string | null;
  propagationStopped?: boolean | null;
  targetLabel?: string | null;
};

export type OdaraSignOutGuardDecision = {
  actionId: string | null;
  allowed: boolean;
  reason: 'menu_sign_out_button' | 'missing_action_id' | 'unexpected_action_id';
};

export function resolveSignOutGuard(request: OdaraSignOutRequest | null | undefined): OdaraSignOutGuardDecision {
  const actionId = request?.actionId ?? null;
  if (!actionId) {
    return {
      actionId,
      allowed: false,
      reason: 'missing_action_id',
    };
  }

  if (actionId !== ODARA_ALLOWED_SIGN_OUT_ACTION_ID) {
    return {
      actionId,
      allowed: false,
      reason: 'unexpected_action_id',
    };
  }

  return {
    actionId,
    allowed: true,
    reason: 'menu_sign_out_button',
  };
}
