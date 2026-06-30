import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Index.tsx', 'utf8');

describe('Index auth storage tracing', () => {
  it('records sign-in submit, result, and immediate auth-key presence checks', () => {
    expect(source).toContain("recordLoginTrace('login_form_rendered'");
    expect(source).toContain("recordLoginTrace('login_submit_clicked'");
    expect(source).toContain("recordLoginTrace('login_submit_prevent_default_applied'");
    expect(source).toContain("recordLoginTrace('login_submit_propagation_stopped'");
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

  it('emits temporary first-five-second login console breadcrumbs', () => {
    expect(source).toContain('LOGIN_CONSOLE_TRACE_WINDOW_MS = 5000');
    expect(source).toContain("console.info('[Odara auth first-5s]'");
    expect(source).toContain('getShortAuthUserId(payload.sessionUserId');
    expect(source).toContain("startLoginConsoleTrace(isSignUp ? 'email_signup_submit' : 'password_sign_in_submit')");
    expect(source).toContain("startLoginConsoleTrace('google_oauth_submit')");
    expect(source).toContain("emitLoginConsoleTrace('auth_state_event'");
    expect(source).toContain("emitLoginConsoleTrace('route_decision'");
    expect(source).toContain("emitLoginConsoleTrace('oracle_rpc_error'");
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

  it('requires getUser confirmation before clearing an established user after null non-signout auth events', () => {
    expect(source).toContain('shouldClearUserAfterGetUserConfirmation');
    expect(source).toContain('await odaraSupabase.auth.getUser()');
    expect(source).toContain("decision: shouldClear ? 'confirmed-signed-out' : 'confirmed-user-retained'");
    expect(source).toContain("clearCaller: shouldClear ? `confirm:${sourceEvent}` : undefined");
    expect(source).toContain("getSessionResult: 'null'");
    expect(source).toContain("getUserResult: getUserHasUser ? 'valid'");
  });

  it('records crash-safe login recovery breadcrumbs and shows the recovery panel on signed-out boot', () => {
    expect(source).toContain('recordOdaraLoginRecoveryEvent');
    expect(source).toContain("decision: 'possible_login_persistence_failure'");
    expect(source).toContain('shouldAutoShowOdaraRecoveryPanel');
    expect(source).toContain('<LoginRecoveryPanel userPresent={Boolean(user)} />');
  });

  it('records safe failed-login errors without signing out or scheduling reload', () => {
    expect(source).toContain('summarizeSafeAuthError(err)');
    expect(source).toContain("setAuthError(safeError.displayMessage)");
    expect(source).toContain("recordLoginTrace('after_error_ui_rendered'");
    expect(source).toContain("recordLoginTrace('after_error_no_reload_scheduled'");
    expect(source).toContain('errorCategory: safeError.category');
    expect(source).toContain('errorStatus: safeError.status');
    expect(source).toContain('toSafeLoginRecoveryReasonLabel(reason)');

    const passwordErrorSnippet = source.slice(
      source.indexOf("recordLoginTrace('login_request_result_error', 'password_sign_in_error'"),
      source.indexOf("} else {\n        recordLoginTrace('login_request_result_success', 'password_sign_in_result'"),
    );
    expect(passwordErrorSnippet).not.toContain('signOut');
    expect(passwordErrorSnippet).not.toContain('removeItem');
    expect(passwordErrorSnippet).not.toContain('window.location');
  });

  it('uses resolved runtime redirect origin instead of hardcoding auth redirects to the shared preview', () => {
    expect(source).toContain('resolveOdaraAuthRedirectOrigin(window.location.origin)');
    expect(source).toContain('options: { redirectTo: authRedirectOrigin }');
    expect(source).toContain('emailRedirectTo: authRedirectOrigin');
    expect(source).not.toContain('options: { redirectTo: ODARA_SHARED_PREVIEW_ORIGIN }');
    expect(source).not.toContain('emailRedirectTo: ODARA_SHARED_PREVIEW_ORIGIN');
  });
});
