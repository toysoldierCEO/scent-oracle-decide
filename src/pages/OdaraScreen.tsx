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
  const ODARA_DEBUG_BUILD = 'ODARA_RENDER_TEST_V1';
  console.log('[ODARA BUILD]', ODARA_DEBUG_BUILD);

  return (
    <div className="dark">
      <div className="min-h-screen bg-background flex flex-col items-center px-6 py-8 gap-6">
        {/* Build marker */}
        <div className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground/60">
          {ODARA_DEBUG_BUILD}
        </div>

        {/* Header */}
        <header className="flex flex-col items-center gap-2">
          <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">ODARA STATIC SHELL</span>
          <span className="text-sm text-muted-foreground">Render test</span>
        </header>

        {/* Today card */}
        <div className="w-full max-w-md rounded-[24px] px-6 py-5 flex flex-col gap-3"
          style={{ background: 'rgba(192,138,62,0.10)', border: '1px solid rgba(192,138,62,0.16)' }}>
          <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Today's Pick</span>
          <span className="text-2xl font-bold text-foreground">Karnak Temple</span>
          <span className="text-sm text-muted-foreground">Alexandria Fragrances</span>
          <span className="text-xs text-muted-foreground/70">oud-amber</span>
          <span className="text-xs text-muted-foreground italic">Static render test only</span>
        </div>

        {/* Layer row */}
        <div className="w-full max-w-md rounded-[16px] px-5 py-4 flex flex-col gap-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Layer</span>
          <span className="text-lg font-semibold text-foreground">Barricade</span>
        </div>

        {/* Alternate row */}
        <div className="w-full max-w-md rounded-[16px] px-5 py-4 flex flex-col gap-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Alternate</span>
          <span className="text-lg font-semibold text-foreground">Miraculous Oud</span>
        </div>
      </div>
    </div>
  );
};

export default OdaraScreen;
