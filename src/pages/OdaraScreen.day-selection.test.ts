import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/OdaraScreen.tsx', 'utf8');

describe('OdaraScreen day selection auth safety', () => {
  it('keeps navigation day cells as non-submitting buttons', () => {
    const dayRailSnippet = source.slice(
      source.indexOf('{navigationDays.map'),
      source.indexOf('<OdaraDayMoonPhaseIcon'),
    );

    expect(dayRailSnippet).toContain('type="button"');
    expect(dayRailSnippet).toContain('event.preventDefault()');
    expect(dayRailSnippet).toContain("decision: 'day_tap_prevent_default_applied'");
    expect(dayRailSnippet).toContain('selectNavigationDay(fd.dateStr)');
  });

  it('exposes the mobile auth diagnostic from the signed-in wordmark without hijacking the occasion picker', () => {
    const wordmarkSnippet = source.slice(
      source.indexOf('ref={occasionSelectorRef}'),
      source.indexOf('aria-label={`Select occasion'),
    );
    expect(wordmarkSnippet).toContain('data-odara-auth-debug-trigger');
    expect(source).toContain('data-odara-auth-debug-ignore');
  });

  it('records safe day-tap breadcrumbs before dispatching the selected date change', () => {
    const handlerSnippet = source.slice(
      source.indexOf('const selectNavigationDay'),
      source.indexOf('useEffect(() => {\n    if (!searchOpen) return;'),
    );

    expect(handlerSnippet).toContain("decision: 'day_tap_start'");
    expect(handlerSnippet).toContain("decision: 'selectedDate_before'");
    expect(handlerSnippet).toContain("decision: 'setSelectedDate_called'");
    expect(handlerSnippet).toContain("decision: 'selectedDate_after'");
    expect(handlerSnippet).toContain("source: 'day-selection'");
    expect(handlerSnippet).toContain('previousDate: selectedDate');
    expect(handlerSnippet).toContain('targetDate: dateStr');
    expect(handlerSnippet).not.toContain('signOut');
    expect(handlerSnippet).not.toContain('setGuestOverride');
  });
});
