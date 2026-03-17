import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

interface OracleData {
  today_pick: {
    name: string;
    family: string;
    reason: string;
  };
  layer?: {
    top: string;
    mode: string;
    reason: string;
  };
  alternates: { name: string }[];
}

const OdaraScreen = () => {
  const [oracle, setOracle] = useState<OracleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchOracle = async () => {
      try {
        // Get current user (may be null for now)
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id ?? "00000000-0000-0000-0000-000000000000";

        const { data, error: rpcError } = await supabase.rpc(
          "get_todays_oracle_v3",
          {
            p_user_id: userId,
            p_temperature: 40,
            p_context: "hangout",
          }
        );

        if (rpcError) throw rpcError;
        setOracle(data as unknown as OracleData);
      } catch (e) {
        console.error("Oracle fetch failed:", e);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchOracle();
  }, []);

  if (loading) {
    return (
      <div className="dark">
        <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-0 overflow-hidden">
          <header className="flex flex-col items-center pt-12 pb-6">
            <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">
              ODARA
            </span>
            <span className="text-[9px] tracking-[0.2em] text-muted-foreground uppercase mt-2 opacity-60">
              SCENT ORACLE
            </span>
          </header>
          <Skeleton className="w-20 h-3 mb-6 bg-muted/20" />
          <div className="w-full max-w-md rounded-[32px] p-8 flex flex-col items-center gap-4" style={{ background: "var(--glass-bg)" }}>
            <Skeleton className="w-3/4 h-10 bg-muted/20" />
            <Skeleton className="w-24 h-4 bg-muted/20" />
            <Skeleton className="w-full h-12 bg-muted/20" />
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

  if (error || !oracle) {
    return (
      <div className="dark">
        <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
          <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase mb-4">
            ODARA
          </span>
          <p className="text-sm text-muted-foreground">Couldn't load today's scent</p>
        </div>
      </div>
    );
  }

  const { today_pick, layer, alternates } = oracle;

  return (
    <div className="dark">
      <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-0 overflow-hidden">
        {/* Header */}
        <header className="flex flex-col items-center pt-12 pb-6">
          <span className="text-lg tracking-[0.5em] font-bold text-foreground uppercase">
            ODARA
          </span>
          <span className="text-[9px] tracking-[0.2em] text-muted-foreground uppercase mt-2 opacity-60">
            SCENT ORACLE
          </span>
        </header>

        {/* Context line */}
        <p className="text-[11px] font-mono text-muted-foreground/60 mb-6 tracking-wide">
          40° · Hangout · Alexandria Archive
        </p>

        {/* Main Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
          className="w-full max-w-md rounded-[32px] p-8 backdrop-blur-2xl flex flex-col items-center"
          style={{
            background: "var(--glass-bg)",
            boxShadow:
              "var(--shadow-glass), inset 0 0 0 1px hsl(var(--family-accent) / 0.12), 0 0 60px -20px hsl(var(--family-accent) / 0.08)",
          }}
        >
          <h1 className="text-4xl font-serif text-foreground text-center mb-1 leading-tight">
            {today_pick.name}
          </h1>

          <p className="text-xs text-family-accent text-center tracking-[0.2em] mb-5 uppercase">
            {today_pick.family}
          </p>

          <p className="text-sm text-center text-muted-foreground/80 leading-relaxed px-4 mb-8 text-pretty">
            {today_pick.reason}
          </p>

          {/* Layer Card — only if exists */}
          {layer && (
            <div
              className="w-full rounded-[20px] p-5 mb-8"
              style={{
                background: "var(--sub-glass-bg)",
                boxShadow:
                  "var(--shadow-sub-glass), inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
              }}
            >
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
                Layering Suggestion
              </p>
              <p className="text-base font-medium text-foreground">
                {layer.top}
              </p>
              <div className="flex justify-between items-center mt-3">
                <span
                  className="text-[10px] text-muted-foreground/80 px-2.5 py-1 rounded-full"
                  style={{
                    boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
                  }}
                >
                  {layer.mode}
                </span>
                <span className="text-[11px] text-muted-foreground italic">
                  {layer.reason}
                </span>
              </div>
            </div>
          )}

          {/* Alternates */}
          <div className="flex gap-2 justify-center mb-2">
            {alternates.map((alt) => (
              <motion.button
                key={alt.name}
                whileHover={{ backgroundColor: "rgba(255,255,255,0.08)" }}
                className="text-[11px] text-muted-foreground rounded-full px-4 py-2 transition-colors"
                style={{
                  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.08)",
                }}
              >
                {alt.name}
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* Footer */}
        <footer className="flex items-center justify-between w-full max-w-md px-2 mt-auto pb-12 pt-8">
          <button className="text-xs text-muted-foreground uppercase tracking-[0.15em] hover:text-foreground transition-colors duration-300">
            Not today
          </button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            className="px-8 py-4 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-shadow duration-300"
            style={{
              background: "rgba(255, 255, 255, 0.9)",
              color: "hsl(var(--background))",
              boxShadow: "0 4px 20px rgba(255, 255, 255, 0.1)",
            }}
          >
            Wear this
          </motion.button>
        </footer>
      </div>
    </div>
  );
};

export default OdaraScreen;
