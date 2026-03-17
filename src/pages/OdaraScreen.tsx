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

type ActionState = "idle" | "accepting" | "skipping" | "disliking" | "rebuilding";

const SWIPE_THRESHOLD = 100;
const SWIPE_VELOCITY = 300;

const CONTEXTS = ["daily", "office", "hangout", "date"] as const;
const TEMPERATURES = [35, 50, 65, 80] as const;

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

  const effectiveTemperature = manualTemperatureOverride ?? liveTemperature ?? 40;

  // Generate forecast days
  const forecastDays = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i + 1);
      return { label: days[d.getDay()], day: d.getDate() };
    });
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

  const handleDislike = useCallback(async () => {
    if (actionState !== "idle" || !oracle?.today_pick?.fragrance_id) return;
    setActionState("disliking");
    try {
      const userId = await getUserId();
      const { error: rpcError } = await supabase.rpc("dislike_fragrance_v1" as any, {
        p_user: userId,
        p_fragrance_id: oracle.today_pick.fragrance_id,
      });
      if (rpcError) throw rpcError;
      await fetchOracle();
    } catch (e) {
      console.error("Dislike failed:", e);
      toast.error("Couldn't remove — try again");
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

  const { today_pick, layer: layerMap, alternates } = oracle;
  const hasLayer = layerMap != null;
  const activeLayer = hasLayer ? layerMap[selectedMood] : null;
  const hasAlternates = alternates != null && alternates.length > 0;

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

          return (
            <div className="w-full max-w-md mb-6 px-2">
              {/* Indicator + label */}
              <div className="relative h-8 mb-1">
                <motion.div
                  className="absolute flex flex-col items-center -translate-x-1/2"
                  style={{ left: `${pct}%` }}
                  animate={{ left: `${pct}%` }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                  <span className="text-[11px] font-mono font-bold text-foreground mb-1 select-none">
                    {effectiveTemperature}°
                  </span>
                  <div
                    className="w-3 h-3 rounded-full bg-foreground"
                    style={{
                      boxShadow: "0 0 8px 2px hsl(var(--family-accent) / 0.4), 0 0 20px 4px hsl(var(--family-accent) / 0.15)",
                    }}
                  />
                </motion.div>
              </div>

              {/* Track */}
              <div className="relative w-full h-[2px] rounded-full bg-foreground/10">
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
                  className="w-full rounded-[16px] px-4 py-3 mb-4 flex flex-col items-center text-center cursor-pointer transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
                  style={{
                    background: "var(--sub-glass-bg)",
                    boxShadow: "var(--shadow-sub-glass), inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
                  }}
                >
                  <p className="text-[14px] font-medium text-foreground/90 mb-1 tracking-wide">
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

                  {/* Inline expanded details */}
                  <AnimatePresence initial={false}>
                    {layerSheetOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
                        className="w-full overflow-hidden"
                      >
                        <div className="pt-2 mt-2 space-y-1.5 text-left" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
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

                          {/* Mode */}
                          <div className="flex items-baseline justify-between">
                            <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">Mode</span>
                            <span className="text-[11px] text-foreground/80 capitalize">{activeLayer.mode}</span>
                          </div>

                          {/* How to wear */}
                          {(activeLayer.anchor_sprays != null && activeLayer.top_sprays != null) && (
                            <div>
                              <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">How to wear</span>
                              <div className="mt-1 space-y-0.5">
                                <p className="text-[11px] text-foreground/75">
                                  <span className="font-mono text-foreground/90">{activeLayer.anchor_sprays}×</span> {activeLayer.anchor_name ?? today_pick.name}
                                </p>
                                <p className="text-[11px] text-foreground/75">
                                  <span className="font-mono text-foreground/90">{activeLayer.top_sprays}×</span> {activeLayer.top_name}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Placement */}
                          {(activeLayer.anchor_placement || activeLayer.top_placement) && (
                            <div>
                              <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/50">Placement</span>
                              <div className="mt-1 space-y-0.5">
                                {activeLayer.anchor_placement && (
                                  <p className="text-[11px] text-muted-foreground/60">
                                    <span className="text-foreground/65">{activeLayer.anchor_name ?? today_pick.name}</span>
                                    <span className="text-muted-foreground/30"> → </span>{activeLayer.anchor_placement}
                                  </p>
                                )}
                                {activeLayer.top_placement && (
                                  <p className="text-[11px] text-muted-foreground/60">
                                    <span className="text-foreground/65">{activeLayer.top_name}</span>
                                    <span className="text-muted-foreground/30"> → </span>{activeLayer.top_placement}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Strength note */}
                          {activeLayer.strength_note && (
                            <p className="text-[10px] text-muted-foreground/45 italic leading-snug">
                              ⚠ {activeLayer.strength_note}
                            </p>
                          )}

                          {/* Why it works — condensed */}
                          {(activeLayer.why_it_works || activeLayer.reason) && (
                            <p className="text-[10px] text-muted-foreground/40 leading-snug">
                              {activeLayer.why_it_works ?? activeLayer.reason}
                            </p>
                          )}
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
        <footer className="flex flex-col items-center w-full max-w-md px-2 mt-auto pb-12 pt-8 gap-4">
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

          {/* Dislike control */}
          <button
            onClick={handleDislike}
            disabled={isBusy}
            className="text-[10px] text-muted-foreground/40 uppercase tracking-[0.15em] hover:text-muted-foreground transition-colors duration-300 disabled:opacity-30"
          >
            {actionState === "disliking" ? "Removing…" : "Don't show again"}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default OdaraScreen;
