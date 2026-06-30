import { describe, expect, it } from 'vitest';

import {
  buildCommunityEvidenceDisplayModel,
  type CommunityEvidenceInput,
} from './communityEvidenceLane';

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
  resolveAccordDisplayPolicy,
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
    expect(model.hasDescriptionSection).toBe(true);
    expect(model.descriptionText).toBe(
      'Bright Italian lemon and coastal moss open crisp and airy, moving into sage and geranium before drying down to Virginia cedarwood and clean white musk.',
    );
    expect(model.performanceDisplayMode).toBe('hidden');
    expect(model.hasPerformanceSection).toBe(false);
    expect(model.topIdentityChips.map((chip) => chip.label)).not.toContain('Italian Lemon');
    expect(model.topIdentityChips.map((chip) => chip.label)).not.toContain('Official Pyramid');
    expect(model.topIdentityChips.map((chip) => chip.label)).not.toContain('EDP');
    expect(model.detailSectionOrder).toEqual([
      'family',
      'description',
      'notes',
      'accords',
      'metadata',
      'source_provenance',
      'actions',
    ]);
    expect(model.detailSectionOrder).not.toContain('performance');
    expect(model.detailSectionOrder.indexOf('metadata')).toBeLessThan(model.detailSectionOrder.indexOf('source_provenance'));
    expect(model.detailSectionOrder.indexOf('source_provenance')).toBeLessThan(model.detailSectionOrder.indexOf('actions'));
  });

  it('uses the same canonical order for key-note-only fragrances such as Into the Woods', () => {
    const model = buildFragranceDetailDisplayModel({
      familyKey: 'woods',
      familyLabel: 'Woody',
      accordLabels: ['Woody', 'Aromatic'],
      flatNotes: ['Oud', 'Cedarwood', 'Amber'],
    });

    expect(model.hasStructuredNoteSections).toBe(false);
    expect(model.hasDescriptionSection).toBe(false);
    expect(model.detailSectionOrder).toEqual([
      'family',
      'key_notes',
      'accords',
      'metadata',
      'source_provenance',
      'actions',
    ]);
    expect(model.detailSectionOrder).not.toContain('performance');
    expect(model.detailSectionOrder.indexOf('key_notes')).toBeLessThan(model.detailSectionOrder.indexOf('metadata'));
    expect(model.detailSectionOrder.indexOf('accords')).toBeLessThan(model.detailSectionOrder.indexOf('metadata'));
    expect(model.detailSectionOrder.indexOf('metadata')).toBeLessThan(model.detailSectionOrder.indexOf('source_provenance'));
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

  it('builds a Sienna source-backed description and orders it before official notes', () => {
    const model = buildFragranceDetailDisplayModel({
      familyKey: 'fresh-blue',
      familyLabel: 'Fresh Aquatic',
      topNotes: ['Sea Air', 'Bergamot'],
      middleNotes: ['Soft Coconut', 'Cucumber'],
      baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
      hasTrustedPerformance: false,
    });

    expect(model.descriptionText).toBe(
      'Bright sea air and bergamot open crisp and airy, moving into soft coconut and cucumber before drying down to vanilla, copaiba, and juniper berry.',
    );
    expect(model.detailSectionOrder).toEqual([
      'family',
      'description',
      'notes',
      'metadata',
      'source_provenance',
      'actions',
    ]);
    expect(model.detailSectionOrder.indexOf('description')).toBeLessThan(model.detailSectionOrder.indexOf('notes'));
    expect(model.detailSectionOrder.indexOf('metadata')).toBeLessThan(model.detailSectionOrder.indexOf('source_provenance'));
    expect(model.detailSectionOrder).not.toContain('performance');
  });

  it('keeps complete official pyramid details from showing community/provider evidence by default', () => {
    const communityEvidence = buildCommunityEvidenceDisplayModel([{
      sourceType: 'community_provider',
      sourceTier: 'community_provider_consensus',
      sourceName: 'Fragrantica',
      reviewStatus: 'approved_for_internal_use',
      evidenceStatus: 'usable_non_official_intelligence',
      usableForVesperIntelligence: true,
      officialRegistryEligible: false,
      patchSafeNow: false,
      normalizedAccords: ['coconut', 'green', 'ozonic', 'aquatic', 'fresh spicy', 'woody', 'sweet', 'aromatic'],
      normalizedNotes: ['Cucumber', 'Juniper Berry', 'White Pepper', 'Wood Resin', 'Amber'],
    } satisfies CommunityEvidenceInput], {
      topNotes: ['Sea Air', 'Bergamot'],
      middleNotes: ['Soft Coconut', 'Cucumber'],
      baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
    });
    const model = buildFragranceDetailDisplayModel({
      familyKey: 'fresh-blue',
      familyLabel: 'Fresh Aquatic',
      topNotes: ['Sea Air', 'Bergamot'],
      middleNotes: ['Soft Coconut', 'Cucumber'],
      baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
      communityEvidence,
    });

    expect(model.structuredNoteSections).toEqual([
      { title: 'Top', position: 'top', values: ['Sea Air', 'Bergamot'] },
      { title: 'Heart', position: 'heart', values: ['Soft Coconut', 'Cucumber'] },
      { title: 'Base', position: 'base', values: ['Vanilla', 'Copaiba', 'Juniper Berry'] },
    ]);
    expect(model.structuredNoteSections[0]?.values).not.toContain('Cucumber');
    expect(model.structuredNoteSections[0]?.values).not.toContain('White Pepper');
    expect(communityEvidence.communityNotes).toContain('White Pepper');
    expect(communityEvidence.trustLine).toBe('Community/provider evidence · Fragrantica');
    expect(communityEvidence.conflictsWithOfficialNotes).toBe(true);
    expect(model.accordLabels).toEqual([]);
    expect(model.communityEvidence).toBeNull();
    expect(model.communityEvidenceDisplayPolicy).toMatchObject({
      officialNotesCompleteEnough: true,
      reason: 'official_notes_complete_default_hidden',
      showCommunityAccords: false,
      showCommunitySignals: false,
      showCommunitySourceTrust: false,
    });
    expect(model.accordDisplayPolicy).toMatchObject({
      source: 'none',
      reason: 'no_approved_visible_accord_source',
    });
    expect(model.accordSourceTrustLine).toBeNull();
    expect(model.detailSectionOrder).toEqual([
      'family',
      'description',
      'notes',
      'metadata',
      'source_provenance',
      'actions',
    ]);
    expect(model.detailSectionOrder).not.toContain('performance');
  });

  it('renders approved Fragella/provider structured accords without calling them official', () => {
    const providerEvidence = buildCommunityEvidenceDisplayModel([{
      sourceType: 'retailer',
      sourceTier: 'retailer_structured_notes',
      sourceName: 'Fragella',
      reviewStatus: 'approved_for_internal_use',
      evidenceStatus: 'usable_non_official_intelligence',
      usableForVesperIntelligence: true,
      officialRegistryEligible: false,
      patchSafeNow: false,
      normalizedAccords: ['amber', 'floral'],
      normalizedNotes: [],
    } satisfies CommunityEvidenceInput], {
      topNotes: ['Sea Air', 'Bergamot'],
      middleNotes: ['Soft Coconut', 'Cucumber'],
      baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
    });
    const model = buildFragranceDetailDisplayModel({
      familyKey: 'fresh-blue',
      familyLabel: 'Fresh Aquatic',
      topNotes: ['Sea Air', 'Bergamot'],
      middleNotes: ['Soft Coconut', 'Cucumber'],
      baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
      communityEvidence: providerEvidence,
    });

    expect(model.accordLabels).toEqual(['amber', 'floral']);
    expect(model.accordDisplayPolicy).toMatchObject({
      source: 'provider_structured',
      reason: 'approved_structured_provider_accords',
    });
    expect(model.accordSourceTrustLine).toBe('Provider accords · Fragella');
    expect(model.accordSourceTrustLine).not.toContain('Official');
    expect(model.communityEvidence).toBeNull();
    expect(model.detailSectionOrder).toEqual([
      'family',
      'description',
      'notes',
      'accords',
      'metadata',
      'source_provenance',
      'actions',
    ]);
  });

  it('renders community/provider evidence only when official notes are incomplete', () => {
    const communityEvidence = buildCommunityEvidenceDisplayModel([{
      sourceType: 'community_provider',
      sourceTier: 'community_provider_consensus',
      sourceName: 'Fragrantica',
      reviewStatus: 'approved_for_internal_use',
      evidenceStatus: 'usable_non_official_intelligence',
      usableForVesperIntelligence: true,
      officialRegistryEligible: false,
      patchSafeNow: false,
      normalizedAccords: ['coconut', 'green', 'ozonic', 'aquatic', 'fresh spicy', 'woody', 'sweet', 'aromatic'],
      normalizedNotes: ['Cucumber', 'Juniper Berry', 'White Pepper', 'Wood Resin', 'Amber'],
    } satisfies CommunityEvidenceInput], {
      topNotes: ['Sea Air'],
    });
    const model = buildFragranceDetailDisplayModel({
      familyKey: 'fresh-blue',
      familyLabel: 'Fresh Aquatic',
      topNotes: ['Sea Air'],
      communityEvidence,
    });

    expect(model.communityEvidenceDisplayPolicy).toMatchObject({
      officialNotesCompleteEnough: false,
      reason: 'official_notes_missing_or_incomplete',
      showCommunityAccords: true,
      showCommunitySignals: true,
      showCommunitySourceTrust: true,
    });
    expect(model.accordLabels).toContain('coconut');
    expect(model.communityEvidence?.communityNotes).toContain('White Pepper');
    expect(model.communityEvidence?.trustLine).toBe('Community/provider evidence · Fragrantica');
    expect(model.detailSectionOrder).toEqual([
      'family',
      'notes',
      'accords',
      'community_signals',
      'metadata',
      'source_provenance',
      'actions',
    ]);
    expect(model.detailSectionOrder).not.toContain('performance');
  });

  it('resolves accord sources without backfilling from community evidence when policy hides it', () => {
    const communityEvidence = buildCommunityEvidenceDisplayModel([{
      sourceType: 'community_provider',
      sourceTier: 'community_provider_consensus',
      sourceName: 'Fragrantica',
      reviewStatus: 'approved_for_internal_use',
      evidenceStatus: 'usable_non_official_intelligence',
      usableForVesperIntelligence: true,
      officialRegistryEligible: false,
      patchSafeNow: false,
      normalizedAccords: ['aromatic'],
      normalizedNotes: ['Cucumber'],
    } satisfies CommunityEvidenceInput], {
      topNotes: ['Sea Air', 'Bergamot'],
      middleNotes: ['Soft Coconut', 'Cucumber'],
      baseNotes: ['Vanilla', 'Copaiba', 'Juniper Berry'],
    });

    expect(resolveAccordDisplayPolicy({
      catalogAccordLabels: null,
      communityEvidence,
      communityEvidenceDisplayPolicy: {
        reason: 'official_notes_complete_default_hidden',
        officialNotesCompleteEnough: true,
        showCommunityAccords: false,
        showCommunitySignals: false,
        showCommunitySourceTrust: false,
        showCommunityWearEvidence: false,
      },
    })).toMatchObject({
      visibleAccords: [],
      visibleSourceTrustLine: null,
      source: 'none',
    });
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
    expect(buildFragranceTrustLine({ kind: null })).toBeNull();
    expect(buildFragranceTrustLine({})).toBeNull();
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

  it('omits the metadata row when every field is unknown', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: null,
      catalogPerfumer: 'Unknown',
      catalogConcentration: 'UNKNOWN',
      resolverReleaseYear: null,
      resolverPerfumerNames: [],
      resolverConcentration: null,
    });

    expect(display.factLine).toBeNull();
    expect(display.fields).toEqual([]);
    expect(display.releaseYear).toBeNull();
    expect(display.perfumer).toBeNull();
    expect(display.concentration).toBeNull();
  });

  it('renders only known release metadata', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: 2017,
      catalogPerfumer: null,
      catalogConcentration: null,
    });

    expect(display.factLine).toBe('Released: 2017');
    expect(display.fields).toEqual(['Released: 2017']);
  });

  it('renders only known perfumer metadata', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: null,
      catalogPerfumer: 'François Merle-Baudoin',
      catalogConcentration: null,
    });

    expect(display.factLine).toBe('Perfumer: François Merle-Baudoin');
    expect(display.fields).toEqual(['Perfumer: François Merle-Baudoin']);
  });

  it('renders only known concentration metadata', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: null,
      catalogPerfumer: null,
      catalogConcentration: 'PARFUM',
    });

    expect(display.factLine).toBe('Concentration: PARFUM');
    expect(display.fields).toEqual(['Concentration: PARFUM']);
  });

  it('renders known metadata fields in Released, Perfumer, Concentration order', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: 2022,
      catalogPerfumer: 'Alexandra Monet',
      catalogConcentration: 'EDP',
    });

    expect(display.factLine).toBe('Released: 2022 · Perfumer: Alexandra Monet · Concentration: EDP');
    expect(display.fields).toEqual([
      'Released: 2022',
      'Perfumer: Alexandra Monet',
      'Concentration: EDP',
    ]);
  });

  it('uses approved resolver metadata before catalog metadata', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: 2020,
      resolverReleaseYear: 2021,
      catalogPerfumer: 'Catalog Perfumer',
      catalogConcentration: 'EDT',
      resolverPerfumerNames: ['Resolver Perfumer'],
      resolverConcentration: 'EDP',
    });

    expect(display.factLine).toBe('Released: 2021 · Perfumer: Resolver Perfumer · Concentration: EDP');
    expect(display.applied).toEqual({
      release_year: true,
      perfumer: true,
      concentration: true,
    });
  });

  it('never renders literal Unknown in user-facing metadata', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: null,
      catalogPerfumer: 'Unknown',
      catalogConcentration: 'Unknown',
      resolverPerfumerNames: [],
      resolverConcentration: 'UNKNOWN',
    });

    expect(display.factLine).toBeNull();
    expect(display.fields.join(' ')).not.toContain('Unknown');
  });

  it('omits metadata for a Miraculous Oud-style catalog row with no known fields', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: null,
      catalogPerfumer: null,
      catalogConcentration: 'UNKNOWN',
      resolverReleaseYear: null,
      resolverPerfumerNames: [],
      resolverConcentration: null,
    });

    expect(display.factLine).toBeNull();
    expect(display.fields).toEqual([]);
  });

  it('renders Sienna-style concentration without unknown release or perfumer labels', () => {
    const display = buildFragranceMetadataDisplay({
      catalogReleaseYear: null,
      catalogPerfumer: null,
      catalogConcentration: 'PARFUM',
      resolverReleaseYear: null,
      resolverPerfumerNames: [],
      resolverConcentration: null,
    });

    expect(display.factLine).toBe('Concentration: PARFUM');
    expect(display.factLine).not.toContain('Released: Unknown');
    expect(display.factLine).not.toContain('Perfumer: Unknown');
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
      'Perfumer: François Merle-Baudoin, Carine Certain Boin · Concentration: EDP',
    );
    expect(display.applied.perfumer).toBe(true);
    expect(display.applied.concentration).toBe(true);
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

  it('builds collection card chips without raw family keys, repeated notes, or loose accord previews', () => {
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
    expect(previewLabels).toEqual([]);
    expect(previewLabels).not.toContain('Italian Lemon');
    expect(previewLabels).not.toContain('Australian Coastal Moss');
    expect(previewLabels).not.toContain('Lemon Italy');
    expect(previewLabels).not.toContain('Sage France');
    expect(previewLabels).not.toContain('Aromatic');
    expect(previewLabels).not.toContain('EDP');
    expect(previewLabels).not.toContain('Official Pyramid');
    expect(previewLabels.length).toBeLessThanOrEqual(3);
  });

  it('keeps Sienna collection preview chips from leaking community-only accord labels', () => {
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
    expect(previewLabels).toEqual([]);
    expect(previewLabels).not.toContain('Aromatic');
    expect(previewLabels).not.toContain('Sea Air');
    expect(previewLabels).not.toContain('Bergamot');
    expect(previewLabels).not.toContain('Soft Coconut');
  });
});
