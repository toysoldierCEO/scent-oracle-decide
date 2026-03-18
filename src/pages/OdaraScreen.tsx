import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Star, X } from "lucide-react";

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

const SWIPE_THRESHOLD = 100;
const SWIPE_VELOCITY = 300;

const CONTEXTS = ["daily", "office", "hangout", "date"] as const;
const TEMPERATURES = [35, 50, 65, 80] as const;

/* ── Fragrance family → color mapping ── */
const FAMILY_COLORS: Record<string, string> = {
  "oud-amber": "#C08A3E",
  "fresh-blue": "#5B9BD5",
  "woody-clean": "#8A9BAE",
  "sweet-gourmand": "#D4A056",
  "dark-leather": "#3A3A3A",
  "tobacco-boozy": "#6B4226",
  "floral-musk": "#C4A0B9",
  "citrus-aromatic": "#B8C94E",
};

const FAMILY_LABELS: Record<string, string> = {
  "oud-amber": "Oud & Amber",
  "fresh-blue": "Fresh & Aquatic",
  "woody-clean": "Woody & Clean",
  "sweet-gourmand": "Sweet & Gourmand",
  "dark-leather": "Dark Leather",
  "tobacco-boozy": "Tobacco & Boozy",
  "floral-musk": "Floral & Musk",
  "citrus-aromatic": "Citrus & Aromatic",
};

interface FragranceProfile {
  brand?: string;
  top_notes?: string[];
  heart_notes?: string[];
  base_notes?: string[];
  wardrobe_role?: string;
  longevity_score?: number; // 0–1
  projection_score?: number; // 0–1
  weather?: string;
}

function performanceLabel(score: number): string {
  if (score <= 0.33) return "Soft";
  if (score <= 0.66) return "Moderate";
  return "Strong";
}

const FRAGRANCE_PROFILES: Record<string, FragranceProfile> = {
  "Valley of the Kings": {
    top_notes: ["Saffron", "Pink Pepper", "Bergamot"],
    heart_notes: ["Rose Absolute", "Oud"],
    base_notes: ["Amber", "Sandalwood", "Musk"],
    wardrobe_role: "Signature evening anchor",
    longevity_score: 0.9,
    projection_score: 0.85,
    weather: "Best in cool → cold weather",
  },
  "Agar": {
    top_notes: ["Elemi", "Green Cardamom"],
    heart_notes: ["Agarwood", "Cedar Atlas"],
    base_notes: ["Vetiver", "White Musk"],
    wardrobe_role: "Versatile daily wear",
    longevity_score: 0.6,
    projection_score: 0.45,
    weather: "Best in mild → warm weather",
  },
  "Noire Absolu": {
    top_notes: ["Black Pepper", "Juniper"],
    heart_notes: ["Leather", "Iris"],
    base_notes: ["Castoreum", "Patchouli", "Benzoin"],
    wardrobe_role: "Power move — formal nights",
    longevity_score: 0.95,
    projection_score: 0.9,
    weather: "Best in cold weather",
  },
  "Santal Sérénade": {
    top_notes: ["Coconut Milk", "Cardamom"],
    heart_notes: ["Sandalwood", "Tonka Bean"],
    base_notes: ["Vanilla", "Cashmeran"],
    wardrobe_role: "Comfort scent — close encounters",
    longevity_score: 0.7,
    projection_score: 0.3,
    weather: "Best in cool → mild weather",
  },
  "Hafez 1984": {
    top_notes: ["Cinnamon", "Dried Plum"],
    heart_notes: ["Tobacco Leaf", "Dark Rum"],
    base_notes: ["Labdanum", "Oud", "Smoky Birch"],
    wardrobe_role: "Night out anchor",
    longevity_score: 0.85,
    projection_score: 0.8,
    weather: "Best in cold → cool weather",
  },
  "Mystere 28": {
    top_notes: ["Sea Salt", "Grapefruit", "Mint"],
    heart_notes: ["Lavender", "Geranium"],
    base_notes: ["Ambroxan", "White Cedar"],
    wardrobe_role: "Daytime refresh — casual wear",
    longevity_score: 0.45,
    projection_score: 0.5,
    weather: "Best in warm → hot weather",
  },
  "Amber Dusk": {
    top_notes: ["Mandarin", "Ginger"],
    heart_notes: ["Amber", "Frankincense"],
    base_notes: ["Labdanum", "Vanilla", "Musk"],
    wardrobe_role: "Transitional — day to night",
    longevity_score: 0.65,
    projection_score: 0.5,
    weather: "Best in cool → mild weather",
  },
};

const LONG_PRESS_DURATION = 500;

/* ── 7-day forecast mock data ── */
/* ── Layer compatibility engine ── */
interface FragranceEntry {
  fragrance_id: string;
  name: string;
  family: string;
  reason: string;
  longevity_score: number;
  projection_score: number;
}

// Compatibility matrix: family → compatible families with score
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
  // Layer should not overpower base
  const projDelta = layer.projection_score - base.projection_score;
  if (projDelta > 0.3) return 0.2; // layer too strong
  if (projDelta > 0.15) return 0.5;
  if (projDelta > 0) return 0.75;
  return 1.0; // layer is softer — safe
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
  let bestCompat = 0;
  let bestDominance = 0;

  for (const candidate of candidates) {
    if (candidate.fragrance_id === base.fragrance_id) continue;

    const compatMatch = compatEntries.find(c => c.family === candidate.family);
    if (!compatMatch) continue;

    const compatibility = compatMatch.score;
    const dominanceSafety = computeDominanceSafety(base, candidate);
    const rotationValue = 1 - (dayIndex % 3) * 0.1; // slight variation

    const score =
      0.45 * 0.85 + // base_score (already selected)
      0.20 * compatibility +
      0.15 * dominanceSafety +
      0.10 * 0.8 + // context_fit placeholder
      0.10 * rotationValue;

    if (score > bestScore && dominanceSafety > 0.4 && compatibility > 0.7) {
      bestScore = score;
      bestLayer = candidate;
      bestCompat = compatibility;
      bestDominance = dominanceSafety;
    }
  }

  if (bestLayer && bestScore > 0.65) {
    return {
      base,
      layer: bestLayer,
      mode: "balance",
      confidence: Math.round(bestScore * 100) / 100,
      reasoning: `${bestLayer.name} complements ${base.name} — compatible families with safe projection ratio.`,
      is_layered: true,
    };
  }

  return {
    base,
    layer: null,
    mode: null,
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

    // Build layer map from daily set if layered
    let layerMap: Record<LayerMood, LayerOption> | null = null;
    if (dailySet.is_layered && dailySet.layer) {
      const layerOption: LayerOption = {
        base_id: frag.fragrance_id,
        anchor_name: frag.name,
        top_id: dailySet.layer.fragrance_id,
        top_name: dailySet.layer.name,
        top: `Layer with ${dailySet.layer.name}`,
        mode: "balance",
        reason: dailySet.reasoning,
        why_it_works: dailySet.reasoning,
        anchor_sprays: 3,
        top_sprays: 1,
        anchor_placement: "Neck, chest",
        top_placement: "Wrists",
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
      label: dayNames[d.getDay()],
      day: d.getDate(),
      fragrance: { fragrance_id: frag.fragrance_id, name: frag.name, family: frag.family, reason: frag.reason },
      temperature: frag.temperature,
      layer: layerMap,
      alternates: null,
      dailySet,
    };
  });
}

const OdaraScreen = () => {
  const [oracle, setOracle] = useState<OracleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [accepted, setAccepted] = useState(false);
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null);
  const [cardKey, setCardKey] = useState(0);
  const swipeLocked = useRef(false);
  const [selectedContext, setSelectedContext] = useState<string>("hangout");
  const [selectedTemperature, setSelectedTemperature] = useState<number>(40);
  const [layerSheetOpen, setLayerSheetOpen] = useState(false);
  const [selectedMood, setSelectedMood] = useState<LayerMood>('balanced');
  const [liveTemperature, setLiveTemperature] = useState<number | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [manualTemperatureOverride, setManualTemperatureOverride] = useState<number | null>(null);
  const [layerSaved, setLayerSaved] = useState(false);
  const [selectedForecastDay, setSelectedForecastDay] = useState(0);
  const [forecastTransition, setForecastTransition] = useState(false);
  const [displayedTemperature, setDisplayedTemperature] = useState<number | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveTemperature = manualTemperatureOverride ?? liveTemperature ?? 40;

  // Build forecast days
  const forecastDays = useMemo(() => buildForecastDays(), []);

  // Continuous timepiece orb position (requestAnimationFrame)
  const [orbPosition, setOrbPosition] = useState(0);
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const msInDay = 24 * 60 * 60 * 1000;
      const dayProgress = (now.getTime() - startOfDay.getTime()) / msInDay;
      // Position: dayProgress maps to the space between day 0 and day 1 markers
      // Full range is 0 (start of today) to 7 (end of 7th day)
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
      .then((temp) => {
        if (!cancelled) {
          setLiveTemperature(temp);
          setSelectedTemperature(temp);
        }
      })
      .catch(() => {
        // silently fall back to 40
      })
      .finally(() => { if (!cancelled) setWeatherLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-8, 0, 8]);
  const acceptOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);
  const skipOpacity = useTransform(x, [-SWIPE_THRESHOLD, 0], [1, 0]);

  const getUserId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? "00000000-0000-0000-0000-000000000000";
  }, []);

  const fetchOracle = useCallback(async (ctx?: string, temp?: number) => {
    setLoading(true);
    setError(false);
    setAccepted(false);
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

  useEffect(() => {
    fetchOracle();
  }, [fetchOracle]);

  const handleAccept = useCallback(async () => {
    if (actionState !== "idle" || !oracle?.today_pick?.fragrance_id) return;
    setActionState("accepting");
    try {
      const userId = await getUserId();
      const { error: rpcError } = await supabase.rpc("accept_today_pick_v1" as any, {
        p_user: userId,
        p_fragrance_id: oracle.today_pick.fragrance_id,
        p_context: "hangout",
      });
      if (rpcError) throw rpcError;
      setAccepted(true);
    } catch (e) {
      console.error("Accept failed:", e);
      toast.error("Couldn't lock in — try again");
    } finally {
      setActionState("idle");
      swipeLocked.current = false;
    }
  }, [actionState, oracle, getUserId]);

  const handleSkip = useCallback(async () => {
    if (actionState !== "idle" || !oracle?.today_pick?.fragrance_id) return;
    setActionState("skipping");
    try {
      const userId = await getUserId();
      const { error: rpcError } = await supabase.rpc("skip_today_pick_v1" as any, {
        p_user: userId,
        p_fragrance_id: oracle.today_pick.fragrance_id,
        p_context: "hangout",
      });
      if (rpcError) throw rpcError;
      await fetchOracle();
    } catch (e) {
      console.error("Skip failed:", e);
      toast.error("Couldn't skip — try again");
    } finally {
      setActionState("idle");
      swipeLocked.current = false;
    }
  }, [actionState, oracle, getUserId, fetchOracle]);


  const handleAlternateTap = useCallback((alt: { fragrance_id?: string; name: string; family?: string; reason?: string }) => {
    if (actionState !== "idle" || !oracle) return;
    setActionState("rebuilding");

    const oldPick = oracle.today_pick;
    const remainingAlts = (oracle.alternates ?? []).filter((a) => a.name !== alt.name);
    // Add old hero into alternates, removing duplicates
    const newAlts = [
      { fragrance_id: oldPick.fragrance_id, name: oldPick.name, family: oldPick.family, reason: oldPick.reason },
      ...remainingAlts,
    ].filter((a) => a.name !== alt.name);

    setExitDirection("left");
    setTimeout(() => {
      setOracle({
        today_pick: { fragrance_id: alt.fragrance_id, name: alt.name, family: alt.family ?? "", reason: alt.reason ?? "" },
        layer: null, // no layer data for frontend-local rebuild
        alternates: newAlts.slice(0, 3),
      });
      setAccepted(false);
      setExitDirection(null);
      setCardKey((k) => k + 1);
      setActionState("idle");
    }, 300);
  }, [actionState, oracle]);

  const handleDragEnd = useCallback(
    (_: any, info: PanInfo) => {
      if (swipeLocked.current || actionState !== "idle") return;

      const { offset, velocity } = info;
      const swipedRight =
        offset.x > SWIPE_THRESHOLD || (offset.x > 40 && velocity.x > SWIPE_VELOCITY);
      const swipedLeft =
        offset.x < -SWIPE_THRESHOLD || (offset.x < -40 && velocity.x < -SWIPE_VELOCITY);

      if (swipedRight && !accepted) {
        swipeLocked.current = true;
        setExitDirection("right");
        handleAccept();
      } else if (swipedLeft) {
        swipeLocked.current = true;
        setExitDirection("left");
        handleSkip();
      }
    },
    [actionState, accepted, handleAccept, handleSkip]
  );

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

  // When a forecast day is selected, show that day's fragrance; day 0 = oracle data
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

  // Background tint based on current fragrance family
  const bgTintColor = today_pick?.family ? (FAMILY_COLORS[today_pick.family] ?? null) : null;

  const handleForecastDayTap = (index: number) => {
    if (index === selectedForecastDay) return;
    setForecastTransition(true);
    // Brief outgoing fade
    setTimeout(() => {
      setSelectedForecastDay(index);
      setAccepted(false);
      setLayerSheetOpen(false);
      setCardKey((k) => k + 1);
      setExitDirection(null);
      // Update displayed temperature for the selected day
      const dayTemp = forecastDays[index]?.temperature;
      if (dayTemp != null) setDisplayedTemperature(dayTemp);
      else setDisplayedTemperature(null);
      setTimeout(() => setForecastTransition(false), 50);
    }, 150);
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

          // Scent behavior label
          const scentBehavior = effectiveTemperature <= 40 ? "Dense" : effectiveTemperature <= 55 ? "Rich" : effectiveTemperature <= 70 ? "Balanced" : "Light";

          return (
            <div className="w-full max-w-md mb-6 px-2">
              {/* Track + Orb + Temp label */}
              <div className="relative w-full" style={{ height: "40px" }}>
                {/* Track line */}
                <div className="absolute w-full h-[2px] rounded-full bg-foreground/10" style={{ top: "25px" }} />

                {/* Orb on track with temperature above */}
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
                      width: "7px",
                      height: "7px",
                      background: "white",
                      boxShadow: "0 0 4px 2px rgba(255,255,255,0.15), 0 0 10px 4px rgba(255,255,255,0.06)",
                      animation: "orbBreathe 4s ease-in-out infinite",
                    }}
                  />
                </motion.div>
              </div>

              {/* Benchmarks below track */}
              <div className="relative w-full mt-1" style={{ height: "20px" }}>
                {/* Benchmark ticks */}
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


        {/* Swipeable Hero Card */}
        <div className="relative w-full max-w-md mt-3">
          {/* Swipe hint labels */}
          <motion.div
            className="absolute inset-0 flex items-center justify-between px-6 pointer-events-none z-10"
            aria-hidden
          >
            <motion.span
              style={{ opacity: skipOpacity }}
              className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60"
            >
              Not today
            </motion.span>
            <motion.span
              style={{ opacity: acceptOpacity }}
              className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground/80"
            >
              Wear this
            </motion.span>
          </motion.div>

          <AnimatePresence mode="wait">
            <motion.div
              key={cardKey}
              drag={isBusy || accepted ? false : "x"}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.9}
              onDragEnd={handleDragEnd}
              initial={{
                opacity: 0,
                y: exitDirection ? 0 : 5,
                x: exitDirection === "left" ? 300 : exitDirection === "right" ? -300 : 0,
                scale: 0.96,
              }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{
                opacity: 0,
                x: exitDirection === "left" ? -300 : exitDirection === "right" ? 300 : 0,
                y: exitDirection ? 0 : -3,
                scale: 0.97,
                transition: { duration: exitDirection ? 0.3 : 0.15 },
              }}
              transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
              className="w-full rounded-[32px] p-8 backdrop-blur-2xl flex flex-col items-center cursor-grab active:cursor-grabbing touch-pan-y"
              style={{
                x,
                rotate,
                background: "var(--glass-bg)",
                boxShadow: "var(--shadow-glass), inset 0 0 0 1px hsl(var(--family-accent) / 0.12), 0 0 60px -20px hsl(var(--family-accent) / 0.08)",
              }}
            >
              {isViewingForecast && (
                <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground/70 mb-2 select-none">
                  {forecastEntry.label} · {forecastEntry.day}
                </span>
              )}
              {/* Long-press target for fragrance profile */}
              <div
                className="flex flex-col items-center select-none"
                onPointerDown={() => {
                  longPressTimer.current = setTimeout(() => {
                    setProfileOpen(true);
                  }, LONG_PRESS_DURATION);
                }}
                onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                onPointerLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                onContextMenu={(e) => e.preventDefault()}
              >
                <h1 className="text-4xl font-serif text-foreground text-center mb-1 leading-tight select-none">
                  {today_pick.name}
                </h1>

                <p className="text-xs text-family-accent text-center tracking-[0.2em] mb-5 uppercase select-none">
                  {today_pick.family}
                </p>
              </div>

              <p className="text-sm text-center text-muted-foreground/80 leading-relaxed px-4 mb-8 text-pretty select-none">
                {today_pick.reason}
              </p>

              {/* Layer Card — inline expand */}
              {hasLayer && activeLayer && (
                <div
                  onClick={() => setLayerSheetOpen((o) => !o)}
                  className="w-full rounded-[16px] px-4 py-3 mb-4 flex flex-col items-center text-center cursor-pointer transition-all duration-200 hover:brightness-110 active:scale-[0.98] relative"
                  style={{
                    background: "var(--sub-glass-bg)",
                    boxShadow: "var(--shadow-sub-glass), inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
                  }}
                >
                  {/* Save star */}
                  <motion.button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLayerSaved((s) => !s);
                      toast(layerSaved ? "Combo unsaved" : "Combo saved");
                    }}
                    whileTap={{ scale: 1.3 }}
                    className="absolute top-3 right-3 p-1"
                  >
                    <motion.div
                      animate={layerSaved ? { scale: [1, 1.25, 1] } : { scale: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Star
                        size={14}
                        className={`transition-all duration-200 ${
                          layerSaved
                            ? "text-foreground fill-foreground/80 drop-shadow-[0_0_4px_rgba(255,255,255,0.3)]"
                            : "text-muted-foreground/30 hover:text-muted-foreground/60"
                        }`}
                      />
                    </motion.div>
                  </motion.button>

                  <p className="text-[14px] font-medium text-foreground/90 mb-1 tracking-wide pr-6">
                    {activeLayer.top ?? `Enhance with ${activeLayer.top_name}`}
                  </p>
                  <span
                    className="text-[9px] text-muted-foreground/80 px-2.5 py-0.5 rounded-full mb-1"
                    style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)" }}
                  >
                    {activeLayer.mode}
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

                          {/* ROLE */}
                          <div>
                            <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">Role</span>
                            <p className="text-[11px] text-foreground/75 mt-0.5 leading-relaxed">
                              {activeLayer.top_name} acts as {activeLayer.mode === 'balance' ? 'a balancing accent' : activeLayer.mode === 'amplify' ? 'a bold amplifier' : activeLayer.mode === 'soften' ? 'a softening layer' : 'a contrasting element'} to {activeLayer.anchor_name ?? today_pick.name}
                            </p>
                          </div>

                          {/* WHY THIS WORKS */}
                          {(activeLayer.why_it_works || activeLayer.reason) && (
                            <div>
                              <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">Why this works</span>
                              <p className="text-[11px] text-foreground/70 mt-0.5 leading-relaxed">
                                {activeLayer.why_it_works ?? activeLayer.reason}
                              </p>
                            </div>
                          )}

                          {/* SPRAY ORDER */}
                          {(activeLayer.anchor_sprays != null && activeLayer.top_sprays != null) && (
                            <div>
                              <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">Spray order</span>
                              <div className="mt-1 space-y-1">
                                <div className="flex items-start gap-2">
                                  <span className="text-[9px] font-mono text-muted-foreground/40 mt-px">01</span>
                                  <div>
                                    <p className="text-[11px] text-foreground/80">
                                      <span className="font-mono">{activeLayer.anchor_sprays}×</span> {activeLayer.anchor_name ?? today_pick.name}
                                    </p>
                                    {activeLayer.anchor_placement && (
                                      <p className="text-[10px] text-muted-foreground/45">{activeLayer.anchor_placement}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-start gap-2">
                                  <span className="text-[9px] font-mono text-muted-foreground/40 mt-px">02</span>
                                  <div>
                                    <p className="text-[11px] text-foreground/80">
                                      <span className="font-mono">{activeLayer.top_sprays}×</span> {activeLayer.top_name}
                                    </p>
                                    {activeLayer.top_placement && (
                                      <p className="text-[10px] text-muted-foreground/45">{activeLayer.top_placement}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* RESULT */}
                          <div>
                            <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">Result</span>
                            <p className="text-[11px] text-foreground/70 mt-0.5 leading-relaxed">
                              {activeLayer.strength_note ?? `A ${activeLayer.mode} blend of ${activeLayer.anchor_name ?? today_pick.name} and ${activeLayer.top_name}`}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Alternates */}
              {hasAlternates && (
                <div className="flex gap-2 justify-center mb-2">
                  {alternates!.map((alt) => (
                    <motion.button
                      key={alt.name}
                      whileHover={{ backgroundColor: "rgba(255,255,255,0.08)" }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleAlternateTap(alt)}
                      disabled={isBusy}
                      className="text-[11px] text-muted-foreground rounded-full px-4 py-2 transition-colors disabled:opacity-40"
                      style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08)" }}
                    >
                      {alt.name}
                    </motion.button>
                  ))}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <footer className="flex flex-col items-center w-full max-w-md px-2 mt-auto pb-4 pt-8 gap-4">
          <div className="flex items-center justify-between w-full">
            <button
              onClick={handleSkip}
              disabled={isBusy}
              className="text-xs text-muted-foreground uppercase tracking-[0.15em] hover:text-foreground transition-colors duration-300 disabled:opacity-40"
            >
              {actionState === "skipping" ? "Skipping…" : "Not today"}
            </button>

            <AnimatePresence mode="wait">
              {accepted ? (
                <motion.span
                  key="locked"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="px-8 py-4 rounded-full text-xs font-bold uppercase tracking-[0.15em] text-foreground"
                  style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.15)" }}
                >
                  Locked in ✓
                </motion.span>
              ) : (
                <motion.button
                  key="wear"
                  whileTap={{ scale: 0.96 }}
                  onClick={handleAccept}
                  disabled={isBusy}
                  className="px-8 py-4 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-shadow duration-300 disabled:opacity-60"
                  style={{
                    background: "rgba(255, 255, 255, 0.9)",
                    color: "hsl(var(--background))",
                    boxShadow: "0 4px 20px rgba(255, 255, 255, 0.1)",
                  }}
                >
                  {actionState === "accepting" ? "Locking in…" : "Wear this"}
                </motion.button>
              )}
            </AnimatePresence>
          </div>

        </footer>

        {/* 7-Day Forecast Timepiece */}
        <div
          className="w-full max-w-md rounded-t-[16px] px-5 py-3 pb-6 backdrop-blur-xl"
          style={{
            background: "var(--sub-glass-bg)",
            boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.06)",
          }}
        >
          <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground/40 block text-center mb-3">
            Forecast
          </span>
          <div className="relative">
            {/* Track line */}
            <div className="absolute top-[7px] left-[12px] right-[12px] h-px bg-muted-foreground/10" />
            
            {/* Continuous orb with midnight handoff fade */}
            {(() => {
              const totalSegments = 6;
              // orbPosition: 0 at midnight → 1 at next midnight
              // Fade zone: last 20% of day (roughly 8pm–midnight)
              const FADE_START = 0.80;
              const progressInDay = orbPosition; // 0→1 within current day
              const orbFade = progressInDay >= FADE_START
                ? 1 - ((progressInDay - FADE_START) / (1 - FADE_START))
                : 1;
              // Clamp position: orb stops at 90% of the way to next day marker max
              const maxProgress = FADE_START + (1 - FADE_START) * 0.4; // ~0.88 — never reaches day 1
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
                      width: "7px",
                      height: "7px",
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

                // Handoff: day 1 brightens as orb fades (last 20% of day = 8pm–midnight)
                const FADE_ZONE = 0.20;
                const distToDay = i - orbPosition;
                const isNextTarget = i === 1 && distToDay > 0 && distToDay <= FADE_ZONE;
                const handoffGlow = isNextTarget ? 1 - (distToDay / FADE_ZONE) : 0;
                const isCurrentOrbDay = i === 0;

                // Dynamic opacity based on handoff + selection + current day
                const labelOpacity = isSelected
                  ? 0.95
                  : isCurrentOrbDay
                    ? 0.65
                    : isNextTarget
                      ? 0.45 + handoffGlow * 0.3
                      : i === 0
                        ? 0.65
                        : 0.45;
                const dateOpacity = isSelected
                  ? 0.75
                  : isNextTarget
                    ? 0.35 + handoffGlow * 0.2
                    : 0.35;

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
                    {/* Weekday label */}
                    <span
                      className="font-mono transition-all duration-200 text-center leading-none"
                      style={{
                        fontSize: "11px",
                        letterSpacing: "0.1em",
                        color: `rgba(255,255,255,${Math.min(labelOpacity + 0.15, 1)})`,
                        fontWeight: isSelected ? 600 : (isNextTarget && handoffGlow > 0.5) ? 500 : i === 0 ? 500 : 450,
                        marginBottom: "6px",
                      }}
                    >
                      {d.label}
                    </span>

                    {/* Date number */}
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

                    {/* Dot container — fixed height, centered */}
                    <div className="flex flex-col items-center justify-center" style={{ height: "22px", gap: "4px" }}>
                      {/* Primary family-coded orb */}
                      <motion.div
                        className="rounded-full"
                        animate={{
                          width: isSelected ? "8px" : "6px",
                          height: isSelected ? "8px" : "6px",
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

                      {/* Secondary layer orb (smaller) */}
                      {isLayered && (
                        <motion.div
                          className="rounded-full"
                          initial={{ opacity: 0, scale: 0 }}
                          animate={{
                            opacity: 0.85,
                            scale: 1,
                            width: isSelected ? "6px" : "5px",
                            height: isSelected ? "6px" : "5px",
                            boxShadow: isSelected
                              ? `0 0 6px 2px ${layerColor}44`
                              : `0 0 2px 1px ${layerColor}22`,
                          }}
                          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                          style={{ background: layerColor }}
                        />
                      )}
                    </div>

                    {/* Selected underline */}
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
        </div>

        {/* Fragrance Profile Sheet */}
        <AnimatePresence>
          {profileOpen && (() => {
            const profile = FRAGRANCE_PROFILES[today_pick.name];
            const familyColor = FAMILY_COLORS[today_pick.family] ?? "#888";
            const familyLabel = FAMILY_LABELS[today_pick.family] ?? today_pick.family;
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
                  className="w-full max-w-md rounded-t-[28px] px-6 pt-5 pb-10 overflow-y-auto"
                  style={{
                    maxHeight: "85vh",
                    background: "hsl(var(--background))",
                    boxShadow: "0 -10px 40px rgba(0,0,0,0.3)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Handle */}
                  <div className="flex justify-center mb-4">
                    <div className="w-10 h-1 rounded-full bg-foreground/15" />
                  </div>

                  {/* Close */}
                  <button
                    onClick={() => setProfileOpen(false)}
                    className="absolute top-5 right-5 p-2 text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    <X size={18} />
                  </button>

                  {/* Header */}
                  <div className="text-center mb-6">
                    <h2 className="text-3xl font-serif text-foreground mb-1">{today_pick.name}</h2>
                    {profile?.brand && (
                      <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/60 mb-2">{profile.brand}</p>
                    )}
                    <span
                      className="inline-block text-[10px] uppercase tracking-[0.15em] px-3 py-1 rounded-full"
                      style={{
                        color: familyColor,
                        boxShadow: `inset 0 0 0 1px ${familyColor}33`,
                      }}
                    >
                      {familyLabel}
                    </span>
                  </div>

                  {/* Note Pyramid */}
                  {(profile?.top_notes || profile?.heart_notes || profile?.base_notes) && (
                    <div className="mt-6 mb-6 space-y-3">
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

                  {/* Performance */}
                  {(profile?.longevity_score != null || profile?.projection_score != null) && (
                    <div className="mt-8 mb-6 grid grid-cols-2 gap-4">
                      <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground/70 col-span-2">Performance</span>
                      {profile?.longevity_score != null && (
                        <div>
                          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50">Longevity</span>
                          <p className="text-[12px] text-foreground/80 mt-0.5">{performanceLabel(profile.longevity_score)}</p>
                        </div>
                      )}
                      {profile?.projection_score != null && (
                        <div>
                          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/50">Projection</span>
                          <p className="text-[12px] text-foreground/80 mt-0.5">{performanceLabel(profile.projection_score)}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Wardrobe Role & Weather */}
                  {(profile?.wardrobe_role || profile?.weather) && (
                    <div className="mt-8 mb-4 grid grid-cols-2 gap-4">
                      {profile.wardrobe_role && (
                        <div>
                          <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground/70">Role</span>
                          <p className="text-[12px] text-foreground/80 mt-0.5">{profile.wardrobe_role}</p>
                        </div>
                      )}
                      {profile.weather && (
                        <div>
                          <span className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground/70">Weather</span>
                          <p className="text-[12px] text-foreground/80 mt-0.5">{profile.weather}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Why it fits */}
                  <div className="mt-8 mb-2">
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
