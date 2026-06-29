import {
  applyCommunityEvidenceDisplayPolicy,
  resolveCommunityEvidenceDisplayPolicy,
  type CommunityEvidenceDisplayModel,
} from './communityEvidenceLane';

export type FragranceDisplayChip = {
  label: string;
  position: string;
};

export type FragranceDisplayNoteSection = {
  title: 'Top' | 'Heart' | 'Base';
  position: 'top' | 'heart' | 'base';
  values: string[];
};

export type FragrancePerformanceDisplayMode = 'bars' | 'hidden';
export type FragranceHeaderVisualPlacement = 'after_identity';
export type FragranceTrustLineKind = 'official_pyramid' | 'official_key_notes' | 'provider' | 'metadata';

export type FragranceDetailSectionId =
  | 'family'
  | 'description'
  | 'notes'
  | 'key_notes'
  | 'accords'
  | 'community_signals'
  | 'performance'
  | 'source_provenance'
  | 'metadata'
  | 'actions';

type FragranceDetailDisplayModelInput = {
  familyLabel?: string | null;
  familyKey?: string | null;
  accordLabels?: string[] | null;
  topNotes?: string[] | null;
  middleNotes?: string[] | null;
  baseNotes?: string[] | null;
  flatNotes?: string[] | null;
  descriptionText?: string | null;
  communityEvidence?: CommunityEvidenceDisplayModel | null;
  maxHeroChips?: number;
  hasTrustedPerformance?: boolean;
};

type FragranceCardDisplayModelInput = FragranceDetailDisplayModelInput & {
  maxPreviewChips?: number;
};

type FragranceMetadataDisplayInput = {
  catalogReleaseYear?: number | null;
  resolverReleaseYear?: number | null;
  catalogPerfumer?: string | null;
  resolverPerfumerNames?: string[] | null;
  catalogConcentration?: string | null;
  resolverConcentration?: string | null;
};

type FragranceFamilyDisplayInput = {
  familyKey?: string | null;
  familyLabel?: string | null;
  accordLabels?: string[] | null;
  noteLabels?: string[] | null;
};

type FragranceTrustLineInput = {
  kind?: FragranceTrustLineKind | null;
  sourceName?: string | null;
  fallbackBrand?: string | null;
};

type SourceBackedPyramidDescriptionInput = {
  familyKey?: string | null;
  topNotes?: string[] | null;
  middleNotes?: string[] | null;
  baseNotes?: string[] | null;
  flatNotes?: string[] | null;
};

type VesperizingNoticeInput = {
  isCanonicalFragrance?: boolean;
  isMatchedExistingIntake?: boolean;
  isUnresolvedIntake?: boolean;
  isLoading?: boolean;
};

const SOURCE_BACKED_NOTE_LABELS: Record<string, string> = {
  'lemon italy': 'Italian Lemon',
  'sage france': 'French Sage',
  'geranium egypt': 'Egyptian Geranium',
  'cedarwood virginia usa': 'Virginia Cedarwood',
  whitemusk: 'White Musk',
  'white musk': 'White Musk',
  'australian coastal moss': 'Australian Coastal Moss',
};

const METADATA_LABEL_KEYS = new Set([
  'edp',
  'edt',
  'eau de parfum',
  'eau de toilette',
  'extrait',
  'extrait de parfum',
  'parfum',
  'pure parfum',
  'cologne',
  'eau de cologne',
  'unknown',
  'released unknown',
  'perfumer unknown',
  'concentration unknown',
]);

const SOURCE_PROVENANCE_LABEL_KEYS = new Set([
  'official pyramid',
  'official source',
  'official source notes',
  'source backed',
  'source backed notes',
  'source backed metadata',
  'provider notes',
  'structured retailer data',
  'official product page concentration',
]);

const PROCESSING_OR_STATE_LABEL_KEYS = new Set([
  'vesperizing',
  'source check pending',
  'limited intel',
  'wear strength not verified',
  'evidence limited performance',
  'evidence-limited performance',
  'community performance unavailable',
  'performance unknown after search',
]);

const FAMILY_DISPLAY_LABELS: Record<string, string> = {
  'fresh blue': 'Fresh Aquatic',
  'fresh aquatic': 'Fresh Aquatic',
};

const RAW_FAMILY_LABEL_DISPLAY_MAP: Record<string, string> = {
  'fresh blue': 'Fresh Aquatic',
  'fresh-blue': 'Fresh Aquatic',
  'fresh aquatic': 'Fresh Aquatic',
  'fresh-aquatic': 'Fresh Aquatic',
};

const INTERNAL_SOURCE_NAME_KEYS = new Set([
  'public fragrances',
  'public fragrance',
  'public.fragrances',
  'fragrances',
  'fragrance official source registry',
  'fragrance official source registry v1',
  'provider intelligence',
  'metadata evidence',
]);

const GROUNDED_WEAR_CONTEXT_LABELS = new Set([
  'daily',
  'work',
  'evening',
  'date night',
  'hot weather',
  'cold weather',
  'fresh daytime',
  'anchor',
]);

const LAYER_TOOL_LABELS = new Set([
  'layer tool',
  'layer tools',
  'layer-tool',
  'layer_tool',
]);

function normalizeDisplayKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDisplayTitleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function cleanStringList(values: string[] | null | undefined) {
  const result: string[] = [];
  for (const value of values ?? []) {
    const label = typeof value === 'string' ? value.trim() : '';
    if (label) result.push(label);
  }
  return result;
}

function normalizeText(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function isKnownConcentrationValue(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return !!normalized && normalized.toUpperCase() !== 'UNKNOWN';
}

function isKnownPerfumerValue(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return !!normalized && normalized.toUpperCase() !== 'UNKNOWN';
}

function isKnownReleaseYearValue(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function dedupeChips(chips: FragranceDisplayChip[]) {
  const seen = new Set<string>();
  const result: FragranceDisplayChip[] = [];
  for (const chip of chips) {
    const label = chip.label.trim();
    if (!label) continue;
    const key = `${chip.position.toLowerCase()}|${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ label, position: chip.position });
  }
  return result;
}

export function formatFragranceNoteDisplayLabel(value: string | null | undefined) {
  const key = normalizeDisplayKey(value);
  if (!key) return '';
  return SOURCE_BACKED_NOTE_LABELS[key] ?? toDisplayTitleCase(key);
}

export function formatFragranceNoteDisplayLabels(values: string[] | null | undefined, max = 8) {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const value of cleanStringList(values)) {
    const label = formatFragranceNoteDisplayLabel(value);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= max) break;
  }
  return labels;
}

export function formatFragranceFamilyDisplayLabel(input: FragranceFamilyDisplayInput) {
  const familyKey = normalizeDisplayKey(input.familyKey);
  const rawFamilyLabel = normalizeText(input.familyLabel);
  const familyLabelKey = normalizeDisplayKey(rawFamilyLabel);
  if (familyKey && FAMILY_DISPLAY_LABELS[familyKey]) return FAMILY_DISPLAY_LABELS[familyKey];
  if (familyLabelKey && RAW_FAMILY_LABEL_DISPLAY_MAP[familyLabelKey]) return RAW_FAMILY_LABEL_DISPLAY_MAP[familyLabelKey];

  const joinedSource = [
    familyKey,
    familyLabelKey,
    ...cleanStringList(input.accordLabels).map(normalizeDisplayKey),
    ...cleanStringList(input.noteLabels).map(normalizeDisplayKey),
  ].join(' ');
  if (/\b(aquatic|marine|oceanic|coastal|sea air|sea-air|watery|blue)\b/.test(joinedSource)) {
    return 'Fresh Aquatic';
  }
  if (/\b(fresh|clean|bright|citrus|green|airy)\b/.test(joinedSource)) {
    return 'Fresh';
  }

  if (rawFamilyLabel && !/[-_]/.test(rawFamilyLabel)) return rawFamilyLabel;
  if (familyKey) return toDisplayTitleCase(familyKey.replace(/[-_]+/g, ' '));
  return rawFamilyLabel;
}

export function getFragranceFamilySemanticColorKey(input: FragranceFamilyDisplayInput) {
  const familyKey = normalizeDisplayKey(input.familyKey);
  if (familyKey === 'fresh blue' || familyKey === 'fresh aquatic') return 'fresh-aquatic';
  if (familyKey === 'fresh') return 'fresh';
  if (familyKey) return familyKey.replace(/\s+/g, '-');

  const familyLabel = formatFragranceFamilyDisplayLabel(input);
  const familyLabelKey = normalizeDisplayKey(familyLabel);
  if (familyLabelKey === 'fresh aquatic') return 'fresh-aquatic';
  if (familyLabelKey === 'fresh') return 'fresh';
  return familyLabelKey ? familyLabelKey.replace(/\s+/g, '-') : null;
}

export function formatSourceDisplayName(
  sourceName: string | null | undefined,
  fallbackBrand?: string | null,
) {
  const source = normalizeText(sourceName);
  const fallback = normalizeText(fallbackBrand);
  const sourceKey = normalizeDisplayKey(source);
  if (source && sourceKey && !INTERNAL_SOURCE_NAME_KEYS.has(sourceKey)) return source;
  return fallback ?? 'official source';
}

export function isLikelyOfficialBrandSourceUrl(
  sourceUrl: string | null | undefined,
  brand: string | null | undefined,
) {
  const source = normalizeText(sourceUrl);
  const brandName = normalizeText(brand);
  if (!source || !brandName) return false;

  let host = '';
  try {
    host = new URL(source).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }

  const tokens = brandName
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !['the', 'and', 'parfum', 'parfums', 'perfume', 'perfumes'].includes(token));
  const meaningfulTokens = tokens.filter((token) => !['fragrance', 'fragrances', 'aromatics'].includes(token));
  const requiredTokens = meaningfulTokens.length > 0 ? meaningfulTokens : tokens;
  if (requiredTokens.length === 0) return false;
  return requiredTokens.every((token) => host.includes(token));
}

export function buildFragranceTrustLine(input: FragranceTrustLineInput) {
  const kind = input.kind ?? null;
  const source = formatSourceDisplayName(input.sourceName, input.fallbackBrand);
  if (kind === 'official_pyramid') return `Source-backed notes · Official source · ${source}`;
  if (kind === 'official_key_notes') return `Official source-backed key notes · Official source · ${source}`;
  if (kind === 'provider') return 'Source-backed notes · Structured provider data · brand confirmation pending';
  if (kind === 'metadata') return 'Source-backed metadata · Official product-page metadata';
  return null;
}

export function isLayerToolActionLabel(value: string | null | undefined) {
  const key = normalizeDisplayKey(value);
  return !!key && LAYER_TOOL_LABELS.has(key);
}

export function isGroundedWearContextLabel(value: string | null | undefined) {
  const key = normalizeDisplayKey(value);
  if (!key || isLayerToolActionLabel(key)) return false;
  return GROUNDED_WEAR_CONTEXT_LABELS.has(key);
}

export function formatFragranceNoteProsePhrase(
  value: string | null | undefined,
  context: 'opening' | 'heart' | 'base',
) {
  const label = formatFragranceNoteDisplayLabel(value);
  const key = normalizeDisplayKey(label);
  if (!key) return '';
  if (context === 'opening' && key === 'italian lemon') return 'Italian lemon';
  if (context === 'opening' && key === 'australian coastal moss') return 'coastal moss';
  if (context === 'heart' && key === 'french sage') return 'sage';
  if (context === 'heart' && key === 'egyptian geranium') return 'geranium';
  if (context === 'base' && key === 'virginia cedarwood') return 'Virginia cedarwood';
  if (context === 'base' && key === 'white musk') return 'clean white musk';
  return label.toLowerCase();
}

export function isMetadataLabel(value: string | null | undefined) {
  const key = normalizeDisplayKey(value);
  if (!key) return false;
  return METADATA_LABEL_KEYS.has(key)
    || key.startsWith('released ')
    || key.startsWith('perfumer ')
    || key.startsWith('concentration ');
}

export function isSourceProvenanceLabel(value: string | null | undefined) {
  const key = normalizeDisplayKey(value);
  if (!key) return false;
  return SOURCE_PROVENANCE_LABEL_KEYS.has(key)
    || key.includes('official source')
    || key.includes('source backed')
    || key.includes('brand confirmation pending');
}

export function isProcessingOrStateLabel(value: string | null | undefined) {
  const key = normalizeDisplayKey(value);
  if (!key) return false;
  return PROCESSING_OR_STATE_LABEL_KEYS.has(key)
    || key.includes('vesperizing')
    || (key.includes('performance') && key.includes('pending'));
}

export function isScentProfileChip(value: string | null | undefined) {
  const label = String(value ?? '').trim();
  if (!label) return false;
  return !isMetadataLabel(label)
    && !isSourceProvenanceLabel(label)
    && !isProcessingOrStateLabel(label);
}

export function shouldShowVesperizingNotice(input: VesperizingNoticeInput) {
  if (input.isCanonicalFragrance || input.isMatchedExistingIntake) return false;
  if (input.isUnresolvedIntake) return true;
  return Boolean(input.isLoading && !input.isCanonicalFragrance);
}

export function buildFragranceMetadataDisplay(input: FragranceMetadataDisplayInput) {
  const catalogReleaseYear = isKnownReleaseYearValue(input.catalogReleaseYear)
    ? input.catalogReleaseYear
    : null;
  const resolverReleaseYear = isKnownReleaseYearValue(input.resolverReleaseYear)
    ? input.resolverReleaseYear
    : null;
  const catalogPerfumer = isKnownPerfumerValue(input.catalogPerfumer)
    ? normalizeText(input.catalogPerfumer)
    : null;
  const resolverPerfumerNames = cleanStringList(input.resolverPerfumerNames).slice(0, 4);
  const resolverPerfumer = resolverPerfumerNames.length > 0 ? resolverPerfumerNames.join(', ') : null;
  const catalogConcentration = isKnownConcentrationValue(input.catalogConcentration)
    ? normalizeText(input.catalogConcentration)
    : null;
  const resolverConcentration = isKnownConcentrationValue(input.resolverConcentration)
    ? normalizeText(input.resolverConcentration)
    : null;
  const releaseYear = resolverReleaseYear ?? catalogReleaseYear;
  const perfumer = resolverPerfumer ?? catalogPerfumer;
  const concentration = resolverConcentration ?? catalogConcentration;
  const fields = [
    releaseYear != null ? `Released: ${String(releaseYear)}` : null,
    perfumer ? `Perfumer: ${perfumer}` : null,
    concentration ? `Concentration: ${concentration}` : null,
  ].filter((field): field is string => Boolean(field));

  return {
    releaseYear,
    perfumer,
    concentration,
    applied: {
      release_year: resolverReleaseYear != null,
      perfumer: !!resolverPerfumer,
      concentration: !!resolverConcentration,
    },
    fields,
    factLine: fields.length > 0 ? fields.join(' · ') : null,
  };
}

export function buildSourceBackedPyramidDescription(input: SourceBackedPyramidDescriptionInput) {
  const topLabels = formatFragranceNoteDisplayLabels(input.topNotes, 3);
  const middleLabels = formatFragranceNoteDisplayLabels(input.middleNotes, 3);
  const baseLabels = formatFragranceNoteDisplayLabels(input.baseNotes, 3);
  if (topLabels.length === 0 || middleLabels.length === 0 || baseLabels.length === 0) return null;

  const joined = [
    normalizeDisplayKey(input.familyKey),
    ...cleanStringList(input.flatNotes).map(normalizeDisplayKey),
    ...topLabels.map(normalizeDisplayKey),
    ...middleLabels.map(normalizeDisplayKey),
    ...baseLabels.map(normalizeDisplayKey),
  ].join(' ');
  const isFreshAquaticProfile = normalizeDisplayKey(input.familyKey) === 'fresh-blue'
    || normalizeDisplayKey(input.familyKey) === 'fresh blue'
    || /\b(lemon|coastal moss|aquatic|fresh|sage|geranium)\b/.test(joined);
  if (!isFreshAquaticProfile) return null;

  const joinPhrases = (parts: string[]) => {
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0]!;
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts[0]}, ${parts[1]}, and ${parts[2]}`;
  };
  const topPhrase = joinPhrases(topLabels.map((label) => formatFragranceNoteProsePhrase(label, 'opening')));
  const heartPhrase = joinPhrases(middleLabels.map((label) => formatFragranceNoteProsePhrase(label, 'heart')));
  const basePhrase = joinPhrases(baseLabels.map((label) => formatFragranceNoteProsePhrase(label, 'base')));
  if (!topPhrase || !heartPhrase || !basePhrase) return null;

  return `Bright ${topPhrase} open crisp and airy, moving into ${heartPhrase} before drying down to ${basePhrase}.`;
}

export function buildFragranceDetailDisplayModel(input: FragranceDetailDisplayModelInput) {
  const topLabels = formatFragranceNoteDisplayLabels(input.topNotes, 6);
  const middleLabels = formatFragranceNoteDisplayLabels(input.middleNotes, 6);
  const baseLabels = formatFragranceNoteDisplayLabels(input.baseNotes, 6);
  const flatNoteLabels = formatFragranceNoteDisplayLabels(input.flatNotes, 8);
  const structuredNoteSections: FragranceDisplayNoteSection[] = [
    { title: 'Top', position: 'top', values: topLabels },
    { title: 'Heart', position: 'heart', values: middleLabels },
    { title: 'Base', position: 'base', values: baseLabels },
  ].filter((section) => section.values.length > 0);
  const hasStructuredNoteSections = structuredNoteSections.length > 0;
  const chips: FragranceDisplayChip[] = [];

  const pushChip = (label: string | null | undefined, position: string) => {
    const trimmed = typeof label === 'string' ? label.trim() : '';
    if (!isScentProfileChip(trimmed)) return;
    chips.push({ label: trimmed, position });
  };

  const familyDisplayLabel = formatFragranceFamilyDisplayLabel({
    familyKey: input.familyKey,
    familyLabel: input.familyLabel,
    accordLabels: input.accordLabels,
    noteLabels: [
      ...cleanStringList(input.flatNotes),
      ...cleanStringList(input.topNotes),
      ...cleanStringList(input.middleNotes),
      ...cleanStringList(input.baseNotes),
    ],
  });
  pushChip(familyDisplayLabel, 'family');

  const identityNoteLabels = hasStructuredNoteSections
    ? [...topLabels, ...middleLabels, ...baseLabels]
    : flatNoteLabels;
  const preferredIdentityPatterns = [
    /coastal moss/i,
    /lemon/i,
    /sage/i,
    /cedarwood/i,
    /musk/i,
    /geranium/i,
  ];
  for (const pattern of preferredIdentityPatterns) {
    const match = identityNoteLabels.find((label) => pattern.test(label));
    pushChip(match, 'note');
  }
  for (const label of identityNoteLabels) {
    if (chips.length >= (input.maxHeroChips ?? 8)) break;
    pushChip(label, 'note');
  }

  const familyKey = normalizeDisplayKey(familyDisplayLabel);
  const rawCommunityEvidence = input.communityEvidence ?? null;
  const communityEvidenceDisplayPolicy = resolveCommunityEvidenceDisplayPolicy({
    communityEvidence: rawCommunityEvidence,
    officialNotes: {
      flatNotes: input.flatNotes,
      topNotes: input.topNotes,
      middleNotes: input.middleNotes,
      baseNotes: input.baseNotes,
    },
  });
  const communityEvidence = applyCommunityEvidenceDisplayPolicy(
    rawCommunityEvidence,
    communityEvidenceDisplayPolicy,
  );
  const availableAccords = cleanStringList([
    ...cleanStringList(input.accordLabels),
    ...(communityEvidence?.accords ?? []),
  ]).filter((accord) => normalizeDisplayKey(accord) !== familyKey);
  const hasAccords = availableAccords.some((accord) => isScentProfileChip(accord));
  const priorityPatterns = [
    /\bleather|leathery\b/i,
    /\boud|amber|resin|resinous|incense\b/i,
    /\bcitrus|bergamot|neroli|orange|grapefruit|lemon\b/i,
    /\bgreen|aromatic|herbal\b/i,
    /\bwoody|wood\b/i,
    /\bspicy|spice\b/i,
    /\bfloral\b/i,
    /\bgourmand|sweet\b/i,
    /\bfruity|fruit\b/i,
  ];
  const preferredAccord = priorityPatterns
    .map((pattern) => availableAccords.find((accord) => pattern.test(accord)))
    .find(Boolean)
    ?? availableAccords.find((accord) => isScentProfileChip(accord))
    ?? null;
  pushChip(preferredAccord, 'accord');
  const descriptionText = normalizeText(input.descriptionText)
    ?? buildSourceBackedPyramidDescription({
      familyKey: input.familyKey,
      topNotes: input.topNotes,
      middleNotes: input.middleNotes,
      baseNotes: input.baseNotes,
      flatNotes: input.flatNotes,
    });
  const detailSectionOrder: FragranceDetailSectionId[] = ['family'];
  if (descriptionText) detailSectionOrder.push('description');
  if (hasStructuredNoteSections) {
    detailSectionOrder.push('notes');
  } else if (flatNoteLabels.length > 0) {
    detailSectionOrder.push('key_notes');
  }
  if (hasAccords) detailSectionOrder.push('accords');
  if (communityEvidence?.hasCommunitySignalsSection) detailSectionOrder.push('community_signals');
  if (input.hasTrustedPerformance) detailSectionOrder.push('performance');
  detailSectionOrder.push('metadata', 'source_provenance', 'actions');

  return {
    headerLayoutOrder: ['title', 'brand', 'family'] as const,
    headerVisualPlacement: 'after_identity' as FragranceHeaderVisualPlacement,
    descriptionText,
    hasDescriptionSection: Boolean(descriptionText),
    familyDisplayLabel,
    familyChip: familyDisplayLabel
      ? { label: familyDisplayLabel, position: 'family' }
      : null,
    performanceDisplayMode: input.hasTrustedPerformance ? 'bars' as FragrancePerformanceDisplayMode : 'hidden' as FragrancePerformanceDisplayMode,
    hasPerformanceSection: Boolean(input.hasTrustedPerformance),
    topIdentityChips: familyDisplayLabel
      ? dedupeChips([{ label: familyDisplayLabel, position: 'family' }]).slice(0, 1)
      : [],
    detailSectionOrder,
    topLabels,
    middleLabels,
    baseLabels,
    accordLabels: availableAccords,
    flatNoteLabels,
    hasStructuredNoteSections,
    structuredNoteSections,
    communityEvidence,
    hasCommunitySignalsSection: Boolean(communityEvidence?.hasCommunitySignalsSection),
    communityEvidenceDisplayPolicy,
    heroProfileChips: dedupeChips(chips).slice(0, input.maxHeroChips ?? 8),
  };
}

export function buildFragranceCardDisplayModel(input: FragranceCardDisplayModelInput) {
  const familyChipLabel = formatFragranceFamilyDisplayLabel({
    familyKey: input.familyKey,
    familyLabel: input.familyLabel,
    accordLabels: input.accordLabels,
    noteLabels: [
      ...cleanStringList(input.flatNotes),
      ...cleanStringList(input.topNotes),
      ...cleanStringList(input.middleNotes),
      ...cleanStringList(input.baseNotes),
    ],
  }) ?? 'Unclassified';
  const familyKey = normalizeDisplayKey(familyChipLabel);
  const model = buildFragranceDetailDisplayModel({
    ...input,
    familyLabel: familyChipLabel,
    maxHeroChips: Math.max((input.maxPreviewChips ?? 3) + 2, 5),
  });
  const previewChips = model.heroProfileChips
    .filter((chip) => chip.position !== 'family')
    .filter((chip) => chip.position !== 'note')
    .filter((chip) => chip.position !== 'accord')
    .filter((chip) => normalizeDisplayKey(chip.label) !== familyKey)
    .filter((chip) => isScentProfileChip(chip.label))
    .slice(0, input.maxPreviewChips ?? 3);

  return {
    familyChipLabel,
    previewChips,
  };
}
