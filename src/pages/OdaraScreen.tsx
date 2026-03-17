import { motion } from "framer-motion";

const OdaraScreen = () => {
  const alternates = ["Agar", "Hafez 1984", "Oasis Elixir"];

  return (
    <div className="dark">
      <div className="min-h-screen bg-background flex flex-col items-center justify-between px-6 py-0 overflow-hidden">
        {/* Header */}
        <header className="flex flex-col items-center pt-12 pb-6">
          <span className="text-[10px] tracking-[0.5em] font-bold text-foreground uppercase">
            ODARA
          </span>
          <span className="text-[9px] tracking-[0.2em] text-muted-foreground uppercase mt-1.5 opacity-60">
            SCENT ORACLE
          </span>
        </header>

        {/* Context line */}
        <p className="text-[11px] font-mono text-muted-foreground/60 mb-6 tracking-wide">
          40° · Hangout · Alexandria Archive
        </p>

        {/* Main Card — The Monolith */}
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
          {/* Title */}
          <h1 className="text-4xl font-serif text-foreground text-center mb-1 leading-tight">
            Valley of the Kings
          </h1>

          {/* Sub-label */}
          <p className="text-xs text-family-accent text-center tracking-[0.2em] mb-5 uppercase">
            oud-amber
          </p>

          {/* Description */}
          <p className="text-sm text-center text-muted-foreground/80 leading-relaxed px-4 mb-8 text-pretty">
            Dark amber lane fits your strongest scent identity.
          </p>

          {/* Sub-Card — The Layer */}
          <div
            className="w-full rounded-[20px] p-5 mb-8"
            style={{
              background: "var(--sub-glass-bg)",
              boxShadow:
                "var(--shadow-sub-glass), inset 0 0 0 1px hsl(var(--family-accent) / 0.1)",
            }}
          >
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
              Layering Suggestion
            </p>
            <p className="text-base font-medium text-foreground">
              Enhance with Mystere 28
            </p>
            <div className="flex justify-between items-center mt-3">
              <span
                className="text-[10px] text-muted-foreground/80 px-2.5 py-1 rounded-full"
                style={{
                  boxShadow:
                    "inset 0 0 0 1px hsl(var(--family-accent) / 0.2)",
                }}
              >
                balance mode
              </span>
              <span className="text-[11px] text-muted-foreground italic">
                Adds lift without breaking depth
              </span>
            </div>
          </div>

          {/* Alternates */}
          <div className="flex gap-2 justify-center mb-2">
            {alternates.map((alt) => (
              <motion.button
                key={alt}
                whileHover={{ backgroundColor: "rgba(255,255,255,0.08)" }}
                className="text-[11px] text-muted-foreground rounded-full px-4 py-2 transition-colors"
                style={{
                  boxShadow:
                    "inset 0 0 0 1px var(--glass-stroke-strong)",
                }}
              >
                {alt}
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* Footer Actions */}
        <footer className="flex items-center justify-between w-full max-w-md px-2 mt-auto pb-12 pt-8">
          <button className="text-xs text-muted-foreground uppercase tracking-[0.15em] hover:text-foreground transition-colors duration-300">
            Not today
          </button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            className="bg-family-accent text-background px-8 py-4 rounded-full text-xs font-bold uppercase tracking-[0.15em] transition-shadow duration-300"
            style={{
              boxShadow: "0 4px 20px hsl(var(--family-accent) / 0.25)",
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
