import { normalizeNotes } from "@/lib/normalizeNotes";

const ODARA_DEBUG_BUILD = 'ODARA_PREMIUM_V2';

/* ── Fragrance family → color mapping ── */
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

const FAMILY_TINTS: Record<string, { bg: string; glow: string; border: string }> = {
  "oud-amber":       { bg: "rgba(192,138,62,0.10)",  glow: "rgba(192,138,62,0.22)",  border: "rgba(192,138,62,0.18)" },
  "fresh-blue":      { bg: "rgba(91,155,213,0.08)",  glow: "rgba(91,155,213,0.18)",  border: "rgba(91,155,213,0.14)" },
  "tobacco-boozy":   { bg: "rgba(107,66,38,0.10)",   glow: "rgba(107,66,38,0.22)",   border: "rgba(107,66,38,0.16)" },
  "sweet-gourmand":  { bg: "rgba(212,160,86,0.08)",  glow: "rgba(212,160,86,0.18)",  border: "rgba(212,160,86,0.14)" },
  "dark-leather":    { bg: "rgba(139,58,58,0.08)",   glow: "rgba(139,58,58,0.18)",   border: "rgba(139,58,58,0.14)" },
  "woody-clean":     { bg: "rgba(107,155,122,0.08)", glow: "rgba(107,155,122,0.18)", border: "rgba(107,155,122,0.14)" },
  "citrus-cologne":  { bg: "rgba(232,212,77,0.07)",  glow: "rgba(232,212,77,0.15)",  border: "rgba(232,212,77,0.12)" },
  "floral-musk":     { bg: "rgba(196,160,185,0.07)", glow: "rgba(196,160,185,0.15)", border: "rgba(196,160,185,0.12)" },
  "citrus-aromatic": { bg: "rgba(184,201,78,0.07)",  glow: "rgba(184,201,78,0.15)",  border: "rgba(184,201,78,0.12)" },
  "fresh-citrus":    { bg: "rgba(232,212,77,0.07)",  glow: "rgba(232,212,77,0.15)",  border: "rgba(232,212,77,0.12)" },
  "spicy-warm":      { bg: "rgba(212,113,59,0.08)",  glow: "rgba(212,113,59,0.18)",  border: "rgba(212,113,59,0.14)" },
  "fresh-aquatic":   { bg: "rgba(91,192,222,0.08)",  glow: "rgba(91,192,222,0.18)",  border: "rgba(91,192,222,0.14)" },
  "earthy-patchouli":{ bg: "rgba(139,115,85,0.08)",  glow: "rgba(139,115,85,0.18)",  border: "rgba(139,115,85,0.14)" },
  "aromatic-fougere":{ bg: "rgba(107,142,107,0.08)", glow: "rgba(107,142,107,0.18)", border: "rgba(107,142,107,0.14)" },
  "floral-rich":     { bg: "rgba(212,131,158,0.07)", glow: "rgba(212,131,158,0.15)", border: "rgba(212,131,158,0.12)" },
  "green-earthy":    { bg: "rgba(107,142,90,0.07)",  glow: "rgba(107,142,90,0.15)",  border: "rgba(107,142,90,0.12)" },
};

const DEFAULT_TINT = { bg: "rgba(255,255,255,0.03)", glow: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.08)" };

const FAMILY_LABELS: Record<string, string> = {
  "oud-amber": "OUD-AMBER",
  "fresh-blue": "FRESH-BLUE",
  "woody-clean": "WOODY-CLEAN",
  "sweet-gourmand": "SWEET-GOURMAND",
  "dark-leather": "DARK-LEATHER",
  "tobacco-boozy": "TOBACCO-BOOZY",
  "floral-musk": "FLORAL-MUSK",
  "citrus-aromatic": "CITRUS-AROMATIC",
  "citrus-cologne": "CITRUS-COLOGNE",
  "fresh-citrus": "FRESH-CITRUS",
  "spicy-warm": "SPICY-WARM",
  "fresh-aquatic": "FRESH-AQUATIC",
  "earthy-patchouli": "EARTHY-PATCHOULI",
  "aromatic-fougere": "AROMATIC-FOUGÈRE",
  "floral-rich": "FLORAL-RICH",
  "green-earthy": "GREEN-EARTHY",
};

const CONTEXTS = ["daily", "work", "hangout", "date"] as const;
const LAYER_MOODS = ["balance", "bold", "smooth", "wild"] as const;

function getDisplayName(name: string | null | undefined, brand?: string | null): string {
  if (!name) return 'Unknown';
  let display = name
    .replace(/\s+(for\s+(Men|Women|Him|Her|Unisex)|Eau\s+de\s+(Parfum|Toilette|Cologne)|EDP|EDT)\s*$/i, '')
    .trim();
  if (brand) {
    const brandRegex = new RegExp(`\\s+${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    display = display.replace(brandRegex, '').trim();
  }
  return display;
}

/* ── Types ── */
export interface OraclePick {
  fragrance_id: string;
  name: string;
  family: string;
  reason: string;
  brand: string;
  notes: string[];
  accords: string[];
}

export interface OracleLayer {
  fragrance_id: string;
  name: string;
  family: string;
  brand: string;
  notes: string[];
  accords: string[];
  reason: string;
}

export interface OracleAlternate {
  fragrance_id: string;
  name: string;
  family: string;
  reason: string;
}

export interface OracleResult {
  today_pick: OraclePick;
  layer: OracleLayer | null;
  alternates: OracleAlternate[];
}

interface OdaraScreenProps {
  oracle: OracleResult | null;
  oracleLoading: boolean;
  oracleError: string | null;
  onSignOut: () => void;
  selectedContext: string;
  onContextChange: (ctx: string) => void;
}

/* ── Forecast placeholder ── */
function buildForecastShells() {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return { label: dayNames[d.getDay()], day: d.getDate(), isToday: i === 0 };
  });
}

function getTodayLabel() {
  const d = new Date();
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return `${days[d.getDay()]} · ${d.getDate()}`;
}

const OdaraScreen = ({ oracle, oracleLoading, oracleError, onSignOut, selectedContext, onContextChange }: OdaraScreenProps) => {
  const pick = oracle?.today_pick;
  const layer = oracle?.layer;
  const alts = oracle?.alternates ?? [];
  const forecastDays = buildForecastShells();

  const familyKey = pick?.family ?? '';
  const tint = FAMILY_TINTS[familyKey] ?? DEFAULT_TINT;
  const familyColor = FAMILY_COLORS[familyKey] ?? '#888';
  const familyLabel = FAMILY_LABELS[familyKey] ?? familyKey.toUpperCase();

  const pickAccords = pick?.accords ? normalizeNotes(pick.accords, 4) : [];

  const layerFamilyKey = layer?.family ?? '';
  const layerTint = FAMILY_TINTS[layerFamilyKey] ?? DEFAULT_TINT;
  const layerColor = FAMILY_COLORS[layerFamilyKey] ?? '#888';
  const layerLabel = FAMILY_LABELS[layerFamilyKey] ?? layerFamilyKey.toUpperCase();
  const layerAccords = layer?.accords ? normalizeNotes(layer.accords, 4) : [];

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}>
      <div className="max-w-md mx-auto px-4 pt-4 pb-6 flex flex-col gap-0">

        {/* Build marker - tiny */}
        <span className="text-[8px] tracking-[0.15em] uppercase text-muted-foreground/30 mb-3">{ODARA_DEBUG_BUILD}</span>

        {/* Context chips */}
        <div className="flex gap-2 mb-3">
          {CONTEXTS.map(ctx => (
            <button
              key={ctx}
              onClick={() => onContextChange(ctx)}
              className={`text-[11px] uppercase tracking-[0.1em] px-4 py-1.5 rounded-full transition-all duration-200 ${
                selectedContext === ctx
                  ? 'bg-foreground/10 text-foreground border border-foreground/20'
                  : 'text-muted-foreground/50 hover:text-foreground/70 border border-transparent'
              }`}
            >
              {ctx}
            </button>
          ))}
        </div>

        {/* Loading / Error */}
        {oracleLoading && (
          <div className="flex flex-col gap-3 items-center py-16">
            <div className="w-8 h-8 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Reading your collection…</span>
          </div>
        )}
        {oracleError && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(220,60,60,0.08)', border: '1px solid rgba(220,60,60,0.15)', color: '#e55' }}>
            {oracleError}
          </div>
        )}

        {/* ── Unified main card ── */}
        {!oracleLoading && !oracleError && pick && (
          <div
            className="rounded-[24px] px-[22px] pt-[16px] pb-[20px] flex flex-col relative overflow-hidden"
            style={{
              background: `linear-gradient(165deg, ${tint.bg} 0%, rgba(15,12,8,0.97) 70%)`,
              border: `1px solid ${tint.border}`,
              boxShadow: `0 24px 60px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.06)`,
            }}
          >
            {/* Glow orb */}
            <div
              className="absolute -top-16 -right-16 w-52 h-52 rounded-full blur-3xl pointer-events-none"
              style={{ background: tint.glow, opacity: 0.35 }}
            />

            {/* Top row: lock · date · temp */}
            <div className="flex items-center mb-2 relative z-10">
              <div className="flex items-center gap-3 flex-1">
                {/* Lock icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/40">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                {/* Date */}
                <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70" style={{ fontFamily: "'Geist Mono', monospace" }}>
                  {getTodayLabel()}
                </span>
              </div>
              {/* Temperature */}
              <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70" style={{ fontFamily: "'Geist Mono', monospace" }}>
                83°
              </span>
            </div>

            {/* Fragrance name — large serif */}
            <h2
              className="text-[32px] leading-[1.1] font-normal text-foreground mt-1 mb-1 text-center"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              {getDisplayName(pick.name, pick.brand)}
            </h2>

            {/* Brand */}
            <span className="text-[13px] text-muted-foreground/60 text-center mb-2">
              {pick.brand}
            </span>

            {/* Family label — text, not pill */}
            <span
              className="text-[12px] uppercase tracking-[0.15em] font-medium text-center mb-2"
              style={{ color: familyColor }}
            >
              {familyLabel}
            </span>

            {/* Accords — inline text */}
            {pickAccords.length > 0 && (
              <p className="text-[13px] text-center mb-4" style={{ lineHeight: 1.5, letterSpacing: '0.06em' }}>
                <span className="text-foreground/50">accords: </span>
                <span className="text-foreground/85 font-medium lowercase">
                  {pickAccords.join(', ')}
                </span>
              </p>
            )}

            {/* ── Nested Layer Card ── */}
            {layer && (
              <div
                className="rounded-[16px] px-5 py-4 flex flex-col items-center gap-1.5 mb-3 relative"
                style={{
                  background: `linear-gradient(170deg, ${layerTint.bg} 0%, rgba(12,8,6,0.95) 80%)`,
                  border: `1px solid ${layerTint.border}`,
                  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.4)',
                }}
              >
                {/* Layer name */}
                <span
                  className="text-[20px] font-normal text-foreground text-center"
                  style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
                >
                  {getDisplayName(layer.name, layer.brand)}
                </span>
                {/* Layer brand */}
                <span className="text-[11px] text-muted-foreground/50">{layer.brand}</span>
                {/* Layer family pill */}
                <span
                  className="text-[10px] uppercase tracking-[0.12em] px-3 py-0.5 rounded-full mt-1"
                  style={{
                    background: `${layerColor}18`,
                    color: layerColor,
                    border: `1px solid ${layerColor}33`,
                  }}
                >
                  {layerLabel}
                </span>
                {/* Layer accords */}
                {layerAccords.length > 0 && (
                  <p className="text-[12px] mt-1.5" style={{ letterSpacing: '0.06em' }}>
                    <span className="text-foreground/40">accords: </span>
                    <span className="text-foreground/75 font-medium lowercase">{layerAccords.join(', ')}</span>
                  </p>
                )}
                {/* Mode chips */}
                <div className="flex gap-1.5 mt-2">
                  {LAYER_MOODS.map((mood, i) => (
                    <span
                      key={mood}
                      className={`text-[10px] uppercase tracking-[0.12em] px-3 py-1 rounded-full ${
                        i === 0
                          ? 'text-foreground/90 border border-foreground/20 bg-foreground/8'
                          : 'text-foreground/30'
                      }`}
                    >
                      {mood}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Alternatives inside card ── */}
            {alts.length > 0 && (
              <div className="flex flex-col items-center gap-3 mt-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
                  Alternatives
                </span>
                <div className="flex gap-2.5 overflow-x-auto w-full pb-1 px-1">
                  {alts.map((alt, i) => {
                    const altColor = FAMILY_COLORS[alt.family] ?? '#888';
                    return (
                      <div
                        key={alt.fragrance_id || i}
                        className="flex-shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium text-foreground/90"
                        style={{
                          border: `1px solid ${altColor}44`,
                          background: `${altColor}0A`,
                        }}
                      >
                        {getDisplayName(alt.name)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Forecast strip — separate panel ── */}
        <div
          className="rounded-[16px] px-5 py-3 mt-3 flex flex-col items-center gap-2"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
            Forecast
          </span>
          <div className="flex w-full justify-between">
            {forecastDays.map((fd, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <span className={`text-[11px] ${fd.isToday ? 'text-foreground font-semibold' : 'text-muted-foreground/40'}`}>
                  {fd.label}
                </span>
                <span className={`text-[13px] font-medium ${fd.isToday ? 'text-foreground' : 'text-muted-foreground/30'}`}>
                  {fd.day}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Sign out — subtle */}
        <button
          onClick={onSignOut}
          className="text-[10px] text-muted-foreground/30 mt-4 self-center hover:text-muted-foreground/60 transition-colors"
        >
          Sign out
        </button>

        {/* No data state */}
        {!oracleLoading && !oracleError && !oracle && (
          <div className="text-center py-12">
            <span className="text-sm text-muted-foreground">No oracle data returned</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default OdaraScreen;
