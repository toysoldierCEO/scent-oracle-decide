import { motion, AnimatePresence } from "framer-motion";
import ModeSelector, { type LayerMood, type LayerModes, LAYER_MOODS } from "./ModeSelector";
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
function getDisplayName(name: string, brand?: string | null): string {
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

/* ── Mode-specific config ── */
interface MoodConfig {
  baseSprays: number;
  layerSprays: number;
  basePlacement: string;
  layerPlacement: string;
  placement: string;
  result: string;
}

function buildMoodConfig(
  mood: LayerMood,
  mainName: string,
  mainBrand: string | null,
  layerName: string,
  layerBrand: string | null,
): MoodConfig {
  const mn = getDisplayName(mainName, mainBrand);
  const ln = getDisplayName(layerName, layerBrand);
  const configs: Record<LayerMood, MoodConfig> = {
    balance: {
      baseSprays: 3, layerSprays: 1,
      basePlacement: 'chest, neck', layerPlacement: 'wrists',
      placement: 'Base on pulse points, layer on outer edges for natural diffusion.',
      result: `A balanced blend where ${mn} leads and ${ln} accents.`,
    },
    bold: {
      baseSprays: 2, layerSprays: 2,
      basePlacement: 'chest, wrists', layerPlacement: 'neck, behind ears',
      placement: 'Even distribution across hot zones for maximum sillage.',
      result: `A powerful statement — ${mn} and ${ln} command the room.`,
    },
    smooth: {
      baseSprays: 2, layerSprays: 1,
      basePlacement: 'chest, neck', layerPlacement: 'wrists, inner elbows',
      placement: 'Close-contact zones for intimate projection.',
      result: `A smooth, approachable blend — ${ln} creams out the edges.`,
    },
    wild: {
      baseSprays: 2, layerSprays: 2,
      basePlacement: 'chest, neck', layerPlacement: 'wrists, collar',
      placement: 'Separate zones to let each scent breathe independently.',
      result: `An unpredictable blend — ${mn} clashes with ${ln} for magnetism.`,
    },
  };
  return configs[mood];
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

/** Effect vocabulary per mood */
const MOOD_EFFECTS: Record<LayerMood, string[]> = {
  balance: ['creating a balanced blend with natural depth', 'creating an even interplay that stays composed'],
  bold: ['creating projection that fills the room', 'creating a commanding presence with layered intensity'],
  smooth: ['creating a seamless, skin-close finish', 'creating an effortless blend that feels second-skin'],
  wild: ['creating unpredictable contrast that intrigues', 'creating tension that shifts throughout the day'],
};

/** Build a structured "why it works" sentence */
function buildWhyItWorks(
  mood: LayerMood,
  baseName: string,
  layerName: string,
  baseNotes: string[],
  layerNotes: string[],
): string {
  const baseRole = detectRole(baseNotes);
  const layerRole = detectRole(layerNotes);

  // Ensure distinct descriptors — if same role, grab secondary
  let bLabel = baseRole?.label ?? 'character';
  let lLabel = layerRole?.label ?? 'a complementary dimension';

  if (baseRole && layerRole && baseRole.role === layerRole.role) {
    const altLayer = detectSecondaryRole(layerNotes, baseRole.role);
    lLabel = altLayer?.label ?? 'a contrasting edge';
  }

  // Pick effect phrase (alternate based on name length for variety)
  const effects = MOOD_EFFECTS[mood];
  const effectIdx = (baseName.length + layerName.length) % effects.length;
  const effect = effects[effectIdx];

  return `${baseName} provides ${bLabel}, while ${layerName} adds ${lLabel} — ${effect}.`;
}

/* ── Props ── */
interface LayerCardProps {
  /** The main fragrance — used for "why it works" text, NOT for color */
  mainName: string;
  mainBrand: string | null;
  /** Main fragrance notes from DB */
  mainNotes: string[] | null;
  /** All layer mode entries */
  layerModes: LayerModes;
  /** Currently selected mood */
  selectedMood: LayerMood;
  /** Callback when user selects a mood */
  onSelectMood: (mood: LayerMood) => void;
  /** Whether detail sheet is expanded */
  isExpanded: boolean;
  /** Toggle expanded state */
  onToggleExpand: () => void;
}

/**
 * LayerCard — a self-contained component for the layering suggestion.
 *
 * COLOR OWNERSHIP:
 *   - LayerCard color = FAMILY_COLORS[selectedLayer.family_key]
 *   - LayerCard NEVER controls or reads the main scent card color
 *
 * DATA OWNERSHIP:
 *   - layer fragrance name
 *   - layer family token
 *   - mode-specific explanation, spray order, placement, result
 */
const LayerCard = ({
  mainName,
  mainBrand,
  mainNotes,
  layerModes,
  selectedMood,
  onSelectMood,
  isExpanded,
  onToggleExpand,
}: LayerCardProps) => {
  const activeModeEntry = layerModes[selectedMood];
  if (!activeModeEntry) return null;

  // COLOR: derived solely from the selected layer fragrance's family_key
  const layerColor = FAMILY_COLORS[activeModeEntry.family_key] ?? '#888';
  const layerTint = FAMILY_TINTS[activeModeEntry.family_key] ?? DEFAULT_TINT;

  // Notes — from real DB data
  const baseNotesRaw = getCuratedNotes(mainNotes);
  const baseNoteSet = new Set(baseNotesRaw.map(n => n.toLowerCase()));
  const layerNoteSource = activeModeEntry.notes ?? activeModeEntry.accords ?? null;
  const layerNotesRaw = getCuratedNotes(layerNoteSource, baseNoteSet);
  const hasNotes = baseNotesRaw.length > 0 || layerNotesRaw.length > 0;

  const mn = getDisplayName(mainName, mainBrand);

  const cfg = buildMoodConfig(selectedMood, mainName, mainBrand, activeModeEntry.name, activeModeEntry.brand);

  // Why it works — structured interaction logic
  const whyText = buildWhyItWorks(selectedMood, mn, getDisplayName(activeModeEntry.name, activeModeEntry.brand), baseNotesRaw, layerNotesRaw);

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
      <p className="text-[13px] tracking-wide text-white">
        Layer: <span className="font-medium">{getDisplayName(activeModeEntry.name, activeModeEntry.brand)}</span>
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
              <p className="text-[11px] text-white/80 text-center">
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
            <div className="pt-3 mt-2 space-y-3 text-left" style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>

              {/* Spray order */}
              <div>
                <span className="text-[9px] uppercase tracking-[0.15em] text-white/50">Spray order</span>
                <div className="mt-1 space-y-1">
                  <div className="flex items-start gap-2">
                    <span className="text-[9px] font-mono text-white/40 mt-px">01</span>
                    <p className="text-[11px] text-white/80">
                      <span className="font-mono">{cfg.baseSprays}×</span> {mn} — {cfg.basePlacement}
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[9px] font-mono text-white/40 mt-px">02</span>
                    <p className="text-[11px] text-white/80">
                      <span className="font-mono">{cfg.layerSprays}×</span> {getDisplayName(activeModeEntry.name, activeModeEntry.brand)} — {cfg.layerPlacement}
                    </p>
                  </div>
                </div>
              </div>

              {/* Placement */}
              <div>
                <span className="text-[9px] uppercase tracking-[0.15em] text-white/50">Placement</span>
                <p className="text-[11px] text-white/80 mt-0.5">{cfg.placement}</p>
              </div>

              {/* Why it works */}
              {whyText && (
                <div>
                  <span className="text-[9px] uppercase tracking-[0.15em] text-white/50">Why it works</span>
                  <p className="text-[11px] text-white/80 mt-0.5 leading-relaxed">{whyText}</p>
                </div>
              )}

              {/* Result */}
              <div>
                <span className="text-[9px] uppercase tracking-[0.15em] text-white/50">Result</span>
                <p className="text-[11px] text-white/80 mt-0.5">{cfg.result}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default LayerCard;
