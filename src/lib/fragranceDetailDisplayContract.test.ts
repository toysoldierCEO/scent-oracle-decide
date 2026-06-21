import { describe, expect, it } from 'vitest';

import {
  buildFragranceCardDisplayModel,
  buildFragranceDetailDisplayModel,
  buildFragranceMetadataDisplay,
  buildSourceBackedPyramidDescription,
  formatFragranceFamilyDisplayLabel,
  formatFragranceNoteDisplayLabel,
  formatFragranceNoteProsePhrase,
  formatSourceDisplayName,
  isGroundedWearContextLabel,
  isLayerToolActionLabel,
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
    const topIdentityLabels = model.topIdentityChips.map((chip) => chip.label);
    expect(topIdentityLabels).toEqual(['Fresh Aquatic']);
    expect(labels).toContain('Fresh Aquatic');
    expect(labels).toContain('Aromatic');
    expect(labels).toContain('Italian Lemon');
    expect(labels).toContain('White Musk');
    expect(labels).not.toContain('Fresh Blue');
    expect(labels).not.toContain('EDP');
    expect(labels).not.toContain('Official Pyramid');
  });

  it('keeps canonical detail top identity to family only for Pacific-style pyramid details', () => {
    const model = buildFragranceDetailDisplayModel({
      familyLabel: 'Fresh Blue',
      familyKey: 'fresh-blue',
      accordLabels: ['EDP', 'Official Pyramid', 'Aromatic'],
      topNotes: ['Lemon Italy', 'Australian Coastal Moss'],
      middleNotes: ['Sage France', 'Geranium Egypt'],
      baseNotes: ['Cedarwood Virginia USA', 'Whitemusk'],
    });

    expect(model.topIdentityChips).toEqual([{ label: 'Fresh Aquatic', position: 'family' }]);
    expect(model.familyChip).toEqual({ label: 'Fresh Aquatic', position: 'family' });
    expect(model.performanceDisplayMode).toBe('compact_pending');
    expect(model.layerToolDisplayMode).toBe('compact_cta');
    expect(model.topIdentityChips.map((chip) => chip.label)).not.toContain('Italian Lemon');
    expect(model.topIdentityChips.map((chip) => chip.label)).not.toContain('Official Pyramid');
    expect(model.topIdentityChips.map((chip) => chip.label)).not.toContain('EDP');
    expect(model.detailSectionOrder).toEqual([
      'family',
      'notes',
      'accords',
      'performance',
      'layer_tool',
      'source_provenance',
      'metadata',
      'actions',
    ]);
    expect(model.detailSectionOrder.indexOf('notes')).toBeLessThan(model.detailSectionOrder.indexOf('performance'));
    expect(model.detailSectionOrder.indexOf('source_provenance')).toBeLessThan(model.detailSectionOrder.indexOf('metadata'));
  });

  it('uses the same canonical order for key-note-only fragrances such as Into the Woods', () => {
    const model = buildFragranceDetailDisplayModel({
      familyKey: 'woods',
      familyLabel: 'Woody',
      accordLabels: ['Woody', 'Aromatic'],
      flatNotes: ['Oud', 'Cedarwood', 'Amber'],
    });

    expect(model.hasStructuredNoteSections).toBe(false);
    expect(model.detailSectionOrder).toEqual([
      'family',
      'key_notes',
      'accords',
      'performance',
      'layer_tool',
      'source_provenance',
      'metadata',
      'actions',
    ]);
    expect(model.detailSectionOrder.indexOf('key_notes')).toBeLessThan(model.detailSectionOrder.indexOf('performance'));
    expect(model.detailSectionOrder.indexOf('accords')).toBeLessThan(model.detailSectionOrder.indexOf('performance'));
  });

  it('uses bar mode only when trusted performance data is available', () => {
    expect(buildFragranceDetailDisplayModel({ hasTrustedPerformance: false }).performanceDisplayMode).toBe('compact_pending');
    expect(buildFragranceDetailDisplayModel({ hasTrustedPerformance: true }).performanceDisplayMode).toBe('bars');
  });

  it('maps internal fresh-blue taxonomy to a user-facing family label', () => {
    expect(formatFragranceFamilyDisplayLabel({ familyKey: 'fresh-blue' })).toBe('Fresh Aquatic');
    expect(formatFragranceFamilyDisplayLabel({ familyLabel: 'Fresh Blue' })).toBe('Fresh Aquatic');
    expect(formatFragranceFamilyDisplayLabel({
      familyKey: null,
      familyLabel: 'fresh-blue',
      noteLabels: ['Australian Coastal Moss'],
    })).toBe('Fresh Aquatic');
  });

  it('keeps Layer Tool out of grounded Best Worn labels while preserving it as an action label', () => {
    expect(isGroundedWearContextLabel('Daily')).toBe(true);
    expect(isGroundedWearContextLabel('Hot weather')).toBe(true);
    expect(isGroundedWearContextLabel('Anchor')).toBe(true);
    expect(isGroundedWearContextLabel('Layer Tool')).toBe(false);
    expect(isLayerToolActionLabel('Layer Tool')).toBe(true);
  });

  it('keeps internal source names out of user-facing provenance labels', () => {
    expect(formatSourceDisplayName('public.fragrances', 'Goldfield & Banks')).toBe('Goldfield & Banks');
    expect(formatSourceDisplayName('public.fragrances', null)).toBe('official source');
    expect(formatSourceDisplayName('Alexandria Fragrances', 'Alexandria Fragrances')).toBe('Alexandria Fragrances');
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

  it('uses approved resolver perfumer names when catalog perfumer is literal Unknown', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: null,
      catalogPerfumer: 'Unknown',
      catalogConcentration: 'EDP',
      resolverPerfumerNames: ['François Merle-Baudoin', 'Carine Certain Boin'],
      resolverConcentration: 'EDP',
    });

    expect(display.factLine).toContain('Perfumer: François Merle-Baudoin, Carine Certain Boin');
    expect(display.applied.perfumer).toBe(true);
  });

  it('builds Pacific-style source-backed pyramid prose with sentence-safe casing', () => {
    const description = buildSourceBackedPyramidDescription({
      familyKey: 'fresh-blue',
      topNotes: ['Lemon Italy', 'Australian Coastal Moss'],
      middleNotes: ['Sage France', 'Geranium Egypt'],
      baseNotes: ['Cedarwood Virginia USA', 'Whitemusk'],
    });

    expect(description).toBe(
      'Bright Italian lemon and coastal moss open crisp and airy, moving into sage and geranium before drying down to Virginia cedarwood and clean white musk.',
    );
    expect(description).not.toContain('virginia Cedarwood');
  });

  it('uses sentence-safe note phrase labels separate from title-case chip labels', () => {
    expect(formatFragranceNoteProsePhrase('Cedarwood Virginia USA', 'base')).toBe('Virginia cedarwood');
    expect(formatFragranceNoteProsePhrase('Whitemusk', 'base')).toBe('clean white musk');
    expect(formatFragranceNoteDisplayLabel('Cedarwood Virginia USA')).toBe('Virginia Cedarwood');
  });

  it('builds collection card chips without raw family keys or raw official note labels', () => {
    const model = buildFragranceCardDisplayModel({
      familyKey: 'fresh-blue',
      familyLabel: 'FRESH-BLUE',
      accordLabels: ['EDP', 'Official Pyramid', 'Aromatic'],
      topNotes: ['Lemon Italy', 'Australian Coastal Moss'],
      middleNotes: ['Sage France', 'Geranium Egypt'],
      baseNotes: ['Cedarwood Virginia USA', 'Whitemusk'],
      flatNotes: ['Lemon Italy', 'Sage France'],
      maxPreviewChips: 3,
    });

    const previewLabels = model.previewChips.map((chip) => chip.label);
    expect(model.familyChipLabel).toBe('Fresh Aquatic');
    expect(model.familyChipLabel).not.toBe('FRESH-BLUE');
    expect(previewLabels).toContain('Italian Lemon');
    expect(previewLabels).toContain('Australian Coastal Moss');
    expect(previewLabels).not.toContain('Lemon Italy');
    expect(previewLabels).not.toContain('Sage France');
    expect(previewLabels).not.toContain('EDP');
    expect(previewLabels).not.toContain('Official Pyramid');
    expect(previewLabels.length).toBeLessThanOrEqual(3);
  });
});
