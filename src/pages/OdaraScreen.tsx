import { useState } from "react";
import { normalizeNotes } from "@/lib/normalizeNotes";
import LayerCard from "@/components/LayerCard";
import type { LayerMood, LayerModes, InteractionType } from "@/components/ModeSelector";

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

/** Build LayerModes from a single oracle layer (same fragrance for all 4 moods) */
function buildLayerModes(layer: OracleLayer): LayerModes {
  const interactionTypes: Record<string, InteractionType> = {
    balance: 'balance',
    bold: 'amplify',
    smooth: 'balance',
    wild: 'contrast',
  };
  const entry = (mood: string) => ({
    id: layer.fragrance_id,
    name: layer.name,
    brand: layer.brand,
    family_key: layer.family,
    notes: layer.notes,
    accords: layer.accords,
    interactionType: interactionTypes[mood] as InteractionType,
    reason: layer.reason || '',
    why_it_works: '',
    projection: null,
  });
  return {
    balance: entry('balance'),
    bold: entry('bold'),
    smooth: entry('smooth'),
    wild: entry('wild'),
  };
}

const OdaraScreen = ({ oracle, oracleLoading, oracleError, onSignOut, selectedContext, onContextChange }: OdaraScreenProps) => {
  const pick = oracle?.today_pick;
  const layer = oracle?.layer;
  const alts = oracle?.alternates ?? [];
  const forecastDays = buildForecastShells();

  // Interactive state
  const [selectedMood, setSelectedMood] = useState<LayerMood>('balance');
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [layerExpanded, setLayerExpanded] = useState(false);
  const [selectedAltIndex, setSelectedAltIndex] = useState<number | null>(null);

  const familyKey = pick?.family ?? '';
  const tint = FAMILY_TINTS[familyKey] ?? DEFAULT_TINT;
  const familyColor = FAMILY_COLORS[familyKey] ?? '#888';
  const familyLabel = FAMILY_LABELS[familyKey] ?? familyKey.toUpperCase();

  const pickAccords = pick?.accords ? normalizeNotes(pick.accords, 4) : [];

  // Build layer modes from oracle layer
  const layerModes = layer ? buildLayerModes(layer) : null;

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}>
      <div className="max-w-md mx-auto px-4 pt-3 pb-6 flex flex-col gap-0">

        {/* Build marker */}
        <span className="text-[8px] tracking-[0.15em] uppercase text-muted-foreground/30 mb-2">{ODARA_DEBUG_BUILD}</span>

        {/* Context chips */}
        <div className="flex gap-1.5 mb-2">
          {CONTEXTS.map(ctx => (
            <button
              key={ctx}
              onClick={() => onContextChange(ctx)}
              className={`text-[11px] uppercase tracking-[0.1em] px-3.5 py-1.5 rounded-full transition-all duration-200 ${
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
            className="rounded-[24px] px-[22px] pt-[14px] pb-[18px] flex flex-col relative overflow-hidden"
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
            <div className="flex items-center mb-1.5 relative z-10">
              <div className="flex items-center gap-2.5 flex-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/40">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70" style={{ fontFamily: "'Geist Mono', monospace" }}>
                  {getTodayLabel()}
                </span>
              </div>
              <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70" style={{ fontFamily: "'Geist Mono', monospace" }}>
                83°
              </span>
            </div>

            {/* Fragrance name */}
            <h2
              className="text-[32px] leading-[1.1] font-normal text-foreground mt-0.5 mb-0.5 text-center"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              {getDisplayName(pick.name, pick.brand)}
            </h2>

            {/* Brand */}
            <span className="text-[13px] text-muted-foreground/60 text-center mb-1.5">
              {pick.brand}
            </span>

            {/* Family label */}
            <span
              className="text-[12px] uppercase tracking-[0.15em] font-medium text-center mb-1.5"
              style={{ color: familyColor }}
            >
              {familyLabel}
            </span>

            {/* Accords */}
            {pickAccords.length > 0 && (
              <p className="text-[13px] text-center mb-3" style={{ lineHeight: 1.5, letterSpacing: '0.06em' }}>
                <span className="text-foreground/50">accords: </span>
                <span className="text-foreground/85 font-medium lowercase">
                  {pickAccords.join(', ')}
                </span>
              </p>
            )}

            {/* ── Layer Card (interactive) ── */}
            {layer && layerModes && (
              <LayerCard
                mainName={pick.name}
                mainBrand={pick.brand}
                mainNotes={pick.notes}
                mainFamily={pick.family}
                mainProjection={null}
                layerModes={layerModes}
                selectedMood={selectedMood}
                onSelectMood={setSelectedMood}
                selectedRatio={selectedRatio}
                onSelectRatio={setSelectedRatio}
                isExpanded={layerExpanded}
                onToggleExpand={() => setLayerExpanded(!layerExpanded)}
              />
            )}

            {/* ── Alternatives (interactive) ── */}
            {alts.length > 0 && (
              <div className="flex flex-col items-center gap-2 mt-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
                  Alternatives
                </span>
                <div className="flex gap-2 overflow-x-auto w-full pb-1 px-1">
                  {alts.map((alt, i) => {
                    const altColor = FAMILY_COLORS[alt.family] ?? '#888';
                    const isSelected = selectedAltIndex === i;
                    return (
                      <button
                        key={alt.fragrance_id || i}
                        onClick={() => setSelectedAltIndex(isSelected ? null : i)}
                        className={`flex-shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200 ${
                          isSelected
                            ? 'text-foreground scale-[1.03]'
                            : 'text-foreground/70 hover:text-foreground/90 active:scale-95'
                        }`}
                        style={{
                          border: `1px solid ${isSelected ? `${altColor}88` : `${altColor}44`}`,
                          background: isSelected ? `${altColor}20` : `${altColor}0A`,
                          boxShadow: isSelected ? `0 0 12px ${altColor}25` : 'none',
                        }}
                      >
                        {getDisplayName(alt.name)}
                      </button>
                    );
                  })}
                </div>
                {/* Selected alternate detail */}
                {selectedAltIndex !== null && alts[selectedAltIndex] && (
                  <div className="w-full px-2 py-2 rounded-lg text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <span className="text-[12px] text-foreground/80">{alts[selectedAltIndex].name}</span>
                    {alts[selectedAltIndex].reason && (
                      <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">{alts[selectedAltIndex].reason}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Forecast strip ── */}
        <div
          className="rounded-[16px] px-5 py-3 mt-2.5 flex flex-col items-center gap-2"
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

        {/* Sign out */}
        <button
          onClick={onSignOut}
          className="text-[10px] text-muted-foreground/30 mt-3 self-center hover:text-muted-foreground/60 transition-colors"
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
