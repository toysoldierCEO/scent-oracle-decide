import { describe, expect, it } from 'vitest';

import {
  ODARA_ALLOWED_SIGN_OUT_ACTION_ID,
  resolveSignOutGuard,
} from './auth-sign-out-guard';

describe('auth sign-out guard', () => {
  it('allows only the explicit menu sign-out action id', () => {
    expect(resolveSignOutGuard({
      actionId: ODARA_ALLOWED_SIGN_OUT_ACTION_ID,
      caller: 'OdaraScreen.root_menu.auth_action',
      targetLabel: 'Sign out',
    })).toMatchObject({
      allowed: true,
      reason: 'menu_sign_out_button',
    });
  });

  it('blocks missing action ids before Supabase signOut can run', () => {
    expect(resolveSignOutGuard(null)).toMatchObject({
      allowed: false,
      reason: 'missing_action_id',
    });
  });

  it('blocks unexpected action ids before Supabase signOut can run', () => {
    expect(resolveSignOutGuard({
      actionId: 'guest_override_toggle',
      caller: 'access-mode',
      targetLabel: 'Skip for now',
    })).toMatchObject({
      actionId: 'guest_override_toggle',
      allowed: false,
      reason: 'unexpected_action_id',
    });
  });
});
