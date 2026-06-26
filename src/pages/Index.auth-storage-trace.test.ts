import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Index.tsx', 'utf8');

describe('Index auth storage tracing', () => {
  it('records sign-in submit, result, and immediate auth-key presence checks', () => {
    expect(source).toContain("recordLoginTrace('login_form_rendered'");
    expect(source).toContain("recordLoginTrace('login_submit_clicked'");
    expect(source).toContain("recordLoginTrace('login_submit_prevent_default_applied'");
    expect(source).toContain("recordLoginTrace('login_request_started'");
    expect(source).toContain("recordLoginTrace('login_request_result_success'");
    expect(source).toContain("recordLoginTrace('login_request_result_error'");
    expect(source).toContain("recordLoginTrace('login_result_session_present'");
    expect(source).toContain("decision: 'sign_in_submit'");
    expect(source).toContain("decision: 'sign_in_result_success'");
    expect(source).toContain("decision: 'sign_in_result_error'");
    expect(source).toContain("decision: 'auth_key_exists_immediately_after_sign_in'");
    expect(source).toContain("recordLoginTrace('auth_key_exists_immediately_after_login'");
    expect(source).toContain("recordLoginTrace('getSession_immediately_after_login'");
  });

  it('guards Supabase sign-out behind an explicit menu action id', () => {
    expect(source).toContain('resolveSignOutGuard(request)');
    expect(source).toContain("decision: 'sign_out_blocked'");
    expect(source).toContain("reason: guard.reason");
    expect(source).toContain('await odaraSupabase.auth.signOut()');
    expect(source).not.toContain("reason: 'explicit_menu_action'");
  });

  it('does not log a guest override toggle when signed-in sign-out has no guest override to clear', () => {
    expect(source).toContain("if (guestMode) {\n      setGuestOverride(false, 'menu_sign_out_clear_guest_override');\n    }");
    expect(source).toContain("decision: changed\n        ? (enabled ? 'enabled' : 'disabled')\n        : (enabled ? 'already_enabled' : 'already_disabled')");
  });

  it('records reload storage and session checks without raw session output', () => {
    expect(source).toContain("decision: hadPersistedTrace ? 'page_mount_after_reload' : 'loaded'");
    expect(source).toContain("decision: 'auth_key_exists_after_reload'");
    expect(source).toContain("decision: 'getSession_after_reload'");
    expect(source).toContain("decision: 'app_mount_after_login_reload'");
    expect(source).toContain("decision: 'session_after_login_reload'");
    expect(source).toContain("decision: 'url_has_auth_params'");
    expect(source).not.toContain('JSON.stringify(session)');
  });

  it('records crash-safe login recovery breadcrumbs and shows the recovery panel on signed-out boot', () => {
    expect(source).toContain('recordOdaraLoginRecoveryEvent');
    expect(source).toContain("decision: 'possible_login_persistence_failure'");
    expect(source).toContain('shouldAutoShowOdaraRecoveryPanel');
    expect(source).toContain('<LoginRecoveryPanel userPresent={Boolean(user)} />');
  });

  it('uses resolved runtime redirect origin instead of hardcoding auth redirects to the shared preview', () => {
    expect(source).toContain('resolveOdaraAuthRedirectOrigin(window.location.origin)');
    expect(source).toContain('options: { redirectTo: authRedirectOrigin }');
    expect(source).toContain('emailRedirectTo: authRedirectOrigin');
    expect(source).not.toContain('options: { redirectTo: ODARA_SHARED_PREVIEW_ORIGIN }');
    expect(source).not.toContain('emailRedirectTo: ODARA_SHARED_PREVIEW_ORIGIN');
  });
});
