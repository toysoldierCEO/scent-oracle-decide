import { useState, useRef, useCallback } from "react";
import { normalizeNotes } from "@/lib/normalizeNotes";
import LayerCard from "@/components/LayerCard";
import type { LayerMood, LayerModes, InteractionType } from "@/components/ModeSelector";

const ODARA_DEBUG_BUILD = 'ODARA_PREMIUM_V2';

/* ── Fragrance family → color mapping ── */
const FAMILY_COLORS: Record<string, string> = {
  "oud-amber": "#D4A373", "fresh-blue": "#4DA3FF", "tobacco-boozy": "#8B5E3C",
  "sweet-gourmand": "#C77DFF", "dark-leather": "#5A3A2E", "woody-clean": "#7FAF8E",
  "citrus-cologne": "#F4D35E", "floral-musk": "#C4A0B9", "citrus-aromatic": "#B8C94E",
  "fresh-citrus": "#F4D35E", "spicy-warm": "#D4713B", "fresh-aquatic": "#5BC0DE",
  "earthy-patchouli": "#8B7355", "aromatic-fougere": "#6B8E6B", "floral-rich": "#D4839E",
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
  "oud-amber": "OUD-AMBER", "fresh-blue": "FRESH-BLUE", "woody-clean": "WOODY-CLEAN",
  "sweet-gourmand": "SWEET-GOURMAND", "dark-leather": "DARK-LEATHER", "tobacco-boozy": "TOBACCO-BOOZY",
  "floral-musk": "FLORAL-MUSK", "citrus-aromatic": "CITRUS-AROMATIC", "citrus-cologne": "CITRUS-COLOGNE",
  "fresh-citrus": "FRESH-CITRUS", "spicy-warm": "SPICY-WARM", "fresh-aquatic": "FRESH-AQUATIC",
  "earthy-patchouli": "EARTHY-PATCHOULI", "aromatic-fougere": "AROMATIC-FOUGÈRE",
  "floral-rich": "FLORAL-RICH", "green-earthy": "GREEN-EARTHY",
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
  fragrance_id: string; name: string; family: string; reason: string;
  brand: string; notes: string[]; accords: string[];
}

export interface OracleLayer {
  fragrance_id: string; name: string; family: string; brand: string;
  notes: string[]; accords: string[]; reason: string;
}

export interface OracleAlternate {
  fragrance_id: string; name: string; family: string; reason: string;
  brand?: string; notes?: string[]; accords?: string[];
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
  selectedDate: string;
  onDateChange: (date: string) => void;
  onAccept: (fragranceId: string) => Promise<void>;
  onSkip: (fragranceId: string) => Promise<void>;
}

/* ── Forecast days ── */
function buildForecastDays(selectedDate: string) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    return {
      label: dayNames[d.getDay()],
      day: d.getDate(),
      dateStr,
      isToday: dateStr === todayStr,
      isSelected: dateStr === selectedDate,
    };
  });
}

function getDateLabel(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return `${days[d.getDay()]} · ${d.getDate()}`;
}

/** Build LayerModes: balance→layer, bold/smooth/wild→alternates when available */
function buildLayerModes(layer: OracleLayer, alternates: OracleAlternate[]): LayerModes {
  const interactionTypes: Record<string, InteractionType> = {
    balance: 'balance', bold: 'amplify', smooth: 'balance', wild: 'contrast',
  };

  const fromLayer = (mood: string) => ({
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

  const fromAlt = (alt: OracleAlternate, mood: string) => ({
    id: alt.fragrance_id,
    name: alt.name,
    brand: alt.brand ?? null,
    family_key: alt.family,
    notes: alt.notes ?? [],
    accords: alt.accords ?? [],
    interactionType: interactionTypes[mood] as InteractionType,
    reason: alt.reason || '',
    why_it_works: '',
    projection: null,
  });

  // Map moods to different fragrances: balance→layer, others→distinct alternates
  // Only use alternates that differ from the layer fragrance
  const distinctAlts = alternates.filter(a => a.fragrance_id !== layer.fragrance_id);

  return {
    balance: fromLayer('balance'),
    bold: distinctAlts[0] ? fromAlt(distinctAlts[0], 'bold') : fromLayer('bold'),
    smooth: distinctAlts[1] ? fromAlt(distinctAlts[1], 'smooth') : fromLayer('smooth'),
    wild: distinctAlts[2] ? fromAlt(distinctAlts[2], 'wild') : fromLayer('wild'),
  };
}

/* ── Lock state type ── */
type LockState = 'neutral' | 'locked' | 'skipping';

/* ── Gesture constants ── */
const DIRECTION_LOCK_THRESHOLD = 12;
const SWIPE_DISTANCE = 50;

const OdaraScreen = ({
  oracle, oracleLoading, oracleError, onSignOut,
  selectedContext, onContextChange,
  selectedDate, onDateChange,
  onAccept, onSkip,
}: OdaraScreenProps) => {
  const pick = oracle?.today_pick;
  const layer = oracle?.layer;
  const alts = oracle?.alternates ?? [];
  const forecastDays = buildForecastDays(selectedDate);

  // Interactive state
  const [selectedMood, setSelectedMood] = useState<LayerMood>('balance');
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [layerExpanded, setLayerExpanded] = useState(false);
  const [selectedAltIndex, setSelectedAltIndex] = useState<number | null>(null);

  // Lock & gesture state
  const [lockState, setLockState] = useState<LockState>('neutral');
  const [lockPulse, setLockPulse] = useState(false);
  const [cardTranslateY, setCardTranslateY] = useState(0);

  // Touch refs
  const touchRef = useRef<{ startX: number; startY: number; locked: 'v' | 'h' | null }>({ startX: 0, startY: 0, locked: null });

  const familyKey = pick?.family ?? '';
  const tint = FAMILY_TINTS[familyKey] ?? DEFAULT_TINT;
  const familyColor = FAMILY_COLORS[familyKey] ?? '#888';
  const familyLabel = FAMILY_LABELS[familyKey] ?? familyKey.toUpperCase();
  const pickAccords = pick?.accords ? normalizeNotes(pick.accords, 4) : [];

  // Build layer modes from oracle layer + alternates
  const layerModes = layer ? buildLayerModes(layer, alts) : null;

  // Lock icon color
  const lockIconColor = lockState === 'locked' ? '#22c55e' : lockState === 'skipping' ? '#ef4444' : 'currentColor';

  /* ── Gesture handlers ── */
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (lockState === 'locked') return; // no gestures when locked
    const t = e.touches[0];
    touchRef.current = { startX: t.clientX, startY: t.clientY, locked: null };
  }, [lockState]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (lockState === 'locked') return;
    const t = e.touches[0];
    const dx = t.clientX - touchRef.current.startX;
    const dy = t.clientY - touchRef.current.startY;

    // Direction lock
    if (!touchRef.current.locked) {
      if (Math.abs(dy) > DIRECTION_LOCK_THRESHOLD || Math.abs(dx) > DIRECTION_LOCK_THRESHOLD) {
        touchRef.current.locked = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
      } else return;
    }

    if (touchRef.current.locked === 'v') {
      // Clamp vertical drag for visual feedback
      const clamped = Math.max(-80, Math.min(80, dy));
      setCardTranslateY(clamped);
    }
  }, [lockState]);

  const handleTouchEnd = useCallback(async () => {
    if (lockState === 'locked') return;
    const dy = cardTranslateY;
    setCardTranslateY(0);

    if (touchRef.current.locked !== 'v') return;
    if (!pick) return;

    if (dy < -SWIPE_DISTANCE) {
      // Swipe UP → lock
      setLockState('locked');
      setLockPulse(true);
      setTimeout(() => setLockPulse(false), 400);
      await onAccept(pick.fragrance_id);
    } else if (dy > SWIPE_DISTANCE) {
      // Swipe DOWN → skip
      setLockState('skipping');
      setTimeout(() => setLockState('neutral'), 600);
      await onSkip(pick.fragrance_id);
    }
  }, [cardTranslateY, lockState, pick, onAccept, onSkip]);

  // Unlock handler
  const handleUnlock = useCallback(() => {
    if (lockState === 'locked') {
      setLockState('neutral');
    }
  }, [lockState]);

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}>
      <div className="max-w-md mx-auto px-4 pt-3 pb-6 flex flex-col gap-0">

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

        {/* ── Unified main card with gestures ── */}
        {!oracleLoading && !oracleError && pick && (
          <div
            className="rounded-[24px] px-[22px] pt-[14px] pb-[18px] flex flex-col relative overflow-hidden transition-transform duration-150"
            style={{
              background: `linear-gradient(165deg, ${tint.bg} 0%, rgba(15,12,8,0.97) 70%)`,
              border: `1px solid ${tint.border}`,
              boxShadow: `0 24px 60px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.06)`,
              transform: `translateY(${cardTranslateY * 0.4}px)`,
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Glow orb */}
            <div
              className="absolute -top-16 -right-16 w-52 h-52 rounded-full blur-3xl pointer-events-none"
              style={{ background: tint.glow, opacity: 0.35 }}
            />

            {/* Top row: lock · date · temp */}
            <div className="flex items-center mb-1.5 relative z-10">
              <div className="flex items-center gap-2.5 flex-1">
                <button onClick={handleUnlock} className="p-0.5 -ml-0.5">
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke={lockIconColor} strokeWidth="1.5"
                    className="transition-colors duration-300"
                    style={lockPulse ? { filter: `drop-shadow(0 0 6px ${lockIconColor})` } : undefined}
                  >
                    {lockState === 'locked' ? (
                      <>
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                      </>
                    ) : (
                      <>
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                      </>
                    )}
                  </svg>
                </button>
                <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70" style={{ fontFamily: "'Geist Mono', monospace" }}>
                  {getDateLabel(selectedDate)}
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

            {/* ── Layer Card (interactive, mood-mapped) ── */}
            {layer && layerModes && (
              <LayerCard
                mainName={pick.name}
                mainBrand={pick.brand}
                mainNotes={pick.notes}
                mainFamily={pick.family}
                mainProjection={null}
                layerModes={layerModes}
                selectedMood={selectedMood}
                onSelectMood={lockState !== 'locked' ? setSelectedMood : () => {}}
                selectedRatio={selectedRatio}
                onSelectRatio={setSelectedRatio}
                isExpanded={layerExpanded}
                onToggleExpand={() => setLayerExpanded(!layerExpanded)}
                lockPulse={lockPulse}
                locked={lockState === 'locked'}
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
                        onClick={() => {
                          if (lockState === 'locked') return;
                          setSelectedAltIndex(isSelected ? null : i);
                        }}
                        className={`flex-shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200 ${
                          isSelected
                            ? 'text-foreground scale-[1.03]'
                            : 'text-foreground/70 hover:text-foreground/90 active:scale-95'
                        } ${lockState === 'locked' && !isSelected ? 'opacity-30' : ''}`}
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

            {/* Lock state indicator */}
            {lockState === 'locked' && (
              <div className="flex justify-center mt-2">
                <span className="text-[9px] uppercase tracking-[0.18em] px-3 py-1 rounded-full"
                  style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>
                  Locked · tap lock to undo
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Clickable Forecast strip ── */}
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
            {forecastDays.map((fd, i) => {
              const dayColor = fd.isSelected ? familyColor : undefined;
              return (
                <button
                  key={i}
                  onClick={() => onDateChange(fd.dateStr)}
                  className="flex flex-col items-center gap-0.5 px-1 py-1 rounded-lg transition-all duration-200"
                  style={fd.isSelected ? {
                    background: `${dayColor}15`,
                    boxShadow: `0 0 8px ${dayColor}20`,
                  } : undefined}
                >
                  <span className={`text-[11px] transition-colors ${
                    fd.isSelected ? 'text-foreground font-semibold' : fd.isToday ? 'text-foreground/60' : 'text-muted-foreground/40'
                  }`}>
                    {fd.label}
                  </span>
                  <span className={`text-[13px] font-medium transition-colors ${
                    fd.isSelected ? 'text-foreground' : fd.isToday ? 'text-foreground/60' : 'text-muted-foreground/30'
                  }`}>
                    {fd.day}
                  </span>
                  {/* Day dot - family colored for selected */}
                  <div
                    className="w-1 h-1 rounded-full mt-0.5 transition-all"
                    style={{
                      background: fd.isSelected ? dayColor : fd.isToday ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)',
                      boxShadow: fd.isSelected ? `0 0 4px ${dayColor}` : 'none',
                    }}
                  />
                </button>
              );
            })}
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
