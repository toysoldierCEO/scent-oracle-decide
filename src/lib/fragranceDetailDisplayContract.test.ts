import { describe, expect, it } from 'vitest';

import {
  buildFragranceCardDisplayModel,
  buildFragranceDetailDisplayModel,
  buildFragranceMetadataDisplay,
  buildFragranceTrustLine,
  buildSourceBackedPyramidDescription,
  formatFragranceFamilyDisplayLabel,
  formatFragranceNoteDisplayLabel,
  formatFragranceNoteProsePhrase,
  formatSourceDisplayName,
  getFragranceFamilySemanticColorKey,
  isGroundedWearContextLabel,
  isLayerToolActionLabel,
  isLikelyOfficialBrandSourceUrl,
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
    expect(isScentProfileChip('Wear strength not verified')).toBe(false);
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
    expect(model.headerLayoutOrder).toEqual(['title', 'brand', 'family']);
    expect(model.headerVisualPlacement).toBe('after_identity');
    expect(model.performanceDisplayMode).toBe('hidden');
    expect(model.hasPerformanceSection).toBe(false);
    expect(model.topIdentityChips.map((chip) => chip.label)).not.toContain('Italian Lemon');
    expect(model.topIdentityChips.map((chip) => chip.label)).not.toContain('Official Pyramid');
    expect(model.topIdentityChips.map((chip) => chip.label)).not.toContain('EDP');
    expect(model.detailSectionOrder).toEqual([
      'family',
      'notes',
      'accords',
      'source_provenance',
      'metadata',
      'actions',
    ]);
    expect(model.detailSectionOrder).not.toContain('performance');
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
      'source_provenance',
      'metadata',
      'actions',
    ]);
    expect(model.detailSectionOrder).not.toContain('performance');
    expect(model.detailSectionOrder.indexOf('key_notes')).toBeLessThan(model.detailSectionOrder.indexOf('source_provenance'));
    expect(model.detailSectionOrder.indexOf('accords')).toBeLessThan(model.detailSectionOrder.indexOf('source_provenance'));
  });

  it('renders performance only when trusted performance data is available', () => {
    const missingPerformance = buildFragranceDetailDisplayModel({ hasTrustedPerformance: false });
    expect(missingPerformance.performanceDisplayMode).toBe('hidden');
    expect(missingPerformance.hasPerformanceSection).toBe(false);
    expect(missingPerformance.detailSectionOrder).not.toContain('performance');

    const realPerformance = buildFragranceDetailDisplayModel({ hasTrustedPerformance: true });
    expect(realPerformance.performanceDisplayMode).toBe('bars');
    expect(realPerformance.hasPerformanceSection).toBe(true);
    expect(realPerformance.detailSectionOrder).toContain('performance');
  });

  it('uses one canonical header hierarchy for new and existing canonical details', () => {
    const newlyResolved = buildFragranceDetailDisplayModel({
      familyKey: 'fresh-blue',
      familyLabel: 'Fresh Aquatic',
      topNotes: ['Sea Air', 'Bergamot'],
      middleNotes: ['Soft Coconut', 'Cucumber'],
      baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
    });
    const olderCanonical = buildFragranceDetailDisplayModel({
      familyKey: 'woods',
      familyLabel: 'Woody',
      flatNotes: ['Oud', 'Cedarwood', 'Amber'],
      hasTrustedPerformance: true,
    });

    expect(newlyResolved.headerLayoutOrder).toEqual(['title', 'brand', 'family']);
    expect(olderCanonical.headerLayoutOrder).toEqual(['title', 'brand', 'family']);
    expect(newlyResolved.headerVisualPlacement).toBe('after_identity');
    expect(olderCanonical.headerVisualPlacement).toBe('after_identity');
    expect(newlyResolved.topIdentityChips).toEqual([{ label: 'Fresh Aquatic', position: 'family' }]);
    expect(olderCanonical.topIdentityChips).toEqual([{ label: 'Woody', position: 'family' }]);
  });

  it('maps internal fresh-blue taxonomy to a user-facing family label', () => {
    expect(formatFragranceFamilyDisplayLabel({ familyKey: 'fresh-blue' })).toBe('Fresh Aquatic');
    expect(formatFragranceFamilyDisplayLabel({ familyLabel: 'Fresh Blue' })).toBe('Fresh Aquatic');
    expect(formatFragranceFamilyDisplayLabel({ familyLabel: 'fresh' })).toBe('Fresh');
    expect(formatFragranceFamilyDisplayLabel({
      familyKey: null,
      familyLabel: 'fresh-blue',
      noteLabels: ['Australian Coastal Moss'],
    })).toBe('Fresh Aquatic');
  });

  it('maps family labels to intentional semantic color lanes', () => {
    expect(getFragranceFamilySemanticColorKey({ familyKey: 'fresh-blue' })).toBe('fresh-aquatic');
    expect(getFragranceFamilySemanticColorKey({ familyKey: 'fresh-aquatic' })).toBe('fresh-aquatic');
    expect(getFragranceFamilySemanticColorKey({ familyLabel: 'Fresh Blue' })).toBe('fresh-aquatic');
    expect(getFragranceFamilySemanticColorKey({ familyLabel: 'fresh' })).toBe('fresh');
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

  it('builds compact trust lines without backend/debug names', () => {
    expect(buildFragranceTrustLine({
      kind: 'official_pyramid',
      sourceName: 'public.fragrances',
      fallbackBrand: 'Goldfield & Banks',
    })).toBe('Source-backed notes · Official source · Goldfield & Banks');
    expect(buildFragranceTrustLine({
      kind: 'official_key_notes',
      sourceName: 'Alexandria Fragrances',
      fallbackBrand: 'Alexandria Fragrances',
    })).toBe('Official source-backed key notes · Official source · Alexandria Fragrances');
    expect(buildFragranceTrustLine({ kind: 'curated' })).toBe('Curated app profile');
  });

  it('recognizes brand-matched official source URLs without exposing internals', () => {
    expect(isLikelyOfficialBrandSourceUrl(
      'https://www.mihanaromatics.com/products/sienna-brume-parfum',
      'Mihan Aromatics',
    )).toBe(true);
    expect(isLikelyOfficialBrandSourceUrl(
      'https://mihanaromatics.com/product/sienna-brume',
      'Mihan Aromatics',
    )).toBe(true);
    expect(isLikelyOfficialBrandSourceUrl(
      'https://example.com/products/sienna-brume',
      'Mihan Aromatics',
    )).toBe(false);
    expect(isLikelyOfficialBrandSourceUrl('public.fragrances', 'Mihan Aromatics')).toBe(false);
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
    expect(formatFragranceNoteProsePhrase('Sea Air', 'opening')).toBe('sea air');
    expect(formatFragranceNoteProsePhrase('Soft Coconut', 'heart')).toBe('soft coconut');
    expect(formatFragranceNoteProsePhrase('Juniper Berry', 'base')).toBe('juniper berry');
    expect(formatFragranceNoteDisplayLabel('Cedarwood Virginia USA')).toBe('Virginia Cedarwood');
  });

  it('builds Sienna-style source-backed pyramid prose with natural sentence casing', () => {
    const description = buildSourceBackedPyramidDescription({
      familyKey: 'fresh-blue',
      topNotes: ['Sea Air', 'Bergamot'],
      middleNotes: ['Soft Coconut', 'Cucumber'],
      baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
    });

    expect(description).toBe(
      'Bright sea air and bergamot open crisp and airy, moving into soft coconut and cucumber before drying down to vanilla, copaiba, and juniper berry.',
    );
    expect(description).not.toContain('sea Air');
    expect(description).not.toContain('soft Coconut');
    expect(description).not.toContain('juniper Berry');
  });

  it('builds collection card chips without raw family keys or repeated note chips', () => {
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
    expect(previewLabels).toEqual(['Aromatic']);
    expect(previewLabels).not.toContain('Italian Lemon');
    expect(previewLabels).not.toContain('Australian Coastal Moss');
    expect(previewLabels).not.toContain('Lemon Italy');
    expect(previewLabels).not.toContain('Sage France');
    expect(previewLabels).not.toContain('EDP');
    expect(previewLabels).not.toContain('Official Pyramid');
    expect(previewLabels.length).toBeLessThanOrEqual(3);
  });

  it('keeps Sienna collection preview chips from repeating official notes', () => {
    const model = buildFragranceCardDisplayModel({
      familyKey: 'fresh-blue',
      familyLabel: 'Fresh Aquatic',
      accordLabels: ['Aromatic'],
      topNotes: ['Sea Air', 'Bergamot'],
      middleNotes: ['Soft Coconut', 'Cucumber'],
      baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
      maxPreviewChips: 3,
    });

    const previewLabels = model.previewChips.map((chip) => chip.label);
    expect(model.familyChipLabel).toBe('Fresh Aquatic');
    expect(previewLabels).toEqual(['Aromatic']);
    expect(previewLabels).not.toContain('Sea Air');
    expect(previewLabels).not.toContain('Bergamot');
    expect(previewLabels).not.toContain('Soft Coconut');
  });
});
