export type TodaysPickPerformanceEvidence = {
  longevityScore?: number | null;
  longevityEvidenceBacked?: boolean | null;
  projectionScore?: number | null;
  projectionEvidenceBacked?: boolean | null;
};

export type TodaysPickProfile = {
  id: string;
  name: string;
  brand?: string | null;
  familyKey?: string | null;
  collectionStatus?: string | null;
  owned?: boolean | null;
  retired?: boolean | null;
  disliked?: boolean | null;
  wishlistOnly?: boolean | null;
  unresolved?: boolean | null;
  profileReady?: boolean | null;
  officialSourceBacked?: boolean | null;
  sourceConfidence?: string | number | null;
  notes?: string[] | null;
  topNotes?: string[] | null;
  heartNotes?: string[] | null;
  baseNotes?: string[] | null;
  accords?: string[] | null;
  providerStructuredAccords?: string[] | null;
  providerStructuredAccordsApproved?: boolean | null;
  communityAccords?: string[] | null;
  communityNotes?: string[] | null;
  performance?: TodaysPickPerformanceEvidence | null;
  sourceRank?: number | null;
};

export type TodaysPickScoringContext = {
  occasion?: string | null;
  weather?: string | null;
  temperatureF?: number | null;
  recentFragranceIds?: string[] | null;
  recentFamilyKeys?: string[] | null;
  recentBrandNames?: string[] | null;
  preferredTerms?: string[] | null;
  dislikedTerms?: string[] | null;
};

export type TodaysPickCandidateScore = {
  id: string;
  name: string;
  brand: string | null;
  familyKey: string | null;
  eligible: boolean;
  exclusions: string[];
  finalScore: number;
  components: {
    userTasteFit: number;
    contextFit: number;
    officialProfileFit: number;
    providerAccordSupport: number;
    communitySupport: number;
    performanceFit: number;
    repetitionPenalty: number;
    diversityAdjustment: number;
    confidence: number;
  };
  evidence: {
    officialDepth: number;
    officialSourceBacked: boolean;
    providerStructuredAccords: boolean;
    communityEvidenceAvailable: boolean;
    performanceEvidencePresent: boolean;
  };
  trace: {
    officialMatches: string[];
    providerAccordMatches: string[];
    communitySignalCategories: string[];
    reasonCodes: string[];
  };
  reasonChipLabel: string | null;
  reasonChipExplanation: string | null;
};

export type TodaysPickScoringResult = {
  winner: TodaysPickCandidateScore | null;
  candidates: TodaysPickCandidateScore[];
  excluded: TodaysPickCandidateScore[];
};

export type TodaysPickScoringTraceEntry = {
  timestamp: string;
  context: string | null;
  temperatureF: number | null;
  winner: {
    id: string;
    name: string;
    brand: string | null;
    score: number;
    reasonChipLabel: string | null;
  } | null;
  candidates: Array<{
    id: string;
    name: string;
    brand: string | null;
    eligible: boolean;
    exclusions: string[];
    finalScore: number;
    components: TodaysPickCandidateScore['components'];
    evidence: TodaysPickCandidateScore['evidence'];
    reasonCodes: string[];
    reasonChipLabel: string | null;
  }>;
};

declare global {
  interface Window {
    __ODARA_TODAYS_PICK_SCORING_TRACE__?: TodaysPickScoringTraceEntry[];
  }
}

const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  amber: [/\bamber\b/, /\bbenzoin\b/, /\blabdanum\b/],
  apple: [/\bapple\b/],
  aquatic: [/\baquatic\b/, /\bmarine\b/, /\bsea\b/, /\bocean\b/, /\bozonic\b/, /\brain\b/],
  aromatic: [/\baromatic\b/, /\blavender\b/, /\bsage\b/, /\brosemary\b/, /\bthyme\b/, /\bbasil\b/, /\bjuniper\b/],
  aventus: [/\baventus\b/, /\bpineapple\b/, /\bbirch\b/],
  br540: [/\bbr540\b/, /\bbaccarat\b/, /\bethymaltol\b/, /\bsaffron sugar\b/],
  citrus: [/\bcitrus\b/, /\bbergamot\b/, /\blemon\b/, /\bgrapefruit\b/, /\borange\b/, /\bmandarin\b/, /\bneroli\b/],
  clean: [/\bclean\b/, /\bsoap\b/, /\bsoapy\b/, /\blaundry\b/],
  dark: [/\bdark\b/, /\bsmoke\b/, /\bsmoky\b/, /\bincense\b/, /\bolebanum\b/, /\bolibanum\b/],
  floral: [/\bfloral\b/, /\brose\b/, /\bjasmine\b/, /\biris\b/, /\bviolet\b/],
  fresh: [/\bfresh\b/, /\bclean\b/, /\bair\b/, /\bairy\b/, /\bozonic\b/],
  fruity: [/\bfruit\b/, /\bfruity\b/, /\bpear\b/, /\bberry\b/, /\bpeach\b/, /\bplum\b/, /\bcherry\b/],
  generic: [/\bgeneric\b/, /\bblue fragrance\b/, /\bshower gel\b/],
  gourmand: [/\bgourmand\b/, /\bcaramel\b/, /\bchocolate\b/, /\bcoffee\b/, /\btonka\b/, /\bpraline\b/],
  green: [/\bgreen\b/, /\bgrass\b/, /\bleaf\b/, /\bgalbanum\b/, /\bcucumber\b/, /\btea\b/, /\bpalm\b/],
  incense: [/\bincense\b/, /\bfrankincense\b/, /\bolibanum\b/, /\bmyrrh\b/],
  leather: [/\bleather\b/, /\bsuede\b/],
  metallic: [/\bmetallic\b/, /\bmetal\b/, /\bmineral\b/, /\bink\b/],
  musk: [/\bmusk\b/, /\bmusky\b/, /\bskin\b/, /\bwhite musk\b/],
  niche: [/\bniche\b/, /\bavant\b/, /\bexperimental\b/, /\bunique\b/],
  oud: [/\boud\b/, /\bagarwood\b/],
  spice: [/\bspice\b/, /\bspicy\b/, /\bpepper\b/, /\bsaffron\b/, /\bcardamom\b/, /\bcinnamon\b/, /\bclove\b/],
  sweet: [/\bsweet\b/, /\bsugar\b/, /\bhoney\b/, /\bvanilla\b/],
  vanilla: [/\bvanilla\b/],
  woods: [/\bwood\b/, /\bwoody\b/, /\bcedar\b/, /\bsandalwood\b/, /\bvetiver\b/, /\bpatchouli\b/, /\bmoss\b/],
};

const DEFAULT_POSITIVE_TASTE_TERMS = [
  'amber',
  'apple',
  'vanilla',
  'musk',
  'woody',
  'light incense',
  'green',
  'dark',
  'niche',
];

const DEFAULT_NEGATIVE_TASTE_TERMS = [
  'metallic',
  'aventus',
  'br540',
  'too fruity',
  'too sweet',
  'weak longevity',
  'generic',
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTerm(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTerms(values: string[] | null | undefined) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const normalized = normalizeTerm(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function categoriesForTerm(term: string) {
  const categories: string[] = [];
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(term))) categories.push(category);
  }
  return categories;
}

function categoriesForTerms(terms: string[]) {
  const categories = new Set<string>();
  for (const term of terms) {
    categoriesForTerm(term).forEach((category) => categories.add(category));
  }
  return categories;
}

function profileTermGroups(profile: TodaysPickProfile) {
  const top = cleanTerms(profile.topNotes);
  const heart = cleanTerms(profile.heartNotes);
  const base = cleanTerms(profile.baseNotes);
  const flat = cleanTerms(profile.notes);
  const official = cleanTerms([...top, ...heart, ...base, ...flat]);
  const catalogAccords = cleanTerms(profile.accords);
  const providerAccords = profile.providerStructuredAccordsApproved === false
    ? []
    : cleanTerms(profile.providerStructuredAccords);
  const community = cleanTerms([
    ...(profile.communityAccords ?? []),
    ...(profile.communityNotes ?? []),
  ]);
  const officialCategories = categoriesForTerms(official);
  const providerCategories = categoriesForTerms(providerAccords);
  const communityCategories = categoriesForTerms(community);
  const familyCategories = categoriesForTerms([profile.familyKey ?? '']);
  const allScoredCategories = new Set([
    ...officialCategories,
    ...providerCategories,
    ...familyCategories,
    ...categoriesForTerms(catalogAccords),
  ]);
  const officialDepth = [top, heart, base].filter((values) => values.length > 0).length;
  return {
    top,
    heart,
    base,
    official,
    catalogAccords,
    providerAccords,
    community,
    officialCategories,
    providerCategories,
    communityCategories,
    familyCategories,
    allScoredCategories,
    officialDepth,
  };
}

function normalizedSet(values: string[] | null | undefined) {
  return new Set(cleanTerms(values));
}

function categoryMatchesFromTerms(terms: string[], categories: Set<string>) {
  const matches = new Set<string>();
  for (const term of terms) {
    const normalized = normalizeTerm(term);
    if (categories.has(normalized)) matches.add(normalized);
    categoriesForTerm(normalized).forEach((category) => {
      if (categories.has(category)) matches.add(category);
    });
  }
  return [...matches];
}

function hasAnyTermMatch(terms: string[], patterns: RegExp[]) {
  return terms.some((term) => patterns.some((pattern) => pattern.test(term)));
}

function negativeTasteMatchesFromTerms(dislikedTerms: string[], groups: ReturnType<typeof profileTermGroups>) {
  const matches = new Set<string>();
  const scoredTerms = [
    ...groups.official,
    ...groups.catalogAccords,
    ...groups.providerAccords,
    normalizeTerm(groups.familyCategories.has('gourmand') ? 'gourmand' : ''),
  ].filter(Boolean);

  for (const term of dislikedTerms) {
    const normalized = normalizeTerm(term);
    if (!normalized) continue;

    if (normalized === 'too sweet') {
      const hasSugarySignal = hasAnyTermMatch(scoredTerms, [
        /\bsugar\b/,
        /\bsugary\b/,
        /\bcandy\b/,
        /\bsyrup\b/,
        /\bcaramel\b/,
        /\bchocolate\b/,
        /\bpraline\b/,
        /\bhoney\b/,
        /\btonka\b/,
        /\bgourmand\b/,
      ]);
      const hasStructuredSweetAccord = groups.catalogAccords.includes('sweet') || groups.providerAccords.includes('sweet');
      if (hasSugarySignal || hasStructuredSweetAccord || groups.allScoredCategories.has('gourmand')) {
        matches.add('too sweet');
      }
      continue;
    }

    if (normalized === 'too fruity') {
      const nonAromaticFruitTerms = scoredTerms.filter((scoredTerm) => !/\bjuniper berry\b/.test(scoredTerm));
      const hasHeavyFruitSignal = hasAnyTermMatch(nonAromaticFruitTerms, [
        /\bfruity\b/,
        /\bfruit\b/,
        /\bberry\b/,
        /\bpeach\b/,
        /\bplum\b/,
        /\bcherry\b/,
        /\bpear\b/,
        /\bpineapple\b/,
      ]);
      if (hasHeavyFruitSignal || groups.providerAccords.includes('fruity') || groups.catalogAccords.includes('fruity')) {
        matches.add('too fruity');
      }
      continue;
    }

    categoryMatchesFromTerms([normalized], groups.allScoredCategories).forEach((match) => matches.add(match));
  }

  return [...matches];
}

function buildEligibilityExclusions(profile: TodaysPickProfile) {
  const status = normalizeTerm(profile.collectionStatus);
  const exclusions: string[] = [];
  const ownedByStatus = status === 'owned' || status === 'signature' || status === 'today pick' || status === 'queue';
  if (profile.disliked || status === 'disliked') exclusions.push('disliked');
  if (profile.retired) exclusions.push('retired');
  if (profile.wishlistOnly || status === 'wishlist') exclusions.push('wishlist_only');
  if (profile.unresolved) exclusions.push('unresolved_or_provisional');
  if (profile.profileReady === false) exclusions.push('profile_not_ready');
  if (profile.owned === false && !ownedByStatus) exclusions.push('not_owned_collection');
  return exclusions;
}

function isEvidenceBackedPerformanceSource(value: boolean | null | undefined) {
  return value === true;
}

function evidenceBackedScore(score: number | null | undefined, backed: boolean | null | undefined) {
  if (!isEvidenceBackedPerformanceSource(backed)) return null;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return clamp(score, 0, 1);
}

function performanceComponent(profile: TodaysPickProfile, context: TodaysPickScoringContext | null | undefined) {
  const longevity = evidenceBackedScore(
    profile.performance?.longevityScore,
    profile.performance?.longevityEvidenceBacked,
  );
  const projection = evidenceBackedScore(
    profile.performance?.projectionScore,
    profile.performance?.projectionEvidenceBacked,
  );
  if (longevity == null && projection == null) {
    return { contribution: 0, evidencePresent: false, reasonCodes: [] as string[] };
  }

  let contribution = 0;
  const reasonCodes: string[] = ['performance_evidence'];
  const occasion = normalizeTerm(context?.occasion);
  const temperature = typeof context?.temperatureF === 'number' ? context.temperatureF : null;
  const projectionValue = projection ?? 0.5;
  const longevityValue = longevity ?? 0.5;

  if (longevity != null && longevity >= 0.66) contribution += 4;
  if (projection != null && projection >= 0.35 && projection <= 0.72) contribution += 3;
  if (occasion === 'work' && projection != null && projection >= 0.75) {
    contribution -= 8;
    reasonCodes.push('loudness_caution');
  }
  if (temperature != null && temperature >= 78 && projection != null && projection > 0.76) {
    contribution -= 7;
    reasonCodes.push('heat_loudness_caution');
  }
  if (longevity != null && longevity < 0.34) {
    contribution -= 4;
    reasonCodes.push('weak_longevity_evidence');
  }
  if (projectionValue > 0.82 && longevityValue > 0.76) {
    contribution -= 5;
    reasonCodes.push('overpowering_caution');
  }

  return { contribution, evidencePresent: true, reasonCodes };
}

function contextComponent(groups: ReturnType<typeof profileTermGroups>, context: TodaysPickScoringContext | null | undefined) {
  const categories = groups.allScoredCategories;
  const occasion = normalizeTerm(context?.occasion);
  const weather = normalizeTerm(context?.weather);
  const temperature = typeof context?.temperatureF === 'number' ? context.temperatureF : null;
  let score = 0;
  const reasonCodes: string[] = [];

  if (temperature != null && temperature >= 75) {
    const hasCoolingStructure = ['fresh', 'aquatic', 'citrus', 'green', 'musk'].some((category) => categories.has(category));
    const hasMeaningfulCoolingBridge = ['fresh', 'aquatic', 'green', 'musk', 'clean'].some((category) => categories.has(category));
    const hasDenseWarmStructure = ['oud', 'leather', 'gourmand'].some((category) => categories.has(category))
      || ((categories.has('sweet') || categories.has('vanilla')) && categories.has('amber') && !hasMeaningfulCoolingBridge)
      || (categories.has('dark') && categories.has('amber') && !hasMeaningfulCoolingBridge);
    if (hasCoolingStructure) {
      score += 8;
      reasonCodes.push('warm_weather_fit');
    }
    if (hasDenseWarmStructure) {
      score -= 12;
      reasonCodes.push('warm_weather_density_caution');
    }
  }

  if (temperature != null && temperature <= 60) {
    if (['amber', 'vanilla', 'woods', 'incense', 'spice'].some((category) => categories.has(category))) {
      score += 7;
      reasonCodes.push('cool_weather_fit');
    }
  }

  if (weather.includes('rain') || weather.includes('damp')) {
    if (['woods', 'musk', 'green', 'aromatic'].some((category) => categories.has(category))) {
      score += 4;
      reasonCodes.push('rain_ready_fit');
    }
  }

  if (occasion === 'work') {
    const hasControlledWorkStructure = ['clean', 'fresh', 'musk', 'woods', 'citrus'].some((category) => categories.has(category));
    const hasWorkDensityRisk = ['oud', 'leather', 'gourmand'].some((category) => categories.has(category))
      || ((categories.has('sweet') || categories.has('vanilla')) && categories.has('amber') && !['clean', 'fresh', 'musk', 'aquatic', 'green'].some((category) => categories.has(category)))
      || (categories.has('dark') && categories.has('amber') && !['clean', 'fresh', 'musk', 'aquatic', 'green'].some((category) => categories.has(category)));
    if (hasControlledWorkStructure && !hasWorkDensityRisk) {
      score += 6;
      reasonCodes.push('work_context_fit');
    } else if (hasControlledWorkStructure) {
      score += 2;
      reasonCodes.push('work_context_fit');
    }
    if (hasWorkDensityRisk) score -= 10;
  } else if (occasion === 'date') {
    if (['amber', 'vanilla', 'woods', 'musk', 'incense', 'spice'].some((category) => categories.has(category))) {
      score += 6;
      reasonCodes.push('date_context_fit');
    }
  } else if (occasion === 'hangout') {
    if (['fresh', 'green', 'aromatic', 'citrus', 'woods'].some((category) => categories.has(category))) {
      score += 4;
      reasonCodes.push('casual_context_fit');
    }
  }

  return { score, reasonCodes };
}

function officialProfileComponent(profile: TodaysPickProfile, groups: ReturnType<typeof profileTermGroups>) {
  let score = 0;
  const reasonCodes: string[] = [];
  if (groups.official.length > 0) score += 4;
  if (groups.officialDepth >= 2) score += 7;
  if (groups.heart.length > 0) score += 3;
  if (groups.base.length > 0) score += 3;
  if (profile.officialSourceBacked || normalizeTerm(profile.sourceConfidence).includes('official')) {
    score += 4;
    reasonCodes.push('source_backed_profile');
  }
  if (groups.officialDepth >= 2) reasonCodes.push('note_pyramid_available');
  return { score, reasonCodes };
}

function providerAccordComponent(groups: ReturnType<typeof profileTermGroups>, positiveCategories: Set<string>) {
  const providerCategories = groups.providerCategories;
  if (providerCategories.size === 0) return { score: 0, matches: [] as string[], reasonCodes: [] as string[] };
  const matches = [...providerCategories].filter((category) => positiveCategories.has(category));
  const supportCount = Math.min(providerCategories.size, 5);
  const score = Math.min(10, supportCount * 1.5 + matches.length * 2);
  return {
    score,
    matches,
    reasonCodes: ['provider_structured_accord_support'],
  };
}

function communityComponent(groups: ReturnType<typeof profileTermGroups>) {
  if (groups.communityCategories.size === 0) {
    return { score: 0, categories: [] as string[], reasonCodes: [] as string[] };
  }
  const officialComplete = groups.officialDepth >= 2 || groups.official.length >= 4;
  const score = officialComplete ? 0 : 1.5;
  return {
    score,
    categories: [...groups.communityCategories].slice(0, 6),
    reasonCodes: score > 0 ? ['community_backend_support_low_authority'] : [],
  };
}

function confidenceComponent(profile: TodaysPickProfile, groups: ReturnType<typeof profileTermGroups>, performanceEvidencePresent: boolean) {
  let score = 0;
  if (groups.officialDepth >= 2) score += 4;
  if (groups.official.length >= 3) score += 2;
  if (groups.providerAccords.length > 0) score += 2;
  if (performanceEvidencePresent) score += 1;
  const confidenceText = normalizeTerm(String(profile.sourceConfidence ?? ''));
  if (confidenceText.includes('high') || confidenceText.includes('official') || confidenceText === '0.99') score += 2;
  return clamp(score, 0, 10);
}

function diversityComponent(profile: TodaysPickProfile, context: TodaysPickScoringContext | null | undefined) {
  const recentIds = normalizedSet(context?.recentFragranceIds);
  const recentFamilies = normalizedSet(context?.recentFamilyKeys);
  const recentBrands = normalizedSet(context?.recentBrandNames);
  const id = normalizeTerm(profile.id);
  const family = normalizeTerm(profile.familyKey);
  const brand = normalizeTerm(profile.brand);
  let repetitionPenalty = 0;
  let diversityAdjustment = 0;
  const reasonCodes: string[] = [];

  if (id && recentIds.has(id)) {
    repetitionPenalty -= 35;
    reasonCodes.push('recent_winner_penalty');
  }
  if (family && recentFamilies.has(family)) {
    repetitionPenalty -= 14;
    reasonCodes.push('recent_family_penalty');
  } else if (family && recentFamilies.size > 0) {
    diversityAdjustment += 4;
    reasonCodes.push('family_diversity_bonus');
  }
  if (brand && recentBrands.has(brand)) {
    repetitionPenalty -= 6;
    reasonCodes.push('same_brand_penalty');
  } else if (brand && recentBrands.size > 0) {
    diversityAdjustment += 2;
    reasonCodes.push('brand_diversity_bonus');
  }

  return { repetitionPenalty, diversityAdjustment, reasonCodes };
}

function tasteComponent(groups: ReturnType<typeof profileTermGroups>, context: TodaysPickScoringContext | null | undefined) {
  const preferred = context?.preferredTerms?.length ? context.preferredTerms : DEFAULT_POSITIVE_TASTE_TERMS;
  const disliked = context?.dislikedTerms?.length ? context.dislikedTerms : DEFAULT_NEGATIVE_TASTE_TERMS;
  const positiveCategories = categoriesForTerms(cleanTerms(preferred));
  const positiveMatches = categoryMatchesFromTerms(preferred, groups.allScoredCategories);
  const negativeMatches = negativeTasteMatchesFromTerms(cleanTerms(disliked), groups);
  let score = Math.min(20, positiveMatches.length * 4);
  score -= Math.min(24, negativeMatches.length * 6);

  return {
    score,
    positiveCategories,
    positiveMatches,
    negativeMatches,
    reasonCodes: [
      ...(positiveMatches.length > 0 ? ['user_taste_match'] : []),
      ...(negativeMatches.length > 0 ? ['negative_taste_caution'] : []),
    ],
  };
}

function resolveReasonChip(score: TodaysPickCandidateScore) {
  const components = score.components;
  if (components.userTasteFit >= 10) {
    return {
      label: 'Taste Match',
      explanation: 'It matches the strongest notes and style signals in the current taste profile.',
    };
  }
  if (components.contextFit >= 8) {
    return {
      label: 'Context Fit',
      explanation: 'The scent profile lines up with today’s weather and occasion.',
    };
  }
  if (components.providerAccordSupport >= 6) {
    return {
      label: 'Provider Accord Fit',
      explanation: 'Approved structured provider accords reinforce the scent profile for today.',
    };
  }
  if (components.performanceFit >= 4 && score.evidence.performanceEvidencePresent) {
    return {
      label: 'Evidence-Backed Wear',
      explanation: 'Real wear evidence supports how this should behave today.',
    };
  }
  if (components.diversityAdjustment >= 4) {
    return {
      label: 'Fresh Rotation',
      explanation: 'It adds variety against recent family or brand repeats.',
    };
  }
  if (components.officialProfileFit >= 10) {
    return {
      label: 'Source-Backed Profile',
      explanation: 'The official note structure gives this pick a stronger evidence base.',
    };
  }
  return {
    label: 'Balanced Pick',
    explanation: 'It clears the Collection gates and balances profile fit with rotation.',
  };
}

export function scoreTodaysPickCandidate(
  profile: TodaysPickProfile,
  context?: TodaysPickScoringContext | null,
): TodaysPickCandidateScore {
  const groups = profileTermGroups(profile);
  const exclusions = buildEligibilityExclusions(profile);
  const eligible = exclusions.length === 0;
  const taste = tasteComponent(groups, context);
  const official = officialProfileComponent(profile, groups);
  const provider = providerAccordComponent(groups, taste.positiveCategories);
  const community = communityComponent(groups);
  const perf = performanceComponent(profile, context);
  const diversity = diversityComponent(profile, context);
  const contextFit = contextComponent(groups, context);
  const confidence = confidenceComponent(profile, groups, perf.evidencePresent);
  const components = {
    userTasteFit: taste.score,
    contextFit: contextFit.score,
    officialProfileFit: official.score,
    providerAccordSupport: provider.score,
    communitySupport: community.score,
    performanceFit: perf.contribution,
    repetitionPenalty: diversity.repetitionPenalty,
    diversityAdjustment: diversity.diversityAdjustment,
    confidence,
  };
  const rawScore = 50
    + components.userTasteFit
    + components.contextFit
    + components.officialProfileFit
    + components.providerAccordSupport
    + components.communitySupport
    + components.performanceFit
    + components.repetitionPenalty
    + components.diversityAdjustment
    + components.confidence;
  const reasonCodes = [
    ...taste.reasonCodes,
    ...contextFit.reasonCodes,
    ...official.reasonCodes,
    ...provider.reasonCodes,
    ...community.reasonCodes,
    ...perf.reasonCodes,
    ...diversity.reasonCodes,
  ];
  const score: TodaysPickCandidateScore = {
    id: profile.id,
    name: profile.name,
    brand: profile.brand ?? null,
    familyKey: profile.familyKey ?? null,
    eligible,
    exclusions,
    finalScore: eligible ? Math.round(clamp(rawScore, 0, 1000) * 10) / 10 : 0,
    components,
    evidence: {
      officialDepth: groups.officialDepth,
      officialSourceBacked: profile.officialSourceBacked === true || official.reasonCodes.includes('source_backed_profile'),
      providerStructuredAccords: groups.providerAccords.length > 0,
      communityEvidenceAvailable: groups.community.length > 0,
      performanceEvidencePresent: perf.evidencePresent,
    },
    trace: {
      officialMatches: [...groups.officialCategories].slice(0, 8),
      providerAccordMatches: provider.matches,
      communitySignalCategories: community.categories,
      reasonCodes: [...new Set(reasonCodes)],
    },
    reasonChipLabel: null,
    reasonChipExplanation: null,
  };
  const reasonChip = resolveReasonChip(score);
  return {
    ...score,
    reasonChipLabel: reasonChip.label,
    reasonChipExplanation: reasonChip.explanation,
  };
}

export function scoreTodaysPickCandidates(
  profiles: TodaysPickProfile[],
  context?: TodaysPickScoringContext | null,
): TodaysPickScoringResult {
  const scores = profiles
    .filter((profile) => profile.id && profile.name)
    .map((profile) => scoreTodaysPickCandidate(profile, context))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      const aRank = profiles.find((profile) => profile.id === a.id)?.sourceRank ?? Number.MAX_SAFE_INTEGER;
      const bRank = profiles.find((profile) => profile.id === b.id)?.sourceRank ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    });
  return {
    winner: scores.find((score) => score.eligible) ?? null,
    candidates: scores.filter((score) => score.eligible),
    excluded: scores.filter((score) => !score.eligible),
  };
}

export function buildTodaysPickScoringTrace(
  result: TodaysPickScoringResult,
  context?: TodaysPickScoringContext | null,
): TodaysPickScoringTraceEntry {
  return {
    timestamp: new Date().toISOString(),
    context: context?.occasion ?? null,
    temperatureF: typeof context?.temperatureF === 'number' ? context.temperatureF : null,
    winner: result.winner
      ? {
          id: result.winner.id,
          name: result.winner.name,
          brand: result.winner.brand,
          score: result.winner.finalScore,
          reasonChipLabel: result.winner.reasonChipLabel,
        }
      : null,
    candidates: [...result.candidates, ...result.excluded].slice(0, 10).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      brand: candidate.brand,
      eligible: candidate.eligible,
      exclusions: candidate.exclusions,
      finalScore: candidate.finalScore,
      components: candidate.components,
      evidence: candidate.evidence,
      reasonCodes: candidate.trace.reasonCodes,
      reasonChipLabel: candidate.reasonChipLabel,
    })),
  };
}

export function recordTodaysPickScoringTrace(
  result: TodaysPickScoringResult,
  context?: TodaysPickScoringContext | null,
) {
  if (typeof window === 'undefined') return null;
  const entry = buildTodaysPickScoringTrace(result, context);
  const nextTrace = [...(window.__ODARA_TODAYS_PICK_SCORING_TRACE__ ?? []), entry].slice(-10);
  window.__ODARA_TODAYS_PICK_SCORING_TRACE__ = nextTrace;
  return entry;
}

export function readTodaysPickScoringTrace() {
  if (typeof window === 'undefined') return [];
  return (window.__ODARA_TODAYS_PICK_SCORING_TRACE__ ?? []).slice(-10);
}
