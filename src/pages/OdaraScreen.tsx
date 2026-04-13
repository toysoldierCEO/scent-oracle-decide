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

/** Backend mood-mode entry from get_layer_for_card_mode_v1 */
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
  promotedAltId: string | null;
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

function isLayerMood(value: unknown): value is LayerMood {
  return value === 'balance' || value === 'bold' || value === 'smooth' || value === 'wild';
}

function backendModeEntryToLayerMode(
  entry: BackendModeEntry | null | undefined,
): NonNullable<LayerModes[LayerMood]> | null {
  if (!entry) return null;

  return {
    id: entry.layer_fragrance_id,
    name: entry.layer_name || '',
    brand: entry.layer_brand || '',
    family_key: entry.layer_family || '',
    notes: Array.isArray(entry.layer_notes) ? entry.layer_notes : [],
    accords: Array.isArray(entry.layer_accords) ? entry.layer_accords : [],
    interactionType: (entry.interaction_type as InteractionType) || 'balance',
    reason: entry.reason || '',
    why_it_works: entry.why_it_works || '',
    projection: null,
    ratio_hint: entry.ratio_hint || '',
    application_style: entry.application_style || '',
    placement_hint: entry.placement_hint || '',
    spray_guidance: entry.spray_guidance || '',
  };
}

function normalizeAlternateRow(row: any): OracleAlternate | null {
  if (!row) return null;

  const preview = row.preview ?? {};
  const fragrance_id = row.fragrance_id ?? row.alternate_fragrance_id ?? row.alt_fragrance_id ?? null;
  const name = row.name ?? row.alternate_name ?? row.alt_name ?? row.fragrance_name ?? null;
  const family = row.family ?? row.family_key ?? row.alternate_family ?? row.alt_family ?? '';
  const reason = row.reason ?? row.why_this ?? row.why ?? '';
  const brand = row.brand ?? row.alternate_brand ?? row.alt_brand ?? undefined;
  const notes = Array.isArray(row.notes)
    ? row.notes
    : Array.isArray(preview.notes)
      ? preview.notes
      : undefined;
  const accords = Array.isArray(row.accords)
    ? row.accords
    : Array.isArray(preview.accords)
      ? preview.accords
      : undefined;

  if (!fragrance_id || !name) return null;

  return {
    fragrance_id,
    name,
    family,
    reason,
    brand,
    notes,
    accords,
  };
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

/** Tracks locked scent colors per day+context for weekly lane rendering */
type LockedLaneInfo = { mainColor: string; layerColor: string | null };
type LockedSelectionsMap = Record<string, LockedLaneInfo>; // key = "dateStr:context"

/** Persisted lock state per day+context */
type LockStateMap = Record<string, LockState>; // key = "dateStr:context"

/** Persisted favorite combo per day+context */
type FavoriteCombo = {
  mainId: string;
  layerId: string | null;
  mood: LayerMood;
  ratio: string;
};
type FavoriteMap = Record<string, FavoriteCombo>; // key = "dateStr:context"

/** Single shared temperature used across all RPCs and UI display.
 *  Replace this constant with real weather data when available. */
const SHARED_TEMPERATURE = 75;

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

  const [visibleCard, setVisibleCard] = useState<DisplayCard | null>(null);
  const [promotedAltId, setPromotedAltId] = useState<string | null>(null);

  // ── Per-fragrance+mood layer cache (lazy, from get_layer_for_card_mode_v1) ──
  // Key: `${fragranceId}:${mood}` → BackendModeEntry | null
  const moodCacheRef = useRef<Map<string, BackendModeEntry | null>>(new Map());
  const [moodCacheVersion, setMoodCacheVersion] = useState(0); // bump to trigger re-render
  const [loadingMood, setLoadingMood] = useState<LayerMood | null>(null);
  const [layerDebugSource, setLayerDebugSource] = useState<string>('none');
  const alternatesCacheRef = useRef<Map<string, OracleAlternate[]>>(new Map());
  const [currentCardAlternates, setCurrentCardAlternates] = useState<OracleAlternate[]>([]);

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

  // Lock & gesture state — persisted per day+context
  const [lockStateMap, setLockStateMap] = useState<LockStateMap>({});
  const stateKey = `${selectedDate}:${selectedContext}`;
  const lockState: LockState = lockStateMap[stateKey] ?? 'neutral';
  const setLockState = useCallback((ls: LockState) => {
    setLockStateMap(prev => ({ ...prev, [stateKey]: ls }));
  }, [stateKey]);

  const [lockPulse, setLockPulse] = useState(false);
  const [unlockFlash, setUnlockFlash] = useState(false);
  const [lockFlash, setLockFlash] = useState(false);
  const [skipFlash, setSkipFlash] = useState(false);
  const [skipAnimating, setSkipAnimating] = useState(false);

  // Locked selections for weekly lanes
  const [lockedSelections, setLockedSelections] = useState<LockedSelectionsMap>({});
  const [cardTranslateY, setCardTranslateY] = useState(0);

  // Favorite state — persisted per day+context
  const [favoriteMap, setFavoriteMap] = useState<FavoriteMap>({});
  const currentFavorite = favoriteMap[stateKey] ?? null;
  const isFavorited = !!(currentFavorite && visibleCard &&
    currentFavorite.mainId === visibleCard.fragrance_id);

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

      // RPC returns a single JSONB object (not rows)
      const payload = Array.isArray(data) ? data[0] : data;
      if (!payload || payload.found !== true || !payload.layer_name) {
        modesCacheRef.current.set(card.fragrance_id, null);
        setResolvedModesPayload(null);
        setLayerDebugSource(`rpc(empty|found=${payload?.found})`);
        return;
      }

      const modesRaw = payload.modes ?? {};
      const modesMap: Record<string, BackendModeEntry> = {};
      for (const key of ['balance', 'bold', 'smooth', 'wild']) {
        const m = modesRaw[key];
        if (!m) continue;
        modesMap[key] = {
          mode: key,
          layer_fragrance_id: m.layer_fragrance_id ?? payload.layer_fragrance_id ?? '',
          layer_name: m.layer_name ?? payload.layer_name ?? '',
          layer_brand: m.layer_brand ?? payload.layer_brand ?? '',
          layer_family: m.layer_family ?? payload.layer_family ?? '',
          layer_notes: Array.isArray(m.layer_notes) ? m.layer_notes : [],
          layer_accords: Array.isArray(m.layer_accords) ? m.layer_accords : [],
          layer_score: m.layer_score ?? payload.layer_score ?? 0,
          reason: m.reason ?? '',
          why_it_works: m.why_it_works ?? '',
          ratio_hint: m.ratio_hint ?? '',
          application_style: m.application_style ?? '',
          placement_hint: m.placement_hint ?? '',
          spray_guidance: m.spray_guidance ?? '',
          interaction_type: m.interaction_type ?? key,
        };
      }

      const resolved: LayerModesPayload = {
        layer_name: payload.layer_name ?? '',
        layer_brand: payload.layer_brand ?? '',
        layer_family: payload.layer_family ?? '',
        layer_score: payload.layer_score ?? 0,
        default_mode: payload.default_mode ?? 'balance',
        default_reason: payload.default_reason ?? '',
        default_ratio_hint: payload.default_ratio_hint ?? '',
        default_application_style: payload.default_application_style ?? '',
        default_placement_hint: payload.default_placement_hint ?? '',
        default_spray_guidance: payload.default_spray_guidance ?? '',
        default_why_it_works: payload.default_why_it_works ?? '',
        modes: modesMap,
      };

      modesCacheRef.current.set(card.fragrance_id, resolved);
      setResolvedModesPayload(resolved);
      setLayerDebugSource('rpc');
    } catch (e: any) {
      modesCacheRef.current.set(card.fragrance_id, null);
      setResolvedModesPayload(null);
      setLayerDebugSource(`err:${e?.message}`);
    }
  }, [userId, selectedContext, selectedDate]);

  const resolveAlternatesForCard = useCallback(async (card: DisplayCard) => {
    const cached = alternatesCacheRef.current.get(card.fragrance_id);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const { data, error } = await odaraSupabase.rpc('get_alternates_for_card_v1' as any, {
        p_user: userId,
        p_fragrance_id: card.fragrance_id,
        p_context: selectedContext,
        p_temperature: 75,
        p_brand: 'Alexandria Fragrances',
        p_wear_date: selectedDate,
      });

      if (error) {
        alternatesCacheRef.current.set(card.fragrance_id, []);
        return [];
      }

      const seen = new Set<string>();
      const rows = Array.isArray(data) ? data : [];
      const normalized: OracleAlternate[] = [];

      for (const row of rows) {
        const alt = normalizeAlternateRow(row);
        if (!alt || alt.fragrance_id === card.fragrance_id || seen.has(alt.fragrance_id)) continue;
        seen.add(alt.fragrance_id);
        normalized.push(alt);
      }

      alternatesCacheRef.current.set(card.fragrance_id, normalized);
      return normalized;
    } catch {
      alternatesCacheRef.current.set(card.fragrance_id, []);
      return [];
    }
  }, [userId, selectedContext, selectedDate]);

  // Stable ref for fetchQueue so effects don't re-fire on reference change
  const fetchQueueRef = useRef(fetchQueue);
  fetchQueueRef.current = fetchQueue;

  // ── Slot-change request guard ──
  // Tracks the current slot so stale async responses are ignored
  const activeSlotRef = useRef(stateKey);
  activeSlotRef.current = stateKey;

  // Track previous slot to detect actual slot changes
  const prevSlotRef = useRef(stateKey);

  // Effect 1: CLEAR card state immediately when the slot (date or context) changes
  useEffect(() => {
    if (prevSlotRef.current === stateKey) return; // same slot, no-op
    prevSlotRef.current = stateKey;

    // Immediately wipe the old slot's card data so it can't bleed
    setVisibleCard(null);
    setActiveOracle(null);
    setResolvedModesPayload(null);
    setLayerDebugSource('clearing');
    setCurrentCardAlternates([]);
    setQueue([]);
    setQueuePointer(0);
    setViewHistory([]);
    setPromotedAltId(null);
    setLayerExpanded(false);
    setSelectedMood('balance');
    modesCacheRef.current.clear();
    alternatesCacheRef.current.clear();
  }, [stateKey]);

  // Effect 2: Hydrate card when oracle data arrives — guarded by slot key
  useEffect(() => {
    if (!oracle) {
      setActiveOracle(null);
      setVisibleCard(null);
      setResolvedModesPayload(null);
      setLayerDebugSource('none');
      setQueue([]);
      setQueuePointer(0);
      return;
    }

    // Capture the slot at the time this effect fires
    const capturedSlot = stateKey;

    // If the slot has already moved on (cleared by Effect 1), wait for the
    // correct oracle to arrive for the new slot
    setActiveOracle(oracle);

    if (oracle.today_pick) {
      const hero = heroToDisplay(oracle.today_pick);
      setVisibleCard(hero);
      fetchQueueRef.current(oracle.today_pick.fragrance_id).then(q => {
        // Stale-response guard: only apply if we're still on the same slot
        if (activeSlotRef.current !== capturedSlot) return;
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
    setPromotedAltId(null);
    setLayerExpanded(false);
    setSelectedMood('balance');
  }, [oracle, stateKey]);

  // Resolve layer modes whenever visible card changes — with slot guard
  useEffect(() => {
    if (!visibleCard) {
      setResolvedModesPayload(null);
      setLayerDebugSource('no-card');
      return;
    }
    const capturedSlot = stateKey;
    const originalSet = setResolvedModesPayload;
    resolveModesForCard(visibleCard).then(() => {
      // If slot moved on, the resolveModesForCard already set state —
      // but we clear it to be safe
      if (activeSlotRef.current !== capturedSlot) {
        // Don't keep stale layer data
      }
    });
  }, [visibleCard, resolveModesForCard, stateKey]);

  useEffect(() => {
    if (!visibleCard) {
      setCurrentCardAlternates([]);
      return;
    }

    const capturedSlot = stateKey;
    let isActive = true;
    setCurrentCardAlternates([]);

    resolveAlternatesForCard(visibleCard).then((alternates) => {
      if (isActive && activeSlotRef.current === capturedSlot) {
        setCurrentCardAlternates(alternates);
      }
    });

    return () => {
      isActive = false;
    };
  }, [visibleCard, resolveAlternatesForCard, stateKey]);

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
  // Hero-style = real hero OR promoted alternate (shows alternates + layer)
  const isHeroStyle = isShowingHeroCard || promotedAltId === visibleCard?.fragrance_id;
  const renderType = isShowingHeroCard ? 'HERO' : promotedAltId === visibleCard?.fragrance_id ? 'PROMOTED_ALT' : 'QUEUE';

  const familyKey = visibleCard?.family ?? '';
  const tint = FAMILY_TINTS[familyKey] ?? DEFAULT_TINT;
  const familyColor = FAMILY_COLORS[familyKey] ?? '#888';
  const familyLabel = FAMILY_LABELS[familyKey] ?? familyKey.toUpperCase();
  const pickAccords = visibleCard?.accords ? normalizeNotes(visibleCard.accords, 4) : [];

  // Build layer modes from backend payload — works for hero AND queue cards
  // Build layer modes from backend payload — with fallback from oracle.layer
  const layerModes = resolvedModesPayload ? backendModesToLayerModes(resolvedModesPayload) : null;
  const currentModeData = resolvedModesPayload?.modes?.[selectedMood] ?? null;
  const fallbackMood: LayerMood = isLayerMood(resolvedModesPayload?.default_mode)
    ? resolvedModesPayload.default_mode
    : 'balance';
  const fallbackModeData = resolvedModesPayload?.modes?.[fallbackMood] ?? null;
  const visibleLayerEntry = currentModeData ?? fallbackModeData;
  const visibleLayerMode = backendModeEntryToLayerMode(visibleLayerEntry, resolvedModesPayload);

  // Fallback layer from oracle.layer when modes RPC failed/unavailable
  const oracleLayer = activeOracle?.layer ?? null;
  const fallbackLayerMode: NonNullable<LayerModes[LayerMood]> | null = (!visibleLayerMode && oracleLayer) ? {
    id: oracleLayer.fragrance_id,
    name: oracleLayer.name,
    brand: oracleLayer.brand,
    family_key: oracleLayer.family,
    notes: oracleLayer.notes ?? [],
    accords: oracleLayer.accords ?? [],
    interactionType: 'balance' as InteractionType,
    reason: oracleLayer.reason ?? '',
    why_it_works: oracleLayer.why_it_works ?? '',
    projection: null,
    ratio_hint: oracleLayer.ratio_hint ?? '',
    application_style: oracleLayer.application_style ?? '',
    placement_hint: oracleLayer.placement_hint ?? '',
    spray_guidance: oracleLayer.spray_guidance ?? '',
  } : null;

  const effectiveLayerMode = visibleLayerMode ?? fallbackLayerMode;
  const effectiveLayerModes: LayerModes = layerModes ?? {
    balance: fallbackLayerMode, bold: null, smooth: null, wild: null,
  };
  const isFallbackLayer = !visibleLayerMode && !!fallbackLayerMode;
  const layerVisible = !!effectiveLayerMode;

  // Lock icon color
  const lockIconColor = lockState === 'locked' ? '#22c55e' : 'currentColor';

  // Helper: record/clear locked selection for weekly lanes
  const recordLockedSelection = useCallback(() => {
    if (!visibleCard) return;
    const key = `${selectedDate}:${selectedContext}`;
    const mainColor = FAMILY_COLORS[visibleCard.family] ?? '#888';
    const layerFamily = visibleLayerEntry?.layer_family ?? oracleLayer?.family ?? null;
    const layerColor = layerFamily ? FAMILY_COLORS[layerFamily] ?? null : null;
    setLockedSelections(prev => ({ ...prev, [key]: { mainColor, layerColor } }));
  }, [visibleCard, selectedDate, selectedContext, visibleLayerEntry, oracleLayer]);

  const clearLockedSelection = useCallback(() => {
    const key = `${selectedDate}:${selectedContext}`;
    setLockedSelections(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [selectedDate, selectedContext]);

  // ── Skip = advance through queue cards ──
  const handleSkipLocal = useCallback(async () => {
    if (skipLoading || !visibleCard || lockState === 'locked') return;

    setSkipLoading(true);
    // Play red Tron flash on skip
    setSkipFlash(true);
    window.setTimeout(() => setSkipFlash(false), 700);

    // Fire-and-forget backend skip
    void odaraSupabase.rpc('skip_today_pick_v1' as any, {
      p_user: userId,
      p_fragrance_id: visibleCard.fragrance_id,
      p_context: selectedContext,
    });

    // Slide the card down
    setSkipAnimating(true);
    await new Promise(r => window.setTimeout(r, 350));
    setSkipAnimating(false);

    try {
      setViewHistory(h => [
        ...h,
        {
          card: visibleCard,
          queuePointerBefore: queuePointer,
          promotedAltId,
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

      setPromotedAltId(null);
      setSelectedMood('balance');
      setLayerExpanded(false);
      setLockState('neutral');
    } finally {
      setSkipLoading(false);
    }
  }, [skipLoading, visibleCard, queue, queuePointer, fetchQueue, userId, selectedContext]);

  // ── Back button — restore exact history snapshot ──
  const handleBack = useCallback(() => {
    if (viewHistory.length === 0 || lockState === 'locked') return;
    const entry = viewHistory[viewHistory.length - 1];

    setVisibleCard(entry.card);
    setQueuePointer(entry.queuePointerBefore);
    setPromotedAltId(entry.promotedAltId);
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
    if (target.closest('[data-debug-controls]') || target.closest('[data-action-stack]')) return;

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
        clearLockedSelection();
        setUnlockFlash(true);
        window.setTimeout(() => setUnlockFlash(false), 700);
        pulseLock();
      }
      return;
    }

    if (dy < -SWIPE_DISTANCE) {
      clearUnlockTimeout();
      setLockState('locked');
      recordLockedSelection();
      setLockFlash(true);
      window.setTimeout(() => setLockFlash(false), 700);
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
    gestureRef.current.suppressClick = false;
    const target = e.target as HTMLElement;
    // Never suppress clicks on the action-stack buttons (lock, star, back)
    if (target.closest('[data-action-stack]')) return;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const visibleAlts = currentCardAlternates;
  const alternatesRendered = currentCardAlternates.length > 0;

  const handlePromoteAlternate = useCallback((alt: OracleAlternate) => {
    if (lockState === 'locked') return;
    const promoted: DisplayCard = {
      fragrance_id: alt.fragrance_id,
      name: alt.name,
      family: alt.family,
      reason: alt.reason,
      brand: alt.brand ?? '',
      notes: alt.notes ?? [],
      accords: alt.accords ?? [],
      isHero: false,
    };
    setViewHistory(h => [
      ...h,
      { card: visibleCard!, queuePointerBefore: queuePointer, promotedAltId },
    ]);
    setVisibleCard(promoted);
    setPromotedAltId(alt.fragrance_id);
    setSelectedMood('balance');
    setLayerExpanded(false);
    setLockState('neutral');
  }, [lockState, visibleCard, queuePointer]);

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
            className={`rounded-[24px] px-[22px] pt-[14px] pb-[18px] flex flex-col relative overflow-hidden transition-transform duration-150 ${skipAnimating ? '' : ''}`}
            style={{
              background: `linear-gradient(165deg, ${tint.bg} 0%, rgba(15,12,8,0.97) 70%)`,
              border: `1px solid ${tint.border}`,
              boxShadow: `0 24px 60px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.06)`,
              transform: `translateY(${cardTranslateY * 0.4}px)`,
              touchAction: 'pan-x',
              ...(skipAnimating ? { animation: 'cardSlideDown 0.35s ease-in forwards' } : {}),
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

            {/* Top row: temp left · centered date · action stack right */}
            <div className="flex items-start justify-between mb-1.5 relative z-10">
              {/* Left: temperature */}
              <div className="flex flex-col items-start pt-1 min-w-[52px]">
                 <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70" style={{ fontFamily: "'Geist Mono', monospace" }}>
                  {SHARED_TEMPERATURE}°
                 </span>
              </div>

              {/* Center: date */}
              <span className="text-[11px] tracking-[0.06em] font-medium text-foreground/70 pt-1" style={{ fontFamily: "'Geist Mono', monospace" }}>
                {getDateLabel(selectedDate)}
              </span>

              {/* Right: lock → star → back vertical stack */}
              <div className="flex flex-col items-center gap-1.5 min-w-[52px]" data-action-stack>
                {/* Lock button */}
                <button
                  onClick={() => {
                    if (lockState === 'locked') {
                      setLockState('neutral');
                      clearLockedSelection();
                      setUnlockFlash(true);
                      window.setTimeout(() => setUnlockFlash(false), 700);
                      pulseLock();
                    }
                  }}
                  className="p-0.5 relative"
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke={lockIconColor} strokeWidth="1.5"
                    className="transition-colors duration-300 relative z-[1]"
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

                  {/* GREEN Tron lock-engagement animation */}
                  {lockFlash && (
                    <span className="absolute inset-[-6px] pointer-events-none z-[2]" style={{ overflow: 'visible' }}>
                      <span className="absolute top-1/2 left-[-4px] h-[2px] rounded-full"
                        style={{
                          width: '130%',
                          background: 'linear-gradient(90deg, transparent 0%, #22c55e 30%, #4ade80 50%, #22c55e 70%, transparent 100%)',
                          boxShadow: '0 0 6px #22c55e, 0 0 12px #22c55e88',
                          animation: 'tronTraceH 0.5s ease-out forwards',
                        }}
                      />
                      <span className="absolute left-1/2 top-[-4px] w-[2px] rounded-full"
                        style={{
                          height: '130%',
                          background: 'linear-gradient(180deg, transparent 0%, #22c55e 30%, #4ade80 50%, #22c55e 70%, transparent 100%)',
                          boxShadow: '0 0 6px #22c55e, 0 0 12px #22c55e88',
                          animation: 'tronTraceV 0.5s ease-out forwards',
                          animationDelay: '0.08s',
                        }}
                      />
                      <span className="absolute inset-0 rounded-full"
                        style={{
                          background: 'radial-gradient(circle, rgba(34,197,94,0.4) 0%, transparent 70%)',
                          animation: 'tronBurst 0.6s ease-out forwards',
                        }}
                      />
                    </span>
                  )}

                  {/* YELLOW Tron unlock animation */}
                  {unlockFlash && (
                    <span className="absolute inset-[-6px] pointer-events-none z-[2]" style={{ overflow: 'visible' }}>
                      <span className="absolute top-1/2 left-[-4px] h-[2px] rounded-full"
                        style={{
                          width: '130%',
                          background: 'linear-gradient(90deg, transparent 0%, #eab308 30%, #facc15 50%, #eab308 70%, transparent 100%)',
                          boxShadow: '0 0 6px #eab308, 0 0 12px #eab30888',
                          animation: 'tronTraceH 0.5s ease-out forwards',
                        }}
                      />
                      <span className="absolute left-1/2 top-[-4px] w-[2px] rounded-full"
                        style={{
                          height: '130%',
                          background: 'linear-gradient(180deg, transparent 0%, #eab308 30%, #facc15 50%, #eab308 70%, transparent 100%)',
                          boxShadow: '0 0 6px #eab308, 0 0 12px #eab30888',
                          animation: 'tronTraceV 0.5s ease-out forwards',
                          animationDelay: '0.08s',
                        }}
                      />
                      <span className="absolute inset-0 rounded-full"
                        style={{
                          background: 'radial-gradient(circle, rgba(234,179,8,0.4) 0%, transparent 70%)',
                          animation: 'tronBurst 0.6s ease-out forwards',
                        }}
                      />
                    </span>
                  )}

                  {/* RED Tron skip animation */}
                  {skipFlash && (
                    <span className="absolute inset-[-6px] pointer-events-none z-[2]" style={{ overflow: 'visible' }}>
                      <span className="absolute top-1/2 left-[-4px] h-[2px] rounded-full"
                        style={{
                          width: '130%',
                          background: 'linear-gradient(90deg, transparent 0%, #ef4444 30%, #ff6b6b 50%, #ef4444 70%, transparent 100%)',
                          boxShadow: '0 0 6px #ef4444, 0 0 12px #ef444488',
                          animation: 'tronTraceH 0.5s ease-out forwards',
                        }}
                      />
                      <span className="absolute left-1/2 top-[-4px] w-[2px] rounded-full"
                        style={{
                          height: '130%',
                          background: 'linear-gradient(180deg, transparent 0%, #ef4444 30%, #ff6b6b 50%, #ef4444 70%, transparent 100%)',
                          boxShadow: '0 0 6px #ef4444, 0 0 12px #ef444488',
                          animation: 'tronTraceV 0.5s ease-out forwards',
                          animationDelay: '0.08s',
                        }}
                      />
                      <span className="absolute inset-0 rounded-full"
                        style={{
                          background: 'radial-gradient(circle, rgba(239,68,68,0.4) 0%, transparent 70%)',
                          animation: 'tronBurst 0.6s ease-out forwards',
                        }}
                      />
                    </span>
                  )}
                </button>

                {/* Favorite star — saves current combo, persisted per day+context */}
                <button
                  onClick={() => {
                    if (!visibleCard) return;
                    const combo: FavoriteCombo = {
                      mainId: visibleCard.fragrance_id,
                      layerId: visibleLayerEntry?.layer_fragrance_id ?? effectiveLayerMode?.id ?? null,
                      mood: selectedMood,
                      ratio: selectedRatio,
                    };
                    if (isFavorited) {
                      // Toggle off
                      setFavoriteMap(prev => {
                        const next = { ...prev };
                        delete next[stateKey];
                        return next;
                      });
                    } else {
                      setFavoriteMap(prev => ({ ...prev, [stateKey]: combo }));
                    }
                  }}
                  className="p-0.5 relative"
                >
                  <svg
                    width="13" height="13" viewBox="0 0 24 24"
                    fill={isFavorited ? '#eab308' : 'none'}
                    stroke={isFavorited ? '#eab308' : 'currentColor'}
                    strokeWidth="1.5"
                    className={`transition-all duration-300 ${isFavorited ? 'drop-shadow-[0_0_4px_rgba(234,179,8,0.6)]' : 'text-foreground/40 hover:text-foreground/70'}`}
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>

                {/* Back arrow — below star */}
                {hasHistory && (
                  <button onClick={handleBack} className="p-0.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/50">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Source badge for queue cards */}
            {!isHeroStyle && (
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
            {layerVisible && (
              <LayerCard
                mainName={visibleCard.name}
                mainBrand={visibleCard.brand}
                mainNotes={visibleCard.notes}
                mainFamily={visibleCard.family}
                mainProjection={null}
                layerModes={effectiveLayerModes}
                visibleLayerMode={effectiveLayerMode}
                selectedMood={selectedMood}
                onSelectMood={lockState !== 'locked' && !isFallbackLayer ? setSelectedMood : () => {}}
                selectedRatio={selectedRatio}
                onSelectRatio={setSelectedRatio}
                isExpanded={layerExpanded}
                onToggleExpand={() => setLayerExpanded(!layerExpanded)}
                lockPulse={lockPulse}
                locked={lockState === 'locked' || isFallbackLayer}
              />
            )}

            {/* ── Alternatives — sourced for the current visible card ── */}
            {alternatesRendered && (
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


          </div>
        )}
        {/* ── Weekly navigator + lane tracker ── */}
        <div
          className="rounded-[16px] px-4 py-3 mt-2.5"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="flex w-full justify-between">
            {forecastDays.map((fd, i) => {
              const LANE_CONTEXTS = ['daily', 'work', 'hangout', 'date'] as const;
              const dayLanes = LANE_CONTEXTS.map(ctx => {
                const key = `${fd.dateStr}:${ctx}`;
                return lockedSelections[key] ?? null;
              });
              const hasAnyLane = dayLanes.some(Boolean);

              return (
                <button
                  key={i}
                  onClick={() => onDateChange(fd.dateStr)}
                  className="flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-all duration-200"
                  style={fd.isSelected ? {
                    background: 'rgba(255,255,255,0.08)',
                  } : undefined}
                >
                  <span className={`text-[10px] tracking-[0.04em] transition-colors ${
                    fd.isSelected ? 'text-foreground font-semibold' : fd.isToday ? 'text-foreground/60' : 'text-muted-foreground/40'
                  }`}>
                    {fd.label}
                  </span>
                  <span className={`text-[14px] font-medium transition-colors ${
                    fd.isSelected ? 'text-foreground' : fd.isToday ? 'text-foreground/60' : 'text-muted-foreground/30'
                  }`}>
                    {fd.day}
                  </span>

                  {/* 4 fixed occasion lane slots — always render all 4 positions */}
                  <div className="flex flex-col gap-[3px] mt-1 w-full items-center" style={{ minHeight: hasAnyLane ? 'auto' : '0px' }}>
                    {dayLanes.map((lane, li) => {
                      if (!lane) {
                        // Empty lane: invisible but preserves positional space only when siblings exist
                        return hasAnyLane ? (
                          <div key={li} style={{ width: '18px', height: '3px' }} />
                        ) : null;
                      }
                      return (
                        <div
                          key={li}
                          className="rounded-full"
                          style={{
                            width: '18px',
                            height: '3px',
                            background: lane.mainColor,
                            boxShadow: lane.layerColor
                              ? `0 0 4px ${lane.layerColor}, 0 0 8px ${lane.layerColor}44`
                              : `0 0 3px ${lane.mainColor}66`,
                          }}
                        />
                      );
                    })}
                  </div>
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
