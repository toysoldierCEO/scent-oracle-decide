import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, './OdaraScreen.tsx'), 'utf8');

describe('OdaraScreen wear mode gating', () => {
  it('uses the shared seven-scent layering eligibility policy', () => {
    expect(source).toContain("from \"@/lib/wearModeEligibility\"");
    expect(source).toContain("from \"@/lib/soloWearGuide\"");
    expect(source).toContain('resolveLayeringEligibility(signedInWearModeCollectionItems)');
    expect(source).toContain('resolveLayeringEligibility(wardrobeCards)');
    expect(source).toContain('LAYERING_UNLOCK_COUNT');
  });

  it('defaults to Solo and persists Wear Mode only when layering is unlocked', () => {
    expect(source).toContain("const [wearMode, setWearMode] = useState<WearMode>(() => readStoredWearModePreference())");
    expect(source).toContain("const effectiveWearMode: WearMode = isWearModeLayeringUnlocked ? wearMode : 'solo'");
    expect(source).toContain("if (!isWearModeLayeringUnlocked && wearMode !== 'solo')");
    expect(source).toContain('writeStoredWearModePreference(wearMode)');
  });

  it('hides Layered UI below threshold and renders Solo as a first-class guide', () => {
    expect(source).toContain('const showWearModeToggle = !isGuestMode && isWearModeLayeringUnlocked');
    expect(source).toContain("const showSoloWearGuide = !!visibleResolvedCurrentCard && effectiveWearMode === 'solo'");
    expect(source).toContain("const showLayeredWearGuide = !!visibleResolvedLayer && effectiveWearMode === 'layered' && isWearModeLayeringUnlocked");
    expect(source).toContain('data-wear-mode-toggle');
    expect(source).toContain('data-solo-wear-guide');
    expect(source).toContain('Wear Solo');
    expect(source).toContain('const soloWearGuide = useMemo(() => resolveSoloWearGuide');
    expect(source).toContain('soloWearGuide.placement');
    expect(source).toContain('soloWearGuide.whyItWorks');
  });

  it('derives the Solo guide from the currently selected scent so alternates update it', () => {
    expect(source).toContain('name: visibleResolvedCurrentCard?.name ?? null');
    expect(source).toContain('brand: visibleResolvedCurrentCard?.brand ?? null');
    expect(source).toContain('family: visibleResolvedCurrentCard?.family ?? null');
    expect(source).toContain('visibleResolvedCurrentCard?.accords');
    expect(source).toContain('visibleResolvedCurrentCard?.notes');
  });

  it('shows Collection progress only while layering is locked', () => {
    expect(source).toContain('data-layering-unlock-note');
    expect(source).toContain('scents toward layering');
    expect(source).toContain('to unlock layering.');
    expect(source).toContain('wardrobeLayeringEligibility.isLayeringUnlocked');
  });

  it('does not introduce fake performance copy', () => {
    expect(source.toLowerCase()).not.toContain('performance pending');
  });
});
