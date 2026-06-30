export type LayerCombinationPerformanceEvidence = {
  projectionScore?: number | null;
  projectionEvidenceBacked?: boolean | null;
  longevityScore?: number | null;
  longevityEvidenceBacked?: boolean | null;
};

export type LayerCombinationProfile = {
  id?: string | null;
  name: string;
  brand?: string | null;
  familyKey?: string | null;
  notes?: string[] | null;
  topNotes?: string[] | null;
  heartNotes?: string[] | null;
  baseNotes?: string[] | null;
  accords?: string[] | null;
  providerStructuredAccords?: string[] | null;
  communityAccords?: string[] | null;
  performance?: LayerCombinationPerformanceEvidence | null;
  owned?: boolean | null;
  retired?: boolean | null;
  disliked?: boolean | null;
  wishlistOnly?: boolean | null;
  unresolved?: boolean | null;
};

export type LayerCombinationContext = {
  occasion?: string | null;
  weather?: string | null;
  mode?: 'balance' | 'bold' | 'smooth' | 'wild' | string | null;
  recentFragranceIds?: string[] | null;
  preferredTerms?: string[] | null;
  dislikedTerms?: string[] | null;
};

export type LayerCombinationScoringInput = {
  fragranceA: LayerCombinationProfile;
  fragranceB: LayerCombinationProfile;
  context?: LayerCombinationContext | null;
};

export type LayerCombinationScoringResult = {
  eligible: boolean;
  score: number;
  anchor: 'a' | 'b';
  companion: 'a' | 'b';
  pairingMode: 'reinforce' | 'brighten' | 'smooth' | 'deepen' | 'contrast' | 'soften';
  placement: string;
  sprayGuidance: string;
  whyItWorks: string;
  bridgeTerms: string[];
  warnings: string[];
  exclusions: string[];
  reasonCodes: string[];
  components: {
    noteBridge: number;
    heartCompatibility: number;
    baseCompatibility: number;
    accordHarmony: number;
    contrast: number;
    redundancyPenalty: number;
    clashPenalty: number;
    performanceBalance: number;
    userTaste: number;
    rotationDiversity: number;
    confidence: number;
  };
};

const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  amber: [/\bamber\b/, /\bbenzoin\b/, /\blabdanum\b/],
  aquatic: [/\baquatic\b/, /\bmarine\b/, /\bsea\b/, /\bocean\b/, /\bozonic\b/],
  aromatic: [/\baromatic\b/, /\blavender\b/, /\bsage\b/, /\brosemary\b/, /\bthyme\b/, /\bjuniper\b/],
  citrus: [/\bcitrus\b/, /\bbergamot\b/, /\blemon\b/, /\bgrapefruit\b/, /\borange\b/, /\bneroli\b/, /\bmandarin\b/, /\btangerine\b/],
  coconut: [/\bcoconut\b/, /\blactonic\b/],
  floral: [/\bfloral\b/, /\bjasmine\b/, /\bylang\b/, /\bviolet\b/, /\biris\b/],
  fresh: [/\bfresh\b/, /\bclean\b/, /\bair\b/, /\bairy\b/, /\bozonic\b/],
  fruit: [/\bfruit\b/, /\bfruity\b/, /\bapple\b/, /\bpear\b/, /\bberry\b/, /\bpeach\b/],
  gourmand: [/\bgourmand\b/, /\bchocolate\b/, /\bcaramel\b/, /\bcoffee\b/, /\btonka\b/, /\bcocoa\b/],
  green: [/\bgreen\b/, /\bgrass\b/, /\bleaf\b/, /\bgalbanum\b/, /\bcucumber\b/, /\bpalm\b/],
  incense: [/\bincense\b/, /\bsmoke\b/, /\bsmoky\b/, /\bfrankincense\b/, /\bmyrrh\b/],
  leather: [/\bleather\b/, /\bsuede\b/, /\btobacco\b/],
  musk: [/\bmusk\b/, /\bmusky\b/, /\bskin\b/, /\bwhite musk\b/],
  oud: [/\boud\b/, /\bagarwood\b/],
  resin: [/\bresin\b/, /\bresinous\b/, /\bcopaiba\b/, /\bbalsam\b/, /\bopoponax\b/],
  rose: [/\brose\b/],
  spice: [/\bspice\b/, /\bspicy\b/, /\bpepper\b/, /\bsaffron\b/, /\bcardamom\b/, /\bcinnamon\b/, /\bclove\b/],
  sweet: [/\bsweet\b/, /\bsugar\b/, /\bhoney\b/, /\bvanilla\b/],
  tea: [/\btea\b/, /\bmatcha\b/],
  vanilla: [/\bvanilla\b/],
  woods: [/\bwood\b/, /\bwoody\b/, /\bcedar\b/, /\bsandalwood\b/, /\bvetiver\b/, /\bpatchouli\b/, /\bmoss\b/],
};

export const LAYER_COMBINATION_HEURISTIC_RULES = [
  'Heart-note bridges are stronger evidence than top-note sparkle.',
  'Base-note cooperation controls the long drydown and can add muddy/heavy penalties.',
  'Approved structured provider accords may supplement official notes, but community accords stay lower-authority support.',
  'Performance affects pair balance only when evidence-backed; missing performance is neutral.',
  'These are heuristic blend rules, not official source facts.',
];

const POSITIVE_CATEGORY_BRIDGES: Array<[string, string, string]> = [
  ['amber', 'vanilla', 'warm amber-vanilla bridge'],
  ['amber', 'woods', 'grounded amber-woods bridge'],
  ['musk', 'fresh', 'clean musk-fresh lift'],
  ['musk', 'aquatic', 'clean musk-aquatic lift'],
  ['citrus', 'woods', 'bright citrus-woods structure'],
  ['green', 'tea', 'green tea freshness'],
  ['green', 'aromatic', 'natural green-aromatic freshness'],
  ['incense', 'woods', 'smoky woods depth'],
  ['incense', 'amber', 'smoky amber depth'],
  ['oud', 'amber', 'oud-amber depth'],
  ['oud', 'rose', 'oud-rose structure'],
  ['oud', 'vanilla', 'oud softened by vanilla'],
  ['oud', 'woods', 'deep woody bridge'],
  ['gourmand', 'citrus', 'gourmand lifted by citrus'],
  ['gourmand', 'fresh', 'gourmand lifted by freshness'],
  ['leather', 'woods', 'leather-woods structure'],
  ['leather', 'spice', 'leather-spice structure'],
];

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

function displayTerm(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function categoriesForTerm(term: string) {
  const categories: string[] = [];
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(term))) categories.push(category);
  }
  return categories;
}

function profileTerms(profile: LayerCombinationProfile) {
  const top = cleanTerms(profile.topNotes);
  const heart = cleanTerms(profile.heartNotes);
  const base = cleanTerms(profile.baseNotes);
  const flat = cleanTerms(profile.notes);
  const accords = cleanTerms([
    ...(profile.accords ?? []),
    ...(profile.providerStructuredAccords ?? []),
  ]);
  const communityAccords = cleanTerms(profile.communityAccords);
  const all = cleanTerms([...top, ...heart, ...base, ...flat, ...accords]);
  const categories = new Set<string>();
  for (const term of all) categoriesForTerm(term).forEach((category) => categories.add(category));
  const communityCategories = new Set<string>();
  for (const term of communityAccords) categoriesForTerm(term).forEach((category) => communityCategories.add(category));
  const officialDepth = [top, heart, base].filter((values) => values.length > 0).length;
  return { top, heart, base, flat, accords, communityAccords, all, categories, communityCategories, officialDepth };
}

function overlap(a: string[], b: string[]) {
  const bSet = new Set(b);
  return a.filter((term) => bSet.has(term));
}

function categoryOverlap(a: Set<string>, b: Set<string>) {
  return [...a].filter((category) => b.has(category));
}

function compatibleCategoryBridges(a: Set<string>, b: Set<string>) {
  const bridges: string[] = [];
  for (const [left, right, label] of POSITIVE_CATEGORY_BRIDGES) {
    if ((a.has(left) && b.has(right)) || (a.has(right) && b.has(left))) bridges.push(label);
  }
  return [...new Set(bridges)];
}

function categoryWeight(categories: Set<string>) {
  let weight = 0;
  for (const category of categories) {
    if (['oud', 'leather', 'incense', 'amber', 'resin'].includes(category)) weight += 3;
    if (['woods', 'gourmand', 'sweet', 'vanilla'].includes(category)) weight += 2;
    if (['musk', 'floral', 'spice'].includes(category)) weight += 1;
    if (['fresh', 'citrus', 'aquatic', 'green', 'tea'].includes(category)) weight -= 1;
  }
  return weight;
}

function hasAny(categories: Set<string>, values: string[]) {
  return values.some((value) => categories.has(value));
}

function isSameFragrance(a: LayerCombinationProfile, b: LayerCombinationProfile) {
  if (a.id && b.id && a.id === b.id) return true;
  return normalizeTerm(a.name) === normalizeTerm(b.name)
    && normalizeTerm(a.brand) === normalizeTerm(b.brand);
}

function buildEligibilityExclusions(profile: LayerCombinationProfile, slot: 'a' | 'b') {
  const exclusions: string[] = [];
  if (profile.owned === false) exclusions.push(`${slot}_not_owned`);
  if (profile.retired) exclusions.push(`${slot}_retired`);
  if (profile.disliked) exclusions.push(`${slot}_disliked`);
  if (profile.wishlistOnly) exclusions.push(`${slot}_wishlist_only`);
  if (profile.unresolved) exclusions.push(`${slot}_unresolved`);
  return exclusions;
}

function evidenceBackedProjection(profile: LayerCombinationProfile) {
  const score = profile.performance?.projectionScore;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  if (profile.performance?.projectionEvidenceBacked !== true) return null;
  return Math.max(0, Math.min(1, score));
}

function chooseAnchor(
  a: LayerCombinationProfile,
  b: LayerCombinationProfile,
  aTerms: ReturnType<typeof profileTerms>,
  bTerms: ReturnType<typeof profileTerms>,
) {
  const aProjection = evidenceBackedProjection(a) ?? 0;
  const bProjection = evidenceBackedProjection(b) ?? 0;
  const aWeight = categoryWeight(aTerms.categories) + aTerms.base.length + aProjection * 2;
  const bWeight = categoryWeight(bTerms.categories) + bTerms.base.length + bProjection * 2;
  return aWeight >= bWeight ? 'a' as const : 'b' as const;
}

function roleFor(profile: LayerCombinationProfile, terms: ReturnType<typeof profileTerms>, role: 'anchor' | 'companion') {
  if (hasAny(terms.categories, ['amber', 'vanilla'])) return role === 'anchor' ? 'warm amber base' : 'soft amber lift';
  if (hasAny(terms.categories, ['oud', 'incense', 'leather'])) return role === 'anchor' ? 'deep textured base' : 'smoky contrast';
  if (hasAny(terms.categories, ['woods'])) return role === 'anchor' ? 'woody structure' : 'dry woody support';
  if (hasAny(terms.categories, ['fresh', 'citrus', 'aquatic', 'green', 'aromatic'])) return role === 'anchor' ? 'fresh aromatic anchor' : 'fresh aromatic lift';
  if (hasAny(terms.categories, ['musk'])) return role === 'anchor' ? 'clean musk base' : 'clean musk softener';
  return role === 'anchor' ? `${profile.name} base` : `${profile.name} accent`;
}

function resolvePairingMode(components: LayerCombinationScoringResult['components'], warnings: string[]) {
  if (warnings.some((warning) => warning.includes('sweet') || warning.includes('heavy'))) return 'soften';
  if (components.contrast >= 9) return 'contrast';
  if (components.baseCompatibility >= 10) return 'deepen';
  if (components.noteBridge >= 12) return 'reinforce';
  if (components.accordHarmony >= 8) return 'smooth';
  return 'brighten';
}

function formatBridgeTerms(terms: string[]) {
  const displayed = [...new Set(terms.map(displayTerm))].slice(0, 3);
  if (displayed.length <= 1) return displayed.join('');
  if (displayed.length === 2) return `${displayed[0]} and ${displayed[1]}`;
  return `${displayed[0]}, ${displayed[1]}, and ${displayed[2]}`;
}

function buildWhyItWorks(
  input: {
    a: LayerCombinationProfile;
    b: LayerCombinationProfile;
    aTerms: ReturnType<typeof profileTerms>;
    bTerms: ReturnType<typeof profileTerms>;
    anchor: 'a' | 'b';
    bridgeTerms: string[];
    warnings: string[];
  },
) {
  const anchorProfile = input.anchor === 'a' ? input.a : input.b;
  const companionProfile = input.anchor === 'a' ? input.b : input.a;
  const anchorTerms = input.anchor === 'a' ? input.aTerms : input.bTerms;
  const companionTerms = input.anchor === 'a' ? input.bTerms : input.aTerms;
  const bridgeText = formatBridgeTerms(input.bridgeTerms);
  const bridgeClause = bridgeText
    ? ` They bridge through ${bridgeText}.`
    : ' The pairing has limited shared note evidence, so keep the companion light.';
  const caution = input.warnings[0] ? ` ${input.warnings[0]}` : '';
  return `Use ${anchorProfile.name} as the ${roleFor(anchorProfile, anchorTerms, 'anchor')} and ${companionProfile.name} as the ${roleFor(companionProfile, companionTerms, 'companion')}.${bridgeClause}${caution}`.trim();
}

export function scoreLayerCombination(input: LayerCombinationScoringInput): LayerCombinationScoringResult {
  const a = input.fragranceA;
  const b = input.fragranceB;
  const aTerms = profileTerms(a);
  const bTerms = profileTerms(b);
  const exclusions = [
    ...buildEligibilityExclusions(a, 'a'),
    ...buildEligibilityExclusions(b, 'b'),
  ];
  if (isSameFragrance(a, b)) exclusions.push('same_fragrance');

  const sharedHeart = overlap(aTerms.heart, bTerms.heart);
  const sharedBase = overlap(aTerms.base, bTerms.base);
  const sharedAll = overlap(aTerms.all, bTerms.all);
  const sharedAccords = overlap(aTerms.accords, bTerms.accords);
  const categoryShared = categoryOverlap(aTerms.categories, bTerms.categories);
  const compatibleBridges = compatibleCategoryBridges(aTerms.categories, bTerms.categories);
  const bridgeTerms = [
    ...sharedHeart,
    ...sharedBase,
    ...sharedAccords,
    ...categoryShared.filter((category) => ['musk', 'woods', 'amber', 'vanilla', 'citrus', 'green', 'aromatic'].includes(category)),
  ];

  const noteBridge = Math.min(20, sharedAll.length * 3 + sharedHeart.length * 5);
  const heartCompatibility = Math.min(18, sharedHeart.length * 8 + compatibleBridges.length * 2);
  const baseCompatibility = Math.min(18, sharedBase.length * 7 + compatibleBridges.filter((bridge) => /amber|woods|oud|smoky|vanilla/i.test(bridge)).length * 4);
  const accordHarmony = Math.min(16, sharedAccords.length * 7 + categoryShared.filter((category) => ['amber', 'woods', 'musk', 'vanilla', 'green', 'aromatic'].includes(category)).length * 3);
  const contrast = Math.min(14, compatibleBridges.length * 3
    + (hasAny(aTerms.categories, ['fresh', 'citrus', 'green', 'aquatic']) && hasAny(bTerms.categories, ['amber', 'woods', 'oud', 'leather', 'incense']) ? 5 : 0)
    + (hasAny(bTerms.categories, ['fresh', 'citrus', 'green', 'aquatic']) && hasAny(aTerms.categories, ['amber', 'woods', 'oud', 'leather', 'incense']) ? 5 : 0));

  const sameFamily = normalizeTerm(a.familyKey) && normalizeTerm(a.familyKey) === normalizeTerm(b.familyKey);
  const redundancyPenalty = Math.min(18, (sharedAll.length >= 5 ? 10 : 0) + (sameFamily && categoryShared.length >= 3 ? 8 : 0));
  const warnings: string[] = [];
  let clashPenalty = 0;
  if (
    (hasAny(aTerms.categories, ['aquatic']) && hasAny(bTerms.categories, ['oud', 'leather']))
    || (hasAny(bTerms.categories, ['aquatic']) && hasAny(aTerms.categories, ['oud', 'leather']))
  ) {
    clashPenalty += compatibleBridges.length > 0 ? 7 : 14;
    warnings.push('Aquatic brightness against oud/leather can turn sharp without a musk, amber, or wood bridge.');
  }
  if (hasAny(aTerms.categories, ['sweet', 'gourmand', 'vanilla']) && hasAny(bTerms.categories, ['sweet', 'gourmand', 'vanilla'])) {
    clashPenalty += 10;
    warnings.push('Both sides carry sweetness, so use a lighter hand to avoid syrupy weight.');
  }
  if (categoryWeight(aTerms.categories) >= 7 && categoryWeight(bTerms.categories) >= 7) {
    clashPenalty += 12;
    warnings.push('Both drydowns are dense, so the combination can get heavy or muddy.');
  }

  const aProjection = evidenceBackedProjection(a);
  const bProjection = evidenceBackedProjection(b);
  let performanceBalance = 0;
  if (aProjection != null && bProjection != null) {
    if (aProjection >= 0.72 && bProjection >= 0.72) {
      performanceBalance -= 10;
      warnings.push('Both have evidence-backed projection, so keep sprays restrained.');
    } else if (Math.abs(aProjection - bProjection) >= 0.38) {
      performanceBalance -= 4;
      warnings.push('One side projects more than the other, so place the quieter scent closer to skin.');
    } else {
      performanceBalance += 4;
    }
  }

  const preferred = new Set(cleanTerms(input.context?.preferredTerms));
  const disliked = new Set(cleanTerms(input.context?.dislikedTerms));
  const allTerms = [...aTerms.all, ...bTerms.all];
  const userTaste = Math.min(8, allTerms.filter((term) => preferred.has(term)).length * 4)
    - Math.min(18, allTerms.filter((term) => disliked.has(term)).length * 9);
  const recentIds = new Set(cleanTerms(input.context?.recentFragranceIds));
  const rotationDiversity = [a.id, b.id].some((id) => id && recentIds.has(normalizeTerm(id))) ? -5 : 2;
  const confidence = (aTerms.officialDepth + bTerms.officialDepth >= 4 ? 6 : 0)
    + (aTerms.accords.length + bTerms.accords.length > 0 ? 2 : 0)
    + (aProjection != null || bProjection != null ? 2 : 0);

  const components = {
    noteBridge,
    heartCompatibility,
    baseCompatibility,
    accordHarmony,
    contrast,
    redundancyPenalty,
    clashPenalty,
    performanceBalance,
    userTaste,
    rotationDiversity,
    confidence,
  };
  const rawScore = 50
    + noteBridge
    + heartCompatibility
    + baseCompatibility
    + accordHarmony
    + contrast
    + performanceBalance
    + userTaste
    + rotationDiversity
    + confidence
    - redundancyPenalty
    - clashPenalty;
  const score = exclusions.length > 0 ? 0 : Math.max(0, Math.min(100, Math.round(rawScore)));
  const anchor = chooseAnchor(a, b, aTerms, bTerms);
  const companion = anchor === 'a' ? 'b' : 'a';
  const pairingMode = resolvePairingMode(components, warnings);
  const anchorName = anchor === 'a' ? a.name : b.name;
  const companionName = anchor === 'a' ? b.name : a.name;
  const reasonCodes = [
    sharedHeart.length > 0 ? 'heart_note_bridge' : null,
    sharedBase.length > 0 ? 'base_note_bridge' : null,
    sharedAccords.length > 0 ? 'accord_bridge' : null,
    compatibleBridges.length > 0 ? 'taxonomy_bridge' : null,
    redundancyPenalty > 0 ? 'redundancy_penalty' : null,
    clashPenalty > 0 ? 'clash_caution' : null,
    performanceBalance < 0 ? 'performance_balance_caution' : null,
    confidence > 0 ? 'evidence_quality' : null,
  ].filter((code): code is string => Boolean(code));

  return {
    eligible: exclusions.length === 0,
    score,
    anchor,
    companion,
    pairingMode,
    placement: `${anchorName} first; ${companionName} as the lighter companion layer.`,
    sprayGuidance: performanceBalance < 0
      ? 'Start with one restrained pass of each; let the louder side sit closer to skin.'
      : 'Start balanced, then add one light top-up only if the lift fades.',
    whyItWorks: buildWhyItWorks({ a, b, aTerms, bTerms, anchor, bridgeTerms: bridgeTerms.length > 0 ? bridgeTerms : compatibleBridges, warnings }),
    bridgeTerms: [...new Set(bridgeTerms.length > 0 ? bridgeTerms : compatibleBridges)].slice(0, 5),
    warnings,
    exclusions,
    reasonCodes,
    components,
  };
}
