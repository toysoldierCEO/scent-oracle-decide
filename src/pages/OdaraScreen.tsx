import { motion, AnimatePresence, PanInfo, useMotionValue, useTransform } from "framer-motion";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import LayerCard from "@/components/LayerCard";
import type { LayerMood, LayerModes, LayerModeEntry } from "@/components/ModeSelector";
import { LAYER_MOODS } from "@/components/ModeSelector";
import { normalizeNotes } from "@/lib/normalizeNotes";

/* ── Live fetch replaces old test query ── */

/** Display-only: strip trailing filler like "for Men", "for Women", "Eau de Parfum" etc.,
 *  and remove the brand name when it appears as a suffix in the fragrance name. */
function getDisplayName(name: string, brand?: string | null): string {
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
  };
  layer?: Record<LayerMood, LayerOption> | null;
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

function buildForecastDays(): ForecastDay[] {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  const weekFragrances: (FragranceEntry & { temperature: number; reason: string })[] = [
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440001', name: 'Valley of the Kings', family: 'oud-amber', reason: 'Dark amber lane fits your strongest scent identity.', temperature: 42, longevity_score: 0.9, projection_score: 0.85 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440003', name: 'Agar', family: 'woody-clean', reason: 'Clean woody undertones for a grounded midweek reset.', temperature: 55, longevity_score: 0.6, projection_score: 0.45 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440006', name: 'Noire Absolu', family: 'dark-leather', reason: 'Raw leather intensity for a commanding presence.', temperature: 38, longevity_score: 0.95, projection_score: 0.9 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440007', name: 'Santal Sérénade', family: 'sweet-gourmand', reason: 'Creamy sandalwood warmth for effortless comfort.', temperature: 62, longevity_score: 0.7, projection_score: 0.3 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440004', name: 'Hafez 1984', family: 'tobacco-boozy', reason: 'Smoky depth that lingers through the evening.', temperature: 45, longevity_score: 0.85, projection_score: 0.8 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440002', name: 'Mystere 28', family: 'fresh-blue', reason: 'Bright aquatic lift for a weekend refresh.', temperature: 72, longevity_score: 0.45, projection_score: 0.5 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440008', name: 'Amber Dusk', family: 'oud-amber', reason: 'Warm amber close to round out the week.', temperature: 48, longevity_score: 0.65, projection_score: 0.5 },
  ];

  const allEntries: FragranceEntry[] = weekFragrances.map(f => ({
    fragrance_id: f.fragrance_id, name: f.name, family: f.family, reason: f.reason,
    longevity_score: f.longevity_score, projection_score: f.projection_score,
  }));

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const frag = weekFragrances[i];
    const baseEntry: FragranceEntry = {
      fragrance_id: frag.fragrance_id, name: frag.name, family: frag.family, reason: frag.reason,
      longevity_score: frag.longevity_score, projection_score: frag.projection_score,
    };
    const dailySet = recommendDailySet(baseEntry, allEntries, i);

    let layerMap: Record<LayerMood, LayerOption> | null = null;
    if (dailySet.is_layered && dailySet.layer) {
      const layerOption: LayerOption = {
        base_id: frag.fragrance_id, anchor_name: frag.name,
        top_id: dailySet.layer.fragrance_id, top_name: dailySet.layer.name,
        top: `Layer with ${dailySet.layer.name}`, mode: "balance",
        reason: dailySet.reasoning, why_it_works: dailySet.reasoning,
        anchor_sprays: 3, top_sprays: 1,
        anchor_placement: "Neck, chest", top_placement: "Wrists",
        strength_note: `A balanced blend of ${frag.name} and ${dailySet.layer.name}`,
      };
      layerMap = {
        balance: layerOption,
        bold: { ...layerOption, mode: "amplify", top_sprays: 2, top_placement: "Neck, wrists" },
        smooth: { ...layerOption, mode: "soften", top_sprays: 1, anchor_sprays: 2 },
        wild: { ...layerOption, mode: "contrast", top_sprays: 2, top_placement: "Clothes, hair" },
      };
    }

    return {
      label: dayNames[d.getDay()], day: d.getDate(),
      fragrance: { fragrance_id: frag.fragrance_id, name: frag.name, family: frag.family, reason: frag.reason },
      temperature: frag.temperature, layer: layerMap, alternates: null, dailySet,
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
    oracle: OracleData;
    mainNotes: string[] | null;
    mainAccords: string[] | null;
    layerModes: LayerModes;
    mainProjection: number | null;
    selectedMood: LayerMood;
    selectedRatio: string;
    layerFragrance: { id: string; name: string; family_key: string } | null;
  }
  const lockedRecipes = useRef<Record<string, LockedRecipe>>({});
  const [liveTemperature, setLiveTemperature] = useState<number | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [manualTemperatureOverride, setManualTemperatureOverride] = useState<number | null>(null);
  // 3-state selection: neutral / selected / undo-ready
  const [selectionState, setSelectionState] = useState<"neutral" | "selected" | "undo-ready">("neutral");
  const [lockFlashColor, setLockFlashColor] = useState<string | null>(null);
  const [cardExiting, setCardExiting] = useState(false);
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

  // Swipe feedback removed — silent UI

  // Direction locking for gestures
  const dragDirection = useRef<"none" | "horizontal" | "vertical">("none");
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const LOCK_THRESHOLD = 12; // px before direction locks

  const effectiveTemperature = manualTemperatureOverride ?? liveTemperature ?? 40;
  const forecastDays = useMemo(() => buildForecastDays(), []);

  // Continuous timepiece orb position
  const [orbPosition, setOrbPosition] = useState(0);
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const msInDay = 24 * 60 * 60 * 1000;
      const dayProgress = (now.getTime() - startOfDay.getTime()) / msInDay;
      setOrbPosition(dayProgress);
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

  const getUserId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? "00000000-0000-0000-0000-000000000000";
  }, []);

  const fetchOracle = useCallback(async (ctx?: string, temp?: number, excludeId?: string) => {
    setLoading(true);
    setError(false);
    setExitDirection(null);
    setSelectionState("neutral");
    try {
      const userId = await getUserId();
      const contextVal = ctx ?? selectedContext ?? "daily";
      const tempVal = temp ?? effectiveTemperature ?? 25;

      const rpcParams = {
        p_user_id: userId,
        p_temperature: tempVal,
        p_context: contextVal,
        p_brand: null,
      };

      const { data: rpcResult, error: rpcErr } = await supabase
        .rpc('get_todays_oracle_v3', rpcParams);

      if (rpcErr) throw rpcErr;
      const result = rpcResult as any;
      const pick = result.today_pick;

      console.log('[ODARA] Oracle RPC result:', result);

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

      // Fetch layer candidates from the table (context-independent diversity scoring)
      const excludeIds = [pick.fragrance_id, ...liveAlternates.map((a: any) => a.fragrance_id)];
      const { data: layerRows } = await supabase
        .from('fragrances')
        .select('id, name, brand, family_key, notes, accords, projection')
        .not('id', 'in', `(${excludeIds.join(',')})`)
        .not('family_key', 'is', null)
        .limit(20);

      const newLayerModes = pickDiverseLayerModes(layerRows ?? [], pick.family ?? '');
      setLayerModes(newLayerModes);
      setLayerFragrance(newLayerModes.balance ?? null);
      setSelectedMood('balance');

      const liveOracle: OracleData = {
        today_pick: {
          fragrance_id: pick.fragrance_id,
          name: pick.name,
          family: pick.family ?? '',
          reason: pick.reason ?? pick.brand ?? '',
        },
        layer: null,
        alternates: liveAlternates,
      };
      setOracle(liveOracle);
      setCardKey((k) => k + 1);
    } catch (e) {
      console.error("Oracle fetch failed:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [selectedContext, effectiveTemperature, getUserId]);

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

  // Only fetch oracle on mount or when fetchOracle deps change,
  // but skip if a locked recipe already exists for the current context
  useEffect(() => {
    if (lockedRecipes.current[selectedContext]) {
      console.log('ODARA skipping fetchOracle — locked recipe exists for', selectedContext);
      // Restore the locked recipe instead
      const recipe = lockedRecipes.current[selectedContext];
      setOracle(recipe.oracle);
      setMainNotes(recipe.mainNotes);
      setMainAccords(recipe.mainAccords);
      setLayerModes(recipe.layerModes);
      setMainProjection(recipe.mainProjection);
      setSelectedMood(recipe.selectedMood);
      setSelectedRatio(recipe.selectedRatio);
      setLayerFragrance(recipe.layerFragrance);
      setSelectionState("selected");
      setLoading(false);
      setCardKey((k) => k + 1);
      return;
    }
    fetchOracle();
  }, [fetchOracle]);

  const handleAccept = useCallback(async () => {
    if (actionState !== "idle") return;
    const isViewingForecastNow = selectedForecastDay > 0;
    const entry = isViewingForecastNow ? forecastDays[selectedForecastDay]?.fragrance : oracle?.today_pick;
    if (!entry?.fragrance_id) return;

    setActionState("accepting");
    try {
      const userId = await getUserId();
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
      const userId = await getUserId();
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
    if (actionState !== "idle" || !alt.fragrance_id) return;
    // Phase 1: simply load the tapped fragrance as main card from live Supabase
    loadFragranceById(alt.fragrance_id);
  }, [actionState, loadFragranceById]);

  const isBusy = actionState !== "idle";

  // Loading skeleton
  if (loading) {
    return (
      <div className="dark">
        <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-0 overflow-hidden">
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
    setSelectedForecastDay(index);
    setLayerSheetOpen(false);
    setCardKey((k) => k + 1);
    setExitDirection(null);
    const dayTemp = forecastDays[index]?.temperature;
    if (dayTemp != null) setDisplayedTemperature(dayTemp);
    else setDisplayedTemperature(null);
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
          <header className="flex flex-col items-center pb-6">
            <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">ODARA</span>
          </header>

          {/* Context chips */}
          <div className="flex gap-1.5">
            {CONTEXTS.map((ctx) => (
              <button
                key={ctx}
                onClick={() => {
                  setSelectedContext(ctx);
                  // Restore locked recipe if one exists for this context
                  console.log('ODARA context switch', ctx);
                  console.log('ODARA found locked recipe', lockedRecipes.current[ctx]);
                  const recipe = lockedRecipes.current[ctx];
                  if (recipe) {
                    console.log('ODARA restoring locked recipe for', ctx);
                    setOracle(recipe.oracle);
                    setMainNotes(recipe.mainNotes);
                    setMainAccords(recipe.mainAccords);
                    setLayerModes(recipe.layerModes);
                    setMainProjection(recipe.mainProjection);
                    setSelectedMood(recipe.selectedMood);
                    setSelectedRatio(recipe.selectedRatio);
                    setLayerFragrance(recipe.layerFragrance);
                    setSelectionState("selected");
                    setLoading(false);
                    setCardKey((k) => k + 1);
                  } else {
                    fetchOracle(ctx, selectedTemperature);
                  }
                }}
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
                if (
                  (offset.x < -hThreshold || velocity.x < -hVel) &&
                  selectedForecastDay < forecastDays.length - 1
                ) {
                  const next = selectedForecastDay + 1;
                  setSelectedForecastDay(next);
                  setLayerSheetOpen(false);
                  const dayTemp = forecastDays[next]?.temperature;
                  if (dayTemp != null) setDisplayedTemperature(dayTemp);
                } else if (
                  (offset.x > hThreshold || velocity.x > hVel) &&
                  selectedForecastDay > 0
                ) {
                  const prev = selectedForecastDay - 1;
                  setSelectedForecastDay(prev);
                  setLayerSheetOpen(false);
                  const dayTemp = forecastDays[prev]?.temperature;
                  if (dayTemp != null) setDisplayedTemperature(dayTemp);
                }
              } else if (dir === "vertical") {
                const vThreshold = 60;
                const vVel = 200;
                // Swipe UP = choose (lock in)
                if (offset.y < -vThreshold || velocity.y < -vVel) {
                  if (selectionState === "neutral") {
                    setSelectionState("selected");
                    setLockFlashColor("#22c55e");
                    setTimeout(() => setLockFlashColor(null), 400);
                    setSkipHistory([]);
                    // Store full recipe for this context
                    if (oracle) {
                      const recipe: LockedRecipe = {
                        context: selectedContext,
                        oracle,
                        mainNotes,
                        mainAccords,
                        layerModes,
                        mainProjection,
                        selectedMood,
                        selectedRatio,
                        layerFragrance,
                      };
                      lockedRecipes.current[selectedContext] = recipe;
                      console.log('ODARA saved locked recipe', selectedContext, recipe);
                    }
                    handleAccept();
                  }
                }
                // Swipe DOWN from selected = yellow undo-ready (no skip yet)
                // Swipe DOWN from undo-ready = red skip
                else if (offset.y > vThreshold || velocity.y > vVel) {
                  if (selectionState === "selected") {
                    setSelectionState("undo-ready");
                    setLockFlashColor("#eab308");
                    setTimeout(() => setLockFlashColor(null), 400);
                  } else if (selectionState === "undo-ready" || selectionState === "neutral") {
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
              if (i !== 0) return null;
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
                        {getDisplayName(cardPick.name, cardPick.reason)}
                      </h1>

                      {/* Brand name — from live Supabase data */}
                      {cardPick.reason && (
                        <p className="text-[11px] text-center tracking-[0.12em] text-muted-foreground/70 mb-1 select-none">
                          {cardPick.reason}
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
                        mainBrand={cardPick.reason}
                        mainNotes={mainNotes}
                        mainFamily={cardPick.family ?? null}
                        mainProjection={mainProjection}
                        layerModes={layerModes}
                        selectedMood={selectedMood}
                        onSelectMood={(mood) => {
                          setSelectedMood(mood);
                          setLayerFragrance(layerModes[mood]);
                        }}
                        selectedRatio={selectedRatio}
                        onSelectRatio={setSelectedRatio}
                        isExpanded={layerSheetOpen}
                        onToggleExpand={() => setLayerSheetOpen((o) => !o)}
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
                                    disabled={isBusy}
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
                              <path d={selectionState === "selected"
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
                          {selectionState === "selected" ? (
                            <Lock
                              size={16}
                              className="transition-all duration-200"
                              style={{
                                color: "#22c55e",
                                filter: `drop-shadow(0 0 4px rgba(34,197,94,0.5))`,
                              }}
                            />
                          ) : selectionState === "undo-ready" ? (
                            <LockOpen
                              size={16}
                              className="transition-all duration-200"
                              style={{
                                color: "#eab308",
                                filter: `drop-shadow(0 0 4px rgba(234,179,8,0.5))`,
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
          <div className="relative">
            {/* White orb — continuous time indicator, moves across the orb lane */}
            {(() => {
              // progress: 0.0 = midnight (start of today), 1.0 = midnight (start of tomorrow)
              const progress = orbPosition;
              // Fade-out zone: 80% → 100% the orb tightens and fades before midnight handoff
              const FADE_START = 0.80;
              const fade = progress >= FADE_START
                ? 1 - ((progress - FADE_START) / (1 - FADE_START))
                : 1;
              // Glow tightens as orb approaches next day
              const glowScale = progress >= FADE_START ? fade : 1;
              // Position: orb travels from column 0 center to column 1 center
              // In a 7-col flex justify-between, each column center is at (i / 6) * 100%
              // So col 0 = 0%, col 1 = 16.667%
              const colCenterPct = (progress / 6) * 100;
              return (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    // The orb lane sits at the same vertical position as the per-column orb lanes
                    // weekday label height (~15px) + marginBottom 4px = 19px offset, centered in 11px lane
                    top: "19px",
                    left: 0,
                    right: 0,
                    height: "11px",
                    zIndex: 10,
                  }}
                >
                  <div
                    className="absolute"
                    style={{
                      left: `${colCenterPct}%`,
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    <div
                      className="rounded-full"
                      style={{
                        width: "6px",
                        height: "6px",
                        background: "white",
                        opacity: Math.max(0, fade),
                        boxShadow: `0 0 ${4 * glowScale}px ${2 * glowScale}px rgba(255,255,255,${(0.15 * fade).toFixed(3)}), 0 0 ${10 * glowScale}px ${4 * glowScale}px rgba(255,255,255,${(0.06 * fade).toFixed(3)})`,
                        animation: fade > 0.1 ? "orbBreathe 4s ease-in-out infinite 2s" : "none",
                        transition: "opacity 0.5s ease, box-shadow 0.5s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Day markers */}
            <div className="flex justify-between relative">
              {forecastDays.map((d, i) => {
                const FALLBACK_ORB_COLOR = "rgba(255,255,255,0.18)";
                const familyColor = d.fragrance
                  ? (FAMILY_COLORS[d.fragrance.family] ?? FALLBACK_ORB_COLOR)
                  : FALLBACK_ORB_COLOR;
                const isSelected = selectedForecastDay === i;
                const hasFragrance = !!d.fragrance;

                const FADE_ZONE = 0.20;
                const distToDay = i - orbPosition;
                const isNextTarget = i === 1 && distToDay > 0 && distToDay <= FADE_ZONE;
                const handoffGlow = isNextTarget ? 1 - (distToDay / FADE_ZONE) : 0;
                const isCurrentOrbDay = i === 0;

                const labelOpacity = isSelected ? 0.95 : isCurrentOrbDay ? 0.65 : isNextTarget ? 0.45 + handoffGlow * 0.3 : 0.45;
                const dateOpacity = isSelected ? 0.75 : isNextTarget ? 0.35 + handoffGlow * 0.2 : 0.35;

                const isLayered = d.dailySet?.is_layered ?? false;
                const layerFamily = d.dailySet?.layer?.family;
                const layerColor = layerFamily ? (FAMILY_COLORS[layerFamily] ?? FALLBACK_ORB_COLOR) : FALLBACK_ORB_COLOR;

                return (
                  <button
                    key={i}
                    onClick={() => handleForecastDayTap(i)}
                    className="flex flex-col items-center justify-start bg-transparent border-none outline-none cursor-pointer"
                    style={{ minWidth: "28px", width: "28px" }}
                  >
                    <span
                      className="font-mono transition-all duration-200 text-center leading-none"
                      style={{
                        fontSize: "11px", letterSpacing: "0.1em",
                        color: `rgba(255,255,255,${Math.min(labelOpacity + 0.15, 1)})`,
                        fontWeight: isSelected ? 600 : (isNextTarget && handoffGlow > 0.5) ? 500 : i === 0 ? 500 : 450,
                        marginBottom: "4px",
                      }}
                    >
                      {d.label}
                    </span>

                    {/* Orb lane spacer — orb is now absolutely positioned above */}
                    <div style={{ height: "11px", marginBottom: "3px" }} />

                    <span
                      className="font-mono text-center leading-none transition-all duration-200"
                      style={{
                        fontSize: "13px",
                        fontWeight: isSelected ? 600 : 500,
                        color: `rgba(255,255,255,${Math.min(dateOpacity + 0.15, 1)})`,
                        marginBottom: "7px",
                      }}
                    >
                      {d.day}
                    </span>

                    <div className="flex flex-col items-center justify-center" style={{ height: "26px", gap: "6px" }}>
                      <motion.div
                        className="rounded-full"
                        animate={{
                          width: isSelected ? "9px" : "7px",
                          height: isSelected ? "9px" : "7px",
                          scale: isSelected ? 1.1 : isNextTarget ? 1 + handoffGlow * 0.05 : 1,
                          boxShadow: isSelected
                            ? `0 0 8px 3px ${familyColor}55`
                            : isNextTarget
                              ? `0 0 ${3 + handoffGlow * 4}px ${1 + handoffGlow * 2}px ${familyColor}${Math.round(0x22 + handoffGlow * 0x33).toString(16)}`
                              : hasFragrance
                                ? `0 0 3px 1px ${familyColor}22`
                                : `0 0 3px 1px ${FALLBACK_ORB_COLOR}`,
                          opacity: hasFragrance ? 1 : 0.5,
                        }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        style={{ background: familyColor }}
                      />

                      {isLayered && (
                        <motion.div
                          className="rounded-full"
                          initial={{ opacity: 0, scale: 0 }}
                          animate={{
                            opacity: 0.85, scale: 1,
                            width: isSelected ? "7px" : "6px",
                            height: isSelected ? "7px" : "6px",
                            boxShadow: isSelected
                              ? `0 0 6px 2px ${layerColor}44`
                              : `0 0 2px 1px ${layerColor}22`,
                          }}
                          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                          style={{ background: layerColor }}
                        />
                      )}
                    </div>

                    {isSelected && (
                      <motion.div
                        layoutId="forecastUnderline"
                        className="rounded-full"
                        style={{ width: "14px", height: "1px", background: "rgba(255,255,255,0.3)", marginTop: "3px" }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
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
