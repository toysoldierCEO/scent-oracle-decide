import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import ModeSelector, { type LayerMood, type LayerModes, type InteractionType, LAYER_MOODS } from "./ModeSelector";
import { normalizeNotes } from "@/lib/normalizeNotes";

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
  const templates = INTERACTION_EFFECT_TEMPLATES[interactionType](mainStrength, layerAddition);
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
  mainFamily: string | null;
  mainProjection: number | null;
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
}

const LayerCard = ({
  mainName,
  mainBrand,
  mainNotes,
  mainFamily,
  mainProjection,
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
}: LayerCardProps) => {
  const activeModeEntry = visibleLayerMode ?? layerModes[selectedMood];

  // Ratio system — recommended ratio for visual hint
  const recommendedRatio = computeRecommendedRatio(
    mainFamily, mainProjection,
    activeModeEntry?.family_key ?? null, activeModeEntry?.projection ?? null,
  );
  // Sync to recommended when mood changes (if parent hasn't overridden)
  React.useEffect(() => {
    onSelectRatio(recommendedRatio);
  }, [recommendedRatio, selectedMood]);

  if (!activeModeEntry) return null;

  // COLOR: derived solely from the selected layer fragrance's family_key
  const layerColor = FAMILY_COLORS[activeModeEntry.family_key] ?? '#888';
  const layerTint = FAMILY_TINTS[activeModeEntry.family_key] ?? DEFAULT_TINT;

  const mn = getDisplayName(mainName, mainBrand);

  const cfg = buildMoodConfig(selectedMood, mainName, mainBrand, activeModeEntry.name, activeModeEntry.brand, mainFamily, activeModeEntry.family_key);

  // Backend-driven text — no frontend generation
  const reasonText = activeModeEntry.reason || '';
  const ratioHintText = activeModeEntry.ratio_hint || '';
  const applicationText = activeModeEntry.application_style || '';
  const placementText = activeModeEntry.placement_hint || '';
  const sprayText = activeModeEntry.spray_guidance || '';
  const whyText = activeModeEntry.why_it_works || '';

  return (
    <div
      className="flex flex-col items-center mb-[14px] py-[10px] px-5 rounded-xl cursor-pointer select-none relative z-10 w-full"
      onClick={(e) => {
        e.stopPropagation();
        onToggleExpand();
      }}
      style={{
        background: `linear-gradient(135deg, ${layerTint.material}, ${layerTint.bg}), rgba(6,6,8,0.92)`,
        border: `1.5px solid ${layerTint.border}`,
        boxShadow: `0 2px 16px ${layerTint.glow}, inset 0 1px 0 ${layerTint.border}`,
        backdropFilter: 'blur(24px)',
        pointerEvents: 'auto',
      }}
    >
      <p className="text-lg font-serif tracking-wide text-white leading-tight">
        {getDisplayName(activeModeEntry.name, activeModeEntry.brand)}
      </p>
      {activeModeEntry.brand && (
        <p className="text-[10px] text-white/50 mt-[1px]">{activeModeEntry.brand}</p>
      )}
      <span
        className="text-[9px] uppercase tracking-[0.25em] mt-[4px] px-3 py-[2px] rounded-full text-white/70 text-center w-auto"
        style={{ boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.2)` }}
      >
        {activeModeEntry.family_key?.toUpperCase() ?? ''}
      </span>

      {/* Always-visible notes & accords summary */}
      {(() => {
        const layerNotes = activeModeEntry.notes ?? [];
        const layerAccords = (activeModeEntry.accords ?? []).map(a => a.trim());
        const displayNotes = normalizeNotes(layerNotes, 3);
        const displayAccords = layerAccords.slice(0, 4);
        const hasAny = displayNotes.length > 0 || displayAccords.length > 0;
        if (!hasAny) return null;
        return (
          <div className="w-full mt-[6px] px-1 space-y-[2px]">
            {displayAccords.length > 0 && (
              <p className="text-[11px] text-white/80 text-center lowercase" style={{ letterSpacing: '0.06em' }}>
                <span className="text-white/50">Accords:</span> {displayAccords.join(', ').toLowerCase()}
              </p>
            )}
          </div>
        );
      })()}

      {/* Mode selector */}
      <div className="mt-[8px]">
        <ModeSelector
          layerModes={layerModes}
          selectedMood={selectedMood}
          onSelectMood={onSelectMood}
          familyColors={FAMILY_COLORS}
          lockPulse={lockPulse}
          locked={locked}
        />
      </div>

      {/* Expanded layer detail */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
            className="w-full overflow-hidden"
          >
            <motion.div
              key={selectedMood}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
              className="pt-3 mt-2 space-y-3 text-left"
              style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}
            >

              {reasonText && (
                <div>
                  <span className="text-[9px] uppercase tracking-[0.15em] text-white/50 block text-center">Reason</span>
                  <p className="text-sm text-white/80 leading-relaxed mt-1 text-center">
                    {reasonText}
                  </p>
                </div>
              )}

              {/* Ratio selector */}
              <div className="flex gap-1.5 justify-center" onClick={(e) => e.stopPropagation()}>
                {RATIO_OPTIONS.map((opt) => {
                  const isSelected = selectedRatio === opt.ratio;
                  const isRecommended = recommendedRatio === opt.ratio;
                  return (
                    <button
                      key={opt.ratio}
                      onClick={() => { if (!locked) onSelectRatio(opt.ratio); }}
                      className={`text-[9px] uppercase tracking-[0.08em] px-2 py-[3px] rounded-full transition-all duration-200 flex items-center gap-1 ${
                        locked && !isSelected ? 'opacity-30 cursor-default' : ''
                      } ${
                        isSelected
                          ? "text-white"
                          : "text-white/35 hover:text-white/60"
                      }`}
                      style={isSelected ? {
                        background: `${layerColor}30`,
                        boxShadow: `inset 0 0 0 1px ${layerColor}55`,
                        animation: lockPulse ? 'lockConfirmTint 300ms ease-out forwards' : undefined,
                      } : undefined}
                    >
                      <span>{opt.ratio}</span>
                      <span className="text-[8px] normal-case tracking-normal">{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              {ratioHintText && (
                <div>
                  <span className="text-[9px] uppercase tracking-[0.15em] text-white/50 block text-center">Ratio hint</span>
                  <p className="text-sm text-white/80 leading-relaxed mt-1 text-center">
                    {ratioHintText}
                  </p>
                </div>
              )}

              {/* Application — backend-driven guidance per mood */}
              <div>
                <span className="text-[9px] uppercase tracking-[0.15em] text-white/50 block text-center">Application</span>
                {applicationText && (
                  <p className="text-sm text-white/80 leading-relaxed mt-1 text-center">
                    {applicationText}
                  </p>
                )}
                {placementText && (
                  <p className="text-[11px] text-white/50 mt-1 text-center italic">{placementText}</p>
                )}
                {sprayText && (
                  <p className="text-[11px] text-white/50 mt-0.5 text-center">{sprayText}</p>
                )}
              </div>

              {/* Why it works — more prominent explanation */}
              {whyText && (
                <div>
                  <span className="text-[9px] uppercase tracking-[0.15em] text-white/50 block text-center">Why it works</span>
                  <p className="text-sm text-white/80 leading-relaxed mt-1">{whyText}</p>
                </div>
              )}

              {/* Effect — outcome of the layering */}
              {(() => {
                const baseNotes = normalizeNotes(mainNotes ?? [], 4);
                const layerNotes = normalizeNotes(activeModeEntry.notes ?? [], 4);
                const effectSentence = buildEffectText(selectedMood, mainName, activeModeEntry.name, baseNotes, layerNotes, activeModeEntry.interactionType, selectedRatio as RatioOption);
                return (
                  <div>
                    <span className="text-[9px] uppercase tracking-[0.15em] text-white/50 block text-center">Effect</span>
                    <p className="text-sm text-white/80 leading-relaxed mt-1">{effectSentence}</p>
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LayerCard;
