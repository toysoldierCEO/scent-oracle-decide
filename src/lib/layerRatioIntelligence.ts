export type LayerRatioRole = 'Lead' | 'Anchor';
export type LayerCompanionRole = 'Accent' | 'Lift' | 'Bridge' | 'Smoother' | 'Deepener';

export type LayerRatioFragranceInput = {
  name?: string | null;
  brand?: string | null;
  family?: string | null;
  family_key?: string | null;
  familyKey?: string | null;
  family_label?: string | null;
  familyLabel?: string | null;
  accords?: unknown;
  notes?: unknown;
  top_notes?: unknown;
  topNotes?: unknown;
  heart_notes?: unknown;
  middle_notes?: unknown;
  middleNotes?: unknown;
  base_notes?: unknown;
  baseNotes?: unknown;
  profileChips?: unknown;
  projection?: unknown;
  projection_score?: unknown;
  projectionScore?: unknown;
  strength?: unknown;
  strength_score?: unknown;
  strengthScore?: unknown;
};

export type LayerRatioGuide = {
  anchorName: string;
  companionName: string;
  anchorRole: LayerRatioRole;
  companionRole: LayerCompanionRole;
  ratioLabel: string;
  ratioValue: '1:1' | '2:1' | '3:1';
  anchorSprays: number;
  companionSprays: number;
  anchorPlacement: string;
  companionPlacement: string;
  sprayGuidance: string;
  whyRatio: string;
  dominanceReason: string;
  caution?: string;
  matchedRule: string;
};

type SignalProfile = {
  normalizedName: string;
  displayName: string;
  terms: Set<string>;
  dominanceScore: number;
  liftScore: number;
  denseScore: number;
  softScore: number;
  projectionScore: number | null;
  hasProjectionEvidence: boolean;
};

const DEFAULT_ANCHOR_NAME = 'Anchor';
const DEFAULT_COMPANION_NAME = 'Companion';

const DENSE_TERMS = [
  'oud',
  'agarwood',
  'resin',
  'resinous',
  'leather',
  'suede',
  'incense',
  'smoke',
  'smoky',
  'patchouli',
  'coffee',
  'tobacco',
  'labdanum',
  'amber',
  'vanilla',
  'tonka',
  'gourmand',
  'dark',
  'woody',
  'wood',
  'woods',
];

const LIFT_TERMS = [
  'fresh',
  'citrus',
  'aquatic',
  'green',
  'clean',
  'ozonic',
  'airy',
  'air',
  'bergamot',
  'grapefruit',
  'lemon',
  'lime',
  'orange',
  'mint',
  'sage',
  'rosemary',
  'aromatic',
  'musk',
  'ambroxan',
  'iso e',
  'molecule',
];

const VERY_DOMINANT_TERMS = [
  'nuclear',
  'beast',
  'beast mode',
  'oud',
  'smoke',
  'smoky',
  'incense',
  'leather',
  'ambroxan',
  'iso e',
  'molecule',
];

const SOFT_TERMS = [
  'soft',
  'musk',
  'skin',
  'skin scent',
  'clean',
  'powder',
  'tea',
  'iris',
  'neroli',
];

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function displayName(input: LayerRatioFragranceInput | null | undefined, fallback: string) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  return name || fallback;
}

function extractTextValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractTextValues);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [
      record.label,
      record.name,
      record.note,
      record.token_label,
      record.term,
      record.value,
    ].flatMap(extractTextValues);
  }

  return [];
}

function hasTerm(signal: string, term: string) {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(signal);
}

function readNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizedProjection(value: number | null) {
  if (value == null) return null;
  if (value > 10) return Math.max(0, Math.min(10, value / 10));
  return Math.max(0, Math.min(10, value));
}

function collectSignals(input: LayerRatioFragranceInput | null | undefined) {
  const signals = [
    displayName(input, ''),
    input?.family_key,
    input?.familyKey,
    input?.family,
    input?.family_label,
    input?.familyLabel,
    input?.top_notes,
    input?.topNotes,
    input?.heart_notes,
    input?.middle_notes,
    input?.middleNotes,
    input?.base_notes,
    input?.baseNotes,
    input?.notes,
    input?.accords,
    input?.profileChips,
  ].flatMap(extractTextValues).map(normalizeText).filter(Boolean);

  return signals;
}

function countMatches(signals: string[], terms: string[]) {
  const matched = new Set<string>();
  for (const signal of signals) {
    for (const term of terms) {
      if (hasTerm(signal, term)) {
        matched.add(normalizeText(term));
      }
    }
  }
  return matched.size;
}

function buildSignalProfile(
  input: LayerRatioFragranceInput | null | undefined,
  fallbackName: string,
): SignalProfile {
  const signals = collectSignals(input);
  const terms = new Set(signals);
  const denseScore = countMatches(signals, DENSE_TERMS);
  const liftScore = countMatches(signals, LIFT_TERMS);
  const softScore = countMatches(signals, SOFT_TERMS);
  const veryDominantScore = countMatches(signals, VERY_DOMINANT_TERMS);
  const projection = normalizedProjection(readNumber(
    input?.projection,
    input?.projection_score,
    input?.projectionScore,
    input?.strength,
    input?.strength_score,
    input?.strengthScore,
  ));
  const projectionBoost = projection == null ? 0 : projection >= 9 ? 4 : projection >= 7 ? 2 : projection >= 5 ? 1 : 0;

  return {
    normalizedName: normalizeText(displayName(input, fallbackName)),
    displayName: displayName(input, fallbackName),
    terms,
    denseScore,
    liftScore,
    softScore,
    projectionScore: projection,
    hasProjectionEvidence: projection != null,
    dominanceScore: denseScore + liftScore + veryDominantScore + projectionBoost,
  };
}

function sameName(profile: SignalProfile, expected: string) {
  return profile.normalizedName === normalizeText(expected);
}

function roleForCompanion(profile: SignalProfile): LayerCompanionRole {
  if (profile.liftScore >= 2) return 'Lift';
  if (profile.denseScore >= 3) return 'Deepener';
  if (profile.softScore >= 2) return 'Smoother';
  if (profile.denseScore > 0 || profile.liftScore > 0) return 'Accent';
  return 'Bridge';
}

function hasFakePerformanceText(value: string) {
  return /performance pending|all day|long lasting|projects well/i.test(value);
}

function buildGuide(params: {
  anchorName: string;
  companionName: string;
  companionRole: LayerCompanionRole;
  ratioValue: '1:1' | '2:1' | '3:1';
  anchorSprays: number;
  companionSprays: number;
  anchorPlacement: string;
  companionPlacement: string;
  whyRatio: string;
  dominanceReason: string;
  matchedRule: string;
  caution?: string;
}): LayerRatioGuide {
  const ratioLabel = `${params.anchorSprays} ${params.anchorName} : ${params.companionSprays} ${params.companionName}`;
  const sprayGuidance = params.ratioValue === '1:1'
    ? `Use ${params.anchorSprays} spray of ${params.anchorName}, then ${params.companionSprays} spray of ${params.companionName}.`
    : `Let ${params.anchorName} lead with ${params.anchorSprays} sprays; keep ${params.companionName} to ${params.companionSprays} spray.`;

  return {
    anchorName: params.anchorName,
    companionName: params.companionName,
    anchorRole: 'Lead',
    companionRole: params.companionRole,
    ratioLabel,
    ratioValue: params.ratioValue,
    anchorSprays: params.anchorSprays,
    companionSprays: params.companionSprays,
    anchorPlacement: params.anchorPlacement,
    companionPlacement: params.companionPlacement,
    sprayGuidance: hasFakePerformanceText(sprayGuidance) ? '' : sprayGuidance,
    whyRatio: hasFakePerformanceText(params.whyRatio) ? `${params.anchorName} stays the lead while ${params.companionName} adds controlled support.` : params.whyRatio,
    dominanceReason: params.dominanceReason,
    caution: params.caution,
    matchedRule: params.matchedRule,
  };
}

export function resolveLayerRatioGuide(
  anchor: LayerRatioFragranceInput | null | undefined,
  companion: LayerRatioFragranceInput | null | undefined,
): LayerRatioGuide {
  const anchorProfile = buildSignalProfile(anchor, DEFAULT_ANCHOR_NAME);
  const companionProfile = buildSignalProfile(companion, DEFAULT_COMPANION_NAME);
  const anchorName = anchorProfile.displayName;
  const companionName = companionProfile.displayName;

  if (sameName(anchorProfile, 'Dark Pleasure') && sameName(companionProfile, 'California Winter 2018')) {
    return buildGuide({
      anchorName,
      companionName,
      companionRole: 'Lift',
      ratioValue: '2:1',
      anchorSprays: 2,
      companionSprays: 1,
      anchorPlacement: `${anchorName} - 2 sprays chest / close to body`,
      companionPlacement: `${companionName} - 1 spray back neck, upper shirt, or outer layer`,
      whyRatio: `${anchorName} carries the dark coffee, rose, and patchouli body. ${companionName} adds lift and air, but one spray keeps it controlled.`,
      dominanceReason: 'user correction: California Winter 2018 is a strong lift and should accent Dark Pleasure',
      matchedRule: 'user_override_dark_pleasure_california_winter_2018',
    });
  }

  const companionRole = roleForCompanion(companionProfile);
  const hasAnyEvidence = anchorProfile.dominanceScore > 0
    || companionProfile.dominanceScore > 0
    || anchorProfile.softScore > 0
    || companionProfile.softScore > 0
    || anchorProfile.hasProjectionEvidence
    || companionProfile.hasProjectionEvidence;
  const companionHasProjectionDominance = companionProfile.hasProjectionEvidence && (companionProfile.projectionScore ?? 0) >= 7;
  const companionVeryStrong = (companionProfile.projectionScore ?? 0) >= 9
    || (companionProfile.dominanceScore - anchorProfile.dominanceScore >= 5 && companionProfile.dominanceScore >= 6);
  const equalSoft = anchorProfile.softScore >= 1
    && companionProfile.softScore >= 1
    && Math.abs(anchorProfile.dominanceScore - companionProfile.dominanceScore) <= 1
    && !companionHasProjectionDominance;

  if (!hasAnyEvidence) {
    return buildGuide({
      anchorName,
      companionName,
      companionRole: 'Accent',
      ratioValue: '2:1',
      anchorSprays: 2,
      companionSprays: 1,
      anchorPlacement: `${anchorName} - 2 sprays chest / close to body`,
      companionPlacement: `${companionName} - 1 spray back neck or outer layer`,
      whyRatio: `${anchorName} should stay the lead. Use ${companionName} as a light accent until more evidence is available.`,
      dominanceReason: 'safe default with limited evidence',
      matchedRule: 'safe_default_2_to_1',
    });
  }

  if (companionVeryStrong) {
    const reason = companionProfile.hasProjectionEvidence
      ? 'companion has evidence-backed high projection'
      : 'companion has multiple dominant material signals';
    return buildGuide({
      anchorName,
      companionName,
      companionRole,
      ratioValue: '3:1',
      anchorSprays: 3,
      companionSprays: 1,
      anchorPlacement: `${anchorName} - 3 sprays chest / close to body`,
      companionPlacement: `${companionName} - 1 small spray back neck or outer layer`,
      whyRatio: `${anchorName} stays in front. ${companionName} can take over, so one small accent spray keeps the layer controlled.`,
      dominanceReason: reason,
      matchedRule: 'very_strong_companion_3_to_1',
      caution: `${companionName} should stay at one spray.`,
    });
  }

  if (equalSoft) {
    return buildGuide({
      anchorName,
      companionName,
      companionRole: 'Bridge',
      ratioValue: '1:1',
      anchorSprays: 1,
      companionSprays: 1,
      anchorPlacement: `${anchorName} - 1 spray chest or inner elbow`,
      companionPlacement: `${companionName} - 1 spray back neck or outer layer`,
      whyRatio: `${anchorName} and ${companionName} are soft enough to share the wear without either replacing the other.`,
      dominanceReason: 'balanced soft profiles',
      matchedRule: 'equal_soft_1_to_1',
    });
  }

  if (companionHasProjectionDominance || companionProfile.liftScore >= 2 || companionProfile.dominanceScore >= anchorProfile.dominanceScore) {
    const dominanceReason = companionHasProjectionDominance
      ? 'companion has evidence-backed projection'
      : companionProfile.liftScore >= 2
        ? 'companion has bright lift signals'
        : 'companion has comparable dominance signals';
    return buildGuide({
      anchorName,
      companionName,
      companionRole,
      ratioValue: '2:1',
      anchorSprays: 2,
      companionSprays: 1,
      anchorPlacement: `${anchorName} - 2 sprays chest / close to body`,
      companionPlacement: `${companionName} - 1 spray back neck, upper shirt, or outer layer`,
      whyRatio: `${anchorName} leads the wear. ${companionName} adds ${companionRole.toLowerCase()}, but one spray keeps it from taking over.`,
      dominanceReason,
      matchedRule: companionHasProjectionDominance ? 'projection_companion_2_to_1' : 'dominant_companion_2_to_1',
    });
  }

  return buildGuide({
    anchorName,
    companionName,
    companionRole,
    ratioValue: '2:1',
    anchorSprays: 2,
    companionSprays: 1,
    anchorPlacement: `${anchorName} - 2 sprays chest / close to body`,
    companionPlacement: `${companionName} - 1 spray back neck or outer layer`,
    whyRatio: `${anchorName} has enough body to lead. ${companionName} supports it as a controlled accent.`,
    dominanceReason: anchorProfile.denseScore > 0 ? 'anchor has denser base material signals' : 'anchor-led default',
    matchedRule: anchorProfile.denseScore > 0 ? 'dense_anchor_2_to_1' : 'anchor_led_default_2_to_1',
  });
}
