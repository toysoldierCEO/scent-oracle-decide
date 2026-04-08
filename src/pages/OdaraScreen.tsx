import { useState, useRef, useCallback, useEffect } from "react";
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
  onSkip: (fragranceId: string) => Promise<OracleResult | null>;
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

/**
 * Build LayerModes — all four moods use the SAME real layer fragrance
 * from the oracle. Moods only change the interaction type (how you layer),
 * not which companion scent is used. The backend provides one layer; the
 * frontend must not substitute alternates as fake mood variants.
 */
function buildLayerModes(layer: OracleLayer): LayerModes {
  const MOOD_INTERACTIONS: Record<LayerMood, InteractionType> = {
    balance: 'balance',
    bold: 'amplify',
    smooth: 'balance',
    wild: 'contrast',
  };

  const entry = (mood: LayerMood) => ({
    id: layer.fragrance_id,
    name: layer.name,
    brand: layer.brand,
    family_key: layer.family,
    notes: layer.notes,
    accords: layer.accords,
    interactionType: MOOD_INTERACTIONS[mood],
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

/* ── Lock state type ── */
type LockState = 'neutral' | 'locked' | 'skipping';

/* ── Gesture constants ── */
const DIRECTION_LOCK_THRESHOLD = 8;
const SWIPE_DISTANCE = 28;

/** Build a deduplicated local card queue from the oracle bundle */
function buildCardQueue(oracle: OracleResult): OraclePick[] {
  const seen = new Set<string>();
  const queue: OraclePick[] = [];
  const addPick = (p: OraclePick | OracleAlternate) => {
    if (!p.fragrance_id || seen.has(p.fragrance_id)) return;
    seen.add(p.fragrance_id);
    queue.push({
      fragrance_id: p.fragrance_id,
      name: p.name,
      family: p.family,
      reason: p.reason,
      brand: p.brand ?? '',
      notes: p.notes ?? [],
      accords: p.accords ?? [],
    });
  };
  addPick(oracle.today_pick);
  oracle.alternates.forEach(addPick);
  return queue;
}

const OdaraScreen = ({
  oracle, oracleLoading, oracleError, onSignOut,
  selectedContext, onContextChange,
  selectedDate, onDateChange,
  onAccept, onSkip,
}: OdaraScreenProps) => {
  const [activeOracle, setActiveOracle] = useState<OracleResult | null>(oracle);
  const layer = activeOracle?.layer ?? null;
  const forecastDays = buildForecastDays(selectedDate);

  // ── Local card queue + index ──
  const [cardQueue, setCardQueue] = useState<OraclePick[]>(() => oracle ? buildCardQueue(oracle) : []);
  const [queueIndex, setQueueIndex] = useState(0);

  // Reset when oracle/context/date changes
  useEffect(() => {
    setActiveOracle(oracle);
    const q = oracle ? buildCardQueue(oracle) : [];
    setCardQueue(q);
    setQueueIndex(0);
    setLockState('neutral');
    setLayerExpanded(false);
    setSelectedMood('balance');
  }, [oracle, selectedDate, selectedContext]);

  // The active pick from the queue
  const pick = cardQueue[queueIndex] ?? null;
  const hasHistory = queueIndex > 0;

  // Interactive state
  const [selectedMood, setSelectedMood] = useState<LayerMood>('balance');
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [layerExpanded, setLayerExpanded] = useState(false);

  // Lock & gesture state
  const [lockState, setLockState] = useState<LockState>('neutral');
  const [lockPulse, setLockPulse] = useState(false);
  const [cardTranslateY, setCardTranslateY] = useState(0);

  // Gesture refs
  const gestureRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    lastY: number;
    locked: 'v' | 'h' | null;
    isDragging: boolean;
    suppressClick: boolean;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    lastY: 0,
    locked: null,
    isDragging: false,
    suppressClick: false,
  });
  const unlockTimeoutRef = useRef<number | null>(null);

  const familyKey = pick?.family ?? '';
  const tint = FAMILY_TINTS[familyKey] ?? DEFAULT_TINT;
  const familyColor = FAMILY_COLORS[familyKey] ?? '#888';
  const familyLabel = FAMILY_LABELS[familyKey] ?? familyKey.toUpperCase();
  const pickAccords = pick?.accords ? normalizeNotes(pick.accords, 4) : [];

  // Build layer modes from oracle layer
  const layerModes = layer ? buildLayerModes(layer) : null;

  // Lock icon color
  const lockIconColor = lockState === 'locked' ? '#22c55e' : lockState === 'skipping' ? '#ef4444' : 'currentColor';

  // ── Skip = advance queue index forward ──
  const handleSkipLocal = useCallback(() => {
    if (queueIndex >= cardQueue.length - 1) {
      console.log('[QUEUE] end of queue, cannot skip further');
      return;
    }
    setQueueIndex(i => i + 1);
    setSelectedMood('balance');
    setLayerExpanded(false);
    setLockState('neutral');
  }, [queueIndex, cardQueue.length]);

  // ── Promote alternate into the main card (jump to its queue position) ──
  const handlePromoteAlternate = useCallback((alt: OracleAlternate) => {
    if (lockState === 'locked') return;
    const idx = cardQueue.findIndex(q => q.fragrance_id === alt.fragrance_id);
    if (idx >= 0) {
      setQueueIndex(idx);
    }
    setSelectedMood('balance');
    setLayerExpanded(false);
    setLockState('neutral');
  }, [lockState, cardQueue]);

  // ── Back button — walk backward in queue ──
  const handleBack = useCallback(() => {
    if (queueIndex <= 0) return;
    setQueueIndex(i => i - 1);
    setSelectedMood('balance');
    setLayerExpanded(false);
  }, [queueIndex]);


  const pulseLock = useCallback(() => {
    setLockPulse(true);
    window.setTimeout(() => setLockPulse(false), 400);
  }, []);

  const clearUnlockTimeout = useCallback(() => {
    if (unlockTimeoutRef.current !== null) {
      window.clearTimeout(unlockTimeoutRef.current);
      unlockTimeoutRef.current = null;
    }
  }, []);

  const resetGesture = useCallback(() => {
    gestureRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      lastY: 0,
      locked: null,
      isDragging: false,
      suppressClick: gestureRef.current.suppressClick,
    };
    setCardTranslateY(0);
  }, []);

  useEffect(() => {
    return () => clearUnlockTimeout();
  }, [clearUnlockTimeout]);

  /* ── Gesture handlers ── */
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!pick) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Don't capture gestures on debug controls or interactive nested elements
    const target = e.target as HTMLElement;
    if (target.closest('[data-debug-controls]')) return;

    clearUnlockTimeout();
    gestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastY: 0,
      locked: null,
      isDragging: false,
      suppressClick: false,
    };

    e.currentTarget.setPointerCapture(e.pointerId);
  }, [clearUnlockTimeout, pick]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== e.pointerId) return;

    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;

    if (!gesture.locked) {
      if (Math.abs(dy) < DIRECTION_LOCK_THRESHOLD && Math.abs(dx) < DIRECTION_LOCK_THRESHOLD) {
        return;
      }

      gesture.locked = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
      if (gesture.locked === 'h') {
        resetGesture();
        return;
      }
    }

    if (gesture.locked !== 'v') return;

    gesture.isDragging = true;
    gesture.suppressClick = Math.abs(dy) > DIRECTION_LOCK_THRESHOLD;
    gesture.lastY = dy;

    const clamped = lockState === 'locked'
      ? Math.max(0, Math.min(96, dy))
      : Math.max(-96, Math.min(96, dy));

    setCardTranslateY(clamped);
    e.preventDefault();
  }, [lockState, resetGesture]);

  const completeGesture = useCallback(async (pointerId: number, currentTarget: HTMLDivElement | null) => {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== pointerId) return;

    if (currentTarget?.hasPointerCapture(pointerId)) {
      currentTarget.releasePointerCapture(pointerId);
    }

    const dy = gesture.lastY;
    const wasVertical = gesture.locked === 'v';
    const shouldSuppressClick = gesture.suppressClick;

    gestureRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      lastY: 0,
      locked: null,
      isDragging: false,
      suppressClick: shouldSuppressClick,
    };
    setCardTranslateY(0);

    if (!wasVertical || !pick) return;

    if (lockState === 'locked') {
      if (dy > SWIPE_DISTANCE) {
        clearUnlockTimeout();
        setLockState('neutral');
        pulseLock();
      }
      return;
    }

    if (dy < -SWIPE_DISTANCE) {
      clearUnlockTimeout();
      setLockState('locked');
      pulseLock();
      await onAccept(pick.fragrance_id);
      return;
    }

    if (dy > SWIPE_DISTANCE) {
      clearUnlockTimeout();
      setLockState('skipping');
      try {
        const nextOracle = await onSkip(pick.fragrance_id);
        const nextPick = nextOracle?.today_pick ?? null;

        if (nextOracle && nextPick && nextPick.fragrance_id !== pick.fragrance_id) {
          pushHistory();
          setActiveOracle(nextOracle);
          setCurrentPick(null);
          setSelectedMood('balance');
          setLayerExpanded(false);
        }
        // Fallback: if same pick returned, promote first alternate
        if (nextOracle && nextPick && nextPick.fragrance_id === pick.fragrance_id) {
          const fallbackAlt = alts.find(a => a.fragrance_id !== pick.fragrance_id);
          if (fallbackAlt) {
            pushHistory();
            setCurrentPick({
              fragrance_id: fallbackAlt.fragrance_id,
              name: fallbackAlt.name,
              family: fallbackAlt.family,
              reason: fallbackAlt.reason,
              brand: fallbackAlt.brand ?? '',
              notes: fallbackAlt.notes ?? [],
              accords: fallbackAlt.accords ?? [],
            });
            setSelectedMood('balance');
            setLayerExpanded(false);
          }
        }
      } finally {
        setLockState('neutral');
      }
    }
  }, [alts, clearUnlockTimeout, lockState, onAccept, onSkip, pick, pulseLock, pushHistory]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    void completeGesture(e.pointerId, e.currentTarget);
  }, [completeGesture]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    void completeGesture(e.pointerId, e.currentTarget);
  }, [completeGesture]);

  const handleCardClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!gestureRef.current.suppressClick) return;

    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) {
      e.preventDefault();
      e.stopPropagation();
    }

    gestureRef.current.suppressClick = false;
  }, []);

  const isOverridden = currentPick !== null;

  // Remaining alternates to show (exclude the currently promoted one)
  const visibleAlts = isOverridden
    ? [originalPick, ...alts].filter(Boolean).filter(a => a!.fragrance_id !== pick?.fragrance_id) as OracleAlternate[]
    : alts;

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
              touchAction: 'pan-x',
            }}
            onPointerDownCapture={handlePointerDown}
            onPointerMoveCapture={handlePointerMove}
            onPointerUpCapture={handlePointerUp}
            onPointerCancelCapture={handlePointerCancel}
            onClickCapture={handleCardClickCapture}
          >
            {/* Glow orb */}
            <div
              className="absolute -top-16 -right-16 w-52 h-52 rounded-full blur-3xl pointer-events-none"
              style={{ background: tint.glow, opacity: 0.35 }}
            />

            {/* Top row: lock · centered date · temp */}
            <div className="flex items-center justify-between mb-1.5 relative z-10">
              {/* Left: back or lock */}
              <div className="flex items-center gap-2 w-[60px]">
                {hasHistory ? (
                  <button onClick={handleBack} className="p-0.5 -ml-0.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/60">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </button>
                ) : null}
                <button onClick={() => lockState === 'locked' && setLockState('neutral')} className="p-0.5">
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
                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                      </>
                    )}
                  </svg>
                </button>
              </div>

              {/* Center: date */}
              <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70" style={{ fontFamily: "'Geist Mono', monospace" }}>
                {getDateLabel(selectedDate)}
              </span>

              {/* Right: temp */}
              <div className="w-[60px] flex justify-end">
                <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70" style={{ fontFamily: "'Geist Mono', monospace" }}>
                  83°
                </span>
              </div>
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

            {/* ── Alternatives (tap to promote into main card) ── */}
            {visibleAlts.length > 0 && (
              <div className="flex flex-col items-center gap-2 mt-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
                  Alternatives
                </span>
                <div className="flex gap-2 overflow-x-auto w-full pb-1 px-1" style={{ scrollbarWidth: 'none' }}>
                  {visibleAlts.map((alt, i) => {
                    const altColor = FAMILY_COLORS[alt.family] ?? '#888';
                    return (
                      <button
                        key={alt.fragrance_id || i}
                        onClick={() => handlePromoteAlternate(alt)}
                        className={`flex-shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200
                          text-foreground/70 hover:text-foreground/90 active:scale-95
                          ${lockState === 'locked' ? 'opacity-30 pointer-events-none' : ''}`}
                        style={{
                          border: `1px solid ${altColor}44`,
                          background: `${altColor}0A`,
                        }}
                      >
                        {getDisplayName(alt.name)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Lock state indicator */}
            {lockState === 'locked' && (
              <div className="flex justify-center mt-2">
                <span className="text-[9px] uppercase tracking-[0.18em] px-3 py-1 rounded-full"
                  style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>
                  Locked · swipe down to unlock
                </span>
              </div>
            )}

          </div>
        )}

        {/* ── TEMPORARY DEBUG CONTROLS (outside gesture card) ── */}
        {!oracleLoading && !oracleError && pick && (
          <div className="mt-2 flex flex-col gap-1.5 items-center">
            <div className="flex gap-2 justify-center">
              <button
                onClick={async () => {
                  if (!pick || lockState === 'locked') return;
                  setLockState('locked');
                  pulseLock();
                  await onAccept(pick.fragrance_id);
                }}
                className="text-[9px] px-3 py-1 rounded-full"
                style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}
              >
                🔒 Lock
              </button>
              <button
                onClick={async () => {
                  if (!pick) return;
                  if (lockState === 'locked') {
                    setLockState('neutral');
                    pulseLock();
                    return;
                  }
                  setLockState('skipping');
                  try {
                    const nextOracle = await onSkip(pick.fragrance_id);
                    const nextPick = nextOracle?.today_pick ?? null;
                    console.log('[DEBUG SKIP]', {
                      prevId: pick.fragrance_id,
                      prevName: pick.name,
                      nextId: nextPick?.fragrance_id,
                      nextName: nextPick?.name,
                      same: nextPick?.fragrance_id === pick.fragrance_id,
                      gotOracle: !!nextOracle,
                    });
                    if (nextOracle && nextPick && nextPick.fragrance_id !== pick.fragrance_id) {
                      pushHistory();
                      setActiveOracle(nextOracle);
                      setCurrentPick(null);
                      setSelectedMood('balance');
                      setLayerExpanded(false);
                    }
                    // If backend returned same fragrance, promote first available alternate
                    if (nextOracle && nextPick && nextPick.fragrance_id === pick.fragrance_id) {
                      const fallbackAlt = alts.find(a => a.fragrance_id !== pick.fragrance_id);
                      if (fallbackAlt) {
                        console.log('[DEBUG SKIP] same pick returned, promoting alternate:', fallbackAlt.name);
                        pushHistory();
                        setCurrentPick({
                          fragrance_id: fallbackAlt.fragrance_id,
                          name: fallbackAlt.name,
                          family: fallbackAlt.family,
                          reason: fallbackAlt.reason,
                          brand: fallbackAlt.brand ?? '',
                          notes: fallbackAlt.notes ?? [],
                          accords: fallbackAlt.accords ?? [],
                        });
                        setSelectedMood('balance');
                        setLayerExpanded(false);
                      }
                    }
                  } finally {
                    setLockState('neutral');
                  }
                }}
                className="text-[9px] px-3 py-1 rounded-full"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                ⏭ Skip
              </button>
              <button
                onClick={() => handleBack()}
                disabled={!hasHistory}
                className="text-[9px] px-3 py-1 rounded-full disabled:opacity-20"
                style={{ background: 'rgba(255,255,255,0.08)', color: '#aaa', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                ← Back
              </button>
            </div>
            <pre className="text-[8px] text-muted-foreground/40 text-center leading-relaxed whitespace-pre-wrap">
{`${pick.name} | ${pick.fragrance_id.slice(0,8)}…
lock=${lockState} hist=${history.length}`}
            </pre>
          </div>
        )}
        {/* ── END DEBUG ── */}

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
