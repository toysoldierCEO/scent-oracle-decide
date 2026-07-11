import React from "react";
import ModeSelector, { type LayerMood, type LayerModes, type InteractionType, type SprayPattern, LAYER_MOODS } from "./ModeSelector";
import { SprayDots, deriveSprayCountsFromLayerMode } from "@/components/card-system/SprayDots";
import SprayPlacementMap from "@/components/SprayPlacementMap";
import { resolveLayerRatioGuide } from "@/lib/layerRatioIntelligence";
import { normalizeNotes } from "@/lib/normalizeNotes";
import { expandAndDeduplicateScentIntelDisplayTerms } from "@/lib/scentIntelChipTerms";
import { buildPlacementGuide } from "@/lib/sprayPlacement";

/* ── Color maps (shared reference, same as OdaraScreen) ── */
export const FAMILY_COLORS: Record<string, string> = {
  "oud-amber": "#D4A373",
  "fresh-blue": "#4DA3FF",
  "tobacco-boozy": "#8B5E3C",
  "sweet-gourmand": "#C77DFF",
  "dark-leather": "#5A3A2E",
  "woody-clean": "#7FAF8E",
  "citrus-cologne": "#F4D35E",
  "floral-musk": "#C4A0B9",
  "citrus-aromatic": "#B8C94E",
  "fresh-citrus": "#F4D35E",
  "spicy-warm": "#D4713B",
  "fresh-aquatic": "#5BC0DE",
  "earthy-patchouli": "#8B7355",
  "aromatic-fougere": "#6B8E6B",
  "floral-rich": "#D4839E",
  "green-earthy": "#6B8E5A",
};

export const FAMILY_TINTS: Record<string, { bg: string; glow: string; border: string; material: string }> = {
  "fresh-blue":      { bg: "rgba(77,163,255,0.14)",  glow: "rgba(77,163,255,0.14)",  border: "rgba(77,163,255,0.30)", material: "rgba(60,140,230,0.10)" },
  "sweet-gourmand":  { bg: "rgba(199,125,255,0.14)", glow: "rgba(199,125,255,0.26)", border: "rgba(199,125,255,0.28)", material: "rgba(180,100,230,0.10)" },
  "oud-amber":       { bg: "rgba(212,163,115,0.16)", glow: "rgba(212,163,115,0.30)", border: "rgba(212,163,115,0.30)", material: "rgba(180,130,80,0.12)" },
  "dark-leather":    { bg: "rgba(139,58,58,0.14)",   glow: "rgba(139,58,58,0.26)",   border: "rgba(139,58,58,0.28)", material: "rgba(120,40,50,0.10)" },
  "woody-clean":     { bg: "rgba(127,175,142,0.14)", glow: "rgba(127,175,142,0.26)", border: "rgba(127,175,142,0.28)", material: "rgba(100,150,115,0.10)" },
  "tobacco-boozy":   { bg: "rgba(139,94,60,0.16)",   glow: "rgba(139,94,60,0.30)",   border: "rgba(139,94,60,0.30)", material: "rgba(115,75,45,0.12)" },
  "citrus-cologne":  { bg: "rgba(244,211,94,0.12)",  glow: "rgba(244,211,94,0.22)",  border: "rgba(244,211,94,0.24)", material: "rgba(220,190,70,0.08)" },
  "citrus-aromatic": { bg: "rgba(184,201,78,0.12)",  glow: "rgba(184,201,78,0.22)",  border: "rgba(184,201,78,0.24)", material: "rgba(160,180,65,0.08)" },
  "floral-musk":     { bg: "rgba(196,160,185,0.12)", glow: "rgba(196,160,185,0.22)", border: "rgba(196,160,185,0.24)", material: "rgba(175,140,165,0.08)" },
  "fresh-citrus":    { bg: "rgba(244,211,94,0.12)",  glow: "rgba(244,211,94,0.22)",  border: "rgba(244,211,94,0.24)", material: "rgba(220,190,70,0.08)" },
  "spicy-warm":      { bg: "rgba(212,113,59,0.14)",  glow: "rgba(212,113,59,0.26)",  border: "rgba(212,113,59,0.28)", material: "rgba(185,95,45,0.10)" },
  "fresh-aquatic":   { bg: "rgba(91,192,222,0.14)",  glow: "rgba(91,192,222,0.26)",  border: "rgba(91,192,222,0.28)", material: "rgba(70,165,195,0.10)" },
  "earthy-patchouli":{ bg: "rgba(139,115,85,0.14)",  glow: "rgba(139,115,85,0.26)",  border: "rgba(139,115,85,0.28)", material: "rgba(115,95,70,0.10)" },
  "aromatic-fougere":{ bg: "rgba(107,142,107,0.14)", glow: "rgba(107,142,107,0.26)", border: "rgba(107,142,107,0.28)", material: "rgba(90,125,90,0.10)" },
  "floral-rich":     { bg: "rgba(212,131,158,0.12)", glow: "rgba(212,131,158,0.22)", border: "rgba(212,131,158,0.24)", material: "rgba(185,115,140,0.08)" },
  "green-earthy":    { bg: "rgba(107,142,90,0.12)",  glow: "rgba(107,142,90,0.22)",  border: "rgba(107,142,90,0.24)", material: "rgba(90,125,75,0.08)" },
};

const DEFAULT_TINT = { bg: "rgba(255,255,255,0.03)", glow: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.08)", material: "rgba(255,255,255,0.02)" };

/** Display-only name shortening */
function getDisplayName(name: string | null | undefined, brand?: string | null): string {
  if (!name) return 'Unknown';
  let display = name
    .replace(/\s+(for\s+(Men|Women|Him|Her|Unisex)|Eau\s+de\s+(Parfum|Toilette|Cologne)|EDP|EDT)\s*$/i, '')
    .trim();
  if (brand) {
    const brandRegex = new RegExp(`\\s+${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    display = display.replace(brandRegex, '').trim();
  }
  return display;
}

function normalizeComparisonText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCoreComparisonName(name: string | null | undefined, brand?: string | null) {
  return normalizeComparisonText(getDisplayName(name, brand))
    .replace(/\b(eau de parfum|eau de toilette|eau de cologne|parfum|edp|edt|extrait|intense|elixir|absolu|le parfum)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNearDuplicateFlankerPair(
  mainName: string | null | undefined,
  mainBrand: string | null | undefined,
  mainFamily: string | null | undefined,
  layerName: string | null | undefined,
  layerBrand: string | null | undefined,
  layerFamily: string | null | undefined,
) {
  const normalizedMainBrand = normalizeComparisonText(mainBrand);
  const normalizedLayerBrand = normalizeComparisonText(layerBrand);
  if (!normalizedMainBrand || normalizedMainBrand !== normalizedLayerBrand) return false;
  if (mainFamily && layerFamily && mainFamily !== layerFamily) return false;

  const mainCore = extractCoreComparisonName(mainName, mainBrand);
  const layerCore = extractCoreComparisonName(layerName, layerBrand);
  if (!mainCore || !layerCore) return false;

  return mainCore === layerCore || mainCore.includes(layerCore) || layerCore.includes(mainCore);
}

function buildFallbackLayerTokens(
  notes: string[] | null | undefined,
  accords: string[] | null | undefined,
  color: string,
) {
  const accordLabels = normalizeNotes((accords ?? []).map((value) => `${value}`.trim()).filter(Boolean), 4);
  const noteLabels = normalizeNotes((notes ?? []).map((value) => `${value}`.trim()).filter(Boolean), 4);
  const labels = [...accordLabels, ...noteLabels].filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const label of labels) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(label);
    if (unique.length >= 4) break;
  }

  return unique.map((label, index) => ({
    token_key: `layer-fallback-${index}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    token_label: label,
    color_hex: color,
    is_shared: false,
  }));
}

function isLikelyTransparentBottleImageUrl(url: string | null | undefined) {
  const normalized = typeof url === 'string' ? url.trim().toLowerCase() : '';
  if (!normalized) return false;
  return normalized.includes('transparent')
    || normalized.includes('cutout')
    || normalized.includes('isolated')
    || normalized.includes('no-bg')
    || normalized.includes('nobg')
    || normalized.includes('background-removed')
    || normalized.includes('removed-background')
    || normalized.includes('alpha')
    || (/^https:\/\/cdn\.fragella\.com\/images\//i.test(normalized) && /\.webp(?:$|[?#])/i.test(normalized));
}

function readTrimmedImageUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (
    /^https?:\/\//i.test(trimmed)
    || trimmed.startsWith('/')
    || trimmed.startsWith('data:image/')
    || trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }
  return null;
}

function deriveFragellaTransparentBottleImageUrl(url: string | null | undefined) {
  const trimmed = readTrimmedImageUrl(url);
  if (!trimmed) return null;
  if (!/^https:\/\/cdn\.fragella\.com\/images\//i.test(trimmed)) return null;
  if (!/\.jpe?g(?:$|[?#])/i.test(trimmed)) return null;
  return trimmed.replace(/\.jpe?g(?=$|[?#])/i, '.webp');
}

function pushUniqueImageUrl(target: string[], url: string | null | undefined) {
  const resolved = readTrimmedImageUrl(url);
  if (!resolved) return;
  if (target.some((candidate) => candidate.toLowerCase() === resolved.toLowerCase())) return;
  target.push(resolved);
}

function buildLayerBottleImageCandidates(url: string | null | undefined) {
  const resolved = readTrimmedImageUrl(url);
  if (!resolved) return [];
  const candidates: string[] = [];
  if (isLikelyTransparentBottleImageUrl(resolved)) {
    pushUniqueImageUrl(candidates, resolved);
  } else {
    pushUniqueImageUrl(candidates, deriveFragellaTransparentBottleImageUrl(resolved));
    pushUniqueImageUrl(candidates, resolved);
  }
  return candidates;
}

function readTrimmedDisplayText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSprayPatternForDisplay(
  pattern: SprayPattern | null | undefined,
  _mainName: string | null | undefined,
  _mainBrand: string | null | undefined,
  _layerName: string | null | undefined,
  _layerBrand: string | null | undefined,
): SprayPattern | null {
  if (!pattern || pattern.is_layer_allowed === false || pattern.key === 'not_a_layer') return null;
  const name = readTrimmedDisplayText(pattern.name);
  const key = readTrimmedDisplayText(pattern.key);
  if (!name || !key) return null;

  const sanitize = (value: unknown) => splitDetailSentences(readTrimmedDisplayText(value))
    .filter((sentence) => !sentenceContainsRawDiagnosticLabel(sentence))
    .join(' ')
    .trim();

  return {
    key,
    name,
    placement: sanitize(pattern.placement),
    anchor_placement_text: sanitize(pattern.anchor_placement_text),
    layer_placement_text: sanitize(pattern.layer_placement_text),
    halo: sanitize(pattern.halo),
    trail: sanitize(pattern.trail),
    why_it_works: sanitize(pattern.why_it_works),
    anchor_sprays: pattern.anchor_sprays ?? null,
    layer_sprays: pattern.layer_sprays ?? null,
    spray_ratio: readTrimmedDisplayText(pattern.spray_ratio),
    is_layer_allowed: pattern.is_layer_allowed,
  };
}

function parsePlacementRowsFromText(value: string) {
  const lines = value
    .split(/\n+/)
    .flatMap((line) => line.split(/\s+\|\s+/))
    .map((line) => line.trim())
    .filter(Boolean);

  let anchor = '';
  let layer = '';

  for (const line of lines) {
    if (!anchor) {
      const anchorMatch = line.match(/^anchor\s*:\s*(.+)$/i);
      if (anchorMatch) {
        anchor = anchorMatch[1].trim();
        continue;
      }
    }

    if (!layer) {
      const layerMatch = line.match(/^layer\s*:\s*(.+)$/i);
      if (layerMatch) {
        layer = layerMatch[1].trim();
      }
    }
  }

  return {
    anchor,
    layer,
    remainder: (!anchor && !layer) ? value.trim() : '',
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitDetailSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function buildAllowedReferenceSet(
  mainName: string | null | undefined,
  mainBrand: string | null | undefined,
  layerName: string | null | undefined,
  layerBrand: string | null | undefined,
) {
  const allowed = new Set<string>();
  const mainDisplayName = getDisplayName(mainName, mainBrand);
  const layerDisplayName = getDisplayName(layerName, layerBrand);

  [
    mainDisplayName,
    layerDisplayName,
    mainName ?? '',
    layerName ?? '',
    mainBrand ?? '',
    layerBrand ?? '',
  ].forEach((value) => {
    const normalized = normalizeComparisonText(value);
    if (normalized) allowed.add(normalized);
  });

  return allowed;
}

function readSentenceReferenceCandidate(sentence: string) {
  const colonPrefix = sentence.match(/^\s*([^:]{2,48})\s*:/);
  if (colonPrefix) {
    return normalizeComparisonText(colonPrefix[1]);
  }

  const leadingName = sentence.match(/^\s*([A-Z0-9][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){1,3})\b/);
  if (!leadingName) return null;
  const normalized = normalizeComparisonText(leadingName[1]);
  if (!normalized) return null;
  if (/^(the|one|use|layer|anchor|base|top|both|this|that|manual)\b/.test(normalized)) return null;
  return normalized;
}

function sentenceReferencesVisiblePair(
  sentence: string,
  allowedReferences: Set<string>,
) {
  const candidate = readSentenceReferenceCandidate(sentence);
  if (!candidate) return true;

  for (const allowed of allowedReferences) {
    if (candidate === allowed || candidate.includes(allowed) || allowed.includes(candidate)) {
      return true;
    }
  }

  return false;
}

function areDetailTextsEquivalent(a: string | null | undefined, b: string | null | undefined) {
  const normalizedA = normalizeComparisonText(a);
  const normalizedB = normalizeComparisonText(b);
  if (!normalizedA || !normalizedB) return false;
  return normalizedA === normalizedB;
}

function sentenceContainsForeignFragrancePhrase(
  sentence: string,
  allowedReferences: Set<string>,
) {
  const matches = sentence.matchAll(/\b([A-Z0-9][A-Za-z0-9'&.-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.-]*){1,3})\b/g);
  for (const match of matches) {
    const candidate = normalizeComparisonText(match[1]);
    if (!candidate) continue;
    if (/^(the|one|use|layer|anchor|base|top|both|manual|added|placement|why|this|that)\b/.test(candidate)) {
      continue;
    }
    const isAllowed = Array.from(allowedReferences).some((allowed) => (
      candidate === allowed || candidate.includes(allowed) || allowed.includes(candidate)
    ));
    if (!isAllowed) {
      return true;
    }
  }
  return false;
}

function sanitizeLayerDetailCopy(
  value: string,
  mainName: string | null | undefined,
  mainBrand: string | null | undefined,
  layerName: string | null | undefined,
  layerBrand: string | null | undefined,
) {
  if (!value) return '';

  const allowedReferences = buildAllowedReferenceSet(mainName, mainBrand, layerName, layerBrand);
  const sanitizedSentences = splitDetailSentences(value).filter((sentence) => (
    sentenceReferencesVisiblePair(sentence, allowedReferences)
    && !sentenceContainsForeignFragrancePhrase(sentence, allowedReferences)
    && !sentenceContainsRawDiagnosticLabel(sentence)
  ));

  return sanitizedSentences.join(' ').trim();
}

function sentenceContainsRawDiagnosticLabel(sentence: string) {
  const normalized = sentence.trim().toLowerCase();
  return (
    normalized.includes('masking risk')
    || normalized.includes('dominance risk')
    || normalized.includes('fatigue risk')
    || normalized.includes('projection score')
    || normalized.includes('beast mode score')
    || normalized.includes('support_role')
    || normalized.includes('support role estimate')
    || normalized.includes('layer_dominates_anchor')
    || normalized.includes('not_recommended')
    || normalized.includes('driver')
  );
}

/** Generic notes to filter out */
const GENERIC_NOTES = new Set(["fresh", "clean", "warm", "soft", "light", "smooth", "musk", "white musk"]);

/** Extract up to 3 distinctive notes from a notes array, excluding generic and already-used notes */
function getCuratedNotes(notes: string[] | null | undefined, exclude: Set<string> = new Set()): string[] {
  if (!notes || notes.length === 0) return [];
  const distinctive = notes.filter(n => !GENERIC_NOTES.has(n.toLowerCase()) && !exclude.has(n.toLowerCase()));
  const fallback = notes.filter(n => !exclude.has(n.toLowerCase()));
  const source = distinctive.length >= 2 ? distinctive : fallback;
  return source.slice(0, 3);
}

/* ── Intensity detection ── */
const HEAVY_FAMILIES = new Set(['oud-amber', 'dark-leather', 'tobacco-boozy', 'sweet-gourmand']);
const LIGHT_FAMILIES = new Set(['fresh-blue', 'citrus-cologne', 'citrus-aromatic', 'fresh-citrus', 'fresh-aquatic']);

function isHeavy(familyKey: string | null): boolean {
  return !!familyKey && HEAVY_FAMILIES.has(familyKey);
}
function isLight(familyKey: string | null): boolean {
  return !!familyKey && LIGHT_FAMILIES.has(familyKey);
}

/* ── Mode-specific config ── */
interface MoodConfig {
  baseLabel: string;
  baseZones: string;
  topLabel: string;
  topZones: string;
}

/* ── Result text helpers ── */
const ROLE_STRENGTHS: Record<string, string> = {
  citrus: 'citrus lift', woody: 'woody backbone', spicy: 'spiced edge',
  sweet: 'sweetness', floral: 'floral character', fresh: 'freshness',
  leather: 'leather depth', resin: 'resinous weight', earthy: 'earthy base',
  fruity: 'fruity brightness', musk: 'soft finish',
};

const ROLE_ADDITIONS: Record<string, string> = {
  citrus: 'brightness on top', woody: 'woody structure underneath',
  spicy: 'a warmer, spiced dimension', sweet: 'roundness in the drydown',
  floral: 'floral complexity', fresh: 'a cleaner, fresher opening',
  leather: 'textured depth', resin: 'anchoring weight', earthy: 'grounding warmth',
  fruity: 'a lighter, fruitier surface', musk: 'a softer landing',
};

/* ── Effect text: outcome-focused, interaction-type-aware ── */
const INTERACTION_EFFECT_TEMPLATES: Record<InteractionType, (mainStr: string, layerAdd: string) => string[]> = {
  amplify: (ms, la) => [
    `${ms} gets louder — ${la} reinforces it without changing direction.`,
    `Doubles down on ${ms}, with ${la} adding density to the trail.`,
  ],
  balance: (ms, la) => [
    `${ms} stays forward, ${la} fills in behind for a rounder finish.`,
    `Opens with ${ms}, settles into ${la} without either dropping out.`,
  ],
  contrast: (ms, la) => [
    `${ms} opens sharp, then ${la} pulls it somewhere different.`,
    `Starts with ${ms}, shifts into ${la} as it develops on skin.`,
  ],
};

function buildEffectText(
  mood: LayerMood,
  baseName: string,
  layerName: string,
  baseNotes: string[],
  layerNotes: string[],
  interactionType: InteractionType,
  ratio: RatioOption = '1:1',
): string {
  const baseRole = detectRole(baseNotes);
  const layerRole = detectRole(layerNotes);

  const mainStrength = baseRole ? (ROLE_STRENGTHS[baseRole.role] ?? 'its character') : 'its character';
  let layerAddition = layerRole ? (ROLE_ADDITIONS[layerRole.role] ?? 'a complementary layer') : 'a complementary layer';

  if (baseRole && layerRole && baseRole.role === layerRole.role) {
    const altRole = detectSecondaryRole(layerNotes, baseRole.role);
    layerAddition = altRole ? (ROLE_ADDITIONS[altRole.role] ?? 'a contrasting edge') : 'a contrasting edge';
  }

  // Ratio-aware effect text
  if (ratio === '2:1') {
    return `${mainStrength.charAt(0).toUpperCase() + mainStrength.slice(1)} leads the wear — ${layerAddition} sits behind, felt more than heard.`;
  } else if (ratio === '1:2') {
    return `${layerAddition.charAt(0).toUpperCase() + layerAddition.slice(1)} pushes forward — ${mainStrength} anchors underneath without competing.`;
  }
  // 1:1 balanced — use interaction-type templates
  const templateFn = INTERACTION_EFFECT_TEMPLATES[interactionType] ?? INTERACTION_EFFECT_TEMPLATES.balance;
  const templates = templateFn(mainStrength, layerAddition);
  const idx = (baseName.length + layerName.length) % templates.length;
  return templates[idx];
}

function buildMoodConfig(
  mood: LayerMood,
  mainName: string,
  mainBrand: string | null,
  layerName: string,
  layerBrand: string | null,
  mainFamily: string | null,
  layerFamily: string | null,
): MoodConfig {
  const mn = getDisplayName(mainName, mainBrand);
  const ln = getDisplayName(layerName, layerBrand);

  const baseHeavy = isHeavy(mainFamily);
  const topHeavy = isHeavy(layerFamily);

  const configs: Record<LayerMood, MoodConfig> = {
    balance: {
      baseLabel: baseHeavy ? '2 sprays' : '3 sprays',
      baseZones: baseHeavy ? 'chest (1), back of neck (1)' : 'chest (2), back of neck (1)',
      topLabel: topHeavy ? '1 spray' : '2 sprays',
      topZones: topHeavy ? 'front neck (1)' : 'both wrists (1 each)',
    
    },
    bold: {
      baseLabel: baseHeavy ? '2 sprays' : '3 sprays',
      baseZones: baseHeavy ? 'chest (1), front neck (1)' : 'chest (2), front neck (1)',
      topLabel: topHeavy ? '2 sprays' : '3 sprays',
      topZones: topHeavy ? 'both wrists (1 each)' : 'front neck (1), both wrists (1 each)',
    
    },
    smooth: {
      baseLabel: baseHeavy ? '1 spray' : '2 sprays',
      baseZones: baseHeavy ? 'chest (1)' : 'chest (1), back of neck (1)',
      topLabel: topHeavy ? '1 spray' : '2 sprays',
      topZones: topHeavy ? 'front neck (1)' : 'both wrists (1 each)',
    
    },
    wild: {
      baseLabel: baseHeavy ? '2 sprays' : '3 sprays',
      baseZones: baseHeavy ? 'chest (1), front neck (1)' : 'chest (2), front neck (1)',
      topLabel: topHeavy ? '2 sprays' : '2 sprays',
      topZones: topHeavy ? 'both wrists (1 each)' : 'both wrists (1 each)',
    
    },
  };
  const cfg = configs[mood];
  // Result text uses note-aware logic
  // (notes not available here, so result is set at render time)
  return cfg;
}

/** Role descriptor with a distinct "role" word for deduplication */
interface RoleDesc { role: string; label: string }

/** Map note families to scent roles */
const ROLE_MATCHERS: { pattern: RegExp; role: string; label: string }[] = [
  { pattern: /lemon|bergamot|orange|grapefruit|lime|citrus|mandarin/, role: 'citrus', label: 'brightness' },
  { pattern: /cedar|sandalwood|oud|wood|vetiver/, role: 'woody', label: 'structure' },
  { pattern: /cardamom|pepper|cinnamon|saffron|clove|nutmeg|ginger/, role: 'spicy', label: 'warmth' },
  { pattern: /vanilla|caramel|honey|tonka|praline|cocoa|chocolate/, role: 'sweet', label: 'roundness' },
  { pattern: /rose|jasmine|iris|violet|lily|tuberose|neroli|lavender/, role: 'floral', label: 'elegance' },
  { pattern: /aqua|marine|mint|cucumber|water|ozone|rain/, role: 'fresh', label: 'clarity' },
  { pattern: /leather|suede|tobacco|smoke/, role: 'leather', label: 'rugged depth' },
  { pattern: /amber|resin|incense|benzoin|labdanum/, role: 'resin', label: 'weight' },
  { pattern: /patchouli|earth|moss|soil/, role: 'earthy', label: 'grounding' },
  { pattern: /pear|apple|peach|plum|berry|fig|raspberry/, role: 'fruity', label: 'lift' },
  { pattern: /musk|skin|powder/, role: 'musk', label: 'softness' },
];

/** Detect the primary role from a notes array */
function detectRole(notes: string[]): RoleDesc | null {
  if (!notes || notes.length === 0) return null;
  const joined = notes.slice(0, 4).map(s => s.toLowerCase()).join(' ');
  for (const m of ROLE_MATCHERS) {
    if (m.pattern.test(joined)) return { role: m.role, label: m.label };
  }
  return null;
}

/** Detect secondary role that differs from the primary */
function detectSecondaryRole(notes: string[], excludeRole: string): RoleDesc | null {
  if (!notes || notes.length === 0) return null;
  const joined = notes.slice(0, 4).map(s => s.toLowerCase()).join(' ');
  for (const m of ROLE_MATCHERS) {
    if (m.role !== excludeRole && m.pattern.test(joined)) return { role: m.role, label: m.label };
  }
  return null;
}

/* ── "Why it works" — natural, sensory language ── */

/** What each role DOES (verb-based, not noun labels) */
const ROLE_DOES: Record<string, string> = {
  citrus: 'keeps it bright',
  woody: 'gives it shape',
  spicy: 'adds bite',
  sweet: 'rounds it out',
  floral: 'opens it up',
  fresh: 'keeps it clean',
  leather: 'adds edge',
  resin: 'anchors the base',
  earthy: 'grounds it',
  fruity: 'lifts the opening',
  musk: 'softens the landing',
};

/** What each role PREVENTS (when the other scent could be too much) */
const ROLE_PREVENTS: Record<string, string> = {
  citrus: 'feeling flat',
  woody: 'feeling thin',
  spicy: 'feeling one-note',
  sweet: 'feeling sharp',
  floral: 'feeling heavy',
  fresh: 'getting stale',
  leather: 'feeling light',
  resin: 'drifting away too fast',
  earthy: 'floating off',
  fruity: 'feeling dense',
  musk: 'feeling harsh',
};

const THIN_EXPLANATION_PATTERNS = [
  /\bstrong fit for (the )?current context\b/i,
  /\bgood fit for (the )?current context\b/i,
  /\bsolid fit for (the )?current context\b/i,
  /\bworks (well )?for (the )?current context\b/i,
  /\bfits (the )?current context\b/i,
  /\bselected layer for this card\b/i,
  /\badded from search for this card\b/i,
];

const EXPLANATION_DETAIL_SIGNAL_PATTERN = /\b(amber|bergamot|cardamom|cedar|citrus|coffee|floral|iris|jasmine|lavender|leather|marine|musk|neroli|oud|patchouli|pepper|powder|resin|rose|saffron|sandalwood|smoke|spice|spicy|tonka|vanilla|vetiver|violet|woody)\b/i;

function isThinExplanation(value: string | null | undefined) {
  const normalized = readTrimmedDisplayText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return true;
  if (THIN_EXPLANATION_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (/\b(layer|hero|main scent|recipe)\b/.test(normalized) && !EXPLANATION_DETAIL_SIGNAL_PATTERN.test(normalized)) {
    return true;
  }

  return normalized.length < 52
    && !/[,:;]/.test(normalized)
    && !EXPLANATION_DETAIL_SIGNAL_PATTERN.test(normalized);
}

function buildExplanationNotePool(source: {
  topNotes?: string[] | null | undefined;
  middleNotes?: string[] | null | undefined;
  baseNotes?: string[] | null | undefined;
  notes?: string[] | null | undefined;
  accords?: string[] | null | undefined;
}) {
  const top = normalizeNotes((source.topNotes ?? []).map((value) => `${value}`.trim()).filter(Boolean), 2);
  const middle = normalizeNotes((source.middleNotes ?? []).map((value) => `${value}`.trim()).filter(Boolean), 2);
  const base = normalizeNotes((source.baseNotes ?? []).map((value) => `${value}`.trim()).filter(Boolean), 2);
  if (top.length > 0 || middle.length > 0 || base.length > 0) {
    return [...top, ...middle, ...base];
  }

  const flatNotes = normalizeNotes((source.notes ?? []).map((value) => `${value}`.trim()).filter(Boolean), 6);
  if (flatNotes.length > 0) {
    return flatNotes;
  }

  return normalizeNotes((source.accords ?? []).map((value) => `${value}`.trim()).filter(Boolean), 4);
}

function buildWhyItWorks(
  mood: LayerMood,
  baseName: string,
  layerName: string,
  baseNotes: string[],
  layerNotes: string[],
  interactionType: InteractionType,
): string {
  const baseRole = detectRole(baseNotes);
  const layerRole = detectRole(layerNotes);

  let bDoes = baseRole ? (ROLE_DOES[baseRole.role] ?? 'holds the center') : 'holds the center';
  let lDoes = layerRole ? (ROLE_DOES[layerRole.role] ?? 'fills in the gaps') : 'fills in the gaps';
  let lPrevents = layerRole ? (ROLE_PREVENTS[layerRole.role] ?? 'feeling incomplete') : 'feeling incomplete';
  let bPrevents = baseRole ? (ROLE_PREVENTS[baseRole.role] ?? 'feeling incomplete') : 'feeling incomplete';

  if (baseRole && layerRole && baseRole.role === layerRole.role) {
    const altLayer = detectSecondaryRole(layerNotes, baseRole.role);
    if (altLayer) {
      lDoes = ROLE_DOES[altLayer.role] ?? 'fills in the gaps';
      lPrevents = ROLE_PREVENTS[altLayer.role] ?? 'feeling one-dimensional';
    }
  }

  // Interaction-type-aware sentence patterns
  if (interactionType === 'amplify') {
    return `Both push in the same direction — the base ${bDoes} and the layer doubles down, so it reads stronger without getting muddy.`;
  } else if (interactionType === 'contrast') {
    return `The base ${bDoes}, while the layer ${lDoes} — opposite energies that stop it from ${lPrevents}.`;
  } else {
    // balance
    const pick = (baseName.length + layerName.length) % 2;
    if (pick === 0) {
      return `One ${bDoes}, the other ${lDoes}, so it doesn't end up ${bPrevents}.`;
    } else {
      return `The base ${bDoes}, the layer ${lDoes} — fills what's missing without fighting it.`;
    }
  }
}

/* ── Ratio system ── */
export type RatioOption = '2:1' | '1:1' | '1:2';

interface RatioChoice {
  ratio: RatioOption;
  label: string;
}

const RATIO_OPTIONS: RatioChoice[] = [
  { ratio: '2:1', label: 'base-forward' },
  { ratio: '1:1', label: 'balanced' },
  { ratio: '1:2', label: 'top-accented' },
];

/** Weight score: 0 (lightest) to 1 (heaviest) based on family + projection */
function computeWeight(familyKey: string | null, projection: number | null): number {
  let weight = 0.5;
  if (familyKey && HEAVY_FAMILIES.has(familyKey)) weight += 0.25;
  if (familyKey && LIGHT_FAMILIES.has(familyKey)) weight -= 0.25;
  // Projection is stored as integer 1-10 in DB, normalize to 0-1
  if (projection != null) {
    const norm = Math.max(0, Math.min(1, projection / 10));
    weight = weight * 0.4 + norm * 0.6; // projection-weighted blend
  }
  return Math.max(0, Math.min(1, weight));
}

function computeRecommendedRatio(
  baseFamily: string | null,
  baseProjection: number | null,
  layerFamily: string | null,
  layerProjection: number | null,
): RatioOption {
  const baseW = computeWeight(baseFamily, baseProjection);
  const layerW = computeWeight(layerFamily, layerProjection);
  const delta = baseW - layerW;
  if (delta > 0.12) return '2:1';   // base is stronger → base-forward
  if (delta < -0.12) return '1:2';  // layer is stronger → top-accented
  return '1:1';                      // similar → balanced
}

/* ── Props ── */
interface LayerCardProps {
  mainName: string;
  mainBrand: string | null;
  mainNotes: string[] | null;
  mainTopNotes?: string[] | null;
  mainMiddleNotes?: string[] | null;
  mainBaseNotes?: string[] | null;
  mainFamily: string | null;
  mainProjection: number | null;
  mainSprayCount?: number | null;
  layerModes: LayerModes;
  visibleLayerMode?: NonNullable<LayerModes[LayerMood]> | null;
  selectedMood: LayerMood;
  onSelectMood: (mood: LayerMood) => void;
  selectedRatio: string;
  onSelectRatio: (ratio: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  lockPulse?: boolean;
  locked?: boolean;
  consumeLockedMoodTap?: boolean;
  loadingMood?: LayerMood | null;
  modeLoading?: Record<LayerMood, boolean>;
  modeErrors?: Record<LayerMood, string | null>;
  onRetryMood?: (mood: LayerMood) => void;
  disabledMoodReasons?: Partial<Record<LayerMood, string>>;
  /** Optional backend-provided token rail for the visible layer (signed-in main page).
   *  Rendered between the layer family chip and the mode row to match the locked
   *  layer order (name → brand → family → tokens → mode row → why it works). */
  layerTokens?: Array<any> | null;
  layerImageUrl?: string | null;
  layerSprayCount?: number | null;
  detailIdentityKey?: string;
  showLegacyAccordsText?: boolean;
  onOpenFragranceDetail?: () => void;
  onOpenScentIntel?: (input: {
    label: string;
    slug?: string | null;
    fragranceId?: string | null;
    fragranceName?: string | null;
    fragranceBrand?: string | null;
    position?: string | null;
  }) => void;
  resolveScentChipTone?: (
    label: string,
    familyKey?: string | null,
  ) => {
    border: string;
    background: string;
    color: string;
    glow: string;
  };
}

const LayerCard = ({
  mainName,
  mainBrand,
  mainNotes,
  mainTopNotes = null,
  mainMiddleNotes = null,
  mainBaseNotes = null,
  mainFamily,
  mainProjection,
  mainSprayCount = null,
  layerModes,
  visibleLayerMode = null,
  selectedMood,
  onSelectMood,
  selectedRatio,
  onSelectRatio,
  isExpanded,
  onToggleExpand,
  lockPulse = false,
  locked = false,
  consumeLockedMoodTap = false,
  loadingMood = null,
  modeLoading,
  modeErrors,
  onRetryMood,
  disabledMoodReasons,
  layerTokens = null,
  layerImageUrl = null,
  layerSprayCount = null,
  detailIdentityKey = '',
  showLegacyAccordsText = true,
  onOpenFragranceDetail,
  onOpenScentIntel,
  resolveScentChipTone,
}: LayerCardProps) => {
  const titlePressRef = React.useRef<{
    pointerId: number;
    startedAt: number;
    startX: number;
    startY: number;
  } | null>(null);
  const activeModeEntry = visibleLayerMode;
  const isLoadingSelectedMood = modeLoading?.[selectedMood] ?? loadingMood === selectedMood;
  const moodError = modeErrors?.[selectedMood] ?? null;
  const layerRatioGuide = activeModeEntry
    ? resolveLayerRatioGuide(
        {
          name: mainName,
          brand: mainBrand,
          family_key: mainFamily,
          notes: mainNotes,
          top_notes: mainTopNotes,
          middle_notes: mainMiddleNotes,
          base_notes: mainBaseNotes,
          projection: mainProjection,
        },
        {
          name: activeModeEntry.name,
          brand: activeModeEntry.brand,
          family_key: activeModeEntry.family_key,
          notes: activeModeEntry.notes,
          top_notes: activeModeEntry.top_notes,
          middle_notes: activeModeEntry.middle_notes,
          base_notes: activeModeEntry.base_notes,
          accords: activeModeEntry.accords,
          projection: activeModeEntry.projection,
        },
      )
    : null;

  // Ratio system — recommended ratio for visual hint
  const recommendedRatio: RatioOption = layerRatioGuide
    ? (layerRatioGuide.ratioValue === '1:1' || layerRatioGuide.ratioValue === '1:2' ? layerRatioGuide.ratioValue : '2:1')
    : computeRecommendedRatio(
        mainFamily, mainProjection,
        activeModeEntry?.family_key ?? null, activeModeEntry?.projection ?? null,
      );
  // Sync to recommended when mood changes (if parent hasn't overridden)
  React.useEffect(() => {
    onSelectRatio(recommendedRatio);
  }, [recommendedRatio, selectedMood]);

  // COLOR: derived solely from the selected layer fragrance's family_key
  const anchorColor = mainFamily ? (FAMILY_COLORS[mainFamily] ?? '#888') : '#888';
  const layerColor = activeModeEntry ? (FAMILY_COLORS[activeModeEntry.family_key] ?? '#888') : '#888';
  const layerTint = activeModeEntry ? (FAMILY_TINTS[activeModeEntry.family_key] ?? DEFAULT_TINT) : DEFAULT_TINT;
  const interactionType = (
    (activeModeEntry as any)?.interaction_type
    ?? (activeModeEntry as any)?.interactionType
    ?? selectedMood
  ) as InteractionType;
  const resolvedRatioOption: RatioOption = selectedRatio === '2:1' || selectedRatio === '1:1' || selectedRatio === '1:2'
    ? selectedRatio
    : recommendedRatio;
  const cfg = activeModeEntry
    ? buildMoodConfig(
        selectedMood,
        mainName,
        mainBrand,
        activeModeEntry.name,
        activeModeEntry.brand,
        mainFamily,
        activeModeEntry.family_key,
      )
    : null;

  // Backend-driven text
  const sameDnaPair = activeModeEntry
    ? isNearDuplicateFlankerPair(
        mainName,
        mainBrand,
        mainFamily,
        activeModeEntry.name,
        activeModeEntry.brand,
        activeModeEntry.family_key,
      )
    : false;
  const rawWhyText = activeModeEntry?.why_it_works?.trim() || activeModeEntry?.reason?.trim() || '';
  const rawReasonText = activeModeEntry?.reason?.trim() || '';
  const rawWearText = activeModeEntry?.application_style?.trim() || '';
  const sanitizedWhyText = sanitizeLayerDetailCopy(
    rawWhyText,
    mainName,
    mainBrand,
    activeModeEntry?.name,
    activeModeEntry?.brand,
  );
  const safeWhyFallback = activeModeEntry
    ? `Use ${getDisplayName(activeModeEntry.name, activeModeEntry.brand)} as the selected layer for this card.`
    : '';
  const generatedWhyText = activeModeEntry
    ? buildWhyItWorks(
        selectedMood,
        mainName,
        activeModeEntry.name,
        buildExplanationNotePool({
          topNotes: mainTopNotes,
          middleNotes: mainMiddleNotes,
          baseNotes: mainBaseNotes,
          notes: mainNotes,
        }),
        buildExplanationNotePool({
          topNotes: activeModeEntry.top_notes,
          middleNotes: activeModeEntry.middle_notes,
          baseNotes: activeModeEntry.base_notes,
          notes: activeModeEntry.notes,
          accords: activeModeEntry.accords,
        }),
        interactionType,
      )
    : '';
  const whyText = sameDnaPair
    ? 'A same-DNA intensifier — this pairing deepens the original profile instead of acting like a contrasting support layer.'
    : (!isThinExplanation(sanitizedWhyText)
      ? sanitizedWhyText
      : (generatedWhyText || safeWhyFallback));
  const placementText = activeModeEntry?.placement_hint?.trim() || '';
  const ratioText = activeModeEntry?.ratio_hint?.trim() || '';
  const sanitizedPlacementText = sanitizeLayerDetailCopy(
    placementText,
    mainName,
    mainBrand,
    activeModeEntry?.name,
    activeModeEntry?.brand,
  );
  const sanitizedRatioText = sanitizeLayerDetailCopy(
    ratioText,
    mainName,
    mainBrand,
    activeModeEntry?.name,
    activeModeEntry?.brand,
  );
  const sanitizedReasonText = sanitizeLayerDetailCopy(
    rawReasonText,
    mainName,
    mainBrand,
    activeModeEntry?.name,
    activeModeEntry?.brand,
  );
  const sanitizedWearText = sanitizeLayerDetailCopy(
    rawWearText,
    mainName,
    mainBrand,
    activeModeEntry?.name,
    activeModeEntry?.brand,
  );
  const sprayPattern = normalizeSprayPatternForDisplay(
    activeModeEntry?.spray_pattern ?? null,
    mainName,
    mainBrand,
    activeModeEntry?.name,
    activeModeEntry?.brand,
  );
  const derivedSprayCounts = deriveSprayCountsFromLayerMode(activeModeEntry as any);
  const resolvedMainSprayCount = layerRatioGuide?.anchorSprays ?? mainSprayCount ?? derivedSprayCounts.main;
  const resolvedLayerSprayCount = layerRatioGuide?.companionSprays ?? layerSprayCount ?? derivedSprayCounts.layer;
  const fallbackPlacementText = resolvedMainSprayCount || resolvedLayerSprayCount
    ? [
        resolvedMainSprayCount ? `Anchor: ${resolvedMainSprayCount} spray${resolvedMainSprayCount === 1 ? '' : 's'}` : null,
        resolvedLayerSprayCount ? `Layer: ${resolvedLayerSprayCount} spray${resolvedLayerSprayCount === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · ')
    : '';
  const fallbackSprayGuidanceText = resolvedMainSprayCount && resolvedLayerSprayCount
    ? `Start with ${resolvedMainSprayCount} anchor spray${resolvedMainSprayCount === 1 ? '' : 's'}, then add ${resolvedLayerSprayCount} layer spray${resolvedLayerSprayCount === 1 ? '' : 's'}.`
    : resolvedMainSprayCount
      ? `Use ${resolvedMainSprayCount} anchor spray${resolvedMainSprayCount === 1 ? '' : 's'} as the base.`
      : resolvedLayerSprayCount
        ? `Use ${resolvedLayerSprayCount} layer spray${resolvedLayerSprayCount === 1 ? '' : 's'} as the accent.`
        : '';
  const rawPatternName = sprayPattern?.name
    || sanitizeLayerDetailCopy(
      activeModeEntry?.spray_pattern_name?.trim()
        || activeModeEntry?.application_style?.trim()
        || '',
      mainName,
      mainBrand,
      activeModeEntry?.name,
      activeModeEntry?.brand,
    );
  const patternRatioText = sprayPattern?.spray_ratio?.trim() || sanitizedRatioText;
  const sprayPatternDisplay = rawPatternName
    ? (patternRatioText ? `${rawPatternName} · ${patternRatioText}` : rawPatternName)
    : '';
  const placementRowsFromPattern = sprayPattern
    ? {
        anchor: sprayPattern.anchor_placement_text?.trim() || '',
        layer: sprayPattern.layer_placement_text?.trim() || '',
      }
    : null;
  const parsedPlacementRows = parsePlacementRowsFromText(sanitizedPlacementText);
  const placementRows = {
    anchor: layerRatioGuide?.anchorPlacement
      || placementRowsFromPattern?.anchor
      || parsedPlacementRows.anchor
      || (resolvedMainSprayCount ? `${resolvedMainSprayCount} spray${resolvedMainSprayCount === 1 ? '' : 's'}` : '')
      || (cfg ? `${cfg.baseLabel} · ${cfg.baseZones}` : ''),
    layer: layerRatioGuide?.companionPlacement
      || placementRowsFromPattern?.layer
      || parsedPlacementRows.layer
      || (resolvedLayerSprayCount ? `${resolvedLayerSprayCount} spray${resolvedLayerSprayCount === 1 ? '' : 's'}` : '')
      || (cfg ? `${cfg.topLabel} · ${cfg.topZones}` : ''),
  };
  const anchorPlacementGuide = buildPlacementGuide({
    fragrance: getDisplayName(mainName, mainBrand),
    role: 'Anchor',
    familyKey: mainFamily,
    colorToken: anchorColor,
    placementText: placementRows.anchor,
  });
  const layerPlacementGuide = activeModeEntry
    ? buildPlacementGuide({
        fragrance: getDisplayName(activeModeEntry.name, activeModeEntry.brand),
        role: 'Layer',
        familyKey: activeModeEntry.family_key,
        colorToken: layerColor,
        placementText: placementRows.layer,
      })
    : null;
  const hasPlacementMap = anchorPlacementGuide.placements.length > 0
    || (layerPlacementGuide?.placements.length ?? 0) > 0;
  const placementFallbackText = parsedPlacementRows.remainder || fallbackPlacementText;
  const resolvedWhyText = layerRatioGuide?.combinedExplanation || sprayPattern?.why_it_works || whyText;
  const rawSprayGuidanceText = activeModeEntry?.spray_guidance?.trim() || '';
  const sanitizedSprayGuidanceText = sanitizeLayerDetailCopy(
    rawSprayGuidanceText,
    mainName,
    mainBrand,
    activeModeEntry?.name,
    activeModeEntry?.brand,
  );
  const ratioDisplayText = layerRatioGuide?.ratioLabel || sprayPatternDisplay || sanitizedRatioText;
  const whyRatioText = layerRatioGuide?.whyRatio || '';
  const sprayGuidanceCandidate = layerRatioGuide?.sprayGuidance || sanitizedSprayGuidanceText || fallbackSprayGuidanceText;
  const sprayGuidanceText = areDetailTextsEquivalent(sprayGuidanceCandidate, resolvedWhyText)
    || areDetailTextsEquivalent(sprayGuidanceCandidate, placementFallbackText)
    || areDetailTextsEquivalent(sprayGuidanceCandidate, ratioDisplayText)
    ? ''
    : sprayGuidanceCandidate;
  const resolvedLayerTokens = Array.isArray(layerTokens) && layerTokens.length > 0
    ? layerTokens
    : buildFallbackLayerTokens(activeModeEntry?.notes, activeModeEntry?.accords, layerColor);
  const layerImageCandidates = React.useMemo(() => buildLayerBottleImageCandidates(layerImageUrl), [layerImageUrl]);
  const layerImageCandidateKey = layerImageCandidates.join('|');
  const [layerImageCandidateIndex, setLayerImageCandidateIndex] = React.useState(0);
  React.useEffect(() => {
    setLayerImageCandidateIndex(0);
  }, [layerImageCandidateKey]);
  const activeLayerImageUrl = layerImageCandidates[layerImageCandidateIndex] ?? null;
  const likelyTransparentLayerImage = isLikelyTransparentBottleImageUrl(activeLayerImageUrl);
  const hasPlacement = !!(placementRows.anchor || placementRows.layer || placementFallbackText || sprayPatternDisplay);
  const placementSubline = layerRatioGuide ? '' : (ratioDisplayText || '');
  const generatedEffectText = activeModeEntry
    ? buildEffectText(
        selectedMood,
        mainName,
        activeModeEntry.name,
        mainNotes ?? [],
        activeModeEntry.notes ?? [],
        interactionType,
        resolvedRatioOption,
      )
    : '';
  const effectTextCandidate = sanitizedReasonText || generatedEffectText;
  const effectText = areDetailTextsEquivalent(effectTextCandidate, resolvedWhyText)
    ? ''
    : effectTextCandidate;
  const wearText = areDetailTextsEquivalent(sanitizedWearText, resolvedWhyText)
    || areDetailTextsEquivalent(sanitizedWearText, effectText)
    || areDetailTextsEquivalent(sanitizedWearText, ratioDisplayText)
    ? ''
    : sanitizedWearText;
  const ratioOnlyText = !ratioDisplayText || areDetailTextsEquivalent(ratioDisplayText, wearText)
    ? ''
    : ratioDisplayText;
  const detailSections = [
    resolvedWhyText
      ? { label: 'Why it works', value: resolvedWhyText }
      : null,
    effectText
      ? { label: 'Effect', value: effectText }
      : null,
    ratioOnlyText
      ? { label: 'Ratio', value: ratioOnlyText }
      : null,
    whyRatioText
      ? { label: 'Why this ratio', value: whyRatioText }
      : null,
    wearText
      ? { label: 'How to wear it', value: wearText }
      : null,
    sprayGuidanceText
      ? { label: 'Spray guidance', value: sprayGuidanceText }
      : null,
    hasPlacement
      ? {
          label: 'Placement',
          placementRows,
          value: placementFallbackText,
          subline: placementSubline,
        }
      : null,
  ].filter((section): section is NonNullable<typeof section> => !!section);
  const hasLayerDetailContent = detailSections.length > 0;
  const layerChipFamilyKey = activeModeEntry?.family_key ?? mainFamily ?? null;

  const resolveFallbackTokenTone = React.useCallback((label: string, colorHex?: string | null) => {
    if (resolveScentChipTone) {
      return resolveScentChipTone(label, layerChipFamilyKey);
    }
    const baseColor = colorHex ?? layerColor;
    return {
      color: `${baseColor}`,
      border: `${baseColor}55`,
      background: `${baseColor}12`,
      glow: `${baseColor}22`,
    };
  }, [layerChipFamilyKey, layerColor, resolveScentChipTone]);

  const handleOpenLayerScentIntel = React.useCallback((
    event: React.MouseEvent<HTMLButtonElement> | React.PointerEvent<HTMLButtonElement>,
    label: string,
    slug?: string | null,
    position?: string | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const cleanLabel = String(label ?? '').trim();
    if (!cleanLabel) return;
    onOpenScentIntel?.({
      label: cleanLabel,
      slug: slug ?? null,
      fragranceId: activeModeEntry?.id ?? null,
      fragranceName: activeModeEntry?.name ?? null,
      fragranceBrand: activeModeEntry?.brand ?? null,
      position: position ?? null,
    });
  }, [activeModeEntry, onOpenScentIntel]);

  const layerFamilyLabel = activeModeEntry?.family_key?.trim()
    ? activeModeEntry.family_key.toUpperCase()
    : '';
  const layerFamilyChips = React.useMemo(() => (
    expandAndDeduplicateScentIntelDisplayTerms(
      layerFamilyLabel
        ? [{ label: layerFamilyLabel, slug: activeModeEntry?.family_key ?? null, position: 'family' }]
        : [],
    )
  ), [activeModeEntry?.family_key, layerFamilyLabel]);
  const expandedLayerTokens = React.useMemo(() => (
    expandAndDeduplicateScentIntelDisplayTerms(
      resolvedLayerTokens.flatMap((token: any) => {
        const tokenLabel = String(token?.token_label ?? '').trim();
        if (!tokenLabel) return [];
        const tokenSlug = typeof token?.slug === 'string'
          ? token.slug
          : typeof token?.term_slug === 'string'
            ? token.term_slug
            : typeof token?.token_slug === 'string'
              ? token.token_slug
              : null;
        const tokenPosition = typeof token?.position === 'string'
          ? token.position
          : typeof token?.context_position === 'string'
            ? token.context_position
            : null;
        return [{ label: tokenLabel, slug: tokenSlug, position: tokenPosition }];
      }),
    )
  ), [resolvedLayerTokens]);

  const handleTitlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    titlePressRef.current = {
      pointerId: event.pointerId,
      startedAt: Date.now(),
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const handleTitlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = titlePressRef.current;
    titlePressRef.current = null;
    if (!current || current.pointerId !== event.pointerId) return;
    const duration = Date.now() - current.startedAt;
    const deltaX = Math.abs(event.clientX - current.startX);
    const deltaY = Math.abs(event.clientY - current.startY);
    if (duration > 320 || deltaX > 10 || deltaY > 10) return;
    onOpenFragranceDetail?.();
  };

  return (
    <div
      className="relative z-10 mb-[14px] flex w-full cursor-pointer select-none flex-col rounded-xl px-5 py-[12px]"
      onClick={(e) => {
        e.stopPropagation();
        onToggleExpand();
      }}
      style={{
        background: `linear-gradient(135deg, ${layerTint.material}, ${layerTint.bg}), rgba(6,6,8,0.92)`,
        border: `1px solid ${layerTint.border}`,
        // ONE clean refined surface — no offset shadow, no outer glow,
        // no pseudo-shelf. Border + inner sheen is sufficient depth.
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04)`,
        backdropFilter: 'blur(24px)',
        pointerEvents: 'auto',
      }}
    >
      {activeModeEntry ? (
        <>
          <div className="flex w-full items-start justify-between gap-4">
            <div className="min-w-0 flex-1 text-left">
            <button
              type="button"
              data-odara-layer-title-button
              data-card-swipe-allow
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                }}
                onPointerDown={handleTitlePointerDown}
                onPointerUp={handleTitlePointerUp}
                onPointerCancel={() => {
                  titlePressRef.current = null;
                }}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-transparent p-0 text-left text-lg font-serif leading-tight tracking-wide text-white"
              >
                <span className="min-w-0">
                  {getDisplayName(activeModeEntry.name, activeModeEntry.brand)}
                </span>
                <SprayDots
                  count={resolvedLayerSprayCount}
                  color={layerColor}
                  className="inline-flex items-center gap-1 pt-0.5"
                />
              </button>
              {activeModeEntry.brand && (
                <p className="mt-[1px] text-left text-[10px] text-white/50">{activeModeEntry.brand}</p>
              )}
              {layerFamilyChips.length > 0 ? (
                <div className="mt-[4px] flex flex-wrap gap-1.5">
                  {layerFamilyChips.map((chip, index) => {
                    const tone = resolveFallbackTokenTone(chip.label, layerColor);
                    return (
                      <button
                        type="button"
                        key={`layer-family-chip-${chip.slug ?? chip.label}-${index}`}
                        data-no-card-swipe
                        aria-label={`Open scent intel for ${chip.label}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onPointerUp={(event) => {
                          event.stopPropagation();
                        }}
                        onClick={(event) => handleOpenLayerScentIntel(event, chip.label, chip.slug ?? null, chip.position ?? 'family')}
                        className="inline-flex w-auto rounded-full px-3 py-[2px] text-left text-[9px] uppercase tracking-[0.25em]"
                        style={{
                          color: tone.color,
                          border: `1px solid ${tone.border}`,
                          background: tone.background,
                          boxShadow: `0 0 8px ${tone.glow}`,
                          WebkitTapHighlightColor: 'transparent',
                          touchAction: 'manipulation',
                          pointerEvents: 'auto',
                        }}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {expandedLayerTokens.length > 0 && (
                <div
                  data-no-card-swipe
                  className="odara-token-rail-fade hide-horizontal-scrollbar mt-1.5 flex w-full flex-nowrap items-center justify-start gap-1.5 overflow-x-auto pr-1"
                  style={{ WebkitOverflowScrolling: 'touch' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {expandedLayerTokens.map((token, i: number) => {
                    const tone = resolveFallbackTokenTone(token.label, layerColor);
                    return (
                      <button
                        type="button"
                        key={`mlayer-tok-${token.slug ?? token.label}-${token.position ?? 'na'}-${i}`}
                        data-no-card-swipe
                        aria-label={`Open scent intel for ${token.label}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onPointerUp={(event) => {
                          event.stopPropagation();
                        }}
                        onClick={(event) => handleOpenLayerScentIntel(
                          event,
                          token.label,
                          token.slug ?? null,
                          token.position ?? null,
                        )}
                        className="flex-shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.12em]"
                        style={{
                          color: tone.color,
                          border: `1px solid ${tone.border}`,
                          background: tone.background,
                          boxShadow: `0 0 6px ${tone.glow}`,
                          WebkitTapHighlightColor: 'transparent',
                          touchAction: 'manipulation',
                          pointerEvents: 'auto',
                        }}
                      >
                        {token.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {showLegacyAccordsText && (() => {
                const layerNotes = activeModeEntry.notes ?? [];
                const layerAccords = (activeModeEntry.accords ?? []).map(a => a.trim());
                const displayNotes = normalizeNotes(layerNotes, 3);
                const displayAccords = layerAccords.slice(0, 4);
                const hasAny = displayNotes.length > 0 || displayAccords.length > 0;
                if (!hasAny) return null;
                return (
                  <div className="mt-[6px] w-full space-y-[2px] pr-2">
                    {displayAccords.length > 0 && (
                      <p className="text-left text-[11px] lowercase text-white/80" style={{ letterSpacing: '0.06em' }}>
                        <span className="text-white/50">Accords:</span> {displayAccords.join(', ').toLowerCase()}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            {activeLayerImageUrl ? (
              <div className="pointer-events-none relative mt-0.5 h-[92px] w-[70px] shrink-0">
                <img
                  src={activeLayerImageUrl}
                  alt={`${activeModeEntry.name} bottle`}
                  className="h-full w-full object-contain object-center"
                  loading="lazy"
                  draggable={false}
                  onError={() => setLayerImageCandidateIndex((index) => index + 1)}
                  style={{
                    opacity: 0.88,
                    borderRadius: likelyTransparentLayerImage ? undefined : 16,
                    filter: likelyTransparentLayerImage
                      ? 'drop-shadow(0 12px 18px rgba(0,0,0,0.30))'
                      : 'contrast(1.03) saturate(0.96) drop-shadow(0 12px 18px rgba(0,0,0,0.30))',
                    mixBlendMode: likelyTransparentLayerImage ? undefined : 'darken',
                  }}
                />
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex w-full flex-col items-start gap-2 text-left">
          {isLoadingSelectedMood ? (
            <>
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
              <p className="text-[11px] text-left text-white/45">
                Loading {selectedMood} layer…
              </p>
            </>
          ) : moodError ? (
            <>
              <p className="text-left text-sm font-serif leading-tight tracking-wide text-white/60">
                Couldn't load {selectedMood} layer
              </p>
              {onRetryMood && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRetryMood(selectedMood); }}
                  className="text-[11px] text-white/60 underline hover:text-white/80 transition-colors"
                >
                  Tap to retry
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-left text-lg font-serif leading-tight tracking-wide text-white/75">
                No layer loaded for this mode
              </p>
              <p className="max-w-[18rem] text-left text-[11px] text-white/45">
                Pick a mode to load its layer without showing the wrong scent.
              </p>
            </>
          )}
        </div>
      )}

      <div className="mt-[10px] w-full">
        <ModeSelector
          layerModes={layerModes}
          selectedMood={selectedMood}
          onSelectMood={onSelectMood}
          familyColors={FAMILY_COLORS}
          lockPulse={lockPulse}
          locked={locked}
          consumeLockedTap={consumeLockedMoodTap}
          loadingMood={modeLoading ? (['balance', 'bold', 'smooth', 'wild'] as LayerMood[]).find(m => modeLoading[m]) ?? loadingMood : loadingMood}
          disabledMoodReasons={disabledMoodReasons}
        />
      </div>

      {isExpanded && (
        <>
          {hasLayerDetailContent && (
            <div
              className="mt-3 w-full border-t pt-3"
              style={{ borderColor: "rgba(255,255,255,0.1)" }}
            >
              <div
                key={detailIdentityKey || `${selectedMood}:${activeModeEntry?.id ?? 'none'}`}
                className="space-y-3"
              >
                {detailSections.map((section) => (
                  <div key={section.label} className="space-y-1">
                    <span className="block text-center text-[9px] uppercase tracking-[0.15em] text-white/50">{section.label}</span>
                    {section.label === 'Placement' && section.placementRows ? (
                      <div className="mx-auto flex max-w-[24rem] flex-col gap-1 text-[13px] leading-relaxed text-white/80">
                        {section.subline && (
                          <p className="text-left text-white/90">{section.subline}</p>
                        )}
                        {hasPlacementMap && (
                          <div
                            className="grid gap-2 pb-2 sm:grid-cols-2"
                            data-layer-placement-maps
                          >
                            {anchorPlacementGuide.placements.length > 0 && (
                              <SprayPlacementMap
                                guide={anchorPlacementGuide}
                                familyColor={anchorColor}
                                compact
                              />
                            )}
                            {layerPlacementGuide && layerPlacementGuide.placements.length > 0 && (
                              <SprayPlacementMap
                                guide={layerPlacementGuide}
                                familyColor={layerColor}
                                compact
                              />
                            )}
                          </div>
                        )}
                        {section.placementRows.anchor && (
                          <p className="text-left">
                            <span className="font-medium text-white/90">Anchor:</span>{' '}
                            {section.placementRows.anchor}
                          </p>
                        )}
                        {section.placementRows.layer && (
                          <p className="text-left">
                            <span className="font-medium text-white/90">Layer:</span>{' '}
                            {section.placementRows.layer}
                          </p>
                        )}
                        {section.value && !section.placementRows.anchor && !section.placementRows.layer && (
                          <p className="text-left">{section.value}</p>
                        )}
                      </div>
                    ) : (
                      <p className="mx-auto max-w-[24rem] text-left text-[13px] leading-relaxed text-white/80">
                        {section.value}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default LayerCard;
