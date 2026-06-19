import { describe, expect, it } from 'vitest';

import {
  buildFragranceDetailDisplayModel,
  buildFragranceMetadataDisplay,
  formatFragranceNoteDisplayLabel,
  isScentProfileChip,
  shouldShowVesperizingNotice,
} from './fragranceDetailDisplayContract';

describe('fragranceDetailDisplayContract', () => {
  it('formats official note source labels for display without changing stored values', () => {
    expect(formatFragranceNoteDisplayLabel('Lemon Italy')).toBe('Italian Lemon');
    expect(formatFragranceNoteDisplayLabel('Sage France')).toBe('French Sage');
    expect(formatFragranceNoteDisplayLabel('Geranium Egypt')).toBe('Egyptian Geranium');
    expect(formatFragranceNoteDisplayLabel('Cedarwood Virginia USA')).toBe('Virginia Cedarwood');
    expect(formatFragranceNoteDisplayLabel('Whitemusk')).toBe('White Musk');
    expect(formatFragranceNoteDisplayLabel('Australian Coastal Moss')).toBe('Australian Coastal Moss');
  });

  it('keeps metadata and provenance labels out of scent-profile chips', () => {
    expect(isScentProfileChip('EDP')).toBe(false);
    expect(isScentProfileChip('Eau de Parfum')).toBe(false);
    expect(isScentProfileChip('Official Pyramid')).toBe(false);
    expect(isScentProfileChip('Source-backed notes')).toBe(false);
    expect(isScentProfileChip('Performance intel pending')).toBe(false);
    expect(isScentProfileChip('Italian Lemon')).toBe(true);
    expect(isScentProfileChip('Fresh Aquatic')).toBe(true);
  });

  it('builds hero chips from smell profile facts only', () => {
    const model = buildFragranceDetailDisplayModel({
      familyLabel: 'Fresh Blue',
      familyKey: 'fresh-blue',
      accordLabels: ['EDP', 'Official Pyramid', 'Aromatic'],
      topNotes: ['Lemon Italy', 'Australian Coastal Moss'],
      middleNotes: ['Sage France', 'Geranium Egypt'],
      baseNotes: ['Cedarwood Virginia USA', 'Whitemusk'],
    });

    const labels = model.heroProfileChips.map((chip) => chip.label);
    expect(labels).toContain('Fresh Blue');
    expect(labels).toContain('Fresh Aquatic');
    expect(labels).toContain('Aromatic');
    expect(labels).toContain('Italian Lemon');
    expect(labels).toContain('White Musk');
    expect(labels).not.toContain('EDP');
    expect(labels).not.toContain('Official Pyramid');
  });

  it('uses structured note sections when a source-backed pyramid exists', () => {
    const model = buildFragranceDetailDisplayModel({
      topNotes: ['Lemon Italy', 'Australian Coastal Moss'],
      middleNotes: ['Sage France', 'Geranium Egypt'],
      baseNotes: ['Cedarwood Virginia USA', 'Whitemusk'],
    });

    expect(model.hasStructuredNoteSections).toBe(true);
    expect(model.structuredNoteSections).toEqual([
      { title: 'Top', position: 'top', values: ['Italian Lemon', 'Australian Coastal Moss'] },
      { title: 'Heart', position: 'heart', values: ['French Sage', 'Egyptian Geranium'] },
      { title: 'Base', position: 'base', values: ['Virginia Cedarwood', 'White Musk'] },
    ]);
  });

  it('does not show Vesperizing for canonical or matched fragrance detail', () => {
    expect(shouldShowVesperizingNotice({ isCanonicalFragrance: true, isLoading: true })).toBe(false);
    expect(shouldShowVesperizingNotice({ isMatchedExistingIntake: true, isLoading: true })).toBe(false);
    expect(shouldShowVesperizingNotice({ isUnresolvedIntake: true })).toBe(true);
  });

  it('uses approved resolver perfumer names when catalog perfumer is missing', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: null,
      catalogPerfumer: null,
      catalogConcentration: 'EDP',
      resolverPerfumerNames: ['François Merle-Baudoin', 'Carine Certain Boin'],
      resolverConcentration: 'EDP',
    });

    expect(display.factLine).toBe(
      'Released: Unknown · Perfumer: François Merle-Baudoin, Carine Certain Boin · Concentration: EDP',
    );
    expect(display.applied.perfumer).toBe(true);
    expect(display.applied.concentration).toBe(false);
  });
});
