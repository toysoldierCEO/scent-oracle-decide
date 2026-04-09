import { useState, useRef, useCallback, useEffect } from "react";
import { normalizeNotes } from "@/lib/normalizeNotes";
import { odaraSupabase } from "@/lib/odara-client";
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
  ratio_hint?: string;
  application_style?: string;
  placement_hint?: string;
  spray_guidance?: string;
  why_it_works?: string;
  layer_score?: number;
  layer_mode?: string;
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

/** Backend mood-mode entry from get_layer_card_modes_v1 */
interface BackendModeEntry {
  mode: string;
  layer_fragrance_id: string;
  layer_name: string;
  layer_brand: string;
  layer_family: string;
  layer_notes: string[];
  layer_accords: string[];
  layer_score: number;
  reason: string;
  why_it_works: string;
  ratio_hint: string;
  application_style: string;
  placement_hint: string;
  spray_guidance: string;
  interaction_type: string;
}

/** Full payload cached per fragrance_id */
interface LayerModesPayload {
  layer_name: string;
  layer_brand: string;
  layer_family: string;
  layer_score: number;
  default_mode: string;
  default_reason: string;
  default_ratio_hint: string;
  default_application_style: string;
  default_placement_hint: string;
  default_spray_guidance: string;
  default_why_it_works: string;
  modes: Record<string, BackendModeEntry>;
}

/** A card from get_home_card_queue_v1 */
interface QueueCard {
  queue_rank: number;
  fragrance_id: string;
  name: string;
  brand: string;
  family_key: string;
  source: string;
  why_this: string;
  collection_status: string;
  is_in_collection: boolean;
  preview: any;
}

/** Normalized card for display — shared between hero and queue */
interface DisplayCard {
  fragrance_id: string;
  name: string;
  family: string;
  reason: string;
  brand: string;
  notes: string[];
  accords: string[];
  isHero: boolean; // true = oracle hero, false = queue card
}

type HistoryEntry = {
  card: DisplayCard;
  queuePointerBefore: number;
};

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
  userId: string;
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

/* ── Lock state type ── */
type LockState = 'neutral' | 'locked' | 'skipping';

/* ── Gesture constants ── */
const DIRECTION_LOCK_THRESHOLD = 8;
const SWIPE_DISTANCE = 28;

function backendModesToLayerModes(payload: LayerModesPayload): LayerModes {
  const MOODS: LayerMood[] = ['balance', 'bold', 'smooth', 'wild'];
  const result: Partial<LayerModes> = {};
  for (const mood of MOODS) {
    const m = payload.modes[mood];
    if (!m) {
      result[mood] = null;
      continue;
    }
    result[mood] = {
      id: m.layer_fragrance_id,
      name: m.layer_name,
      brand: m.layer_brand,
      family_key: m.layer_family,
      notes: Array.isArray(m.layer_notes) ? m.layer_notes : [],
      accords: Array.isArray(m.layer_accords) ? m.layer_accords : [],
      interactionType: (m.interaction_type as InteractionType) || 'balance',
      reason: m.reason || payload.default_reason || '',
      why_it_works: m.why_it_works || payload.default_why_it_works || '',
      projection: null,
    };
  }
  return result as LayerModes;
}

/** Convert a QueueCard to a DisplayCard */
function queueCardToDisplay(qc: QueueCard): DisplayCard {
  const preview = qc.preview ?? {};
  return {
    fragrance_id: qc.fragrance_id,
    name: qc.name ?? '',
    family: qc.family_key ?? '',
    reason: qc.why_this ?? '',
    brand: qc.brand ?? '',
    notes: Array.isArray(preview.notes) ? preview.notes : [],
    accords: Array.isArray(preview.accords) ? preview.accords : [],
    isHero: false,
  };
}

/** Convert an OraclePick to a DisplayCard (hero) */
function heroToDisplay(pick: OraclePick): DisplayCard {
  return {
    ...pick,
    isHero: true,
  };
}

const OdaraScreen = ({
  oracle, oracleLoading, oracleError, onSignOut,
  selectedContext, onContextChange,
  selectedDate, onDateChange,
  onAccept, onSkip, userId,
}: OdaraScreenProps) => {
  const [activeOracle, setActiveOracle] = useState<OracleResult | null>(oracle);
  // heroLayer no longer used — all layer resolution goes through get_layer_for_card_v1
  const forecastDays = buildForecastDays(selectedDate);

  // ── Queue from get_home_card_queue_v1 ──
  const [queue, setQueue] = useState<DisplayCard[]>([]);
  const [queuePointer, setQueuePointer] = useState(0);
  const [viewHistory, setViewHistory] = useState<HistoryEntry[]>([]);
  const [skipLoading, setSkipLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  // The visible card: starts as oracle hero, then walks through queue
  const [visibleCard, setVisibleCard] = useState<DisplayCard | null>(null);

  // ── Per-card layer modes cache (from get_layer_card_modes_v1) ──
  const modesCacheRef = useRef<Map<string, LayerModesPayload | null>>(new Map());
  const [resolvedModesPayload, setResolvedModesPayload] = useState<LayerModesPayload | null>(null);
  const [layerDebugSource, setLayerDebugSource] = useState<string>('none');

  const hasHistory = viewHistory.length > 0;

  // Fetch queue from backend
  const fetchQueue = useCallback(async (excludeId?: string) => {
    try {
      setQueueError(null);
      const { data, error } = await odaraSupabase.rpc('get_home_card_queue_v1' as any, {
        p_user: userId,
        p_context: selectedContext,
        p_temperature: 75,
        p_brand: 'Alexandria Fragrances',
        p_wear_date: selectedDate,
        p_limit: 20,
      });
      if (error) {
        setQueueError(error.message);
        return [];
      }
      const rows = (data as unknown as QueueCard[]) ?? [];
      const filtered = excludeId
        ? rows.filter(r => r.fragrance_id !== excludeId)
        : rows;
      return filtered.map(queueCardToDisplay);
    } catch (e: any) {
      setQueueError(e?.message ?? 'Queue fetch failed');
      return [];
    }
  }, [userId, selectedContext, selectedDate]);

  // Interactive state
  const [selectedMood, setSelectedMood] = useState<LayerMood>('balance');
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [layerExpanded, setLayerExpanded] = useState(false);

  // Lock & gesture state
  const [lockState, setLockState] = useState<LockState>('neutral');
  const [lockPulse, setLockPulse] = useState(false);
  const [cardTranslateY, setCardTranslateY] = useState(0);

  // Resolve layer modes for any visible card via get_layer_card_modes_v1
  const resolveModesForCard = useCallback(async (card: DisplayCard) => {
    const cached = modesCacheRef.current.get(card.fragrance_id);
    if (cached !== undefined) {
      setResolvedModesPayload(cached);
      setLayerDebugSource(cached ? 'cache' : 'cache(null)');
      return;
    }

    try {
      setLayerDebugSource('rpc…');
      const { data, error } = await odaraSupabase.rpc('get_layer_card_modes_v1' as any, {
        p_user: userId,
        p_fragrance_id: card.fragrance_id,
        p_context: selectedContext,
        p_temperature: 75,
        p_brand: 'Alexandria Fragrances',
        p_wear_date: selectedDate,
      });

      if (error) {
        modesCacheRef.current.set(card.fragrance_id, null);
        setResolvedModesPayload(null);
        setLayerDebugSource(`err:${error.message}`);
        return;
      }

      // RPC returns table rows — one row per mood
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        modesCacheRef.current.set(card.fragrance_id, null);
        setResolvedModesPayload(null);
        setLayerDebugSource('rpc(empty)');
        return;
      }

      // Build payload from rows
      const first = rows[0] as any;
      const modesMap: Record<string, BackendModeEntry> = {};
      for (const r of rows) {
        const row = r as any;
        if (row.mode) {
          modesMap[row.mode] = {
            mode: row.mode,
            layer_fragrance_id: row.layer_fragrance_id ?? '',
            layer_name: row.layer_name ?? '',
            layer_brand: row.layer_brand ?? '',
            layer_family: row.layer_family ?? '',
            layer_notes: Array.isArray(row.layer_notes) ? row.layer_notes : [],
            layer_accords: Array.isArray(row.layer_accords) ? row.layer_accords : [],
            layer_score: row.layer_score ?? 0,
            reason: row.reason ?? '',
            why_it_works: row.why_it_works ?? '',
            ratio_hint: row.ratio_hint ?? '',
            application_style: row.application_style ?? '',
            placement_hint: row.placement_hint ?? '',
            spray_guidance: row.spray_guidance ?? '',
            interaction_type: row.interaction_type ?? 'balance',
          };
        }
      }

      const payload: LayerModesPayload = {
        layer_name: first.layer_name ?? '',
        layer_brand: first.layer_brand ?? '',
        layer_family: first.layer_family ?? '',
        layer_score: first.layer_score ?? 0,
        default_mode: first.default_mode ?? first.mode ?? 'balance',
        default_reason: first.default_reason ?? first.reason ?? '',
        default_ratio_hint: first.default_ratio_hint ?? first.ratio_hint ?? '',
        default_application_style: first.default_application_style ?? first.application_style ?? '',
        default_placement_hint: first.default_placement_hint ?? first.placement_hint ?? '',
        default_spray_guidance: first.default_spray_guidance ?? first.spray_guidance ?? '',
        default_why_it_works: first.default_why_it_works ?? first.why_it_works ?? '',
        modes: modesMap,
      };

      modesCacheRef.current.set(card.fragrance_id, payload);
      setResolvedModesPayload(payload);
      setLayerDebugSource('rpc');
    } catch (e: any) {
      modesCacheRef.current.set(card.fragrance_id, null);
      setResolvedModesPayload(null);
      setLayerDebugSource(`err:${e?.message}`);
    }
  }, [userId, selectedContext, selectedDate]);

  // Initialize on oracle/context/date change
  useEffect(() => {
    setActiveOracle(oracle);
    modesCacheRef.current.clear();
    if (oracle?.today_pick) {
      const hero = heroToDisplay(oracle.today_pick);
      setVisibleCard(hero);
      fetchQueue(oracle.today_pick.fragrance_id).then(q => {
        setQueue(q);
        setQueuePointer(0);
      });
    } else {
      setVisibleCard(null);
      setResolvedModesPayload(null);
      setLayerDebugSource('none');
      setQueue([]);
      setQueuePointer(0);
    }
    setViewHistory([]);
    setLockState('neutral');
    setLayerExpanded(false);
    setSelectedMood('balance');
  }, [oracle, selectedDate, selectedContext, fetchQueue]);

  // Resolve layer modes whenever visible card changes
  useEffect(() => {
    if (visibleCard) {
      resolveModesForCard(visibleCard);
    } else {
      setResolvedModesPayload(null);
      setLayerDebugSource('no-card');
    }
  }, [visibleCard, resolveModesForCard]);

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

  const oracleHeroId = activeOracle?.today_pick?.fragrance_id ?? null;
  const isShowingHeroCard =
    !!visibleCard &&
    !!oracleHeroId &&
    visibleCard.fragrance_id === oracleHeroId;

  const familyKey = visibleCard?.family ?? '';
  const tint = FAMILY_TINTS[familyKey] ?? DEFAULT_TINT;
  const familyColor = FAMILY_COLORS[familyKey] ?? '#888';
  const familyLabel = FAMILY_LABELS[familyKey] ?? familyKey.toUpperCase();
  const pickAccords = visibleCard?.accords ? normalizeNotes(visibleCard.accords, 4) : [];

  // Build layer modes from backend payload — works for hero AND queue cards
  const layerModes = resolvedModesPayload ? backendModesToLayerModes(resolvedModesPayload) : null;
  const currentModeData = resolvedModesPayload?.modes[selectedMood] ?? null;

  // Lock icon color
  const lockIconColor = lockState === 'locked' ? '#22c55e' : lockState === 'skipping' ? '#ef4444' : 'currentColor';

  // ── Skip = advance through queue cards ──
  const handleSkipLocal = useCallback(async () => {
    if (skipLoading || !visibleCard) return;

    setSkipLoading(true);
    try {
      void odaraSupabase.rpc('skip_today_pick_v1' as any, {
        p_user: userId,
        p_fragrance_id: visibleCard.fragrance_id,
        p_context: selectedContext,
      });

      setViewHistory(h => [
        ...h,
        {
          card: visibleCard,
          queuePointerBefore: queuePointer,
        },
      ]);

      if (queuePointer < queue.length) {
        const nextCard = queue[queuePointer];
        setVisibleCard(nextCard);
        setQueuePointer(queuePointer + 1);
      } else {
        const newQueue = await fetchQueue(visibleCard.fragrance_id);
        if (newQueue.length > 0) {
          setQueue(newQueue);
          setVisibleCard(newQueue[0]);
          setQueuePointer(1);
        }
      }

      setSelectedMood('balance');
      setLayerExpanded(false);
      setLockState('neutral');
    } finally {
      setSkipLoading(false);
    }
  }, [skipLoading, visibleCard, queue, queuePointer, fetchQueue, userId, selectedContext]);

  // ── Back button — restore exact history snapshot ──
  const handleBack = useCallback(() => {
    if (viewHistory.length === 0) return;
    const entry = viewHistory[viewHistory.length - 1];

    setVisibleCard(entry.card);
    setQueuePointer(entry.queuePointerBefore);
    setViewHistory(h => h.slice(0, -1));
    setSelectedMood('balance');
    setLayerExpanded(false);
    setLockState('neutral');
  }, [viewHistory]);

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
    if (!visibleCard) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
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
  }, [clearUnlockTimeout, visibleCard]);

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

    if (!wasVertical || !visibleCard) return;

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
      await onAccept(visibleCard.fragrance_id);
      return;
    }

    if (dy > SWIPE_DISTANCE) {
      clearUnlockTimeout();
      void handleSkipLocal();
    }
  }, [clearUnlockTimeout, handleSkipLocal, lockState, onAccept, visibleCard, pulseLock]);

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

  // Alternates from oracle — only shown for hero card
  const visibleAlts = (isShowingHeroCard && activeOracle?.alternates)
    ? activeOracle.alternates
    : [];

  // Promote alternate — only works for hero card
  const handlePromoteAlternate = useCallback((alt: OracleAlternate) => {
    if (lockState === 'locked' || !isShowingHeroCard) return;
    const idx = queue.findIndex(q => q.fragrance_id === alt.fragrance_id);
    if (idx >= 0) {
      setViewHistory(h => [
        ...h,
        {
          card: visibleCard,
          queuePointerBefore: queuePointer,
        },
      ]);
      setVisibleCard(queue[idx]);
    }
    setSelectedMood('balance');
    setLayerExpanded(false);
    setLockState('neutral');
  }, [lockState, visibleCard, queue, queuePointer]);

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
        {queueError && (
          <div className="rounded-xl px-4 py-2 text-[10px] mt-1" style={{ background: 'rgba(220,160,60,0.08)', border: '1px solid rgba(220,160,60,0.15)', color: '#da3' }}>
            Queue: {queueError}
          </div>
        )}

        {/* ── Unified main card with gestures ── */}
        {!oracleLoading && !oracleError && visibleCard && (
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

            {/* Source badge for queue cards */}
            {!isShowingHeroCard && (
              <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/40 text-center mb-0.5">
                from queue
              </span>
            )}

            {/* Fragrance name */}
            <h2
              className="text-[32px] leading-[1.1] font-normal text-foreground mt-0.5 mb-0.5 text-center"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              {getDisplayName(visibleCard.name, visibleCard.brand)}
            </h2>

            {/* Brand */}
            <span className="text-[13px] text-muted-foreground/60 text-center mb-1.5">
              {visibleCard.brand}
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

            {/* ── Layer Card — for ALL visible cards ── */}
            {resolvedLayer && layerModes && (
              <LayerCard
                mainName={visibleCard.name}
                mainBrand={visibleCard.brand}
                mainNotes={visibleCard.notes}
                mainFamily={visibleCard.family}
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

            {/* ── Alternatives — only for hero card ── */}
            {isShowingHeroCard && visibleAlts.length > 0 && (
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

            {/* Reason / why_this */}
            {visibleCard.reason && (
              <p className="text-[11px] text-muted-foreground/50 text-center mt-2 italic">
                {visibleCard.reason}
              </p>
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

        {/* ── TEMPORARY DEBUG CONTROLS ── */}
        {!oracleLoading && !oracleError && visibleCard && (
          <div className="mt-2 flex flex-col gap-1.5 items-center" data-debug-controls>
            <div className="flex gap-2 justify-center">
             <button
                onClick={async () => {
                  if (!visibleCard || lockState === 'locked') return;
                  setLockState('locked');
                  pulseLock();
                  await onAccept(visibleCard.fragrance_id);
                }}
                className="text-[9px] px-3 py-1 rounded-full"
                style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}
              >
                🔒 Lock
              </button>
              <button
                onClick={async () => {
                  if (!visibleCard) return;
                  if (lockState === 'locked') {
                    setLockState('neutral');
                    pulseLock();
                    return;
                  }
                  await handleSkipLocal();
                }}
                disabled={skipLoading}
                className="text-[9px] px-3 py-1 rounded-full disabled:opacity-40"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                {skipLoading ? '⏳ Loading…' : '⏭ Skip'}
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
{`card=${visibleCard?.name ?? 'none'} | cardId=${visibleCard?.fragrance_id?.slice(0,8) ?? '?'}
type=${isShowingHeroCard ? 'HERO' : 'QUEUE'} | layerSrc=${layerDebugSource}
layer=${resolvedLayer?.name ?? 'NONE'} | layerId=${resolvedLayer?.fragrance_id?.slice(0,8) ?? '?'}
layerFamily=${resolvedLayer?.family ?? '?'} | renderGate=${!!(resolvedLayer && layerModes)}
qp=${queuePointer} | hist=${viewHistory.length}`}
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
