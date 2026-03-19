import { motion, AnimatePresence, PanInfo, useMotionValue, useTransform } from "framer-motion";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Lock, LockOpen, X, ChevronUp, ChevronDown } from "lucide-react";

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

type LayerMood = 'balanced' | 'bold' | 'smooth' | 'wild';

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

const LAYER_MOODS: LayerMood[] = ['balanced', 'bold', 'smooth', 'wild'];

type ActionState = "idle" | "accepting" | "skipping" | "rebuilding";


const CONTEXTS = ["daily", "office", "hangout", "date"] as const;
const TEMPERATURES = [35, 50, 65, 80] as const;

/* ── Fragrance family → color mapping (expanded with tint HSL values) ── */
const FAMILY_COLORS: Record<string, string> = {
  "oud-amber": "#C08A3E",
  "fresh-blue": "#5B9BD5",
  "woody-clean": "#6B9B7A",
  "sweet-gourmand": "#D4A056",
  "dark-leather": "#8B3A3A",
  "tobacco-boozy": "#6B4226",
  "floral-musk": "#C4A0B9",
  "citrus-aromatic": "#B8C94E",
  "citrus-cologne": "#E8D44D",
};

/* Family → tint colors for card backgrounds (subtle, desaturated) */
const FAMILY_TINTS: Record<string, { bg: string; glow: string; border: string }> = {
  "fresh-blue":      { bg: "rgba(91,155,213,0.06)",  glow: "rgba(91,155,213,0.15)",  border: "rgba(91,155,213,0.12)" },
  "sweet-gourmand":  { bg: "rgba(212,160,86,0.06)",  glow: "rgba(212,160,86,0.15)",  border: "rgba(212,160,86,0.12)" },
  "oud-amber":       { bg: "rgba(192,138,62,0.07)",  glow: "rgba(192,138,62,0.18)",  border: "rgba(192,138,62,0.14)" },
  "dark-leather":    { bg: "rgba(139,58,58,0.06)",   glow: "rgba(139,58,58,0.15)",   border: "rgba(139,58,58,0.12)" },
  "woody-clean":     { bg: "rgba(107,155,122,0.06)", glow: "rgba(107,155,122,0.15)", border: "rgba(107,155,122,0.12)" },
  "tobacco-boozy":   { bg: "rgba(107,66,38,0.07)",   glow: "rgba(107,66,38,0.18)",   border: "rgba(107,66,38,0.14)" },
  "citrus-cologne":  { bg: "rgba(232,212,77,0.05)",  glow: "rgba(232,212,77,0.12)",  border: "rgba(232,212,77,0.10)" },
  "citrus-aromatic": { bg: "rgba(184,201,78,0.05)",  glow: "rgba(184,201,78,0.12)",  border: "rgba(184,201,78,0.10)" },
  "floral-musk":     { bg: "rgba(196,160,185,0.05)", glow: "rgba(196,160,185,0.12)", border: "rgba(196,160,185,0.10)" },
};

const DEFAULT_TINT = { bg: "rgba(255,255,255,0.03)", glow: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.08)" };

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
        balanced: layerOption,
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

const OdaraScreen = () => {
  const [oracle, setOracle] = useState<OracleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const [cardKey, setCardKey] = useState(0);
  const swipeLocked = useRef(false);
  const [selectedContext, setSelectedContext] = useState<string>("daily");
  const [selectedTemperature, setSelectedTemperature] = useState<number>(40);
  const [layerSheetOpen, setLayerSheetOpen] = useState(false);
  const [selectedMood, setSelectedMood] = useState<LayerMood>('balanced');
  const [liveTemperature, setLiveTemperature] = useState<number | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [manualTemperatureOverride, setManualTemperatureOverride] = useState<number | null>(null);
  const [layerSaved, setLayerSaved] = useState(false);
  const [lockPulse, setLockPulse] = useState(false);
  const [selectedForecastDay, setSelectedForecastDay] = useState(0);
  const [displayedTemperature, setDisplayedTemperature] = useState<number | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Swipe feedback state
  const [swipeFeedback, setSwipeFeedback] = useState<"up" | "down" | null>(null);

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

  const fetchOracle = useCallback(async (ctx?: string, temp?: number) => {
    setLoading(true);
    setError(false);
    setExitDirection(null);
    try {
      const userId = await getUserId();
      const t = temp ?? effectiveTemperature;
      const { data, error: rpcError } = await supabase.rpc(
        "get_todays_oracle_v3",
        { p_user_id: userId, p_temperature: t, p_context: ctx ?? selectedContext }
      );
      if (rpcError) throw rpcError;
      setOracle(data as unknown as OracleData);
      setCardKey((k) => k + 1);
    } catch (e) {
      console.error("Oracle fetch failed:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getUserId, selectedContext, effectiveTemperature]);

  useEffect(() => { fetchOracle(); }, [fetchOracle]);

  const handleAccept = useCallback(async () => {
    if (actionState !== "idle") return;
    const isViewingForecastNow = selectedForecastDay > 0;
    const entry = isViewingForecastNow ? forecastDays[selectedForecastDay]?.fragrance : oracle?.today_pick;
    if (!entry?.fragrance_id) return;

    setActionState("accepting");
    // Show swipe-up feedback
    setSwipeFeedback("up");
    try {
      const userId = await getUserId();
      const { error: rpcError } = await supabase.rpc("accept_today_pick_v1" as any, {
        p_user: userId,
        p_fragrance_id: entry.fragrance_id,
        p_context: selectedContext,
      });
      if (rpcError) throw rpcError;
      toast.success(`${entry.name} — wearing today`);
    } catch (e) {
      console.error("Accept failed:", e);
      toast.error("Couldn't confirm — try again");
    } finally {
      setTimeout(() => setSwipeFeedback(null), 600);
      setActionState("idle");
      swipeLocked.current = false;
    }
  }, [actionState, oracle, getUserId, selectedForecastDay, forecastDays, selectedContext]);

  const handleSkip = useCallback(async () => {
    if (actionState !== "idle" || !oracle?.today_pick?.fragrance_id) return;
    setActionState("skipping");
    setSwipeFeedback("down");
    try {
      const userId = await getUserId();
      const { error: rpcError } = await supabase.rpc("skip_today_pick_v1" as any, {
        p_user: userId,
        p_fragrance_id: oracle.today_pick.fragrance_id,
        p_context: selectedContext,
      });
      if (rpcError) throw rpcError;
      toast("Skipped — next option");
      await fetchOracle();
    } catch (e) {
      console.error("Skip failed:", e);
      toast.error("Couldn't skip — try again");
    } finally {
      setTimeout(() => setSwipeFeedback(null), 600);
      setActionState("idle");
      swipeLocked.current = false;
    }
  }, [actionState, oracle, getUserId, fetchOracle]);

  const handleAlternateTap = useCallback((alt: { fragrance_id?: string; name: string; family?: string; reason?: string }) => {
    if (actionState !== "idle" || !oracle) return;
    setActionState("rebuilding");
    const oldPick = oracle.today_pick;
    const remainingAlts = (oracle.alternates ?? []).filter((a) => a.name !== alt.name);
    const newAlts = [
      { fragrance_id: oldPick.fragrance_id, name: oldPick.name, family: oldPick.family, reason: oldPick.reason },
      ...remainingAlts,
    ].filter((a) => a.name !== alt.name);

    setExitDirection("left");
    setTimeout(() => {
      setOracle({
        today_pick: { fragrance_id: alt.fragrance_id, name: alt.name, family: alt.family ?? "", reason: alt.reason ?? "" },
        layer: null,
        alternates: newAlts.slice(0, 3),
      });
      setExitDirection(null);
      setCardKey((k) => k + 1);
      setActionState("idle");
    }, 300);
  }, [actionState, oracle]);

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
          <div className="w-full max-w-md rounded-[32px] p-8 flex flex-col items-center gap-4" style={{ background: "var(--glass-bg)" }}>
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

  const isViewingForecast = selectedForecastDay > 0;
  const forecastEntry = forecastDays[selectedForecastDay];
  const today_pick = isViewingForecast && forecastEntry?.fragrance
    ? forecastEntry.fragrance
    : oraclePick;
  const currentLayerMap = isViewingForecast ? forecastEntry?.layer ?? null : layerMap;
  const alternates = isViewingForecast ? forecastEntry?.alternates : oracleAlternates;
  const hasLayer = currentLayerMap != null;
  const activeLayer = hasLayer ? currentLayerMap[selectedMood] : null;
  const hasAlternates = alternates != null && alternates.length > 0;

  const bgTintColor = today_pick?.family ? (FAMILY_COLORS[today_pick.family] ?? null) : null;

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
        {/* Header */}
        <header className="flex flex-col items-center pt-12 pb-6">
          <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">ODARA</span>
        </header>

        {/* Context chips */}
        <div className="flex gap-1.5 mb-3">
          {CONTEXTS.map((ctx) => (
            <button
              key={ctx}
              onClick={() => {
                setSelectedContext(ctx);
                fetchOracle(ctx, selectedTemperature);
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

        {/* Temperature Scale */}
        {(() => {
          const TRACK_MIN = 28;
          const TRACK_MAX = 87;
          const BENCHMARKS = [35, 50, 65, 80];
          const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
          const tempToShow = displayedTemperature ?? effectiveTemperature;
          const pct = ((clamp(tempToShow, TRACK_MIN, TRACK_MAX) - TRACK_MIN) / (TRACK_MAX - TRACK_MIN)) * 100;

          return (
            <div className="w-full max-w-md mb-6 px-2">
              <div className="relative w-full" style={{ height: "40px" }}>
                <div className="absolute w-full h-[2px] rounded-full bg-foreground/10" style={{ top: "25px" }} />
                <motion.div
                  className="absolute -translate-x-1/2 flex flex-col items-center"
                  style={{ top: "0px" }}
                  animate={{ left: `${pct}%` }}
                  transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                >
                  <span className="text-[10px] font-mono text-muted-foreground/70 select-none mb-1">
                    {tempToShow}°
                  </span>
                  <motion.div
                    className="rounded-full"
                    whileHover={{ scale: 1.4, boxShadow: "0 0 6px 3px rgba(255,255,255,0.25), 0 0 14px 6px rgba(255,255,255,0.1)" }}
                    whileTap={{ scale: 1.2 }}
                    style={{
                      width: "7px", height: "7px",
                      background: "white",
                      boxShadow: "0 0 4px 2px rgba(255,255,255,0.15), 0 0 10px 4px rgba(255,255,255,0.06)",
                      animation: "orbBreathe 4s ease-in-out infinite",
                    }}
                  />
                </motion.div>
              </div>

              <div className="relative w-full mt-1" style={{ height: "20px" }}>
                {BENCHMARKS.map((temp) => {
                  const tickPct = ((temp - TRACK_MIN) / (TRACK_MAX - TRACK_MIN)) * 100;
                  return (
                    <button
                      key={temp}
                      onClick={() => {
                        setManualTemperatureOverride(temp);
                        setSelectedTemperature(temp);
                        fetchOracle(selectedContext, temp);
                      }}
                      disabled={isBusy || loading}
                      className="absolute -translate-x-1/2 -top-1 flex flex-col items-center group disabled:opacity-40"
                      style={{ left: `${tickPct}%` }}
                    >
                      <div className="w-[3px] h-[10px] rounded-full bg-foreground/20 group-hover:bg-foreground/40 transition-colors" />
                      <span className="text-[9px] font-mono text-muted-foreground/40 mt-1 group-hover:text-muted-foreground/70 transition-colors select-none">
                        {temp}°
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}


        {/* Cover Flow Card Stack — magnet: shifts up when layer expands */}
        <motion.div
          className="relative w-full max-w-lg mt-3 overflow-visible"
          style={{ perspective: "1200px" }}
          animate={{ y: layerSheetOpen ? -18 : 0 }}
          transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {/* Gesture hint indicators */}
          <AnimatePresence>
            {swipeFeedback === "up" && (
              <motion.div
                key="feedback-up"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: -8 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
                className="absolute -top-10 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2"
              >
                <ChevronUp size={14} className="text-foreground/60" />
                <span className="text-[11px] uppercase tracking-[0.15em] text-foreground/80 font-medium">Wearing this</span>
              </motion.div>
            )}
            {swipeFeedback === "down" && (
              <motion.div
                key="feedback-down"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 8 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
                className="absolute -bottom-10 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2"
              >
                <ChevronDown size={14} className="text-muted-foreground/60" />
                <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground/60 font-medium">Not today</span>
              </motion.div>
            )}
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
                // Swipe UP = accept / wear
                if (offset.y < -vThreshold || velocity.y < -vVel) {
                  handleAccept();
                }
                // Swipe DOWN = skip
                else if (offset.y > vThreshold || velocity.y > vVel) {
                  handleSkip();
                }
              }
            }}
          >
            {forecastDays.map((dayData, i) => {
              const offset = i - selectedForecastDay;
              const absOffset = Math.abs(offset);
              const isCenter = offset === 0;

              if (absOffset > 3) return null;

              const cardPick = i === 0 && oracle ? oraclePick : dayData.fragrance;
              const cardLayerMap = i === 0 ? layerMap : dayData.layer;
              const cardAlternates = i === 0 ? oracleAlternates : dayData.alternates;
              const cardHasLayer = cardLayerMap != null;
              const cardActiveLayer = cardHasLayer ? cardLayerMap[selectedMood] : null;
              const cardHasAlternates = cardAlternates != null && cardAlternates.length > 0;

              if (!cardPick) return null;

              // Family color tinting
              const familyTint = FAMILY_TINTS[cardPick.family] ?? DEFAULT_TINT;
              const familyColor = FAMILY_COLORS[cardPick.family] ?? "#888";

              // Cover flow transforms
              const scale = isCenter ? 1 : Math.max(0.88, 1 - absOffset * 0.05);
              const rotateY = offset * -22;
              const translateX = offset * 90;
              const translateZ = isCenter ? 40 : -absOffset * 50;
              const opacity = isCenter ? 1 : Math.max(0.55, 0.75 - absOffset * 0.12);
              const blur = isCenter ? 0 : Math.min(absOffset * 1.5, 4);
              const zIndex = 10 - absOffset;

              // Swipe feedback animation for center card
              const feedbackY = isCenter && swipeFeedback === "up" ? -8 : isCenter && swipeFeedback === "down" ? 8 : 0;
              const feedbackScale = isCenter && swipeFeedback ? 0.97 : scale;
              const feedbackGlow = isCenter && swipeFeedback === "up"
                ? `0 -8px 30px -5px ${familyColor}30`
                : isCenter && swipeFeedback === "down"
                  ? `0 8px 20px -5px rgba(0,0,0,0.4)`
                  : "";

              return (
                <motion.div
                  key={`coverflow-${i}`}
                  className="absolute w-full max-w-md"
                  animate={{
                    x: translateX,
                    y: feedbackY,
                    rotateY,
                    scale: feedbackScale,
                    opacity: isCenter && swipeFeedback === "down" ? 0.6 : opacity,
                    z: translateZ,
                  }}
                  transition={{
                    duration: 0.45,
                    ease: [0.32, 0.72, 0, 1],
                  }}
                  style={{
                    zIndex,
                    filter: blur > 0 ? `blur(${blur}px)` : undefined,
                    transformStyle: "preserve-3d",
                    pointerEvents: isCenter ? "auto" : "none",
                  }}
                >
                  <div
                    className={`w-full rounded-[32px] p-8 flex flex-col items-center relative ${
                      isCenter ? "cursor-pointer" : ""
                    }`}
                    onClick={() => {
                      if (!isCenter) return;
                      if (longPressTimer.current) return;
                      handleAccept();
                    }}
                    style={{
                      background: isCenter
                        ? `linear-gradient(180deg, ${familyTint.bg} 0%, rgba(255,255,255,0.02) 50%, ${familyTint.bg} 100%), rgba(10,10,12,0.88)`
                        : `linear-gradient(180deg, ${familyTint.bg} 0%, rgba(255,255,255,0.01) 100%), rgba(18,18,22,0.82)`,
                      backdropFilter: isCenter ? "blur(40px) saturate(1.2)" : "blur(16px) saturate(1.1)",
                      boxShadow: isCenter
                        ? `0 25px 60px -15px rgba(0,0,0,0.7), 0 8px 24px -8px rgba(0,0,0,0.5), inset 0 1px 0 0 rgba(255,255,255,0.1), inset 0 0 0 1px ${familyTint.border}, 0 0 40px -10px ${familyTint.glow}${feedbackGlow ? `, ${feedbackGlow}` : ""}`
                        : `0 10px 30px rgba(0,0,0,0.35), inset 0 1px 0 0 rgba(255,255,255,0.06), inset 0 0 0 1px ${familyTint.border}`,
                    }}
                  >
                    {/* Day/date label */}
                    <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/70 mb-2 select-none">
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
                        {cardPick.name}
                      </h1>

                      {/* Brand name */}
                      {FRAGRANCE_BRANDS[cardPick.name] && (
                        <p className="text-[11px] text-center tracking-[0.12em] text-muted-foreground/70 mb-1 select-none">
                          {FRAGRANCE_BRANDS[cardPick.name]}
                        </p>
                      )}

                      {/* Family label with color accent */}
                      <p
                        className="text-xs text-center tracking-[0.2em] mb-5 uppercase select-none"
                        style={{ color: familyColor }}
                      >
                        {cardPick.family}
                      </p>
                    </div>

                    <p className="text-sm text-center text-muted-foreground/80 leading-relaxed px-4 mb-8 text-pretty select-none">
                      {cardPick.reason}
                    </p>

                    {/* Layer Card — only on center */}
                    {isCenter && cardHasLayer && cardActiveLayer && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          setLayerSheetOpen((o) => !o);
                        }}
                        className="w-full rounded-[16px] px-4 py-3 mb-4 flex flex-col items-center text-center cursor-pointer transition-all duration-200 hover:brightness-110 active:scale-[0.98] relative"
                        style={{
                          background: "var(--sub-glass-bg)",
                          boxShadow: "var(--shadow-sub-glass), inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
                        }}
                      >

                        <p className="text-[14px] font-medium text-foreground/90 mb-1 tracking-wide">
                          {cardActiveLayer.top_name ?? cardActiveLayer.top}
                        </p>
                        <span
                          className="text-[9px] text-muted-foreground/80 px-2.5 py-0.5 rounded-full mb-1"
                          style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)" }}
                        >
                          {cardActiveLayer.mode}
                        </span>
                        <span className="text-[9px] text-muted-foreground/35 tracking-[0.1em]">
                          {layerSheetOpen ? "tap to close" : "tap for details"}
                        </span>

                        {/* Expanded details */}
                        <AnimatePresence initial={false}>
                          {layerSheetOpen && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
                              className="w-full overflow-hidden"
                            >
                              <div className="pt-3 mt-2 space-y-3 text-left" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                                {/* Mood selector */}
                                <div className="flex gap-1 justify-center pb-1" onClick={(e) => e.stopPropagation()}>
                                  {LAYER_MOODS.map((mood) => (
                                    <button
                                      key={mood}
                                      onClick={() => setSelectedMood(mood)}
                                      className={`text-[9px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-full transition-all duration-200 ${
                                        selectedMood === mood
                                          ? "bg-foreground/10 text-foreground"
                                          : "text-muted-foreground/40 hover:text-muted-foreground/70"
                                      }`}
                                      style={selectedMood === mood ? { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" } : undefined}
                                    >
                                      {mood}
                                    </button>
                                  ))}
                                </div>

                                <div>
                                  <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">Role</span>
                                  <p className="text-[11px] text-foreground/75 mt-0.5 leading-relaxed">
                                    {cardActiveLayer.top_name} acts as {cardActiveLayer.mode === 'balance' ? 'a balancing accent' : cardActiveLayer.mode === 'amplify' ? 'a bold amplifier' : cardActiveLayer.mode === 'soften' ? 'a softening layer' : 'a contrasting element'} to {cardActiveLayer.anchor_name ?? cardPick.name}
                                  </p>
                                </div>

                                {(cardActiveLayer.why_it_works || cardActiveLayer.reason) && (
                                  <div>
                                    <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">Why this works</span>
                                    <p className="text-[11px] text-foreground/70 mt-0.5 leading-relaxed">
                                      {cardActiveLayer.why_it_works ?? cardActiveLayer.reason}
                                    </p>
                                  </div>
                                )}

                                {(cardActiveLayer.anchor_sprays != null && cardActiveLayer.top_sprays != null) && (
                                  <div>
                                    <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">Spray order</span>
                                    <div className="mt-1 space-y-1">
                                      <div className="flex items-start gap-2">
                                        <span className="text-[9px] font-mono text-muted-foreground/40 mt-px">01</span>
                                        <div>
                                          <p className="text-[11px] text-foreground/80">
                                            <span className="font-mono">{cardActiveLayer.anchor_sprays}×</span> {cardActiveLayer.anchor_name ?? cardPick.name}
                                          </p>
                                          {cardActiveLayer.anchor_placement && (
                                            <p className="text-[10px] text-muted-foreground/45">{cardActiveLayer.anchor_placement}</p>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-start gap-2">
                                        <span className="text-[9px] font-mono text-muted-foreground/40 mt-px">02</span>
                                        <div>
                                          <p className="text-[11px] text-foreground/80">
                                            <span className="font-mono">{cardActiveLayer.top_sprays}×</span> {cardActiveLayer.top_name}
                                          </p>
                                          {cardActiveLayer.top_placement && (
                                            <p className="text-[10px] text-muted-foreground/45">{cardActiveLayer.top_placement}</p>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                <div>
                                  <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">Result</span>
                                  <p className="text-[11px] text-foreground/70 mt-0.5 leading-relaxed">
                                    {cardActiveLayer.strength_note ?? `A ${cardActiveLayer.mode} blend of ${cardActiveLayer.anchor_name ?? cardPick.name} and ${cardActiveLayer.top_name}`}
                                  </p>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* Alternatives */}
                    {isCenter && cardHasAlternates && (
                      <div className="flex gap-2.5 justify-center mb-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 w-full text-center mb-1.5 font-medium">Alternatives</span>
                        {cardAlternates!.map((alt) => (
                          <motion.button
                            key={alt.name}
                            whileHover={{ backgroundColor: "rgba(255,255,255,0.10)" }}
                            whileTap={{ scale: 0.93 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAlternateTap(alt);
                            }}
                            disabled={isBusy}
                            className="text-[13px] text-foreground/80 rounded-full px-5 py-2.5 transition-colors disabled:opacity-40 font-medium"
                            style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.12)", minHeight: "40px" }}
                          >
                            {alt.name}
                          </motion.button>
                        ))}
                      </div>
                    )}

                    {/* Lock pulse radiation */}
                    {isCenter && (
                      <AnimatePresence>
                        {lockPulse && (
                          <motion.div
                            key="lock-pulse"
                            className="absolute bottom-5 right-5 rounded-full pointer-events-none"
                            style={{ width: 20, height: 20 }}
                            initial={{ scale: 1, opacity: 0.5 }}
                            animate={{ scale: 18, opacity: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.7, ease: [0.2, 0, 0, 1] }}
                            onAnimationComplete={() => setLockPulse(false)}
                          >
                            <div
                              className="w-full h-full rounded-full"
                              style={{ background: `radial-gradient(circle, ${familyColor}30 0%, transparent 70%)` }}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    )}

                    {/* Lock toggle — bottom-right */}
                    {isCenter && (
                      <motion.button
                        onClick={(e) => {
                          e.stopPropagation();
                          const willLock = !layerSaved;
                          setLayerSaved(willLock);
                          if (willLock) setLockPulse(true);
                          toast(willLock ? "Locked in" : "Unlocked");
                        }}
                        whileTap={{ scale: 1.15 }}
                        className="absolute bottom-5 right-5 p-2 rounded-full z-10"
                        style={{
                          background: layerSaved ? `${familyColor}18` : "transparent",
                        }}
                      >
                        <motion.div
                          animate={layerSaved
                            ? { scale: [1, 1.05, 1] }
                            : { scale: 1 }
                          }
                          transition={{ duration: 0.2 }}
                        >
                          {layerSaved ? (
                            <Lock
                              size={16}
                              className="transition-all duration-200"
                              style={{
                                color: familyColor,
                                filter: `drop-shadow(0 0 6px ${familyColor}60)`,
                              }}
                            />
                          ) : (
                            <LockOpen
                              size={16}
                              className="text-muted-foreground/50 transition-all duration-200 hover:text-muted-foreground/70"
                            />
                          )}
                        </motion.div>
                      </motion.button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </motion.div>

        {/* Spacer before forecast */}
        <div className="mt-auto pt-8" />

        {/* 7-Day Forecast Timepiece — magnet: compresses when layer expands */}
        <motion.div
          className="w-full max-w-md rounded-t-[16px] px-5 backdrop-blur-xl overflow-hidden"
          animate={{
            paddingTop: layerSheetOpen ? 8 : 12,
            paddingBottom: layerSheetOpen ? 16 : 24,
            opacity: layerSheetOpen ? 0.7 : 1,
          }}
          transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
          style={{
            background: "var(--sub-glass-bg)",
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06)",
          }}
        >
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/60 block text-center mb-3">
            Forecast
          </span>
          <div className="relative">
            <div className="absolute top-[7px] left-[12px] right-[12px] h-px bg-muted-foreground/10" />

            {/* Continuous orb */}
            {(() => {
              const totalSegments = 6;
              const FADE_START = 0.80;
              const progressInDay = orbPosition;
              const orbFade = progressInDay >= FADE_START
                ? 1 - ((progressInDay - FADE_START) / (1 - FADE_START))
                : 1;
              const maxProgress = FADE_START + (1 - FADE_START) * 0.4;
              const clampedProgress = Math.min(progressInDay, maxProgress);
              const pct = (clampedProgress / totalSegments) * 100;
              return (
                <div
                  className="absolute top-[2px] z-10 pointer-events-none"
                  style={{
                    left: `calc(12px + ${pct / 100} * (100% - 24px))`,
                    transform: "translateX(-50%)",
                    opacity: Math.max(0, orbFade),
                  }}
                >
                  <div
                    className="rounded-full"
                    style={{
                      width: "7px", height: "7px",
                      background: "white",
                      boxShadow: `0 0 4px 2px rgba(255,255,255,${(0.15 * orbFade).toFixed(3)}), 0 0 10px 4px rgba(255,255,255,${(0.06 * orbFade).toFixed(3)})`,
                      animation: "orbBreathe 4s ease-in-out infinite 2s",
                    }}
                  />
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
                        marginBottom: "6px",
                      }}
                    >
                      {d.label}
                    </span>

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

                  {/* Note Pyramid */}
                  {(profile?.top_notes || profile?.heart_notes || profile?.base_notes) && (
                    <div className="mb-8 space-y-3">
                      <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground/70 block mb-1">Note Pyramid</span>
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
                    </div>
                  )}

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
