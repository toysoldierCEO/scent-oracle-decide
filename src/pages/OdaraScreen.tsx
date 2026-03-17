import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { useCallback, useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface OracleData {
  today_pick: {
    fragrance_id?: string;
    name: string;
    family: string;
    reason: string;
  };
  layer?: {
    base_id?: string;
    base?: string;
    top_id?: string;
    top: string;
    mode: string;
    reason: string;
  } | null;
  alternates?: {
    fragrance_id?: string;
    name: string;
    family?: string;
    reason?: string;
  }[] | null;
}

type ActionState = "idle" | "accepting" | "skipping" | "disliking";

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
      const { data, error: rpcError } = await supabase.rpc(
        "get_todays_oracle_v3",
        { p_user_id: userId, p_temperature: temp ?? selectedTemperature, p_context: ctx ?? selectedContext }
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
  }, [getUserId, selectedContext, selectedTemperature]);

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
            <span className="text-[9px] tracking-[0.2em] text-muted-foreground uppercase mt-2 opacity-60">SCENT ORACLE</span>
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
            onClick={fetchOracle}
            className="text-xs text-muted-foreground uppercase tracking-[0.15em] hover:text-foreground transition-colors duration-300 px-6 py-3 rounded-full"
            style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)" }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { today_pick, layer, alternates } = oracle;
  const hasLayer = layer != null;
  const hasAlternates = alternates != null && alternates.length > 0;

  return (
    <div className="dark">
      <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-0 overflow-hidden">
        {/* Header */}
        <header className="flex flex-col items-center pt-12 pb-6">
          <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">ODARA</span>
          <span className="text-[9px] tracking-[0.2em] text-muted-foreground uppercase mt-2 opacity-60">SCENT ORACLE</span>
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

        {/* Temperature chips */}
        <div className="flex gap-1.5 mb-6">
          {TEMPERATURES.map((temp) => (
            <button
              key={temp}
              onClick={() => {
                setSelectedTemperature(temp);
                fetchOracle(selectedContext, temp);
              }}
              disabled={isBusy || loading}
              className={`text-[10px] font-mono px-2.5 py-1 rounded-full transition-all duration-200 disabled:opacity-40 ${
                selectedTemperature === temp
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground/40 hover:text-muted-foreground"
              }`}
              style={selectedTemperature === temp ? { boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" } : undefined}
            >
              {temp}°
            </button>
          ))}
        </div>

        {/* Swipeable Hero Card */}
        <div className="relative w-full max-w-md">
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

              {/* Layer Card */}
              {hasLayer && (
                <div
                  className="w-full rounded-[20px] p-5 mb-8"
                  style={{
                    background: "var(--sub-glass-bg)",
                    boxShadow: "var(--shadow-sub-glass), inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
                  }}
                >
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
                    Layering Suggestion
                  </p>
                  <p className="text-base font-medium text-foreground">{layer!.top}</p>
                  <div className="flex justify-between items-center mt-3">
                    <span
                      className="text-[10px] text-muted-foreground/80 px-2.5 py-1 rounded-full"
                      style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)" }}
                    >
                      {layer!.mode}
                    </span>
                    <span className="text-[11px] text-muted-foreground italic">{layer!.reason}</span>
                  </div>
                </div>
              )}

              {/* Alternates */}
              {hasAlternates && (
                <div className="flex gap-2 justify-center mb-2">
                  {alternates!.map((alt) => (
                    <motion.button
                      key={alt.name}
                      whileHover={{ backgroundColor: "rgba(255,255,255,0.08)" }}
                      className="text-[11px] text-muted-foreground rounded-full px-4 py-2 transition-colors"
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
