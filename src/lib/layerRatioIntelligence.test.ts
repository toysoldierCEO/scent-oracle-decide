import { describe, expect, it } from 'vitest';

import { resolveLayerRatioGuide } from './layerRatioIntelligence';

const FORBIDDEN_FAKE_PERFORMANCE_COPY = /performance pending|all day|long lasting|projects well/i;

describe('resolveLayerRatioGuide', () => {
  it('keeps Dark Pleasure as lead and California Winter 2018 as a one-spray lift', () => {
    const guide = resolveLayerRatioGuide(
      {
        name: 'Dark Pleasure',
        brand: 'Alexandria Fragrances',
        family_key: 'dark-leather',
        notes: ['Rose', 'Coffee', 'Patchouli', 'Incense'],
      },
      {
        name: 'California Winter 2018',
        brand: 'Alexandria Fragrances',
        family_key: 'fresh-blue',
        notes: ['Citrus', 'Clean Air', 'Musk'],
        projection: 8,
      },
    );

    expect(guide.anchorRole).toBe('Lead');
    expect(guide.companionRole).toBe('Lift');
    expect(guide.ratioValue).toBe('2:1');
    expect(guide.ratioLabel).toBe('2 Dark Pleasure : 1 California Winter 2018');
    expect(guide.anchorPlacement).toContain('2 sprays chest');
    expect(guide.companionPlacement).toContain('1 spray back neck');
    expect(guide.leadEffect).toContain('dark coffee, rose, and patchouli body');
    expect(guide.companionEffect).toContain('adds lift and air');
    expect(guide.airEffect).toContain('warm dark core');
    expect(guide.expectedSmell).toContain('opening the edges');
    expect(guide.combinedExplanation).toContain('California Winter 2018 adds lift and air');
    expect(guide.whyRatio).toContain('strong and airy');
    expect(guide.whyRatio).toContain('one spray keeps that lift controlled');
    expect(guide.matchedRule).toBe('user_override_dark_pleasure_california_winter_2018');
  });

  it('reduces a strong fresh companion to an accent spray', () => {
    const guide = resolveLayerRatioGuide(
      {
        name: 'Dark Anchor',
        family_key: 'dark-leather',
        notes: ['Coffee', 'Patchouli'],
      },
      {
        name: 'Bright Air',
        family_key: 'fresh-aquatic',
        top_notes: ['Bergamot', 'Grapefruit', 'Mint'],
      },
    );

    expect(guide.anchorSprays).toBe(2);
    expect(guide.companionSprays).toBe(1);
    expect(guide.companionRole).toBe('Lift');
    expect(guide.matchedRule).toBe('dominant_companion_2_to_1');
  });

  it('keeps a dense dark anchor in the lead', () => {
    const guide = resolveLayerRatioGuide(
      {
        name: 'Dense Oud',
        family_key: 'oud-amber',
        base_notes: ['Oud', 'Leather', 'Incense'],
      },
      {
        name: 'Resin Spice',
        family_key: 'spicy-warm',
        notes: ['Amber', 'Cedar', 'Pepper'],
      },
    );

    expect(guide.ratioValue).toBe('2:1');
    expect(guide.anchorPlacement).toContain('Dense Oud');
    expect(guide.companionPlacement).toContain('Resin Spice');
    expect(guide.matchedRule).toBe('dense_anchor_2_to_1');
    expect(guide.leadEffect).toContain('dark, textured body');
  });

  it('allows equal soft compatible scents to share a 1:1 ratio', () => {
    const guide = resolveLayerRatioGuide(
      { name: 'Soft Iris', notes: ['Iris', 'Clean Musk'] },
      { name: 'Quiet Tea', notes: ['Tea', 'Soft Musk'] },
    );

    expect(guide.ratioValue).toBe('1:1');
    expect(guide.anchorSprays).toBe(1);
    expect(guide.companionSprays).toBe(1);
    expect(guide.matchedRule).toBe('equal_soft_1_to_1');
  });

  it('keeps a very strong companion to one spray with a 3:1 ratio', () => {
    const guide = resolveLayerRatioGuide(
      { name: 'Smooth Amber', notes: ['Amber', 'Musk'] },
      { name: 'Huge Oud', notes: ['Oud', 'Smoke', 'Leather'], projection: 9 },
    );

    expect(guide.ratioValue).toBe('3:1');
    expect(guide.anchorSprays).toBe(3);
    expect(guide.companionSprays).toBe(1);
    expect(guide.caution).toContain('one spray');
    expect(guide.matchedRule).toBe('very_strong_companion_3_to_1');
  });

  it('allows a strong lead to use fewer sprays while remaining the lead', () => {
    const guide = resolveLayerRatioGuide(
      {
        name: 'Hafez 1984',
        family_key: 'tobacco-boozy',
        notes: ['Tobacco', 'Amber', 'Vanilla', 'Cinnamon'],
        projection: 9,
      },
      {
        name: 'Quiet Musk',
        family_key: 'floral-musk',
        notes: ['Musk', 'Tea', 'Soft Powder'],
      },
    );

    expect(guide.anchorRole).toBe('Lead');
    expect(guide.ratioValue).toBe('1:2');
    expect(guide.anchorSprays).toBe(1);
    expect(guide.companionSprays).toBe(2);
    expect(guide.sprayGuidance).toContain('stays the lead at 1 spray');
    expect(guide.sprayGuidance).toContain('so it can register around it');
    expect(guide.whyRatio).toContain('stays the lead because it defines the blend');
    expect(guide.whyRatio).toContain('gets more air and height');
    expect(guide.matchedRule).toBe('strong_lead_support_needs_space_1_to_2');
  });

  it('gives weak support more spray or higher placement so it can register', () => {
    const guide = resolveLayerRatioGuide(
      {
        name: 'Dark Tobacco',
        family_key: 'tobacco-boozy',
        base_notes: ['Tobacco', 'Patchouli', 'Incense', 'Leather'],
      },
      {
        name: 'Soft Tea Musk',
        family_key: 'floral-musk',
        notes: ['Tea', 'Musk'],
      },
    );

    expect(guide.ratioValue).toBe('1:2');
    expect(guide.anchorPlacement).toContain('1 spray chest');
    expect(guide.companionPlacement).toContain('2 light sprays');
    expect(guide.whyRatio).toContain('support can register');
  });

  it('uses evidence-backed projection to reduce companion sprays', () => {
    const guide = resolveLayerRatioGuide(
      { name: 'Warm Lead', notes: ['Amber', 'Vanilla'] },
      { name: 'Projecting Citrus', notes: ['Bergamot'], projection_score: 8 },
    );

    expect(guide.ratioValue).toBe('2:1');
    expect(guide.companionSprays).toBe(1);
    expect(guide.dominanceReason).toContain('projection');
    expect(guide.matchedRule).toBe('projection_companion_2_to_1');
  });

  it('falls back to notes, accords, and family when performance data is missing', () => {
    const guide = resolveLayerRatioGuide(
      { name: 'Coffee Rose', accords: ['Coffee', 'Patchouli'] },
      { name: 'Fresh Lift', family_label: 'Fresh Aquatic', top_notes: ['Grapefruit', 'Mint'] },
    );

    expect(guide.ratioValue).toBe('2:1');
    expect(guide.companionRole).toBe('Lift');
    expect(guide.whyRatio).not.toMatch(/projection|performance/i);
    expect(guide.combinedExplanation).toContain('In the air');
  });

  it('returns a safe 2:1 default when all scent data is missing', () => {
    const guide = resolveLayerRatioGuide(
      { name: 'Mystery Lead' },
      { name: 'Mystery Accent' },
    );

    expect(guide.ratioValue).toBe('2:1');
    expect(guide.anchorSprays).toBe(2);
    expect(guide.companionSprays).toBe(1);
    expect(guide.matchedRule).toBe('safe_default_2_to_1');
    expect(guide.leadEffect).toContain('sets the identity');
    expect(guide.companionEffect).toContain('supporting dimension');
  });

  it('does not mutate inputs', () => {
    const anchor = {
      name: 'Dark Pleasure',
      notes: ['Rose', 'Coffee', 'Patchouli'],
      accords: [{ label: 'Dark Leather' }],
    };
    const companion = {
      name: 'California Winter 2018',
      notes: ['Citrus', 'Musk'],
      projection: 8,
    };
    const before = structuredClone({ anchor, companion });

    resolveLayerRatioGuide(anchor, companion);

    expect({ anchor, companion }).toEqual(before);
  });

  it('does not introduce fake performance copy', () => {
    const guides = [
      resolveLayerRatioGuide({ name: 'A' }, { name: 'B' }),
      resolveLayerRatioGuide({ name: 'A', notes: ['Oud'] }, { name: 'B', notes: ['Musk'] }),
      resolveLayerRatioGuide({ name: 'A', notes: ['Amber'] }, { name: 'B', top_notes: ['Grapefruit'] }),
    ];

    for (const guide of guides) {
      expect(`${guide.sprayGuidance} ${guide.whyRatio} ${guide.caution ?? ''}`).not.toMatch(FORBIDDEN_FAKE_PERFORMANCE_COPY);
      expect(`${guide.combinedExplanation} ${guide.leadEffect} ${guide.companionEffect}`).not.toMatch(FORBIDDEN_FAKE_PERFORMANCE_COPY);
    }
  });
});
