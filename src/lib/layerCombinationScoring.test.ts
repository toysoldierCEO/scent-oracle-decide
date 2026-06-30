import { describe, expect, it } from 'vitest';

import {
  scoreLayerCombination,
  type LayerCombinationProfile,
} from './layerCombinationScoring';

const siennaBrume: LayerCombinationProfile = {
  id: 'sienna',
  name: 'Sienna Brume',
  brand: 'Mihan Aromatics',
  familyKey: 'fresh-aquatic',
  owned: true,
  notes: ['Sea Air', 'Bergamot', 'Soft Coconut', 'Cucumber', 'Vanilla', 'Copaiba', 'Juniper Berry'],
  topNotes: ['Sea Air', 'Bergamot'],
  heartNotes: ['Soft Coconut', 'Cucumber'],
  baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
  accords: [],
  communityAccords: ['coconut', 'green', 'ozonic', 'aquatic', 'aromatic'],
};

const amberWoods: LayerCombinationProfile = {
  id: 'amber-woods',
  name: 'Amber Woods',
  brand: 'Fixture House',
  familyKey: 'woody-amber',
  owned: true,
  notes: ['Amber', 'Vanilla', 'Cedar', 'Musk'],
  topNotes: ['Bergamot'],
  heartNotes: ['Musk'],
  baseNotes: ['Amber', 'Vanilla', 'Cedar'],
  providerStructuredAccords: ['amber', 'woody', 'musky'],
};

const sharpLeatherOud: LayerCombinationProfile = {
  id: 'leather-oud',
  name: 'Black Oud Leather',
  brand: 'Fixture House',
  familyKey: 'leather-oud',
  owned: true,
  notes: ['Oud', 'Leather', 'Smoke', 'Saffron'],
  topNotes: ['Saffron'],
  heartNotes: ['Leather'],
  baseNotes: ['Oud', 'Smoke', 'Labdanum'],
  providerStructuredAccords: ['oud', 'leather', 'smoky'],
};

const sweetGourmand: LayerCombinationProfile = {
  id: 'sweet-gourmand',
  name: 'Vanilla Caramel',
  brand: 'Fixture House',
  familyKey: 'gourmand',
  owned: true,
  notes: ['Vanilla', 'Caramel', 'Honey', 'Tonka'],
  topNotes: ['Honey'],
  heartNotes: ['Caramel'],
  baseNotes: ['Vanilla', 'Tonka'],
  providerStructuredAccords: ['sweet', 'gourmand', 'vanilla'],
};

const freshLift: LayerCombinationProfile = {
  id: 'fresh-lift',
  name: 'Green Citrus Musk',
  brand: 'Fixture House',
  familyKey: 'fresh-aromatic',
  owned: true,
  notes: ['Bergamot', 'Green Tea', 'Musk', 'Cedar'],
  topNotes: ['Bergamot', 'Lemon'],
  heartNotes: ['Green Tea', 'Musk'],
  baseNotes: ['Cedar'],
  providerStructuredAccords: ['green', 'citrus', 'musky', 'woody'],
};

describe('layerCombinationScoring', () => {
  it('excludes scents that should not enter the owned Collection layer pool', () => {
    expect(scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: { ...amberWoods, retired: true },
    }).exclusions).toContain('b_retired');

    expect(scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: { ...amberWoods, disliked: true },
    }).eligible).toBe(false);

    expect(scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: { ...amberWoods, wishlistOnly: true },
    }).exclusions).toContain('b_wishlist_only');

    expect(scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: { ...amberWoods, unresolved: true },
    }).score).toBe(0);
  });

  it('does not block an owned pair just because performance evidence is missing', () => {
    const result = scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: amberWoods,
    });

    expect(result.eligible).toBe(true);
    expect(result.exclusions).toEqual([]);
    expect(result.whyItWorks).not.toMatch(/projection|performance/i);
  });

  it('rewards heart/base bridges and approved provider structured accords', () => {
    const bridged = scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: amberWoods,
    });
    const unsupported = scoreLayerCombination({
      fragranceA: {
        ...siennaBrume,
        topNotes: ['Sea Air'],
        heartNotes: ['Cucumber'],
        baseNotes: ['Copaiba'],
        notes: ['Sea Air', 'Cucumber', 'Copaiba'],
      },
      fragranceB: {
        ...amberWoods,
        notes: ['Ink', 'Metallic Notes'],
        topNotes: ['Ink'],
        heartNotes: ['Metallic Notes'],
        baseNotes: ['Mineral Notes'],
        providerStructuredAccords: [],
      },
    });

    expect(bridged.score).toBeGreaterThan(unsupported.score);
    expect(bridged.reasonCodes).toEqual(expect.arrayContaining(['base_note_bridge', 'taxonomy_bridge', 'evidence_quality']));
    expect(bridged.bridgeTerms.join(' ')).toMatch(/vanilla|amber|woods/i);
    expect(bridged.whyItWorks).toMatch(/Use .* as the .* and .* as the .*/);
  });

  it('applies clash, sweetness, heaviness, and redundancy penalties', () => {
    const cleanLift = scoreLayerCombination({
      fragranceA: sharpLeatherOud,
      fragranceB: freshLift,
    });
    const aquaticLeatherClash = scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: sharpLeatherOud,
    });
    const sweetOverload = scoreLayerCombination({
      fragranceA: sweetGourmand,
      fragranceB: { ...sweetGourmand, id: 'sweet-gourmand-2', name: 'Honeyed Tonka' },
    });

    expect(aquaticLeatherClash.score).toBeLessThan(cleanLift.score);
    expect(aquaticLeatherClash.reasonCodes).toContain('clash_caution');
    expect(sweetOverload.reasonCodes).toEqual(expect.arrayContaining(['redundancy_penalty', 'clash_caution']));
    expect(sweetOverload.warnings.join(' ')).toMatch(/sweetness|heavy|muddy|syrupy/i);
  });

  it('uses performance balance only when both projection values are evidence-backed', () => {
    const backed = scoreLayerCombination({
      fragranceA: {
        ...sharpLeatherOud,
        performance: { projectionScore: 0.9, projectionEvidenceBacked: true },
      },
      fragranceB: {
        ...amberWoods,
        performance: { projectionScore: 0.86, projectionEvidenceBacked: true },
      },
    });
    const unsupported = scoreLayerCombination({
      fragranceA: {
        ...sharpLeatherOud,
        performance: { projectionScore: 0.9, projectionEvidenceBacked: false },
      },
      fragranceB: {
        ...amberWoods,
        performance: { projectionScore: 0.86, projectionEvidenceBacked: false },
      },
    });

    expect(backed.reasonCodes).toContain('performance_balance_caution');
    expect(backed.warnings.join(' ')).toMatch(/projection|sprays/i);
    expect(unsupported.reasonCodes).not.toContain('performance_balance_caution');
    expect(unsupported.whyItWorks).not.toMatch(/projection/i);
  });

  it('keeps community accord evidence lower authority than official/provider signals', () => {
    const communityOnlyBridge = scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: {
        id: 'community-only',
        name: 'Abstract Mineral',
        brand: 'Fixture House',
        familyKey: 'abstract-mineral',
        owned: true,
        notes: ['Mint', 'Aldehydes'],
        topNotes: ['Mint'],
        heartNotes: ['Aldehydes'],
        baseNotes: ['Mineral Notes'],
        providerStructuredAccords: [],
        communityAccords: ['aquatic', 'green', 'aromatic'],
      },
    });

    expect(communityOnlyBridge.bridgeTerms.join(' ')).not.toMatch(/aquatic|green|aromatic/i);
    expect(communityOnlyBridge.reasonCodes).not.toContain('accord_bridge');
    expect(communityOnlyBridge.whyItWorks).not.toMatch(/Fragrantica|community/i);
  });

  it('uses user taste and rotation signals without overriding hard exclusions', () => {
    const preferred = scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: amberWoods,
      context: {
        preferredTerms: ['vanilla', 'amber'],
        recentFragranceIds: [],
      },
    });
    const recentlyRepeated = scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: amberWoods,
      context: {
        preferredTerms: ['vanilla', 'amber'],
        recentFragranceIds: ['amber-woods'],
      },
    });
    const disliked = scoreLayerCombination({
      fragranceA: siennaBrume,
      fragranceB: { ...amberWoods, disliked: true },
      context: {
        preferredTerms: ['vanilla', 'amber'],
      },
    });

    expect(preferred.components.userTaste).toBeGreaterThan(0);
    expect(recentlyRepeated.score).toBeLessThan(preferred.score);
    expect(disliked.eligible).toBe(false);
  });
});
