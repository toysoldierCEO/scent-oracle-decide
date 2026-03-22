import { motion, AnimatePresence } from "framer-motion";
import ModeSelector, { type LayerMood, type LayerModes, LAYER_MOODS } from "./ModeSelector";

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
  "fresh-blue":      { bg: "rgba(91,155,213,0.08)",  glow: "rgba(91,155,213,0.18)",  border: "rgba(91,155,213,0.14)", material: "rgba(70,130,190,0.06)" },
  "sweet-gourmand":  { bg: "rgba(212,160,86,0.08)",  glow: "rgba(212,160,86,0.18)",  border: "rgba(212,160,86,0.14)", material: "rgba(180,130,60,0.07)" },
  "oud-amber":       { bg: "rgba(192,138,62,0.10)",  glow: "rgba(192,138,62,0.22)",  border: "rgba(192,138,62,0.16)", material: "rgba(160,110,40,0.08)" },
  "dark-leather":    { bg: "rgba(139,58,58,0.08)",   glow: "rgba(139,58,58,0.18)",   border: "rgba(139,58,58,0.14)", material: "rgba(120,40,50,0.07)" },
  "woody-clean":     { bg: "rgba(107,155,122,0.08)", glow: "rgba(107,155,122,0.18)", border: "rgba(107,155,122,0.14)", material: "rgba(85,130,100,0.06)" },
  "tobacco-boozy":   { bg: "rgba(107,66,38,0.10)",   glow: "rgba(107,66,38,0.22)",   border: "rgba(107,66,38,0.16)", material: "rgba(90,50,30,0.08)" },
  "citrus-cologne":  { bg: "rgba(232,212,77,0.07)",  glow: "rgba(232,212,77,0.15)",  border: "rgba(232,212,77,0.12)", material: "rgba(200,180,60,0.05)" },
  "citrus-aromatic": { bg: "rgba(184,201,78,0.07)",  glow: "rgba(184,201,78,0.15)",  border: "rgba(184,201,78,0.12)", material: "rgba(150,170,60,0.05)" },
  "floral-musk":     { bg: "rgba(196,160,185,0.07)", glow: "rgba(196,160,185,0.15)", border: "rgba(196,160,185,0.12)", material: "rgba(170,130,160,0.05)" },
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

const FRAGRANCE_PROFILES: Record<string, { top_notes?: string[]; heart_notes?: string[]; base_notes?: string[] }> = {
  "Valley of the Kings": { top_notes: ["Saffron", "Pink Pepper", "Bergamot"], heart_notes: ["Rose Absolute", "Oud"], base_notes: ["Amber", "Sandalwood", "Musk"] },
  "Agar": { top_notes: ["Elemi", "Green Cardamom"], heart_notes: ["Agarwood", "Cedar Atlas"], base_notes: ["Vetiver", "White Musk"] },
  "Noire Absolu": { top_notes: ["Black Pepper", "Juniper"], heart_notes: ["Leather", "Iris"], base_notes: ["Castoreum", "Patchouli", "Benzoin"] },
  "Santal Sérénade": { top_notes: ["Coconut Milk", "Cardamom"], heart_notes: ["Sandalwood", "Tonka Bean"], base_notes: ["Vanilla", "Cashmeran"] },
  "Hafez 1984": { top_notes: ["Cinnamon", "Dried Plum"], heart_notes: ["Tobacco Leaf", "Dark Rum"], base_notes: ["Labdanum", "Oud", "Smoky Birch"] },
  "Mystere 28": { top_notes: ["Sea Salt", "Grapefruit", "Mint"], heart_notes: ["Lavender", "Geranium"], base_notes: ["Ambroxan", "White Cedar"] },
  "Amber Dusk": { top_notes: ["Mandarin", "Ginger"], heart_notes: ["Amber", "Frankincense"], base_notes: ["Labdanum", "Vanilla", "Musk"] },
};

function getCuratedNotes(name: string, exclude: Set<string> = new Set()): string[] {
  const profile = FRAGRANCE_PROFILES[name];
  if (!profile) return [];
  const pool = [...(profile.top_notes ?? []), ...(profile.heart_notes ?? []), ...(profile.base_notes ?? [])];
  const distinctive = pool.filter(n => !GENERIC_NOTES.has(n.toLowerCase()) && !exclude.has(n.toLowerCase()));
  const fallback = pool.filter(n => !exclude.has(n.toLowerCase()));
  const source = distinctive.length >= 2 ? distinctive : fallback;
  return source.slice(0, 3);
}

/* ── Mode-specific config ── */
interface MoodConfig {
  effect: string;
  baseSprays: number;
  layerSprays: number;
  basePlacement: string;
  layerPlacement: string;
  placement: string;
  result: string;
  whyVerb: string;
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
      effect: `Harmonizes with ${mn} for a rounded blend.`,
      baseSprays: 3, layerSprays: 1,
      basePlacement: 'chest, neck', layerPlacement: 'wrists',
      placement: 'Base on pulse points, layer on outer edges for natural diffusion.',
      result: `A balanced blend where ${mn} leads and ${ln} accents.`,
      whyVerb: 'stay grounded',
    },
    bold: {
      effect: `Boosts projection and presence alongside ${mn}.`,
      baseSprays: 2, layerSprays: 2,
      basePlacement: 'chest, wrists', layerPlacement: 'neck, behind ears',
      placement: 'Even distribution across hot zones for maximum sillage.',
      result: `A powerful statement — ${mn} and ${ln} command the room.`,
      whyVerb: 'anchor the intensity',
    },
    smooth: {
      effect: `Softens the edges of ${mn} into a creamy finish.`,
      baseSprays: 2, layerSprays: 1,
      basePlacement: 'chest, neck', layerPlacement: 'wrists, inner elbows',
      placement: 'Close-contact zones for intimate projection.',
      result: `A smooth, approachable blend — ${ln} creams out the edges.`,
      whyVerb: 'provide structure',
    },
    wild: {
      effect: `Adds unexpected tension against ${mn}.`,
      baseSprays: 2, layerSprays: 2,
      basePlacement: 'chest, neck', layerPlacement: 'wrists, collar',
      placement: 'Separate zones to let each scent breathe independently.',
      result: `An unpredictable blend — ${mn} clashes with ${ln} for magnetism.`,
      whyVerb: 'create the foundation',
    },
  };
  return configs[mood];
}

/* ── Props ── */
interface LayerCardProps {
  /** The main fragrance — used for "why it works" text, NOT for color */
  mainName: string;
  mainBrand: string | null;
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

  // Notes
  const baseNotesRaw = getCuratedNotes(mainName);
  const baseNoteSet = new Set(baseNotesRaw.map(n => n.toLowerCase()));
  const layerNotesRaw = getCuratedNotes(activeModeEntry.name, baseNoteSet);
  const hasNotes = baseNotesRaw.length > 0 || layerNotesRaw.length > 0;

  const cfg = buildMoodConfig(selectedMood, mainName, mainBrand, activeModeEntry.name, activeModeEntry.brand);

  // Why it works text
  let whyText = '';
  if (baseNotesRaw.length > 0 || layerNotesRaw.length > 0) {
    const mn = getDisplayName(mainName, mainBrand);
    const ln = getDisplayName(activeModeEntry.name, activeModeEntry.brand);
    const bPart = baseNotesRaw.length > 0
      ? `The ${baseNotesRaw.slice(0, 2).join(" and ")} in ${mn} ${cfg.whyVerb}`
      : mn;
    const lPart = layerNotesRaw.length > 0
      ? ` while ${layerNotesRaw.slice(0, 2).join(" and ")} from ${ln} add${layerNotesRaw.length === 1 ? 's' : ''} depth`
      : '';
    whyText = `${bPart}${lPart}.`;
  }

  const mn = getDisplayName(mainName, mainBrand);

  return (
    <div
      className="flex flex-col items-center mb-[14px] py-[10px] px-5 rounded-xl cursor-pointer select-none relative z-10 w-full"
      onClick={(e) => {
        e.stopPropagation();
        onToggleExpand();
      }}
      style={{
        background: layerTint.bg,
        border: `1px solid ${layerTint.border}`,
        boxShadow: `0 2px 12px ${layerTint.glow}`,
        pointerEvents: 'auto',
      }}
    >
      <p className="text-[13px] tracking-wide text-white">
        Layer: <span className="font-medium">{getDisplayName(activeModeEntry.name, activeModeEntry.brand)}</span>
      </p>
      <span
        className="text-[9px] uppercase tracking-[0.18em] mt-[4px] px-3 py-[2px] rounded-full text-white/70"
        style={{ boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.2)` }}
      >
        {activeModeEntry.family_key?.toUpperCase() ?? ''}
      </span>

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
              {/* Effect */}
              <p className="text-[11px] text-white/80 leading-relaxed">{cfg.effect}</p>

              {/* Key notes */}
              {hasNotes && (
                <div>
                  <span className="text-[9px] uppercase tracking-[0.15em] text-white/50">Key notes</span>
                  <div className="mt-1 space-y-0.5">
                    {baseNotesRaw.length > 0 && (
                      <p className="text-[11px] text-white/80">
                        <span className="text-white/50">{mn}:</span>{" "}
                        {baseNotesRaw.join(", ").toLowerCase()}
                      </p>
                    )}
                    {layerNotesRaw.length > 0 && (
                      <p className="text-[11px] text-white/80">
                        <span className="text-white/50">{getDisplayName(activeModeEntry.name, activeModeEntry.brand)}:</span>{" "}
                        {layerNotesRaw.join(", ").toLowerCase()}
                      </p>
                    )}
                  </div>
                </div>
              )}

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
