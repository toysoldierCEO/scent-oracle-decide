export type CommunityEvidenceSourceType =
  | 'community_provider'
  | 'retailer_provider'
  | 'retailer'
  | 'professional_provider'
  | 'review_aggregate'
  | 'provider_metadata';

export type CommunityEvidenceStatus =
  | 'proposed'
  | 'approved_for_internal_use'
  | 'rejected'
  | 'held_for_review'
  | 'reviewed'
  | 'superseded';

export type CommunityPerformanceMetricEvidence = {
  votesTotal?: number | null;
  distribution?: Record<string, number> | null;
};

export type CommunityPerformanceEvidence = {
  longevity?: CommunityPerformanceMetricEvidence | null;
  projection?: CommunityPerformanceMetricEvidence | null;
  sillage?: CommunityPerformanceMetricEvidence | null;
  trail?: CommunityPerformanceMetricEvidence | null;
};

export type CommunityEvidencePyramidInput = {
  top?: string[] | null;
  heart?: string[] | null;
  base?: string[] | null;
};

export type CommunityEvidenceInput = {
  canonicalFragranceId?: string | null;
  sourceType?: CommunityEvidenceSourceType | string | null;
  sourceTier?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  reviewStatus?: CommunityEvidenceStatus | string | null;
  evidenceStatus?: string | null;
  usableForVesperIntelligence?: boolean | null;
  officialRegistryEligible?: boolean | null;
  patchSafeNow?: boolean | null;
  normalizedNotes?: string[] | null;
  normalizedPyramid?: CommunityEvidencePyramidInput | null;
  normalizedAccords?: string[] | null;
  extractionConfidence?: number | null;
  extractionWarnings?: string[] | null;
  communityPerformance?: CommunityPerformanceEvidence | null;
};

export type CommunityEvidenceOfficialNotesInput = {
  flatNotes?: string[] | null;
  topNotes?: string[] | null;
  middleNotes?: string[] | null;
  baseNotes?: string[] | null;
};

export type CommunityEvidenceDisplayModel = {
  hasApprovedEvidence: boolean;
  officialRegistryEligible: false;
  officialNotesPreserved: true;
  sourceNames: string[];
  sourceLabel: string | null;
  trustLine: string | null;
  accords: string[];
  communityNotes: string[];
  hasCommunitySignalsSection: boolean;
  communityPerformance: CommunityPerformanceEvidence | null;
  hasCommunityPerformance: boolean;
  conflictsWithOfficialNotes: boolean;
  conflictSummary: string | null;
  recommendationSignals: {
    authority: 'supplemental_non_official';
    styleAccords: string[];
    communityPerformanceAvailable: boolean;
    canSupplementMatching: boolean;
  };
};

export type CommunityEvidenceDisplayPolicyReason =
  | 'no_approved_community_evidence'
  | 'official_notes_complete_default_hidden'
  | 'official_notes_missing_or_incomplete'
  | 'community_performance_evidence'
  | 'recommendation_explanation_context'
  | 'meaningful_conflict';

export type CommunityEvidenceDisplayPolicyInput = {
  communityEvidence?: CommunityEvidenceDisplayModel | null;
  officialNotes?: CommunityEvidenceOfficialNotesInput | null;
  recommendationExplanationContext?: boolean | null;
  hasMeaningfulUserFacingConflict?: boolean | null;
};

export type CommunityEvidenceDisplayPolicy = {
  showCommunityAccords: boolean;
  showCommunitySignals: boolean;
  showCommunitySourceTrust: boolean;
  showCommunityWearEvidence: boolean;
  officialNotesCompleteEnough: boolean;
  reason: CommunityEvidenceDisplayPolicyReason;
};

const INTERNAL_SOURCE_NAME_KEYS = new Set([
  'public fragrances',
  'public.fragrances',
  'fragrances',
  'fragrance provider intelligence registry v1',
  'fragrance_provider_intelligence_registry_v1',
  'provider intelligence',
  'official source evidence registry',
]);

function normalizeText(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function normalizeDisplayKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function cleanList(values: string[] | null | undefined, formatter: (value: string) => string) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const label = formatter(normalized);
    const key = normalizeDisplayKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

function mergeUnique(values: string[], limit: number) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const label = normalizeText(value);
    if (!label) continue;
    const key = normalizeDisplayKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeAccordLabel(value: string) {
  return value.trim().toLowerCase();
}

function normalizeNoteLabel(value: string) {
  return titleCase(value);
}

function normalizeSourceName(value: string | null | undefined) {
  const source = normalizeText(value);
  const key = normalizeDisplayKey(source);
  if (!source || !key || INTERNAL_SOURCE_NAME_KEYS.has(key)) return null;
  return source;
}

function isOfficialSourceType(value: string | null | undefined) {
  const key = normalizeDisplayKey(value);
  return key === 'official brand' || key === 'official source' || key === 'official_brand';
}

export function isApprovedCommunityEvidenceInput(input: CommunityEvidenceInput) {
  if (input.reviewStatus !== 'approved_for_internal_use') return false;
  if (input.evidenceStatus && input.evidenceStatus !== 'usable_non_official_intelligence') return false;
  if (input.usableForVesperIntelligence === false) return false;
  if (input.officialRegistryEligible !== false) return false;
  if (input.patchSafeNow === true) return false;
  if (isOfficialSourceType(input.sourceType)) return false;
  return true;
}

function hasMetricEvidence(metric: CommunityPerformanceMetricEvidence | null | undefined) {
  if (!metric) return false;
  if (typeof metric.votesTotal === 'number' && metric.votesTotal > 0) return true;
  return Object.values(metric.distribution ?? {}).some((value) => Number(value) > 0);
}

function hasCommunityPerformanceEvidence(performance: CommunityPerformanceEvidence | null | undefined) {
  return Boolean(
    hasMetricEvidence(performance?.longevity)
      || hasMetricEvidence(performance?.projection)
      || hasMetricEvidence(performance?.sillage)
      || hasMetricEvidence(performance?.trail),
  );
}

function buildOfficialNoteKeySet(officialNotes: CommunityEvidenceOfficialNotesInput | null | undefined) {
  const values = [
    ...(officialNotes?.flatNotes ?? []),
    ...(officialNotes?.topNotes ?? []),
    ...(officialNotes?.middleNotes ?? []),
    ...(officialNotes?.baseNotes ?? []),
  ];
  return new Set(cleanList(values, normalizeNoteLabel).map(normalizeDisplayKey));
}

function countPopulatedOfficialNoteLayers(officialNotes: CommunityEvidenceOfficialNotesInput | null | undefined) {
  return [
    officialNotes?.topNotes,
    officialNotes?.middleNotes,
    officialNotes?.baseNotes,
  ].filter((values) => cleanList(values, normalizeNoteLabel).length > 0).length;
}

function countMeaningfulOfficialNotes(officialNotes: CommunityEvidenceOfficialNotesInput | null | undefined) {
  return buildOfficialNoteKeySet(officialNotes).size;
}

function buildSourceLabel(sourceNames: string[]) {
  if (sourceNames.length === 0) return null;
  if (sourceNames.length <= 2) return sourceNames.join(', ');
  return `${sourceNames.slice(0, 2).join(', ')} +${sourceNames.length - 2}`;
}

export function buildEmptyCommunityEvidenceDisplayModel(): CommunityEvidenceDisplayModel {
  return {
    hasApprovedEvidence: false,
    officialRegistryEligible: false,
    officialNotesPreserved: true,
    sourceNames: [],
    sourceLabel: null,
    trustLine: null,
    accords: [],
    communityNotes: [],
    hasCommunitySignalsSection: false,
    communityPerformance: null,
    hasCommunityPerformance: false,
    conflictsWithOfficialNotes: false,
    conflictSummary: null,
    recommendationSignals: {
      authority: 'supplemental_non_official',
      styleAccords: [],
      communityPerformanceAvailable: false,
      canSupplementMatching: false,
    },
  };
}

export function buildCommunityEvidenceDisplayModel(
  inputs: CommunityEvidenceInput[] | null | undefined,
  officialNotes?: CommunityEvidenceOfficialNotesInput | null,
): CommunityEvidenceDisplayModel {
  const approvedInputs = (inputs ?? []).filter(isApprovedCommunityEvidenceInput);
  if (approvedInputs.length === 0) return buildEmptyCommunityEvidenceDisplayModel();

  const sourceNames = mergeUnique(
    approvedInputs
      .map((input) => normalizeSourceName(input.sourceName))
      .filter((source): source is string => Boolean(source)),
    4,
  );
  const sourceLabel = buildSourceLabel(sourceNames);
  const accordLabels = mergeUnique(
    approvedInputs.flatMap((input) => cleanList(input.normalizedAccords, normalizeAccordLabel)),
    12,
  );
  const communityNotes = mergeUnique(
    approvedInputs.flatMap((input) => [
      ...cleanList(input.normalizedNotes, normalizeNoteLabel),
      ...cleanList(input.normalizedPyramid?.top, normalizeNoteLabel),
      ...cleanList(input.normalizedPyramid?.heart, normalizeNoteLabel),
      ...cleanList(input.normalizedPyramid?.base, normalizeNoteLabel),
    ]),
    14,
  );
  const communityPerformance = approvedInputs.find((input) => (
    hasCommunityPerformanceEvidence(input.communityPerformance)
  ))?.communityPerformance ?? null;
  const hasCommunityPerformance = hasCommunityPerformanceEvidence(communityPerformance);
  const officialNoteKeys = buildOfficialNoteKeySet(officialNotes);
  const communityNotesOutsideOfficial = officialNoteKeys.size > 0
    ? communityNotes.filter((note) => !officialNoteKeys.has(normalizeDisplayKey(note)))
    : [];
  const conflictsWithOfficialNotes = communityNotesOutsideOfficial.length > 0;
  const conflictSummary = conflictsWithOfficialNotes
    ? `Community mentions differ from official notes (${communityNotesOutsideOfficial.slice(0, 3).join(', ')}); official notes are preserved.`
    : null;
  const hasApprovedEvidence = accordLabels.length > 0
    || communityNotes.length > 0
    || hasCommunityPerformance;
  const canSupplementMatching = accordLabels.length > 0 || communityNotes.length > 0 || hasCommunityPerformance;

  return {
    hasApprovedEvidence,
    officialRegistryEligible: false,
    officialNotesPreserved: true,
    sourceNames,
    sourceLabel,
    trustLine: hasApprovedEvidence && sourceLabel
      ? `Community/provider evidence · ${sourceLabel}`
      : null,
    accords: accordLabels,
    communityNotes,
    hasCommunitySignalsSection: communityNotes.length > 0 || conflictsWithOfficialNotes,
    communityPerformance,
    hasCommunityPerformance,
    conflictsWithOfficialNotes,
    conflictSummary,
    recommendationSignals: {
      authority: 'supplemental_non_official',
      styleAccords: accordLabels,
      communityPerformanceAvailable: hasCommunityPerformance,
      canSupplementMatching,
    },
  };
}

export function resolveCommunityEvidenceDisplayPolicy(
  input: CommunityEvidenceDisplayPolicyInput,
): CommunityEvidenceDisplayPolicy {
  const communityEvidence = input.communityEvidence ?? null;
  const baseHidden = {
    showCommunityAccords: false,
    showCommunitySignals: false,
    showCommunitySourceTrust: false,
    showCommunityWearEvidence: false,
  };
  const officialNotesCompleteEnough = countPopulatedOfficialNoteLayers(input.officialNotes) >= 2
    || countMeaningfulOfficialNotes(input.officialNotes) >= 3;

  if (!communityEvidence?.hasApprovedEvidence) {
    return {
      ...baseHidden,
      officialNotesCompleteEnough,
      reason: 'no_approved_community_evidence',
    };
  }

  const showCommunityWearEvidence = communityEvidence.hasCommunityPerformance;
  const hasCommunityAccords = communityEvidence.accords.length > 0;
  const hasCommunitySignals = communityEvidence.communityNotes.length > 0
    || communityEvidence.hasCommunitySignalsSection;

  if (input.recommendationExplanationContext) {
    const showCommunityAccords = hasCommunityAccords;
    const showCommunitySignals = hasCommunitySignals;
    return {
      showCommunityAccords,
      showCommunitySignals,
      showCommunitySourceTrust: showCommunityAccords || showCommunitySignals || showCommunityWearEvidence,
      showCommunityWearEvidence,
      officialNotesCompleteEnough,
      reason: 'recommendation_explanation_context',
    };
  }

  if (showCommunityWearEvidence) {
    return {
      showCommunityAccords: false,
      showCommunitySignals: false,
      showCommunitySourceTrust: true,
      showCommunityWearEvidence,
      officialNotesCompleteEnough,
      reason: 'community_performance_evidence',
    };
  }

  if (input.hasMeaningfulUserFacingConflict) {
    return {
      showCommunityAccords: false,
      showCommunitySignals: hasCommunitySignals,
      showCommunitySourceTrust: hasCommunitySignals,
      showCommunityWearEvidence,
      officialNotesCompleteEnough,
      reason: 'meaningful_conflict',
    };
  }

  if (officialNotesCompleteEnough) {
    return {
      ...baseHidden,
      officialNotesCompleteEnough,
      reason: 'official_notes_complete_default_hidden',
    };
  }

  const showCommunityAccords = hasCommunityAccords;
  const showCommunitySignals = hasCommunitySignals;
  return {
    showCommunityAccords,
    showCommunitySignals,
    showCommunitySourceTrust: showCommunityAccords || showCommunitySignals,
    showCommunityWearEvidence,
    officialNotesCompleteEnough,
    reason: 'official_notes_missing_or_incomplete',
  };
}

export function applyCommunityEvidenceDisplayPolicy(
  communityEvidence: CommunityEvidenceDisplayModel | null | undefined,
  policy: CommunityEvidenceDisplayPolicy,
): CommunityEvidenceDisplayModel | null {
  if (!communityEvidence?.hasApprovedEvidence) return null;

  const visibleAccords = policy.showCommunityAccords ? communityEvidence.accords : [];
  const visibleNotes = policy.showCommunitySignals ? communityEvidence.communityNotes : [];
  const showSignalsSection = policy.showCommunitySignals
    && (visibleNotes.length > 0 || Boolean(communityEvidence.conflictSummary));
  const hasCommunityPerformance = policy.showCommunityWearEvidence
    && communityEvidence.hasCommunityPerformance;
  const hasVisibleEvidence = visibleAccords.length > 0
    || showSignalsSection
    || hasCommunityPerformance;

  if (!hasVisibleEvidence) return null;

  return {
    ...communityEvidence,
    trustLine: policy.showCommunitySourceTrust ? communityEvidence.trustLine : null,
    accords: visibleAccords,
    communityNotes: visibleNotes,
    hasCommunitySignalsSection: showSignalsSection,
    communityPerformance: hasCommunityPerformance ? communityEvidence.communityPerformance : null,
    hasCommunityPerformance,
  };
}
