import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Star } from "lucide-react";

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

/* ── 7-day forecast mock data ── */
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
}

function buildForecastDays(): ForecastDay[] {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  const weekFragrances: { fragrance_id: string; name: string; family: string; reason: string; temperature: number }[] = [
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440001', name: 'Valley of the Kings', family: 'oud-amber', reason: 'Dark amber lane fits your strongest scent identity.', temperature: 42 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440003', name: 'Agar', family: 'woody-clean', reason: 'Clean woody undertones for a grounded midweek reset.', temperature: 55 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440006', name: 'Noire Absolu', family: 'dark-leather', reason: 'Raw leather intensity for a commanding presence.', temperature: 38 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440007', name: 'Santal Sérénade', family: 'sweet-gourmand', reason: 'Creamy sandalwood warmth for effortless comfort.', temperature: 62 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440004', name: 'Hafez 1984', family: 'tobacco-boozy', reason: 'Smoky depth that lingers through the evening.', temperature: 45 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440002', name: 'Mystere 28', family: 'fresh-blue', reason: 'Bright aquatic lift for a weekend refresh.', temperature: 72 },
    { fragrance_id: '550e8400-e29b-41d4-a716-446655440008', name: 'Amber Dusk', family: 'oud-amber', reason: 'Warm amber close to round out the week.', temperature: 48 },
  ];

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const frag = weekFragrances[i];
    return {
      label: dayNames[d.getDay()],
      day: d.getDate(),
      fragrance: { fragrance_id: frag.fragrance_id, name: frag.name, family: frag.family, reason: frag.reason },
      temperature: frag.temperature,
      layer: null,
      alternates: null,
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

  const handleForecastDayTap = (index: number) => {
    setSelectedForecastDay(index);
    setAccepted(false);
    setLayerSheetOpen(false);
    setCardKey((k) => k + 1);
    setExitDirection(null);
  };

  return (
    <div className="dark">
      <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-0 overflow-hidden">
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
          const pct = ((clamp(effectiveTemperature, TRACK_MIN, TRACK_MAX) - TRACK_MIN) / (TRACK_MAX - TRACK_MIN)) * 100;

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
                  style={{ left: `${pct}%`, top: "0px" }}
                  animate={{ left: `${pct}%` }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                  <span className="text-[10px] font-mono text-muted-foreground/70 select-none mb-1">
                    {effectiveTemperature}°
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
              initial={{ opacity: 0, scale: 0.96, x: exitDirection === "left" ? 300 : exitDirection === "right" ? -300 : 0 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{
                opacity: 0,
                x: exitDirection === "left" ? -300 : exitDirection === "right" ? 300 : 0,
                scale: 0.95,
                transition: { duration: 0.3 },
              }}
              transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
              className="w-full rounded-[32px] p-8 backdrop-blur-2xl flex flex-col items-center cursor-grab active:cursor-grabbing touch-pan-y"
              style={{
                x,
                rotate,
                background: "var(--glass-bg)",
                boxShadow: "var(--shadow-glass), inset 0 0 0 1px hsl(var(--family-accent) / 0.12), 0 0 60px -20px hsl(var(--family-accent) / 0.08)",
              }}
            >
              {isViewingForecast && (
                <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/40 mb-2 select-none">
                  {forecastEntry.label} · {forecastEntry.day}
                </span>
              )}
              <h1 className="text-4xl font-serif text-foreground text-center mb-1 leading-tight select-none">
                {today_pick.name}
              </h1>

              <p className="text-xs text-family-accent text-center tracking-[0.2em] mb-5 uppercase select-none">
                {today_pick.family}
              </p>

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
            
            {/* Continuous orb */}
            {(() => {
              const totalSegments = 6;
              const pct = (orbPosition / totalSegments) * 100;
              return (
                <div
                  className="absolute top-[2px] z-10"
                  style={{
                    left: `calc(12px + ${pct / 100} * (100% - 24px))`,
                    transform: "translateX(-50%)",
                  }}
                >
                  <div
                    className="rounded-full"
                    style={{
                      width: "7px",
                      height: "7px",
                      background: "white",
                      boxShadow: "0 0 4px 2px rgba(255,255,255,0.15), 0 0 10px 4px rgba(255,255,255,0.06)",
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
                return (
                  <button
                    key={i}
                    onClick={() => handleForecastDayTap(i)}
                    className="flex flex-col items-center gap-2.5 bg-transparent border-none outline-none cursor-pointer px-1 py-0"
                  >
                    {/* Family-coded dot — always rendered */}
                    <div
                      className="rounded-full transition-all duration-300"
                      style={{
                        width: isSelected ? "6px" : "5px",
                        height: isSelected ? "6px" : "5px",
                        background: familyColor,
                        boxShadow: isSelected
                          ? `0 0 6px 2px ${familyColor}44`
                          : hasFragrance
                            ? `0 0 3px 1px ${familyColor}22`
                            : `0 0 3px 1px ${FALLBACK_ORB_COLOR}`,
                        opacity: hasFragrance ? 1 : 0.5,
                      }}
                    />
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className="font-mono transition-all duration-200"
                        style={{
                          fontSize: "10px",
                          letterSpacing: "0.08em",
                          color: isSelected
                            ? "rgba(255,255,255,0.85)"
                            : i === 0
                              ? "rgba(255,255,255,0.55)"
                              : "rgba(255,255,255,0.35)",
                          fontWeight: isSelected ? 600 : i === 0 ? 500 : 400,
                        }}
                      >
                        {d.label}
                      </span>
                      {isSelected && (
                        <motion.div
                          layoutId="forecastUnderline"
                          className="w-3.5 h-px rounded-full"
                          style={{ background: "rgba(255,255,255,0.3)" }}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OdaraScreen;
