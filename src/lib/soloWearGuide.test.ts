import { describe, expect, it } from 'vitest';
import { resolveSoloWearGuide } from './soloWearGuide';

const FORBIDDEN_PERFORMANCE_COPY = /performance pending|projection|longevity|all day|long lasting|projects well/i;

describe('resolveSoloWearGuide', () => {
  it('returns dense warm guidance for sweet, gourmand, amber, or vanilla profiles', () => {
    const guide = resolveSoloWearGuide({
      family_label: 'Amber Gourmand',
      notes: ['Vanilla', 'Honey', 'Tonka'],
    });

    expect(guide.matchedLane).toBe('sweet_gourmand');
    expect(guide.placement).toBe('2 sprays chest • 1 spray back neck');
    expect(guide.whyItWorks).toContain('Already rich enough');
  });

  it('returns higher lift guidance for fresh, aquatic, green, or citrus profiles', () => {
    const guide = resolveSoloWearGuide({
      family_label: 'Fresh Aquatic',
      top_notes: ['Sea Air', 'Bergamot'],
      heart_notes: ['Cucumber'],
    });

    expect(guide.matchedLane).toBe('fresh_aquatic');
    expect(guide.placement).toBe('2 sprays neck • 1 spray chest');
    expect(guide.whyItWorks).toContain('Fresher profiles lift best');
  });

  it('returns darker close-wear guidance for woody, oud, leather, incense, or resin profiles', () => {
    const guide = resolveSoloWearGuide({
      accords: ['Dark Leather', 'Patchouli'],
      base_notes: ['Oud', 'Labdanum'],
    });

    expect(guide.matchedLane).toBe('woody_oud');
    expect(guide.placement).toBe('1 spray chest • 1 spray back neck • optional wrist');
    expect(guide.whyItWorks).toContain('Darker materials');
  });

  it('returns warmth and pulse-point guidance for musk, molecule, or skin scent profiles', () => {
    const guide = resolveSoloWearGuide({
      name: 'Molecule 01',
      accords: ['Skin Scent'],
      notes: ['Iso E Super', 'Ambroxan'],
    });

    expect(guide.matchedLane).toBe('musk_skin');
    expect(guide.placement).toBe('2 sprays chest • 1 spray inner elbow');
    expect(guide.whyItWorks).toContain('Skin-close scents');
  });

  it('returns air and chest guidance for spicy, aromatic, fougere, or herbal profiles', () => {
    const guide = resolveSoloWearGuide({
      family_label: 'Aromatic Fougere',
      notes: ['Lavender', 'Rosemary', 'Black Pepper'],
    });

    expect(guide.matchedLane).toBe('aromatic_spicy');
    expect(guide.placement).toBe('1 spray neck • 2 sprays chest');
    expect(guide.whyItWorks).toContain('Aromatic spice');
  });

  it('returns spacing and clarity guidance for floral, iris, rose, or white floral profiles', () => {
    const guide = resolveSoloWearGuide({
      accords: ['Rose', 'White Floral'],
      middle_notes: ['Iris', 'Jasmine'],
    });

    expect(guide.matchedLane).toBe('floral');
    expect(guide.placement).toBe('1 spray chest • 1 spray neck • 1 spray back neck');
    expect(guide.whyItWorks).toContain('Florals carry best');
  });

  it('returns a safe fallback when no usable scent signals exist', () => {
    const guide = resolveSoloWearGuide({
      name: 'Unknown Scent',
      brand: 'Quiet House',
    });

    expect(guide.matchedLane).toBe('fallback');
    expect(guide.placement).toBe('2 sprays chest • 1 spray back neck');
    expect(guide.whyItWorks).toContain('focused and clean');
  });

  it('does not crash on missing notes or accords', () => {
    expect(resolveSoloWearGuide(null)).toMatchObject({
      title: 'Wear Solo',
      matchedLane: 'fallback',
    });
    expect(resolveSoloWearGuide({ notes: null, accords: undefined })).toMatchObject({
      title: 'Wear Solo',
      matchedLane: 'fallback',
    });
  });

  it('does not introduce fake performance claims', () => {
    const guides = [
      resolveSoloWearGuide({ accords: ['Vanilla'] }),
      resolveSoloWearGuide({ family_label: 'Fresh Aquatic' }),
      resolveSoloWearGuide({ base_notes: ['Oud', 'Leather'] }),
      resolveSoloWearGuide({ notes: ['Iso E Super'] }),
      resolveSoloWearGuide({ notes: ['Lavender', 'Cardamom'] }),
      resolveSoloWearGuide({ notes: ['Rose', 'Iris'] }),
      resolveSoloWearGuide({}),
    ];

    for (const guide of guides) {
      expect(`${guide.placement} ${guide.whyItWorks}`).not.toMatch(FORBIDDEN_PERFORMANCE_COPY);
    }
  });

  it('does not mutate the input object', () => {
    const input = {
      family_label: 'Woody Amber',
      notes: ['Cedar', 'Vanilla'],
      accords: [{ label: 'Woods' }],
    };
    const before = structuredClone(input);

    resolveSoloWearGuide(input);

    expect(input).toEqual(before);
  });
});
