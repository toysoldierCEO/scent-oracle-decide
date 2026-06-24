import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/OdaraScreen.tsx', 'utf8');

describe('OdaraScreen sign-out safety', () => {
  it('requires the root menu auth action to send an explicit sign-out request', () => {
    const signOutActionIndex = source.indexOf('data-menu-action="sign-out"');
    const signOutSnippet = source.slice(
      source.lastIndexOf('<button', signOutActionIndex),
      source.indexOf('<span>{shellAuthActionLabel}</span>'),
    );

    expect(signOutSnippet).toContain('type="button"');
    expect(signOutSnippet).toContain('event.preventDefault()');
    expect(signOutSnippet).toContain('event.stopPropagation()');
    expect(signOutSnippet).toContain('ODARA_ALLOWED_SIGN_OUT_ACTION_ID');
    expect(signOutSnippet).toContain("caller: 'OdaraScreen.root_menu.auth_action'");
    expect(source).not.toContain('onSignOut();');
  });

  it('keeps non-signout menu rows isolated from the sign-out action', () => {
    const menuRowsSnippet = source.slice(
      source.indexOf("{ key: 'profile', label: 'Profile' }"),
      source.indexOf('data-menu-action="sign-out"'),
    );

    expect(menuRowsSnippet).toContain('data-menu-action={`open-${item.key}`}');
    expect(menuRowsSnippet).toContain('event.preventDefault()');
    expect(menuRowsSnippet).toContain('event.stopPropagation()');
    expect(menuRowsSnippet).not.toContain('onSignOut');
    expect(menuRowsSnippet).not.toContain('ODARA_ALLOWED_SIGN_OUT_ACTION_ID');
  });
});
