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

  it('keeps diagnostics reachable from menu and detail states when debug mode is enabled', () => {
    expect(source).toContain('readAuthDebugEnabled');
    expect(source).toContain('setAuthDebugEnabled(true)');
    expect(source).toContain('root_menu_diagnostics_button');
    expect(source).toContain('detail_footer_diagnostics_button');
    expect(source).toContain('Open diagnostics');
  });

  it('does not clear an established Index user from the secondary auth hook on getSession null alone', () => {
    expect(source).toContain('shouldClearUserAfterGetUserConfirmation');
    expect(source).toContain('const propUserId = normalizeOdaraAuthUserId(userId);');
    expect(source).toContain('Boolean(activeSessionUserRef.current) || Boolean(propUserId)');
    expect(source).toContain('await odaraSupabase.auth.getUser()');
    expect(source).toContain("decision: shouldClear ? 'confirmed-signed-out' : 'confirmed-user-retained'");
    expect(source).toContain('normalizeOdaraAuthUserId(activeSessionUser?.id) ?? (!isGuestMode ? propUserId : null)');
  });

  it('records detail community counters that identify where Sienna evidence is lost', () => {
    expect(source).toContain('approvedFragranticaRowPresent');
    expect(source).toContain('cacheKey');
    expect(source).toContain('detailFetchStatus');
    expect(source).toContain('intelligenceFetchSuccess');
    expect(source).toContain('renderedAccordsSection');
    expect(source).toContain('renderedCommunitySignalsSection');
    expect(source).toContain('renderedCommunitySourceLabel');
  });

  it('renders community signals from the policy-visible evidence model when they are allowed', () => {
    expect(source).toContain('detailAccordLabels.slice(0, 12)');
    expect(source).toContain('visibleCommunityEvidence.communityNotes.slice(0, 12)');
    expect(source).not.toContain('detailAccordLabels.slice(0, 8)');
    expect(source).not.toContain('visibleCommunityEvidence.communityNotes.slice(0, 8)');
  });

  it('uses policy-approved provider accord provenance in the visible detail trust line', () => {
    expect(source).toContain('detailDisplayModel.accordSourceTrustLine');
    expect(source).toContain('visibleCommunityEvidence?.trustLine');
  });

  it('enriches signed-in layer cards with pair-scored combination reasoning', () => {
    expect(source).toContain('scoreLayerCombination');
    expect(source).toContain('applyLayerCombinationScoreToMode');
    expect(source).toContain('buildLayerCombinationProfileFromDisplayCard');
    expect(source).toContain('buildLayerCombinationProfileFromLayerMode');
    expect(source).toContain('finalLayer = applyLayerCombinationScoreToMode');
    expect(source).toContain('projectionEvidenceBacked');
  });

  it('does not cancel wardrobe detail hydration when marking the selected fragrance loading', () => {
    expect(source).toContain('const detailHydrationByIdRef = useRef(detailHydrationById)');
    expect(source).toContain('detailHydrationByIdRef.current = detailHydrationById');
    expect(source).toContain('const existing = detailHydrationByIdRef.current[selectedFragranceId]');

    const hydrationEffectSnippet = source.slice(
      source.indexOf("if (surface !== 'detail' || !selectedFragranceId || !activeSessionUserId) return;"),
      source.indexOf('const timeoutId = window.setTimeout'),
    );
    expect(hydrationEffectSnippet).toContain('setDetailHydrationById');
    expect(hydrationEffectSnippet).toContain('fetchOdaraFragranceDetailForSurface');
    expect(hydrationEffectSnippet).toContain('}, [activeSessionUserId, selectedFragranceId, surface]);');
    expect(hydrationEffectSnippet).not.toContain('detailHydrationById, selectedFragranceId');
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
