import { motion, AnimatePresence, PanInfo, useMotionValue, useTransform } from "framer-motion";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { odaraSupabase as supabase } from "@/lib/odara-client";
import { Skeleton } from "@/components/ui/skeleton";
import LayerCard from "@/components/LayerCard";
import type { LayerMood, LayerModes, LayerModeEntry } from "@/components/ModeSelector";
import { LAYER_MOODS } from "@/components/ModeSelector";
import { normalizeNotes } from "@/lib/normalizeNotes";

/* ── Live fetch replaces old test query ── */

/** Display-only: strip trailing filler like "for Men", "for Women", "Eau de Parfum" etc.,
 *  and remove the brand name when it appears as a suffix in the fragrance name. */
function getDisplayName(name: string | null | undefined, brand?: string | null): string {
  if (!name) return 'Unknown';
  let display = name
    .replace(/\s+(for\s+(Men|Women|Him|Her|Unisex)|Eau\s+de\s+(Parfum|Toilette|Cologne)|EDP|EDT)\s*$/i, '')
    .trim();
  // Strip brand name from end (e.g. "Paradigme Prada" → "Paradigme")
  if (brand) {
    const brandRegex = new RegExp(`\\s+${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    display = display.replace(brandRegex, '').trim();
  }
  return display;
}

import { Lock, LockOpen, X, Undo2 } from "lucide-react";

/* ── Weather helper (Open-Meteo, no key) ── */
async function fetchLiveTemperature(): Promise<number> {
  const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 })
  );
  const { latitude, longitude } = pos.coords;
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=fahrenheit`
  );
  if (!res.ok) throw new Error("Weather fetch failed");
  const json = await res.json();
  return Math.round(json.current_weather.temperature as number);
}

interface LayerOption {
  base_id?: string;
  anchor_name?: string;
  top_id?: string;
  top_name?: string;
  top: string;
  mode: string;
  anchor_sprays?: number;
  top_sprays?: number;
  anchor_placement?: string;
  top_placement?: string;
  mixing_rule?: string;
  why_it_works?: string;
  strength_note?: string;
  dominance_level?: 'low' | 'medium' | 'high';
  reason: string;
}
interface OracleData {
  today_pick: {
    fragrance_id?: string;
    name: string;
    family: string;
    reason: string;
    brand?: string;
  };
  layer?: { fragrance_id: string; name: string; family: string; reason: string } | null;
  alternates?: {
    fragrance_id?: string;
    name: string;
    family?: string;
    reason?: string;
  }[] | null;
}


type ActionState = "idle" | "accepting" | "skipping" | "rebuilding";


const CONTEXTS = ["daily", "work", "hangout", "date"] as const;
const TEMPERATURES = [35, 50, 65, 80] as const;

/* ── Fragrance family → color mapping (expanded with tint HSL values) ── */
const FAMILY_COLORS: Record<string, string> = {
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

/* Family → tint colors for card backgrounds (subtle, desaturated) */
const FAMILY_TINTS: Record<string, { bg: string; glow: string; border: string; material: string }> = {
  "fresh-blue":      { bg: "rgba(91,155,213,0.08)",  glow: "rgba(91,155,213,0.18)",  border: "rgba(91,155,213,0.14)", material: "rgba(70,130,190,0.06)" },
  "sweet-gourmand":  { bg: "rgba(212,160,86,0.08)",  glow: "rgba(212,160,86,0.18)",  border: "rgba(212,160,86,0.14)", material: "rgba(180,130,60,0.07)" },
  "oud-amber":       { bg: "rgba(192,138,62,0.10)",  glow: "rgba(192,138,62,0.22)",  border: "rgba(192,138,62,0.16)", material: "rgba(160,110,40,0.08)" },
  "dark-leather":    { bg: "rgba(139,58,58,0.08)",   glow: "rgba(139,58,58,0.18)",   border: "rgba(139,58,58,0.14)", material: "rgba(120,40,50,0.07)" },
  "woody-clean":     { bg: "rgba(107,155,122,0.08)", glow: "rgba(107,155,122,0.18)", border: "rgba(107,155,122,0.14)", material: "rgba(85,130,100,0.06)" },
  "tobacco-boozy":   { bg: "rgba(107,66,38,0.10)",   glow: "rgba(107,66,38,0.22)",   border: "rgba(107,66,38,0.16)", material: "rgba(90,50,30,0.08)" },
  "citrus-cologne":  { bg: "rgba(232,212,77,0.07)",  glow: "rgba(232,212,77,0.15)",  border: "rgba(232,212,77,0.12)", material: "rgba(200,180,60,0.05)" },
  "citrus-aromatic": { bg: "rgba(184,201,78,0.07)",  glow: "rgba(184,201,78,0.15)",  border: "rgba(184,201,78,0.12)", material: "rgba(150,170,60,0.05)" },
  "floral-musk":     { bg: "rgba(196,160,185,0.07)", glow: "rgba(196,160,185,0.15)", border: "rgba(196,160,185,0.12)", material: "rgba(170,130,160,0.05)" },
  "fresh-citrus":    { bg: "rgba(232,212,77,0.07)",  glow: "rgba(232,212,77,0.15)",  border: "rgba(232,212,77,0.12)", material: "rgba(200,180,60,0.05)" },
  "spicy-warm":      { bg: "rgba(212,113,59,0.08)",  glow: "rgba(212,113,59,0.18)",  border: "rgba(212,113,59,0.14)", material: "rgba(180,90,40,0.07)" },
  "fresh-aquatic":   { bg: "rgba(91,192,222,0.08)",  glow: "rgba(91,192,222,0.18)",  border: "rgba(91,192,222,0.14)", material: "rgba(70,160,190,0.06)" },
  "earthy-patchouli":{ bg: "rgba(139,115,85,0.08)",  glow: "rgba(139,115,85,0.18)",  border: "rgba(139,115,85,0.14)", material: "rgba(115,90,65,0.07)" },
  "aromatic-fougere":{ bg: "rgba(107,142,107,0.08)", glow: "rgba(107,142,107,0.18)", border: "rgba(107,142,107,0.14)", material: "rgba(85,120,85,0.06)" },
  "floral-rich":     { bg: "rgba(212,131,158,0.07)", glow: "rgba(212,131,158,0.15)", border: "rgba(212,131,158,0.12)", material: "rgba(180,110,135,0.05)" },
  "green-earthy":    { bg: "rgba(107,142,90,0.07)",  glow: "rgba(107,142,90,0.15)",  border: "rgba(107,142,90,0.12)", material: "rgba(85,120,70,0.05)" },
};

const DEFAULT_TINT = { bg: "rgba(255,255,255,0.03)", glow: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.08)", material: "rgba(255,255,255,0.02)" };

const FAMILY_LABELS: Record<string, string> = {
  "oud-amber": "Oud & Amber",
  "fresh-blue": "Fresh & Aquatic",
  "woody-clean": "Woody & Clean",
  "sweet-gourmand": "Sweet & Gourmand",
  "dark-leather": "Dark Leather",
  "tobacco-boozy": "Tobacco & Boozy",
  "floral-musk": "Floral & Musk",
  "citrus-aromatic": "Citrus & Aromatic",
  "citrus-cologne": "Citrus Cologne",
  "fresh-citrus": "Fresh Citrus",
  "spicy-warm": "Spicy & Warm",
  "fresh-aquatic": "Fresh & Aquatic",
  "earthy-patchouli": "Earthy Patchouli",
  "aromatic-fougere": "Aromatic Fougère",
  "floral-rich": "Rich Floral",
  "green-earthy": "Green & Earthy",
};

interface FragranceProfile {
  brand?: string;
  top_notes?: string[];
  heart_notes?: string[];
  base_notes?: string[];
  wardrobe_role?: string;
  longevity_score?: number;
  projection_score?: number;
  weather?: string;
  secondary_weather?: string;
  bottle_url?: string;
}

function performanceLabel(score: number): string {
  if (score <= 0.33) return "Soft";
  if (score <= 0.66) return "Moderate";
  return "Strong";
}

/** Generic notes to filter out when selecting distinctive notes */
const GENERIC_NOTES = new Set(["fresh", "clean", "warm", "soft", "light", "smooth", "musk", "white musk"]);

/**
 * Get max 3 distinctive notes for a fragrance, preferring non-generic ones.
 * Falls back to accords string split if notes unavailable.
 */
function getCuratedNotes(
  name: string,
  dbNotes: string | null | undefined,
  dbAccords: string | null | undefined,
  exclude: Set<string> = new Set(),
): string[] {
  // 1. Try DB notes (comma-separated string)
  let pool: string[] = [];
  if (dbNotes) {
    pool = dbNotes.split(",").map(n => n.trim()).filter(Boolean);
  }
  // 2. Fallback: DB accords
  if (pool.length === 0 && dbAccords) {
    pool = dbAccords.split(",").map(n => n.trim()).filter(Boolean);
  }
  // 3. Fallback: local FRAGRANCE_PROFILES
  if (pool.length === 0) {
    const profile = FRAGRANCE_PROFILES[name];
    if (profile) {
      const all = [
        ...(profile.top_notes ?? []),
        ...(profile.heart_notes ?? []),
        ...(profile.base_notes ?? []),
      ];
      pool = all;
    }
  }
  if (pool.length === 0) return [];

  // Filter: remove generic, remove duplicates with other fragrance
  const distinctive = pool.filter(n => !GENERIC_NOTES.has(n.toLowerCase()) && !exclude.has(n.toLowerCase()));
  const fallback = pool.filter(n => !exclude.has(n.toLowerCase()));
  const source = distinctive.length >= 2 ? distinctive : fallback;
  return source.slice(0, 3);
}

/** Build a "why it works" explanation referencing actual notes */
function buildWhyItWorks(baseName: string, baseNotes: string[], layerName: string, layerNotes: string[]): string {
  if (baseNotes.length === 0 && layerNotes.length === 0) return "";
  const bPart = baseNotes.length > 0 ? `The ${baseNotes.slice(0, 2).join(" and ")} in ${getDisplayName(baseName)}` : getDisplayName(baseName);
  const lPart = layerNotes.length > 0 ? `while ${layerNotes.slice(0, 2).join(" and ")} from ${getDisplayName(layerName)} add${layerNotes.length === 1 ? "s" : ""} depth` : "";
  if (lPart) return `${bPart} stay grounded ${lPart}.`;
  return `${bPart} anchors the blend with character.`;
}

/* Brand mapping */
const FRAGRANCE_BRANDS: Record<string, string> = {
  "Valley of the Kings": "Alexandria Fragrances",
  "Agar": "Maison Alhambra",
  "Noire Absolu": "Maison Alhambra",
  "Santal Sérénade": "Maison Alhambra",
  "Hafez 1984": "Alexandria Fragrances",
  "Mystere 28": "Alexandria Fragrances",
  "Amber Dusk": "Alexandria Fragrances",
  "Cuir Sauvage": "Maison Alhambra",
  "Oasis Elixir": "Alexandria Fragrances",
};

/* Wear context tags per fragrance */
const FRAGRANCE_WEAR_TAGS: Record<string, string[]> = {
  "Valley of the Kings": ["Date night", "Cold evenings", "Statement wear"],
  "Agar": ["Daily driver", "Office safe", "Versatile"],
  "Noire Absolu": ["Night out", "Power move", "Cold weather"],
  "Santal Sérénade": ["Close encounters", "Cozy nights", "Indoor"],
  "Hafez 1984": ["Evening signature", "Cool weather", "Night out"],
  "Mystere 28": ["Daytime", "Casual", "Warm weather"],
  "Amber Dusk": ["Day-to-night", "Transitional", "All-season"],
  "Cuir Sauvage": ["Bold evening", "Statement", "Cool-cold weather"],
  "Oasis Elixir": ["Warm weather", "Outdoor", "Weekend"],
};

const FRAGRANCE_PROFILES: Record<string, FragranceProfile> = {
  "Valley of the Kings": {
    brand: "Alexandria Fragrances",
    top_notes: ["Saffron", "Pink Pepper", "Bergamot"],
    heart_notes: ["Rose Absolute", "Oud"],
    base_notes: ["Amber", "Sandalwood", "Musk"],
    wardrobe_role: "Date night · Cold evenings · Statement wear",
    longevity_score: 0.9,
    projection_score: 0.85,
    weather: "Best in cool → cold weather",
    secondary_weather: "Also great in crisp autumn evenings",
    bottle_url: "https://fimgs.net/mdimg/perfume/375x500.77498.jpg",
  },
  "Agar": {
    brand: "Maison Alhambra",
    top_notes: ["Elemi", "Green Cardamom"],
    heart_notes: ["Agarwood", "Cedar Atlas"],
    base_notes: ["Vetiver", "White Musk"],
    wardrobe_role: "Daily driver · Office safe · Versatile",
    longevity_score: 0.6,
    projection_score: 0.45,
    weather: "Best in mild → warm weather",
    secondary_weather: "Also great in early spring",
    bottle_url: "https://fimgs.net/mdimg/perfume/375x500.65498.jpg",
  },
  "Noire Absolu": {
    brand: "Maison Alhambra",
    top_notes: ["Black Pepper", "Juniper"],
    heart_notes: ["Leather", "Iris"],
    base_notes: ["Castoreum", "Patchouli", "Benzoin"],
    wardrobe_role: "Night out · Power move · Cold weather",
    longevity_score: 0.95,
    projection_score: 0.9,
    weather: "Best in cold weather",
    secondary_weather: "Also great in late autumn",
    bottle_url: "https://fimgs.net/mdimg/perfume/375x500.65499.jpg",
  },
  "Santal Sérénade": {
    brand: "Maison Alhambra",
    top_notes: ["Coconut Milk", "Cardamom"],
    heart_notes: ["Sandalwood", "Tonka Bean"],
    base_notes: ["Vanilla", "Cashmeran"],
    wardrobe_role: "Close encounters · Cozy nights · Indoor",
    longevity_score: 0.7,
    projection_score: 0.3,
    weather: "Best in cool → mild weather",
    secondary_weather: "Also great in dry winter days",
    bottle_url: "https://fimgs.net/mdimg/perfume/375x500.65500.jpg",
  },
  "Hafez 1984": {
    brand: "Alexandria Fragrances",
    top_notes: ["Cinnamon", "Dried Plum"],
    heart_notes: ["Tobacco Leaf", "Dark Rum"],
    base_notes: ["Labdanum", "Oud", "Smoky Birch"],
    wardrobe_role: "Evening signature · Cool weather · Night out",
    longevity_score: 0.85,
    projection_score: 0.8,
    weather: "Best in cold → cool weather",
    secondary_weather: "Also great in rainy evenings",
    bottle_url: "https://fimgs.net/mdimg/perfume/375x500.77499.jpg",
  },
  "Mystere 28": {
    brand: "Alexandria Fragrances",
    top_notes: ["Sea Salt", "Grapefruit", "Mint"],
    heart_notes: ["Lavender", "Geranium"],
    base_notes: ["Ambroxan", "White Cedar"],
    wardrobe_role: "Daytime · Casual · Warm weather",
    longevity_score: 0.45,
    projection_score: 0.5,
    weather: "Best in warm → hot weather",
    secondary_weather: "Also great in humid spring days",
    bottle_url: "https://fimgs.net/mdimg/perfume/375x500.77500.jpg",
  },
  "Amber Dusk": {
    brand: "Alexandria Fragrances",
    top_notes: ["Mandarin", "Ginger"],
    heart_notes: ["Amber", "Frankincense"],
    base_notes: ["Labdanum", "Vanilla", "Musk"],
    wardrobe_role: "Day-to-night · Transitional · All-season",
    longevity_score: 0.65,
    projection_score: 0.5,
    weather: "Best in cool → mild weather",
    secondary_weather: "Also great in early spring evenings",
    bottle_url: "https://fimgs.net/mdimg/perfume/375x500.65501.jpg",
  },
};

const LONG_PRESS_DURATION = 450;

/* ── Layer compatibility engine ── */
interface FragranceEntry {
  fragrance_id: string;
  name: string;
  family: string;
  reason: string;
  longevity_score: number;
  projection_score: number;
}

const LAYER_COMPATIBILITY: Record<string, { family: string; score: number }[]> = {
  "oud-amber": [
    { family: "sweet-gourmand", score: 0.88 },
    { family: "woody-clean", score: 0.82 },
    { family: "tobacco-boozy", score: 0.75 },
  ],
  "fresh-blue": [
    { family: "woody-clean", score: 0.90 },
    { family: "citrus-aromatic", score: 0.85 },
  ],
  "woody-clean": [
    { family: "fresh-blue", score: 0.88 },
    { family: "oud-amber", score: 0.80 },
    { family: "floral-musk", score: 0.78 },
  ],
  "sweet-gourmand": [
    { family: "oud-amber", score: 0.85 },
    { family: "tobacco-boozy", score: 0.82 },
    { family: "woody-clean", score: 0.72 },
  ],
  "dark-leather": [
    { family: "tobacco-boozy", score: 0.88 },
    { family: "oud-amber", score: 0.80 },
    { family: "woody-clean", score: 0.75 },
  ],
  "tobacco-boozy": [
    { family: "sweet-gourmand", score: 0.86 },
    { family: "dark-leather", score: 0.84 },
    { family: "oud-amber", score: 0.78 },
  ],
  "floral-musk": [
    { family: "woody-clean", score: 0.85 },
    { family: "fresh-blue", score: 0.80 },
  ],
  "citrus-aromatic": [
    { family: "fresh-blue", score: 0.88 },
    { family: "woody-clean", score: 0.82 },
  ],
};

interface DailySet {
  base: FragranceEntry;
  layer: FragranceEntry | null;
  mode: string | null;
  confidence: number;
  reasoning: string;
  is_layered: boolean;
}

function computeDominanceSafety(base: FragranceEntry, layer: FragranceEntry): number {
  const projDelta = layer.projection_score - base.projection_score;
  if (projDelta > 0.3) return 0.2;
  if (projDelta > 0.15) return 0.5;
  if (projDelta > 0) return 0.75;
  return 1.0;
}

function recommendDailySet(
  base: FragranceEntry,
  candidates: FragranceEntry[],
  dayIndex: number,
): DailySet {
  const baseFamily = base.family;
  const compatEntries = LAYER_COMPATIBILITY[baseFamily] ?? [];

  let bestLayer: FragranceEntry | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    if (candidate.fragrance_id === base.fragrance_id) continue;
    const compatMatch = compatEntries.find(c => c.family === candidate.family);
    if (!compatMatch) continue;
    const compatibility = compatMatch.score;
    const dominanceSafety = computeDominanceSafety(base, candidate);
    const rotationValue = 1 - (dayIndex % 3) * 0.1;
    const score = 0.45 * 0.85 + 0.20 * compatibility + 0.15 * dominanceSafety + 0.10 * 0.8 + 0.10 * rotationValue;
    if (score > bestScore && dominanceSafety > 0.4 && compatibility > 0.7) {
      bestScore = score;
      bestLayer = candidate;
    }
  }

  if (bestLayer && bestScore > 0.65) {
    return {
      base, layer: bestLayer, mode: "balance",
      confidence: Math.round(bestScore * 100) / 100,
      reasoning: `${bestLayer.name} complements ${base.name} — compatible families with safe projection ratio.`,
      is_layered: true,
    };
  }

  return {
    base, layer: null, mode: null,
    confidence: Math.round((0.45 * 0.85 + 0.10 * 0.8 + 0.10 * 0.9) * 100) / 100,
    reasoning: `${base.name} wears best solo today — no layer improves the set.`,
    is_layered: false,
  };
}

interface ForecastDay {
  label: string;
  day: number;
  dateKey: string;
  fragrance: {
    fragrance_id: string;
    name: string;
    family: string;
    reason: string;
  } | null;
  temperature: number;
  layer: Record<LayerMood, LayerOption> | null;
  alternates: { fragrance_id?: string; name: string; family?: string; reason?: string }[] | null;
  dailySet: DailySet | null;
}

/** Build empty forecast day shells — actual data filled via RPC */
function buildForecastDays(): ForecastDay[] {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      label: dayNames[d.getDay()], day: d.getDate(), dateKey,
      fragrance: null, temperature: 0, layer: null, alternates: null, dailySet: null,
    };
  });
}

/* ── Density classification for interaction types ── */
const DENSE_FAMILIES = new Set(['oud-amber', 'dark-leather', 'tobacco-boozy', 'sweet-gourmand']);
const AIRY_FAMILIES = new Set(['fresh-blue', 'citrus-cologne', 'fresh-citrus', 'fresh-aquatic', 'citrus-aromatic']);

type InteractionType = 'amplify' | 'balance' | 'contrast';

function classifyInteraction(mainFamily: string, layerFamily: string): InteractionType {
  if (mainFamily === layerFamily) return 'amplify';
  const mainDense = DENSE_FAMILIES.has(mainFamily);
  const mainAiry = AIRY_FAMILIES.has(mainFamily);
  const layerDense = DENSE_FAMILIES.has(layerFamily);
  const layerAiry = AIRY_FAMILIES.has(layerFamily);
  const mainNeutral = !mainDense && !mainAiry;
  const layerNeutral = !layerDense && !layerAiry;

  // Opposite density → contrast
  if ((mainDense && layerAiry) || (mainAiry && layerDense)) return 'contrast';
  // Same density group but different family → amplify
  if ((mainDense && layerDense) || (mainAiry && layerAiry)) return 'amplify';
  // Neutral + extreme → contrast (pulling in a new direction)
  if (mainNeutral && (layerDense || layerAiry)) return 'contrast';
  if (layerNeutral && (mainDense || mainAiry)) return 'balance';
  // Both neutral but different families → balance
  return 'balance';
}

function scoreLayerCandidate(
  mainFamily: string,
  candidate: any,
): { score: number; interaction: InteractionType } {
  const layerFamily = candidate.family_key as string;
  const interaction = classifyInteraction(mainFamily, layerFamily);

  let score = 0.5; // baseline

  // Interaction type boosts
  if (interaction === 'balance') score += 0.25; // fills a gap — best
  if (interaction === 'contrast') score += 0.15; // adds tension — good
  if (interaction === 'amplify') score += 0.05; // same direction — only if meaningful

  // Penalty: same family as main (redundant, no transformation)
  if (layerFamily === mainFamily) score -= 0.30;

  // Penalty: both dense (muddy/cloying risk)
  if (DENSE_FAMILIES.has(mainFamily) && DENSE_FAMILIES.has(layerFamily) && mainFamily !== layerFamily) {
    score -= 0.10;
  }

  // Boost: layer adds missing dimension (different density)
  const mainDense = DENSE_FAMILIES.has(mainFamily);
  const mainAiry = AIRY_FAMILIES.has(mainFamily);
  const layerDense = DENSE_FAMILIES.has(layerFamily);
  const layerAiry = AIRY_FAMILIES.has(layerFamily);
  if ((mainDense && layerAiry) || (mainAiry && layerDense)) {
    score += 0.10; // structural improvement
  }

  // Boost: neutral layer on extreme base (grounding/lifting)
  if ((mainDense || mainAiry) && !layerDense && !layerAiry) {
    score += 0.08;
  }

  return { score: Math.max(0, Math.min(1, score)), interaction };
}

/* ── Interaction-aware text generators ── */
const INTERACTION_REASON: Record<InteractionType, (layerFamily: string) => string> = {
  amplify: (lf) => `Reinforces ${lf.replace(/-/g, ' ')} character`,
  balance: (lf) => `Adds ${lf.replace(/-/g, ' ')} dimension`,
  contrast: (lf) => `Contrasts with ${lf.replace(/-/g, ' ')} energy`,
};

const INTERACTION_WHY: Record<InteractionType, (mainFam: string, layerFam: string) => string> = {
  amplify: (mf, lf) => {
    const m = mf.replace(/-/g, ' '), l = lf.replace(/-/g, ' ');
    return `Both lean ${m} — the layer doubles down so the whole thing reads stronger without getting muddy.`;
  },
  balance: (mf, lf) => {
    const m = mf.replace(/-/g, ' '), l = lf.replace(/-/g, ' ');
    return `The ${m} base holds shape while ${l} fills what's missing — neither drops out.`;
  },
  contrast: (mf, lf) => {
    const m = mf.replace(/-/g, ' '), l = lf.replace(/-/g, ' ');
    return `${m.charAt(0).toUpperCase() + m.slice(1)} and ${l} pull in opposite directions — the tension keeps it interesting.`;
  },
};

/**
 * Pick 4 layer fragrances using interaction-type-aware scoring.
 * Prioritizes family diversity + meaningful transformation.
 */
function pickDiverseLayerModes(candidates: any[], mainFamily: string): LayerModes {
  const moodKeys: LayerMood[] = ['balance', 'bold', 'smooth', 'wild'];
  const result: LayerModes = { balance: null, bold: null, smooth: null, wild: null };

  if (!candidates || candidates.length === 0) return result;

  // Score and classify all candidates
  const scored = candidates
    .filter(c => c.family_key)
    .map(c => ({
      ...c,
      ...scoreLayerCandidate(mainFamily, c),
    }))
    .sort((a, b) => b.score - a.score);

  // Pick top candidates ensuring family diversity
  const picked: (typeof scored[0])[] = [];
  const usedFamilies = new Set<string>();
  const usedIds = new Set<string>();

  // First pass: one per distinct family, sorted by score
  for (const c of scored) {
    if (picked.length >= 4) break;
    if (!usedFamilies.has(c.family_key) && !usedIds.has(c.id)) {
      picked.push(c);
      usedFamilies.add(c.family_key);
      usedIds.add(c.id);
    }
  }

  // Fill remaining slots from best remaining candidates
  if (picked.length < 4) {
    for (const c of scored) {
      if (picked.length >= 4) break;
      if (!usedIds.has(c.id)) {
        picked.push(c);
        usedIds.add(c.id);
      }
    }
  }

  // Assign to moods — try to match interaction type to mood intent
  const moodPreference: Record<LayerMood, InteractionType> = {
    balance: 'balance',
    bold: 'amplify',
    smooth: 'balance',
    wild: 'contrast',
  };

  const assigned = new Set<string>();
  for (const mood of moodKeys) {
    const preferred = moodPreference[mood];
    const match = picked.find(p => p.interaction === preferred && !assigned.has(p.id));
    const fallback = picked.find(p => !assigned.has(p.id));
    const chosen = match ?? fallback;
    if (chosen) {
      assigned.add(chosen.id);
      const iType = chosen.interaction as InteractionType;
      result[mood] = {
        id: chosen.id,
        name: chosen.name,
        brand: chosen.brand ?? null,
        family_key: chosen.family_key,
        notes: chosen.notes ?? null,
        accords: chosen.accords ?? null,
        interactionType: iType,
        reason: INTERACTION_REASON[iType](chosen.family_key),
        why_it_works: INTERACTION_WHY[iType](mainFamily, chosen.family_key),
        projection: chosen.projection ?? null,
      };
    }
  }

  console.log('[ODARA] Layer selections:', moodKeys.map(m => {
    const e = result[m];
    return `${m.toUpperCase()}=${e?.family_key ?? 'none'}(${e?.interactionType ?? '-'})`;
  }).join(', '));

  return result;
}

const OdaraScreen = () => {
  const ODARA_DEBUG_BUILD = 'ODARA_BUILD_2026_04_05_B';
  console.log('[ODARA BUILD]', ODARA_DEBUG_BUILD);
  console.log('[ODARA DEBUG] component render start');

  // Auth state
  const [authUser, setAuthUser] = useState<{ id: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ? { id: session.user.id } : null);
      setAuthLoading(false);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthUser(session?.user ? { id: session.user.id } : null);
      setAuthLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);
  const [oracle, setOracle] = useState<OracleData | null>(null);
  const [mainNotes, setMainNotes] = useState<string[] | null>(null);
  const [mainAccords, setMainAccords] = useState<string[] | null>(null);
  const [layerModes, setLayerModes] = useState<LayerModes>({ balance: null, bold: null, smooth: null, wild: null });
  const [layerFragrance, setLayerFragrance] = useState<{ id: string; name: string; family_key: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const [cardKey, setCardKey] = useState(0);
  const swipeLocked = useRef(false);
  const [selectedContext, setSelectedContext] = useState<string>("daily");
  const [selectedTemperature, setSelectedTemperature] = useState<number>(40);
  const [layerSheetOpen, setLayerSheetOpen] = useState(false);
  const [selectedMood, setSelectedMood] = useState<LayerMood>('balance');
  const [selectedRatio, setSelectedRatio] = useState<string>('1:1');
  const [mainProjection, setMainProjection] = useState<number | null>(null);

  // Locked recipes: full recipe state keyed by context
  interface LockedRecipe {
    context: string;
    lockState: "selected";
    oracle: OracleData;
    mainNotes: string[] | null;
    mainAccords: string[] | null;
    layerModes: LayerModes;
    mainProjection: number | null;
    selectedMood: LayerMood;
    selectedRatio: string;
    layerFragrance: { id: string; name: string; family_key: string } | null;
  }
  // lockedRecipes: dateKey → context → recipe
  const lockedRecipes = useRef<Record<string, Record<string, LockedRecipe>>>({});
  const [recipeVersion, setRecipeVersion] = useState(0);
  const bumpRecipeVersion = useCallback(() => setRecipeVersion(v => v + 1), []);

  // Helper: build dateKey from a Date
  const toDateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [liveTemperature, setLiveTemperature] = useState<number | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [manualTemperatureOverride, setManualTemperatureOverride] = useState<number | null>(null);
  // Persistent lock states are only: neutral / selected
  const [selectionState, setSelectionState] = useState<"neutral" | "selected">("neutral");
  const [isUnlockTransition, setIsUnlockTransition] = useState(false);
  const [lockFlashColor, setLockFlashColor] = useState<string | null>(null);
  const [lockPulse, setLockPulse] = useState(false);
  const [cardExiting, setCardExiting] = useState(false);
  const selectedContextRef = useRef(selectedContext);
  const latestFetchId = useRef(0);
  const unlockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Undo: stack-based skip history for multi-step undo
  interface SkipSnapshot {
    oracle: OracleData;
    mainNotes: string[] | null;
    mainAccords: string[] | null;
    layerModes: LayerModes;
    mainProjection: number | null;
  }
  const [skipHistory, setSkipHistory] = useState<SkipSnapshot[]>([]);
  const [selectedForecastDay, setSelectedForecastDay] = useState(0);
  const [displayedTemperature, setDisplayedTemperature] = useState<number | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    selectedContextRef.current = selectedContext;
  }, [selectedContext]);

  useEffect(() => {
    return () => {
      if (unlockTimeoutRef.current) clearTimeout(unlockTimeoutRef.current);
    };
  }, []);

  // Swipe feedback removed — silent UI

  // Direction locking for gestures
  const dragDirection = useRef<"none" | "horizontal" | "vertical">("none");
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const LOCK_THRESHOLD = 12; // px before direction locks

  const effectiveTemperature = manualTemperatureOverride ?? liveTemperature ?? 40;
  const [forecastDays, setForecastDays] = useState<ForecastDay[]>(() => buildForecastDays());
  // Derived selected date key — used everywhere instead of toDateKey(new Date())
  const selectedDateKey = forecastDays[selectedForecastDay]?.dateKey ?? toDateKey(new Date());

  // Continuous timepiece orb position (0–6 scale, 0 = today start, 1 = tomorrow start)
  const [orbPosition, setOrbPosition] = useState(0);
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const now = new Date();
      const secondsSinceMidnight =
        now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      // Today is always index 0; orb moves from 0 toward 1 over 24h
      const progress = secondsSinceMidnight / 86400;
      setOrbPosition(progress);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Fetch live weather on mount
  useEffect(() => {
    let cancelled = false;
    setWeatherLoading(true);
    fetchLiveTemperature()
      .then((temp) => { if (!cancelled) { setLiveTemperature(temp); setSelectedTemperature(temp); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setWeatherLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const getUserId = useCallback((): string | null => {
    return authUser?.id ?? null;
  }, [authUser]);

  // Hydrate forecast strip from live RPC on mount
  useEffect(() => {
    let cancelled = false;
    const hydrateForecast = async () => {
      const userId = getUserId();
      if (!userId) return;
      console.log('[ODARA DEBUG] before forecast hydration', {
        build: ODARA_DEBUG_BUILD,
        effectiveTemperature,
      });
      try {
        const temp = effectiveTemperature;
        const shells = buildForecastDays();
        console.log('[ODARA DEBUG] forecast shells before hydration', shells);
        const hydrated = await Promise.all(
          shells.map(async (day) => {
            const params = {
              p_user_id: userId,
              p_temperature: temp,
              p_context: 'daily',
              p_brand: 'Alexandria Fragrances',
              p_wear_date: day.dateKey,
            } as any;
            console.log('[ODARA DEBUG] forecast rpc params', params);
            const { data, error } = await supabase.rpc('get_todays_oracle_v3', params);
            if (error || !data) {
              console.error('[ODARA DEBUG] forecast rpc failed for day', day.dateKey, { error, data });
              return day;
            }
            const r = data as any;
            const pick = r.today_pick;
            if (!pick) {
              console.error('[ODARA DEBUG] forecast rpc missing today_pick for day', day.dateKey, r);
              return day;
            }
            return {
              ...day,
              fragrance: {
                fragrance_id: pick.fragrance_id,
                name: pick.name,
                family: pick.family ?? '',
                reason: pick.reason ?? '',
              },
              temperature: temp,
              alternates: r.alternates ?? null,
            };
          })
        );
        if (!cancelled) {
          console.log('[ODARA DEBUG] forecast hydrated from RPC:', hydrated.map(d => d.fragrance?.name));
          setForecastDays(hydrated);
        }
      } catch (e) {
        console.error('[ODARA DEBUG] forecast hydration catch full error:', e);
        console.warn('[ODARA] forecast hydration failed (auth?):', e);
      }
    };
    hydrateForecast();
    return () => { cancelled = true; };
  }, [effectiveTemperature, getUserId]);

  const fetchOracle = useCallback(async (ctx?: string, temp?: number, excludeId?: string, wearDate?: string) => {
    const contextVal = ctx ?? selectedContext ?? "daily";
    const tempVal = temp ?? effectiveTemperature ?? 25;
    const dateForRpc = wearDate ?? selectedDateKey;
    const fetchId = ++latestFetchId.current;

    const dateKey = dateForRpc;
    console.log('[ODARA DEBUG] before fetchOracle', {
      build: ODARA_DEBUG_BUILD,
      contextVal,
      tempVal,
      excludeId,
      wearDate,
      selectedDateKey,
      fetchId,
    });
    console.log('ODARA current context', contextVal);
    console.log('ODARA found locked recipe', !!lockedRecipes.current[dateKey]?.[contextVal]);
    console.log('ODARA saved lock state', lockedRecipes.current[dateKey]?.[contextVal]?.lockState ?? 'neutral');

    setLoading(true);
    setError(false);
    setExitDirection(null);
    try {
      const userId = getUserId();
      if (!userId) { setError(true); setLoading(false); return; }

      const rpcParams = {
        p_user_id: userId,
        p_temperature: tempVal,
        p_context: contextVal,
        p_brand: "Alexandria Fragrances",
        p_wear_date: dateForRpc,
      } as any;

      const { data: rpcResult, error: rpcErr } = await supabase
        .rpc('get_todays_oracle_v3', rpcParams);

      if (rpcErr) throw rpcErr;
      const result = rpcResult as any;
      const pick = result.today_pick;

      if (fetchId !== latestFetchId.current || selectedContextRef.current !== contextVal) {
        console.log('ODARA stale fetch ignored for', contextVal);
        return;
      }

      console.log('[ODARA DEBUG] RPC params:', rpcParams);
      console.log('[ODARA DEBUG] raw RPC result:', result);
      console.log('[ODARA DEBUG] today_pick:', pick?.name, 'brand:', pick?.brand);
      console.log('[ODARA DEBUG] layer:', result.layer?.name);
      console.log('[ODARA DEBUG] alternates:', (result.alternates ?? []).map((a: any) => a.name));

      if (!pick) throw new Error('No fragrance found for this context');

      setMainNotes(pick.notes ?? null);
      setMainAccords(pick.accords ?? null);
      setMainProjection(pick.projection ?? null);

      const liveAlternates = (result.alternates ?? []).map((a: any) => ({
        fragrance_id: a.fragrance_id,
        name: a.name,
        family: a.family ?? '',
        reason: a.reason ?? '',
      }));

      const rpcLayer = result.layer;
      if (rpcLayer && rpcLayer.fragrance_id) {
        const layerEntry = {
          id: rpcLayer.fragrance_id,
          name: rpcLayer.name,
          brand: rpcLayer.brand ?? null,
          family_key: rpcLayer.family ?? null,
          notes: rpcLayer.notes ?? null,
          accords: rpcLayer.accords ?? null,
          projection: rpcLayer.projection ?? null,
          interactionType: "balance" as const,
          reason: rpcLayer.reason ?? "",
          why_it_works: rpcLayer.reason ?? "",
        };
        setLayerModes({
          balance: layerEntry,
          bold: layerEntry,
          smooth: layerEntry,
          wild: layerEntry,
        });
        setLayerFragrance(layerEntry);
      } else {
        setLayerModes({
          balance: null,
          bold: null,
          smooth: null,
          wild: null,
        });
        setLayerFragrance(null);
      }
      setSelectedMood("balance");

      const liveOracle: OracleData = {
        today_pick: {
          fragrance_id: pick.fragrance_id,
          name: pick.name,
          family: pick.family ?? '',
          reason: pick.reason ?? '',
          brand: pick.brand ?? '',
        },
        layer: rpcLayer
          ? {
              fragrance_id: rpcLayer.fragrance_id,
              name: rpcLayer.name,
              family: rpcLayer.family ?? '',
              reason: rpcLayer.reason ?? '',
            }
          : null,
        alternates: liveAlternates,
      };
      console.log('[ODARA DEBUG] liveOracle mapped:', liveOracle);
      setIsUnlockTransition(false);
      setSelectionState("neutral");
      setOracle(liveOracle);
      setCardKey((k) => k + 1);
    } catch (e) {
      console.error('[ODARA DEBUG] fetchOracle catch full error:', e);
      if (fetchId !== latestFetchId.current || selectedContextRef.current !== contextVal) {
        console.log('ODARA stale fetch error ignored for', contextVal);
        return;
      }
      console.error("Oracle fetch failed:", e);
      setError(true);
    } finally {
      if (fetchId === latestFetchId.current && selectedContextRef.current === contextVal) {
        setLoading(false);
      }
    }
  }, [selectedContext, effectiveTemperature, getUserId, selectedDateKey]);

  // Load a specific fragrance as main card by id (for alt tap)
  const loadFragranceById = useCallback(async (id: string) => {
    setLoading(true);
    setError(false);
    try {
      const { data: row, error: qErr } = await supabase
        .from('fragrances')
        .select('id, name, brand, family_key, notes, accords, projection')
        .eq('id', id)
        .single();
      if (qErr) throw qErr;
      setMainNotes(row.notes ?? null);
      setMainAccords(row.accords ?? null);
      setMainProjection(row.projection ?? null);

      const { data: altRows } = await supabase
        .from('fragrances')
        .select('id, name, brand, family_key, notes, accords')
        .neq('id', row.id)
        .not('family_key', 'is', null)
        .limit(3);

      const liveAlternates = (altRows ?? []).map((r: any) => ({
        fragrance_id: r.id,
        name: r.name,
        family: r.family_key ?? '',
        reason: row.brand ?? '',
      }));

      // Fetch layer candidates — get more rows to maximize family diversity
      const excludeIds = [row.id, ...(altRows ?? []).map((r: any) => r.id)];
      const { data: layerRows } = await supabase
        .from('fragrances')
        .select('id, name, brand, family_key, notes, accords, projection')
        .not('id', 'in', `(${excludeIds.join(',')})`)
        .not('family_key', 'is', null)
        .limit(20);

      const newLayerModes = pickDiverseLayerModes(layerRows ?? [], row.family_key ?? '');
      setLayerModes(newLayerModes);
      setLayerFragrance(newLayerModes.balance ?? null);
      setSelectedMood('balance');

      setOracle({
        today_pick: {
          fragrance_id: row.id,
          name: row.name,
          family: row.family_key ?? '',
          reason: row.brand ?? '',
        },
        layer: null,
        alternates: liveAlternates,
      });
      setCardKey((k) => k + 1);
    } catch (e) {
      console.error("Load fragrance failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const restoreLockedRecipe = useCallback((ctx: string, recipe: LockedRecipe) => {
    latestFetchId.current += 1;
    console.log('ODARA restoring locked recipe for', ctx);
    console.log('ODARA restored lock state', 'selected');
    setOracle(recipe.oracle);
    setMainNotes(recipe.mainNotes);
    setMainAccords(recipe.mainAccords);
    setLayerModes(recipe.layerModes);
    setMainProjection(recipe.mainProjection);
    setSelectedMood(recipe.selectedMood);
    setSelectedRatio(recipe.selectedRatio);
    setLayerFragrance(recipe.layerFragrance);
    setIsUnlockTransition(false);
    setSelectionState("selected");
    setCardExiting(false);
    setError(false);
    setLoading(false);
    setCardKey((k) => k + 1);
  }, []);

  const handleContextSwitch = useCallback((ctx: string) => {
    if (ctx === selectedContext) return;

    console.log('ODARA context switch', ctx);
    console.log('ODARA current context', selectedContextRef.current);

    setSelectedContext(ctx);
    setCardExiting(false);
    setLayerSheetOpen(false);
    setSkipHistory([]);

    const dateKey = selectedDateKey;
    const recipe = lockedRecipes.current[dateKey]?.[ctx];
    console.log('ODARA found locked recipe', !!recipe);
    console.log('ODARA saved lock state', recipe?.lockState ?? 'neutral');

    if (recipe) {
      restoreLockedRecipe(ctx, recipe);
      return;
    }

    setIsUnlockTransition(false);
    setSelectionState("neutral");
    fetchOracle(ctx, selectedTemperature, undefined, selectedDateKey);
  }, [fetchOracle, restoreLockedRecipe, selectedContext, selectedTemperature]);

  useEffect(() => {
    const dateKey = selectedDateKey;
    if (!authUser) return; // Don't fetch without auth
    const recipe = lockedRecipes.current[dateKey]?.[selectedContext];
    console.log('[ODARA DEBUG] boot effect start', {
      build: ODARA_DEBUG_BUILD,
      selectedContext,
      selectedTemperature,
      selectedDateKey,
      hasLockedRecipe: !!recipe,
      userId: authUser.id,
    });
    if (recipe) {
      restoreLockedRecipe(selectedContext, recipe);
      return;
    }
    console.log('[ODARA DEBUG] boot effect before fetchOracle');
    fetchOracle(selectedContext, selectedTemperature);
  }, [authUser]);

  const handleAccept = useCallback(async () => {
    if (actionState !== "idle") return;
    const isViewingForecastNow = selectedForecastDay > 0;
    const entry = isViewingForecastNow ? forecastDays[selectedForecastDay]?.fragrance : oracle?.today_pick;
    if (!entry?.fragrance_id) return;

    setActionState("accepting");
    try {
      const userId = getUserId();
      if (!userId) return;
      const { error: rpcError } = await supabase.rpc("accept_today_pick_v1" as any, {
        p_user: userId,
        p_fragrance_id: entry.fragrance_id,
        p_context: selectedContext,
      });
      if (rpcError) throw rpcError;
      // Silent success — UI state communicates the action
    } catch (e) {
      console.error("Accept failed:", e);
      console.warn("Couldn't confirm — try again");
    } finally {
      setActionState("idle");
      swipeLocked.current = false;
    }
  }, [actionState, oracle, getUserId, selectedForecastDay, forecastDays, selectedContext]);

  const handleSkip = useCallback(async () => {
    if (actionState !== "idle" || !oracle?.today_pick?.fragrance_id) return;
    setActionState("skipping");
    // Push current state onto skip history stack
    setSkipHistory(prev => [...prev, {
      oracle,
      mainNotes,
      mainAccords,
      layerModes,
      mainProjection,
    }]);
    
    try {
      const userId = getUserId();
      if (!userId) return;
      const { error: rpcError } = await supabase.rpc("skip_today_pick_v1" as any, {
        p_user: userId,
        p_fragrance_id: oracle.today_pick.fragrance_id,
        p_context: selectedContext,
      });
      if (rpcError) throw rpcError;
      await fetchOracle();
    } catch (e) {
      console.error("Skip failed:", e);
      console.warn("Couldn't skip — try again");
    } finally {
      setActionState("idle");
      swipeLocked.current = false;
    }
  }, [actionState, oracle, mainNotes, mainAccords, layerModes, mainProjection, getUserId, fetchOracle, selectedContext]);

  const handleUndo = useCallback(() => {
    if (skipHistory.length === 0) return;
    const snapshot = skipHistory[skipHistory.length - 1];
    setSkipHistory(prev => prev.slice(0, -1));
    setOracle(snapshot.oracle);
    setMainNotes(snapshot.mainNotes);
    setMainAccords(snapshot.mainAccords);
    setLayerModes(snapshot.layerModes);
    setMainProjection(snapshot.mainProjection);
    setLayerFragrance(snapshot.layerModes.balance ?? null);
    setSelectedMood('balance');
    setSelectionState("neutral");
    setCardKey((k) => k + 1);
  }, [skipHistory]);

  const handleAlternateTap = useCallback((alt: { fragrance_id?: string; name: string; family?: string; reason?: string }) => {
    if (actionState !== "idle" || !alt.fragrance_id || selectionState === "selected") return;
    loadFragranceById(alt.fragrance_id);
  }, [actionState, loadFragranceById, selectionState]);

  const isBusy = actionState !== "idle";

  // Auth loading
  if (authLoading) {
    return (
      <div className="dark">
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-6">
          <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">ODARA</span>
          <p className="text-sm text-muted-foreground">Checking authentication…</p>
        </div>
      </div>
    );
  }

  // Signed-out state
  if (!authUser) {
    return (
      <div className="dark">
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-6">
          <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">ODARA</span>
          <p className="text-sm text-muted-foreground">Sign in to access your scent profile</p>
          <button
            onClick={() => { /* TODO: wire to real sign-in flow */ }}
            className="text-xs text-muted-foreground uppercase tracking-[0.15em] hover:text-foreground transition-colors duration-300 px-6 py-3 rounded-full"
            style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)" }}
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="dark">
        <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-0 overflow-hidden">
          <div className="pt-3 text-[10px] tracking-[0.18em] uppercase text-muted-foreground/60">
            {ODARA_DEBUG_BUILD}
          </div>
          <header className="flex flex-col items-center pt-12 pb-6">
            <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">ODARA</span>
          </header>
          <Skeleton className="w-20 h-3 mb-6 bg-muted/20 rounded" />
          <div className="w-full max-w-md rounded-[24px] px-[22px] py-[18px] flex flex-col items-center gap-[10px]" style={{ background: "var(--glass-bg)" }}>
            <Skeleton className="w-3/4 h-10 bg-muted/20 rounded" />
            <Skeleton className="w-24 h-4 bg-muted/20 rounded" />
            <Skeleton className="w-full h-14 bg-muted/20 rounded" />
            <Skeleton className="w-full h-24 rounded-[20px] bg-muted/20" />
            <div className="flex gap-2">
              <Skeleton className="w-16 h-8 rounded-full bg-muted/20" />
              <Skeleton className="w-20 h-8 rounded-full bg-muted/20" />
              <Skeleton className="w-20 h-8 rounded-full bg-muted/20" />
            </div>
          </div>
          <div className="mt-auto pb-12 pt-8" />
        </div>
      </div>
    );
  }

  // Error state
  if (error || !oracle) {
    return (
      <div className="dark">
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 gap-6">
          <div className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground/60">
            {ODARA_DEBUG_BUILD}
          </div>
          <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">ODARA</span>
          <p className="text-sm text-muted-foreground">Couldn't load today's scent</p>
          <button
            onClick={() => fetchOracle()}
            className="text-xs text-muted-foreground uppercase tracking-[0.15em] hover:text-foreground transition-colors duration-300 px-6 py-3 rounded-full"
            style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)" }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { today_pick: oraclePick, layer: layerMap, alternates: oracleAlternates } = oracle;

  // Phase 2: mode-driven layering
  const today_pick = oraclePick;
  const alternates = oracleAlternates ?? [];
  const hasAlternates = alternates.length > 0;
  const hasAnyLayerMode = Object.values(layerModes).some(v => v !== null);

  // Card color stays fixed to main fragrance family
  const effectiveFamily = today_pick?.family;
  const bgTintColor = effectiveFamily ? (FAMILY_COLORS[effectiveFamily] ?? null) : null;

  const handleForecastDayTap = (index: number) => {
    if (index === selectedForecastDay) return;
    const nextDay = forecastDays[index];
    const newDateKey = nextDay?.dateKey;
    setSelectedForecastDay(index);
    setLayerSheetOpen(false);
    setCardKey((k) => k + 1);
    setExitDirection(null);
    setSkipHistory([]);
    const dayTemp = nextDay?.temperature;
    if (dayTemp != null) setDisplayedTemperature(dayTemp);
    else setDisplayedTemperature(null);
    // Load correct data for tapped day
    const lockedForDay = lockedRecipes.current?.[newDateKey]?.[selectedContext];
    if (lockedForDay) {
      restoreLockedRecipe(selectedContext, lockedForDay);
    } else {
      setSelectionState("neutral");
      fetchOracle(selectedContext, dayTemp ?? effectiveTemperature, undefined, newDateKey);
    }
  };

  return (
    <div className="dark">
      <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-0 overflow-hidden relative">
        {/* Subtle background tint overlay */}
        <motion.div
          className="absolute inset-0 pointer-events-none z-0"
          animate={{ backgroundColor: bgTintColor ? `${bgTintColor}08` : "transparent" }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
        />
        {/* Header + Context chips grouped */}
        <div className="flex flex-col items-center pt-[16px] mb-[14px]">
          <div className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground/60 mb-2">
            {ODARA_DEBUG_BUILD}
          </div>
          <header className="flex flex-col items-center pb-6">
            <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">ODARA</span>
          </header>

          {/* Context chips */}
          <div className="flex gap-1.5">
            {CONTEXTS.map((ctx) => (
              <button
                key={ctx}
                onClick={() => handleContextSwitch(ctx)}
                disabled={isBusy || loading}
                className={`text-[10px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-full transition-all duration-200 disabled:opacity-40 ${
                  selectedContext === ctx
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground/50 hover:text-muted-foreground"
                }`}
                style={selectedContext === ctx ? { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)" } : undefined}
              >
                {ctx}
              </button>
            ))}
          </div>
        </div>

        {/* Cover Flow Card Stack — magnet: shifts up when layer expands */}
        <motion.div
          className="relative w-full max-w-lg mt-[4px] overflow-visible flex-shrink-0"
          style={{ perspective: "1200px" }}
          animate={{ y: layerSheetOpen ? -32 : 0 }}
          transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {/* Gesture hint indicators removed — state communicates via card transitions */}
          <AnimatePresence>
          </AnimatePresence>

          {/* Card stack container — custom gesture handling */}
          <motion.div
            className="flex items-center justify-center relative"
            style={{ minHeight: "420px", touchAction: "none" }}
            onPointerDown={(e) => {
              dragDirection.current = "none";
              dragStart.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              if (!dragStart.current || dragDirection.current !== "none") return;
              const dx = Math.abs(e.clientX - dragStart.current.x);
              const dy = Math.abs(e.clientY - dragStart.current.y);
              if (dx > LOCK_THRESHOLD || dy > LOCK_THRESHOLD) {
                dragDirection.current = dx > dy ? "horizontal" : "vertical";
              }
            }}
            drag
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            dragElastic={0.15}
            onDragEnd={(_, info: PanInfo) => {
              const { offset, velocity } = info;
              const absX = Math.abs(offset.x);
              const absY = Math.abs(offset.y);

              // Use the locked direction, or fall back to dominant axis
              const dir = dragDirection.current !== "none"
                ? dragDirection.current
                : (absX > absY ? "horizontal" : "vertical");

              dragDirection.current = "none";
              dragStart.current = null;

              if (dir === "horizontal") {
                const hThreshold = 50;
                const hVel = 200;
                let nextIndex: number | null = null;
                if (
                  (offset.x < -hThreshold || velocity.x < -hVel) &&
                  selectedForecastDay < forecastDays.length - 1
                ) {
                  nextIndex = selectedForecastDay + 1;
                } else if (
                  (offset.x > hThreshold || velocity.x > hVel) &&
                  selectedForecastDay > 0
                ) {
                  nextIndex = selectedForecastDay - 1;
                }
                if (nextIndex != null) {
                  const nextDay = forecastDays[nextIndex];
                  const newDateKey = nextDay?.dateKey;
                  setSelectedForecastDay(nextIndex);
                  setLayerSheetOpen(false);
                  setSkipHistory([]);
                  const dayTemp = nextDay?.temperature;
                  if (dayTemp != null) setDisplayedTemperature(dayTemp);
                  // Load correct data for the new day
                  const lockedForDay = lockedRecipes.current?.[newDateKey]?.[selectedContext];
                  if (lockedForDay) {
                    restoreLockedRecipe(selectedContext, lockedForDay);
                  } else {
                    setSelectionState("neutral");
                    fetchOracle(selectedContext, dayTemp ?? effectiveTemperature, undefined, newDateKey);
                  }
                }
              } else if (dir === "vertical") {
                const vThreshold = 60;
                const vVel = 200;
                // Swipe UP = choose (lock in)
                if (offset.y < -vThreshold || velocity.y < -vVel) {
                  if (selectionState === "neutral") {
                    setSelectionState("selected");
                    setIsUnlockTransition(false);
                    setLockFlashColor("#22c55e");
                    setTimeout(() => setLockFlashColor(null), 400);
                    setLockPulse(true);
                    setTimeout(() => setLockPulse(false), 380);
                    setSkipHistory([]);
                    // Store full recipe for this context
                    if (oracle) {
                      const recipe: LockedRecipe = {
                        context: selectedContext,
                        lockState: "selected",
                        oracle,
                        mainNotes,
                        mainAccords,
                        layerModes,
                        mainProjection,
                        selectedMood,
                        selectedRatio,
                        layerFragrance,
                      };
                      const dateKey = selectedDateKey;
                      if (!lockedRecipes.current[dateKey]) lockedRecipes.current[dateKey] = {};
                      lockedRecipes.current[dateKey][selectedContext] = recipe;
                      bumpRecipeVersion();
                      console.log('ODARA saved locked recipe', dateKey, selectedContext, recipe);
                      console.log('ODARA saved lock state', recipe.lockState);
                    }
                    handleAccept();
                  }
                }
                // Swipe DOWN from selected = temporary yellow unlock transition, then neutral
                // Swipe DOWN from neutral = red skip
                else if (offset.y > vThreshold || velocity.y > vVel) {
                  if (selectionState === "selected") {
                    if (unlockTimeoutRef.current) clearTimeout(unlockTimeoutRef.current);
                    setIsUnlockTransition(true);
                    setLockFlashColor("#eab308");
                    const dateKey = selectedDateKey;
                    if (lockedRecipes.current[dateKey]) {
                      delete lockedRecipes.current[dateKey][selectedContext];
                      if (Object.keys(lockedRecipes.current[dateKey]).length === 0) delete lockedRecipes.current[dateKey];
                    }
                    bumpRecipeVersion();
                    console.log('ODARA recipe deleted for', dateKey, selectedContext);
                    unlockTimeoutRef.current = setTimeout(() => {
                      setLockFlashColor(null);
                      setIsUnlockTransition(false);
                      setSelectionState("neutral");
                    }, 360);
                  } else if (selectionState === "neutral") {
                    // Defensive clear before skip in case stale recipe exists
                    const dateKey2 = selectedDateKey;
                    if (lockedRecipes.current[dateKey2]) {
                      delete lockedRecipes.current[dateKey2][selectedContext];
                      if (Object.keys(lockedRecipes.current[dateKey2]).length === 0) delete lockedRecipes.current[dateKey2];
                    }
                    bumpRecipeVersion();
                    console.log('ODARA recipe deleted for', dateKey2, selectedContext);
                    setLockFlashColor("#ef4444");
                    setCardExiting(true);
                    setTimeout(() => {
                      setLockFlashColor(null);
                      setCardExiting(false);
                      setSelectionState("neutral");
                      handleSkip();
                    }, 450);
                  }
                }
              }
            }}
          >
            {forecastDays.map((dayData, i) => {
              const offset = i - selectedForecastDay;
              const absOffset = Math.abs(offset);
              const isCenter = offset === 0;

              if (absOffset > 3) return null;

              // Phase 1: only render day 0 (live main card), skip forecast cards
              if (!isCenter) return null;
              const cardPick = oraclePick;
              const cardAlternates = oracleAlternates ?? [];
              const cardHasAlternates = cardAlternates.length > 0;

              if (!cardPick) return null;

              // Card color stays fixed to main fragrance family
              const cardEffectiveFamily = cardPick.family;
              const familyTint = FAMILY_TINTS[cardEffectiveFamily] ?? DEFAULT_TINT;
              const familyColor = FAMILY_COLORS[cardEffectiveFamily] ?? "#888";
              const baseFamilyColor = FAMILY_COLORS[cardPick.family] ?? "#888";

              // Cover flow transforms
              const scale = isCenter ? 1 : Math.max(0.88, 1 - absOffset * 0.05);
              const rotateY = offset * -22;
              const translateX = offset * 90;
              const translateZ = isCenter ? 40 : -absOffset * 50;
              const opacity = isCenter ? 1 : Math.max(0.55, 0.75 - absOffset * 0.12);
              const blur = isCenter ? 0 : Math.min(absOffset * 1.5, 4);
              const zIndex = 10 - absOffset;

              const feedbackY = 0;
              const feedbackScale = scale;
              const feedbackGlow = "";

              return (
                <motion.div
                  key={`coverflow-${i}`}
                  className="absolute w-full max-w-md"
                  animate={{
                    x: translateX,
                    y: cardExiting && isCenter ? 600 : feedbackY,
                    rotateY,
                    scale: feedbackScale,
                    opacity: cardExiting && isCenter ? 0 : opacity,
                    z: translateZ,
                  }}
                  transition={cardExiting && isCenter
                    ? { duration: 0.4, ease: [0.4, 0, 1, 1] }
                    : { duration: 0.45, ease: [0.32, 0.72, 0, 1] }
                  }
                  style={{
                    zIndex,
                    filter: blur > 0 ? `blur(${blur}px)` : undefined,
                    transformStyle: "preserve-3d",
                    pointerEvents: isCenter ? "auto" : "none",
                  }}
                >
                  <div
                    className="w-full rounded-[24px] px-[22px] py-[16px] flex flex-col items-center relative"
                    style={{
                      background: isCenter
                        ? `linear-gradient(135deg, ${familyColor}55, rgba(20,20,20,0.95))`
                        : `linear-gradient(180deg, rgba(255,255,255,0.015) 0%, rgba(0,0,0,0.1) 100%), rgba(10,10,12,0.92)`,
                      backdropFilter: isCenter ? "blur(50px) saturate(1.4)" : "blur(14px) saturate(1.05)",
                      border: isCenter ? `1px solid ${familyColor}88` : undefined,
                      boxShadow: isCenter
                        ? `0 10px 40px rgba(0,0,0,0.6)`
                        : `0 12px 35px rgba(0,0,0,0.5), inset 0 1px 0 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(255,255,255,0.03)`,
                    }}
                  >
                    {/* Temperature — quiet metadata top-right */}
                    {isCenter && (displayedTemperature ?? effectiveTemperature) > 0 && (
                      <span className="absolute top-3 right-5 text-[11px] font-mono font-medium text-white/70 tracking-[0.06em] select-none">
                        {displayedTemperature ?? effectiveTemperature}°
                      </span>
                    )}

                    {/* Day/date label */}
                    <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/70 mb-[6px] select-none">
                      {dayData.label} · {dayData.day}
                    </span>

                    {/* Long-press target for fragrance profile */}
                    <div
                      className="flex flex-col items-center select-none"
                      onPointerDown={(e) => {
                        if (!isCenter) return;
                        e.stopPropagation();
                        longPressTimer.current = setTimeout(() => {
                          setSelectedForecastDay(i);
                          setProfileOpen(true);
                          longPressTimer.current = null;
                        }, LONG_PRESS_DURATION);
                      }}
                      onPointerUp={() => {
                        if (longPressTimer.current) {
                          clearTimeout(longPressTimer.current);
                          longPressTimer.current = null;
                        }
                      }}
                      onPointerLeave={() => {
                        if (longPressTimer.current) {
                          clearTimeout(longPressTimer.current);
                          longPressTimer.current = null;
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      <h1 className="text-4xl font-serif text-foreground text-center mb-1 leading-tight select-none">
                        {getDisplayName(cardPick.name, cardPick.brand)}
                      </h1>

                      {/* Brand name — from live Supabase data */}
                      {cardPick.brand && (
                        <p className="text-[11px] text-center tracking-[0.12em] text-muted-foreground/70 mb-1 select-none">
                          {cardPick.brand}
                        </p>
                      )}

                      {/* Family label with color accent — always uses base family */}
                      <p
                        className="text-xs text-center uppercase select-none w-full mt-[10px] mb-[6px]"
                        style={{ color: baseFamilyColor, fontWeight: 500, letterSpacing: '0.12em', lineHeight: 1.4 }}
                      >
                        {cardPick.family}
                      </p>

                      {/* Main fragrance accords — swappable for phased notes later */}
                      {(() => {
                        const displayNotes = normalizeNotes(mainNotes ?? [], 3);
                        const displayAccords = (mainAccords ?? []).map(a => a.trim()).slice(0, 4);
                        const hasAny = displayNotes.length > 0 || displayAccords.length > 0;
                        if (!isCenter || !hasAny) return null;
                        return (
                          <div className="w-full px-2 mb-[10px] mt-[6px]">
                            {displayAccords.length > 0 && (
                              <p className="text-[13px] text-center select-none lowercase" style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500, letterSpacing: '0.06em', lineHeight: 1.5 }}>
                                <span style={{ color: 'rgba(255,255,255,0.50)' }}>Accords:</span> {displayAccords.join(', ').toLowerCase()}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Layer Card — separate component with independent color ownership */}
                    {isCenter && hasAnyLayerMode && (
                      <LayerCard
                        mainName={cardPick.name}
                        mainBrand={cardPick.brand}
                        mainNotes={mainNotes}
                        mainFamily={cardPick.family ?? null}
                        mainProjection={mainProjection}
                        layerModes={layerModes}
                        selectedMood={selectedMood}
                        onSelectMood={(mood) => {
                          if (selectionState === "selected") return;
                          setSelectedMood(mood);
                          setLayerFragrance(layerModes[mood]);
                        }}
                        selectedRatio={selectedRatio}
                        onSelectRatio={(r) => {
                          if (selectionState === "selected") return;
                          setSelectedRatio(r);
                        }}
                        isExpanded={layerSheetOpen}
                        onToggleExpand={() => setLayerSheetOpen((o) => !o)}
                        lockPulse={lockPulse}
                        locked={selectionState === "selected"}
                      />
                    )}

                    {/* Alternatives */}
                    {isCenter && cardHasAlternates && (
                      <div className="flex flex-col items-center mb-[6px] max-w-full">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 text-center mt-[2px] mb-[16px] font-medium">Alternatives</span>
                        <div className="relative w-full">
                          <div
                            className="flex flex-row gap-2.5 overflow-x-auto overflow-y-hidden px-4 pb-1"
                            style={{
                              scrollbarWidth: 'none',
                              msOverflowStyle: 'none',
                              WebkitOverflowScrolling: 'touch',
                              scrollBehavior: 'smooth',
                              scrollSnapType: 'x mandatory',
                            }}
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchMove={(e) => e.stopPropagation()}
                          >
                            <div className="shrink-0 w-3" aria-hidden />
                            <div className="flex flex-row gap-2.5 mx-auto">
                              {cardAlternates!.map((alt) => {
                                const altFamily = alt.family ?? "";
                                const altColor = FAMILY_COLORS[altFamily] ?? "#ffffff";
                                const isSelected = oracle?.today_pick?.name === alt.name;
                                return (
                                  <motion.button
                                    key={alt.name}
                                    whileTap={{ scale: 0.93 }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAlternateTap(alt);
                                    }}
                                    disabled={isBusy || selectionState === "selected"}
                                    className="text-[13px] text-white/90 rounded-full px-4 py-1.5 transition-all disabled:opacity-40 whitespace-nowrap shrink-0"
                                    style={{
                                      background: isSelected ? `${altColor}55` : `${altColor}22`,
                                      border: `1px solid ${altColor}66`,
                                      boxShadow: "none",
                                      color: "#fff",
                                      fontWeight: 500,
                                      scrollSnapAlign: 'start',
                                    }}
                                  >
                                    {getDisplayName(alt.name)}
                                  </motion.button>
                                );
                              })}
                            </div>
                            <div className="shrink-0 w-3" aria-hidden />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Lock line flash — Tron-style neon line on lock icon */}
                    {isCenter && (
                      <AnimatePresence>
                        {lockFlashColor && (
                          <motion.div
                            key={`lock-flash-${lockFlashColor}`}
                            className="absolute top-3 left-5 pointer-events-none z-20 ml-2 mt-2"
                            style={{ width: 20, height: 20 }}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 1, 1, 0] }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.4, times: [0, 0.1, 0.6, 1], ease: "easeOut" }}
                          >
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                              {/* Neon line traces around the lock shape */}
                              <rect x="3" y="9" width="14" height="9" rx="2" stroke={lockFlashColor} strokeWidth="1.5" fill="none"
                                filter={`drop-shadow(0 0 4px ${lockFlashColor}) drop-shadow(0 0 8px ${lockFlashColor}80)`} />
                              <path d={(selectionState === "selected" && !isUnlockTransition)
                                ? "M7 9V6a3 3 0 0 1 6 0v3"
                                : "M7 9V6a3 3 0 0 1 6 0"
                              } stroke={lockFlashColor} strokeWidth="1.5" fill="none" strokeLinecap="round"
                                filter={`drop-shadow(0 0 4px ${lockFlashColor}) drop-shadow(0 0 8px ${lockFlashColor}80)`} />
                            </svg>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    )}

                    {/* Lock icon — state-driven, top-left */}
                    {isCenter && (
                      <div className="absolute top-3 left-5 flex flex-col items-center z-10">
                        <motion.div
                          className="p-2"
                          animate={lockFlashColor
                            ? { scale: [1, 1.12, 1] }
                            : { scale: 1 }
                          }
                          transition={{ duration: 0.3 }}
                        >
                          {isUnlockTransition ? (
                            <LockOpen
                              size={16}
                              className="transition-all duration-200"
                              style={{
                                color: "#eab308",
                                filter: `drop-shadow(0 0 4px rgba(234,179,8,0.5))`,
                              }}
                            />
                          ) : selectionState === "selected" ? (
                            <Lock
                              size={16}
                              className="transition-all duration-200"
                              style={{
                                color: "#22c55e",
                                filter: `drop-shadow(0 0 4px rgba(34,197,94,0.5))`,
                              }}
                            />
                          ) : (
                            <LockOpen
                              size={16}
                              className="text-muted-foreground/40 transition-all duration-200"
                            />
                          )}
                        </motion.div>
                        {/* Undo back arrow — appears after skip */}
                        <AnimatePresence>
                          {skipHistory.length > 0 && (
                            <motion.button
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.2 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUndo();
                              }}
                              className="mt-1 p-1.5 rounded-full"
                              style={{ color: "rgba(255,255,255,0.45)" }}
                            >
                              <Undo2 size={13} />
                            </motion.button>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </motion.div>

        {/* Spacer before forecast — breathing room between card and forecast */}
        <motion.div
          className="shrink-0"
          animate={{ height: layerSheetOpen ? 6 : 20 }}
          transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
        />

        {/* 7-Day Forecast Timepiece — magnet: physically pushed down & compressed when layer expands */}
        <motion.div
          className="w-full max-w-md rounded-t-[16px] px-5 backdrop-blur-xl overflow-hidden shrink-0"
          animate={{
            maxHeight: layerSheetOpen ? 60 : 200,
            y: layerSheetOpen ? 24 : 0,
            paddingTop: layerSheetOpen ? 4 : 12,
            paddingBottom: layerSheetOpen ? 6 : 24,
            opacity: layerSheetOpen ? 0.55 : 1,
            scale: layerSheetOpen ? 0.97 : 1,
          }}
          transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
          style={{
            background: "var(--sub-glass-bg)",
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06)",
            transformOrigin: "bottom center",
          }}
        >
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60 block text-center mb-3">
            Forecast
          </span>
          {/* Weekday label row with orb on the same line */}
          <div className="relative" style={{ marginBottom: "4px" }}>
            {/* Day name labels */}
            <div className="flex justify-between">
              {forecastDays.map((d, i) => {
                const FALLBACK_ORB_COLOR = "rgba(255,255,255,0.18)";
                const isSelected = selectedForecastDay === i;

                const distToDay = Math.abs(i - orbPosition);
                const PROXIMITY_RADIUS = 0.8;
                const proximity = distToDay < PROXIMITY_RADIUS ? 1 - (distToDay / PROXIMITY_RADIUS) : 0;
                const smoothProximity = proximity * proximity * (3 - 2 * proximity);
                const isCurrentOrbDay = i === 0;
                const todayOwnership = isCurrentOrbDay ? Math.max(0, 1 - orbPosition) : 0;
                const isNextTarget = i === 1 && orbPosition > 0.5;
                const handoffGlow = isNextTarget ? (orbPosition - 0.5) / 0.5 : 0;
                const CROSSOVER_RADIUS = 0.15;
                const crossoverGlow = distToDay < CROSSOVER_RADIUS
                  ? (1 - distToDay / CROSSOVER_RADIUS) * 0.35
                  : 0;
                const labelOpacity = isSelected ? 0.95
                  : isCurrentOrbDay ? 0.55 + todayOwnership * 0.3 + smoothProximity * 0.1
                  : isNextTarget ? 0.4 + handoffGlow * 0.35 + crossoverGlow
                  : 0.4 + smoothProximity * 0.08;

                return (
                  <span
                    key={i}
                    className="font-mono text-center leading-none"
                    style={{
                      fontSize: "11px",
                      letterSpacing: "0.1em",
                      color: `rgba(255,255,255,${Math.min(labelOpacity + 0.15, 1)})`,
                      fontWeight: isSelected ? 600 : isCurrentOrbDay ? 500 : 450,
                      minWidth: "28px",
                      width: "28px",
                      textShadow: crossoverGlow > 0.01
                        ? `0 0 ${6 * crossoverGlow}px rgba(255,255,255,${(crossoverGlow * 0.6).toFixed(3)})`
                        : "none",
                      transition: "text-shadow 0.5s ease, color 0.3s ease",
                    }}
                  >
                    {d.label}
                  </span>
                );
              })}
            </div>

            {/* Orb — lives in the gap between day labels, never overlaps text */}
            {(() => {
              // Labels are centered at (i/6)*100%. Each ~28px wide → half = 14px.
              // Gap left edge = today's center + 14px + 1px buffer
              // Gap right edge = tomorrow's center - 14px - 1px buffer
              // orbPosition 0→1 maps midnight→next midnight within this gap.
              const todayIdx = 0;
              const tomorrowIdx = 1;
              const todayCenterPct = (todayIdx / 6) * 100;
              const tomorrowCenterPct = (tomorrowIdx / 6) * 100;
              const LABEL_HALF = 14; // half of ~28px label width
              const GAP_BUFFER = 1;  // 1px separation from label text

              // left: calc( todayCenter% + 15px + orbPosition * ( tomorrowCenter% - todayCenter% - 30px ) )
              const ORB_RADIUS = 2.5; // half of 5px orb dot
              const leftOffsetPx = LABEL_HALF + ORB_RADIUS + GAP_BUFFER; // 17.5px
              const rightOffsetPx = LABEL_HALF + ORB_RADIUS + GAP_BUFFER; // 17.5px
              const totalOffsetPx = leftOffsetPx + rightOffsetPx; // 35px

              // Fade/emerge at midnight boundaries
              const dayFrac = orbPosition % 1;
              const FADE_START = 0.96;
              const EMERGE_END = 0.02;
              let orbOpacity: number;
              if (dayFrac >= FADE_START) {
                orbOpacity = (1 - dayFrac) / (1 - FADE_START);
              } else if (dayFrac <= EMERGE_END) {
                orbOpacity = dayFrac / EMERGE_END;
              } else {
                orbOpacity = 1;
              }
              orbOpacity = orbOpacity * orbOpacity * (3 - 2 * orbOpacity);
              const glowScale = orbOpacity;

              // Pre-compute the % and px components for CSS calc
              const gapPct = tomorrowCenterPct - todayCenterPct; // ~16.667%
              const pctPart = todayCenterPct + orbPosition * gapPct;
              const pxPart = leftOffsetPx + orbPosition * (-totalOffsetPx);
              const orbLeft = `calc(${pctPart}% + ${pxPart}px)`;

              return (
                <div
                  className="pointer-events-none"
                  style={{
                    position: "absolute",
                    left: orbLeft,
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    zIndex: 10,
                    willChange: "transform, opacity",
                  }}
                >
                  <div
                    className="rounded-full"
                    style={{
                      width: "5px",
                      height: "5px",
                      background: "white",
                      opacity: Math.max(0, orbOpacity),
                      boxShadow: `0 0 ${4 * glowScale}px ${2 * glowScale}px rgba(255,255,255,${(0.15 * orbOpacity).toFixed(3)}), 0 0 ${8 * glowScale}px ${3 * glowScale}px rgba(255,255,255,${(0.05 * orbOpacity).toFixed(3)})`,
                      transition: "opacity 0.3s ease, box-shadow 0.3s ease",
                    }}
                  />
                </div>
              );
            })()}
          </div>

          {/* Date numbers + underline row (separate from orb line) */}
          <div className="flex justify-between">
            {forecastDays.map((d, i) => {
              const isSelected = selectedForecastDay === i;
              const isCurrentOrbDay = i === 0;
              const todayOwnership = isCurrentOrbDay ? Math.max(0, 1 - orbPosition) : 0;
              const isNextTarget = i === 1 && orbPosition > 0.5;
              const handoffGlow = isNextTarget ? (orbPosition - 0.5) / 0.5 : 0;
              const dateOpacity = isSelected ? 0.75 : isCurrentOrbDay ? 0.35 + todayOwnership * 0.2 : isNextTarget ? 0.3 + handoffGlow * 0.2 : 0.3;

              return (
                <button
                  key={i}
                  onClick={() => handleForecastDayTap(i)}
                  className="flex flex-col items-center justify-start bg-transparent border-none outline-none cursor-pointer"
                  style={{ minWidth: "28px", width: "28px" }}
                >
                  <span
                    className="font-mono text-center leading-none transition-all duration-200"
                    style={{
                      fontSize: "13px",
                      fontWeight: isSelected ? 600 : 500,
                      color: `rgba(255,255,255,${Math.min(dateOpacity + 0.15, 1)})`,
                      marginBottom: "5px",
                    }}
                  >
                    {d.day}
                  </span>

                  {/* Recipe-driven forecast bars (multi-day, multi-context) */}
                  {(() => {
                    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                    recipeVersion; // subscribe to recipe changes
                    const dayDateKey = d.dateKey;
                    const dayRecipes = lockedRecipes.current[dayDateKey];
                    const CONTEXT_ORDER: string[] = ["daily", "work", "hangout", "date"];

                    if (!dayRecipes || Object.keys(dayRecipes).length === 0) {
                      return isSelected ? (
                        <div className="flex flex-col items-center" style={{ marginTop: "3px", gap: "5px" }}>
                          {CONTEXT_ORDER.map(ctx => (
                            <div key={ctx} style={{ width: "18px", height: "3px" }} />
                          ))}
                        </div>
                      ) : null;
                    }

                    // Fixed 4-lane structure per day
                    return (
                      <div className="flex flex-col items-center" style={{ marginTop: "3px", gap: "5px" }}>
                        {CONTEXT_ORDER.map((ctx) => {
                          const recipe = dayRecipes[ctx];
                          if (!recipe) {
                            // Empty lane — reserve space, render nothing visible
                            return <div key={ctx} style={{ width: "18px", height: "3px" }} />;
                          }
                          const mainFamily = recipe.oracle.today_pick.family;
                          const mainColor = FAMILY_COLORS[mainFamily] ?? "#888";
                          const hasLayer = !!recipe.layerFragrance;
                          const layerColor = hasLayer
                            ? (FAMILY_COLORS[recipe.layerFragrance!.family_key] ?? "#666")
                            : null;
                          return (
                            <motion.div
                              key={ctx}
                              initial={{ scaleX: 0 }}
                              animate={{ scaleX: 1 }}
                              exit={{ scaleX: 0 }}
                              transition={{ duration: 0.25, ease: "easeOut" }}
                              className="rounded-full overflow-hidden"
                              style={{
                                width: "18px",
                                height: "3px",
                                display: "flex",
                                background: hasLayer ? "transparent" : mainColor,
                              }}
                            >
                              {hasLayer && (
                                <>
                                  <div style={{ flex: 1, background: mainColor }} />
                                  <div style={{ flex: 1, background: layerColor! }} />
                                </>
                              )}
                            </motion.div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Fragrance Profile Sheet */}
        <AnimatePresence>
          {profileOpen && (() => {
            const profile = FRAGRANCE_PROFILES[today_pick.name];
            const familyColor = FAMILY_COLORS[today_pick.family] ?? "#888";
            const familyLabel = FAMILY_LABELS[today_pick.family] ?? today_pick.family;
            const familyTint = FAMILY_TINTS[today_pick.family] ?? DEFAULT_TINT;
            return (
              <motion.div
                key="profile-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="fixed inset-0 z-50 flex items-end justify-center"
                style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
                onClick={() => setProfileOpen(false)}
              >
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
                  className="w-full max-w-md rounded-t-[28px] px-6 pt-5 pb-10 overflow-y-auto relative"
                  style={{
                    maxHeight: "85vh",
                    background: "hsl(var(--background))",
                    boxShadow: "0 -10px 40px rgba(0,0,0,0.3)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-center mb-4">
                    <div className="w-10 h-1 rounded-full bg-foreground/15" />
                  </div>

                  <button
                    onClick={() => setProfileOpen(false)}
                    className="absolute top-5 right-5 p-2 text-muted-foreground/50 hover:text-foreground transition-colors z-10"
                  >
                    <X size={18} />
                  </button>

                  {/* Top section: Name + Family + Bottle */}
                  <div className="relative mb-6">
                    {/* Bottle image — top right */}
                    {profile?.bottle_url && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4, delay: 0.15, ease: [0.2, 0, 0, 1] }}
                        className="absolute -top-2 right-0 z-0"
                        style={{ width: "25%", maxWidth: "100px" }}
                      >
                        <div
                          className="relative rounded-xl overflow-hidden"
                          style={{
                            boxShadow: `0 8px 24px -6px rgba(0,0,0,0.4), 0 0 20px -4px ${familyTint.glow}`,
                          }}
                        >
                          <img
                            src={profile.bottle_url}
                            alt={`${today_pick.name} bottle`}
                            className="w-full h-auto object-cover"
                            style={{ aspectRatio: "2/3" }}
                          />
                          {/* Family glow overlay */}
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background: `linear-gradient(180deg, transparent 40%, ${familyColor}15 100%)`,
                            }}
                          />
                        </div>
                      </motion.div>
                    )}

                    {/* Name + family — left aligned to leave room for bottle */}
                    <div style={{ paddingRight: profile?.bottle_url ? "30%" : "0" }}>
                      <h2 className="text-3xl font-serif text-foreground mb-1">{today_pick.name}</h2>
                      {profile?.brand && (
                        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/60 mb-2">{profile.brand}</p>
                      )}
                      <span
                        className="inline-block text-[10px] uppercase tracking-[0.15em] px-3 py-1 rounded-full"
                        style={{ color: familyColor, boxShadow: `inset 0 0 0 1px ${familyColor}33` }}
                      >
                        {familyLabel}
                      </span>
                    </div>
                  </div>

                  {/* Note Pyramid — raw, unfiltered notes for detail view */}
                  {(() => {
                    const hasProfileNotes = profile?.top_notes || profile?.heart_notes || profile?.base_notes;
                    const hasDbNotes = (mainNotes && mainNotes.length > 0);
                    const hasDbAccords = (mainAccords && mainAccords.length > 0);
                    if (!hasProfileNotes && !hasDbNotes && !hasDbAccords) return null;
                    return (
                      <div className="mb-8 space-y-3">
                        <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground/70 block mb-1">
                          {hasProfileNotes ? 'Note Pyramid' : 'Notes & Accords'}
                        </span>
                        {hasProfileNotes ? (
                          <>
                            {profile?.top_notes && (
                              <div>
                                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50">Top</span>
                                <p className="text-[12px] text-foreground/80 mt-0.5">{profile.top_notes.join(" · ")}</p>
                              </div>
                            )}
                            {profile?.heart_notes && (
                              <div>
                                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50">Heart</span>
                                <p className="text-[12px] text-foreground/80 mt-0.5">{profile.heart_notes.join(" · ")}</p>
                              </div>
                            )}
                            {profile?.base_notes && (
                              <div>
                                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50">Base</span>
                                <p className="text-[12px] text-foreground/80 mt-0.5">{profile.base_notes.join(" · ")}</p>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {hasDbNotes && (
                              <div>
                                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50">Notes</span>
                                <p className="text-[12px] text-foreground/80 mt-0.5">{mainNotes!.join(" · ")}</p>
                              </div>
                            )}
                            {hasDbAccords && (
                              <div>
                                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50">Accords</span>
                                <p className="text-[12px] text-foreground/80 mt-0.5 lowercase">{mainAccords!.join(" · ")}</p>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* Performance Bars */}
                  {(profile?.longevity_score != null || profile?.projection_score != null) && (
                    <div className="mb-8">
                      <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground/70 block mb-3">Performance</span>
                      <div className="space-y-4">
                        {profile?.longevity_score != null && (
                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50">Longevity</span>
                              <span className="text-[10px] font-mono text-foreground/50">{Math.round(profile.longevity_score * 10)}/10</span>
                            </div>
                            <div
                              className="w-full h-[6px] rounded-full overflow-hidden"
                              style={{ background: "rgba(255,255,255,0.06)" }}
                            >
                              <motion.div
                                className="h-full rounded-full"
                                initial={{ width: 0 }}
                                animate={{ width: `${profile.longevity_score * 100}%` }}
                                transition={{ duration: 0.5, delay: 0.2, ease: [0.2, 0, 0, 1] }}
                                style={{
                                  background: `linear-gradient(90deg, ${familyColor}CC, ${familyColor}88)`,
                                  boxShadow: `0 0 10px -2px ${familyColor}44`,
                                }}
                              />
                            </div>
                          </div>
                        )}
                        {profile?.projection_score != null && (
                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50">Projection</span>
                              <span className="text-[10px] font-mono text-foreground/50">{Math.round(profile.projection_score * 10)}/10</span>
                            </div>
                            <div
                              className="w-full h-[6px] rounded-full overflow-hidden"
                              style={{ background: "rgba(255,255,255,0.06)" }}
                            >
                              <motion.div
                                className="h-full rounded-full"
                                initial={{ width: 0 }}
                                animate={{ width: `${profile.projection_score * 100}%` }}
                                transition={{ duration: 0.5, delay: 0.35, ease: [0.2, 0, 0, 1] }}
                                style={{
                                  background: `linear-gradient(90deg, ${familyColor}CC, ${familyColor}88)`,
                                  boxShadow: `0 0 10px -2px ${familyColor}44`,
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Wear Context + Weather (two-tier) */}
                  {(profile?.wardrobe_role || profile?.weather) && (
                    <div className="mb-8 grid grid-cols-2 gap-4">
                      {profile.wardrobe_role && (
                        <div>
                          <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground/70">Wear it for</span>
                          <p className="text-[12px] text-foreground/80 mt-1">{profile.wardrobe_role}</p>
                        </div>
                      )}
                      {profile.weather && (
                        <div>
                          <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground/70">Weather</span>
                          <p className="text-[12px] text-foreground/80 mt-1">{profile.weather}</p>
                          {profile.secondary_weather && (
                            <p className="text-[11px] text-foreground/60 mt-1">{profile.secondary_weather}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Why it fits */}
                  <div className="mb-2">
                    <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground/70 block mb-1">Why it fits</span>
                    <p className="text-[12px] text-foreground/70 leading-relaxed">{today_pick.reason}</p>
                  </div>
                </motion.div>
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default OdaraScreen;
