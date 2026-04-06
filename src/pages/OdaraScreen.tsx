import { useState } from "react";
import { normalizeNotes } from "@/lib/normalizeNotes";

const ODARA_DEBUG_BUILD = 'ODARA_PREMIUM_V1';

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
  "oud-amber":       { bg: "rgba(192,138,62,0.10)",  glow: "rgba(192,138,62,0.22)",  border: "rgba(192,138,62,0.16)" },
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

const CONTEXTS = ["daily", "work", "hangout", "date"] as const;

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

const OdaraScreen = ({ oracle, oracleLoading, oracleError, onSignOut, selectedContext, onContextChange }: OdaraScreenProps) => {
  const pick = oracle?.today_pick;
  const layer = oracle?.layer;
  const alts = oracle?.alternates ?? [];
  const forecastDays = buildForecastShells();

  const familyKey = pick?.family ?? '';
  const tint = FAMILY_TINTS[familyKey] ?? DEFAULT_TINT;
  const familyColor = FAMILY_COLORS[familyKey] ?? '#888';
  const familyLabel = FAMILY_LABELS[familyKey] ?? familyKey;

  const pickAccords = pick?.accords ? normalizeNotes(pick.accords, 4) : [];

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}>
      <div className="max-w-md mx-auto px-4 py-6 flex flex-col gap-5">

        {/* Header bar */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground/50">{ODARA_DEBUG_BUILD}</span>
            <h1 className="text-lg tracking-[0.4em] font-bold uppercase">ODARA</h1>
          </div>
          <button
            onClick={onSignOut}
            className="text-[11px] text-muted-foreground border border-border/20 rounded-md px-3 py-1 hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Context chips */}
        <div className="flex gap-2">
          {CONTEXTS.map(ctx => (
            <button
              key={ctx}
              onClick={() => onContextChange(ctx)}
              className={`text-[11px] uppercase tracking-[0.1em] px-3 py-1.5 rounded-full transition-all duration-200 ${
                selectedContext === ctx
                  ? 'bg-foreground/10 text-foreground border border-foreground/20'
                  : 'text-muted-foreground hover:text-foreground/70 border border-transparent'
              }`}
            >
              {ctx}
            </button>
          ))}
        </div>

        {/* Loading / Error */}
        {oracleLoading && (
          <div className="flex flex-col gap-3 items-center py-12">
            <div className="w-8 h-8 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Reading your collection…</span>
          </div>
        )}
        {oracleError && (
          <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(220,60,60,0.08)', border: '1px solid rgba(220,60,60,0.15)', color: '#e55' }}>
            {oracleError}
          </div>
        )}

        {/* ── Today's Pick hero card ── */}
        {!oracleLoading && !oracleError && pick && (
          <div
            className="rounded-[24px] px-[22px] py-5 flex flex-col gap-3 relative overflow-hidden"
            style={{
              background: tint.bg,
              border: `1px solid ${tint.border}`,
              boxShadow: `0 20px 50px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.08)`,
              backdropFilter: 'blur(44px)',
            }}
          >
            {/* Glow orb */}
            <div
              className="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl pointer-events-none"
              style={{ background: tint.glow, opacity: 0.4 }}
            />

            <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">Today's Pick</span>
            <h2 className="text-2xl font-bold text-foreground leading-tight">
              {getDisplayName(pick.name, pick.brand)}
            </h2>
            <span className="text-sm text-muted-foreground">{pick.brand}</span>

            {/* Family label */}
            <span
              className="self-start text-[11px] px-3 py-1 rounded-full"
              style={{ background: `${familyColor}22`, color: familyColor, border: `1px solid ${familyColor}33` }}
            >
              {familyLabel}
            </span>

            {/* Accords */}
            {pickAccords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {pickAccords.map(a => (
                  <span key={a} className="text-[10px] px-2 py-0.5 rounded-full bg-foreground/5 text-muted-foreground border border-foreground/5">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Layer section ── */}
        {!oracleLoading && !oracleError && layer && (
          <div
            className="rounded-[16px] px-5 py-4 flex flex-col gap-2"
            style={{
              background: (FAMILY_TINTS[layer.family] ?? DEFAULT_TINT).bg,
              border: `1px solid ${(FAMILY_TINTS[layer.family] ?? DEFAULT_TINT).border}`,
              boxShadow: '0 10px 30px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.05)',
            }}
          >
            <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">Layer</span>
            <span className="text-lg font-semibold text-foreground">
              {getDisplayName(layer.name, layer.brand)}
            </span>
            <span className="text-xs text-muted-foreground">{layer.brand}</span>
            {layer.family && (
              <span
                className="self-start text-[10px] px-2.5 py-0.5 rounded-full mt-1"
                style={{
                  background: `${FAMILY_COLORS[layer.family] ?? '#888'}22`,
                  color: FAMILY_COLORS[layer.family] ?? '#888',
                  border: `1px solid ${FAMILY_COLORS[layer.family] ?? '#888'}33`,
                }}
              >
                {FAMILY_LABELS[layer.family] ?? layer.family}
              </span>
            )}
            <p className="text-[11px] text-muted-foreground/70 mt-1">{layer.reason}</p>
          </div>
        )}

        {/* ── Alternates row ── */}
        {!oracleLoading && !oracleError && alts.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60 px-1">Alternates</span>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {alts.map((alt, i) => {
                const altColor = FAMILY_COLORS[alt.family] ?? '#888';
                return (
                  <div
                    key={alt.fragrance_id || i}
                    className="flex-shrink-0 rounded-xl px-4 py-3 flex flex-col gap-1 min-w-[140px]"
                    style={{
                      background: (FAMILY_TINTS[alt.family] ?? DEFAULT_TINT).bg,
                      border: `1px solid ${(FAMILY_TINTS[alt.family] ?? DEFAULT_TINT).border}`,
                    }}
                  >
                    <span className="text-sm font-medium text-foreground">{getDisplayName(alt.name)}</span>
                    {alt.family && (
                      <span className="text-[9px] px-2 py-0.5 rounded-full self-start"
                        style={{ background: `${altColor}22`, color: altColor }}>
                        {FAMILY_LABELS[alt.family] ?? alt.family}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Forecast strip (placeholder) ── */}
        <div className="flex flex-col gap-2 mt-2">
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60 px-1">7-Day Forecast</span>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {forecastDays.map((fd, i) => (
              <div
                key={i}
                className={`flex-shrink-0 w-12 rounded-xl py-3 flex flex-col items-center gap-1.5 transition-all ${
                  fd.isToday ? 'border border-foreground/20' : 'border border-transparent'
                }`}
                style={{ background: fd.isToday ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)' }}
              >
                <span className={`text-[9px] uppercase tracking-wider ${fd.isToday ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                  {fd.label}
                </span>
                <span className={`text-xs font-medium ${fd.isToday ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                  {fd.day}
                </span>
                <div className="w-3 h-3 rounded-full bg-foreground/5" />
              </div>
            ))}
          </div>
        </div>

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
