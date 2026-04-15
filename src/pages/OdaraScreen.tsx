import { useState, useRef, useCallback, useEffect } from "react";
import { normalizeNotes } from "@/lib/normalizeNotes";
import { odaraSupabase } from "@/lib/odara-client";
import LayerCard from "@/components/LayerCard";
import { LAYER_MODE_ORDER, type LayerMood, type LayerModes, type InteractionType } from "@/components/ModeSelector";

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

/** Home hero payload shape from get_todays_oracle_home_v1 */
export interface OracleResult {
  today_pick: OraclePick;
  layer: OracleLayer | null;
  alternates: OracleAlternate[];
  ui_default_mode?: string;
  layer_modes?: {
    balance?: any;
    bold?: any;
    smooth?: any;
    wild?: any;
  };
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

const MAX_SESSION_HISTORY = 30;

type HistoryEntry = {
  card: DisplayCard;
  queuePointerBefore: number;
  promotedAltId: string | null;
  selectedMood: LayerMood | null;
  resolvedVisibleModeEntry: BackendModeEntry | null;
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
  onAccept: (fragranceId: string, layerFragranceId: string | null) => Promise<void>;
  onSkip: (fragranceId: string) => Promise<OracleResult | null>;
  userId: string;
  resolvedTemperature: number;
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

// (oracleModeEntryToLayerMode removed — Effect 2 now pre-seeds cache directly)

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

const OdaraScreen = ({
  oracle, oracleLoading, oracleError, onSignOut,
  selectedContext, onContextChange,
  selectedDate, onDateChange,
  onAccept, onSkip, userId,
  resolvedTemperature,
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

  // ── Slot-scoped layer caches (lazy, from get_layer_for_card_mode_v1) ──
  // Key: `${date}|${context}|${fragranceId}|${mood}` → BackendModeEntry | null
  const moodCacheRef = useRef<Map<string, BackendModeEntry | null>>(new Map());
  const moodInFlightRef = useRef<Map<string, Promise<BackendModeEntry | null>>>(new Map());
  const [moodCacheVersion, setMoodCacheVersion] = useState(0); // bump to trigger re-render
  const [loadingMood, setLoadingMood] = useState<LayerMood | null>(null);
  const [layerDebugSource, setLayerDebugSource] = useState<string>('none');
  // Key: `${date}|${context}|${fragranceId}` → OracleAlternate[]
  const alternatesCacheRef = useRef<Map<string, OracleAlternate[]>>(new Map());
  const [currentCardAlternates, setCurrentCardAlternates] = useState<OracleAlternate[]>([]);

  const hasHistory = viewHistory.length > 0;

  // Fetch queue from backend — background only, never blocks hero
  const fetchQueue = useCallback(async (excludeId?: string) => {
    console.log('[Odara] queue fetch start');
    try {
      setQueueError(null);
      const { data, error } = await odaraSupabase.rpc('get_home_card_queue_v1' as any, {
        p_user: userId,
        p_context: selectedContext,
        p_temperature: resolvedTemperature,
        p_brand: 'Alexandria Fragrances',
        p_wear_date: selectedDate,
        p_limit: 12,
      });
      if (error) {
        console.error('[Odara] queue fetch fail', error.message);
        setQueueError(error.message);
        return [];
      }
      const rows = (data as unknown as QueueCard[]) ?? [];
      const filtered = excludeId
        ? rows.filter(r => r.fragrance_id !== excludeId)
        : rows;
      console.log('[Odara] queue fetch success', filtered.length, 'cards');
      return filtered.map(queueCardToDisplay);
    } catch (e: any) {
      console.error('[Odara] queue fetch fail', e?.message);
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

  // ── Lazy per-mood fetcher via get_layer_for_card_mode_v1 (slot-scoped) ──
  const fetchMoodForCard = useCallback(async (fragranceId: string, mood: LayerMood) => {
    const slotPrefix = `${selectedDate}|${selectedContext}`;
    const moodKey = `${slotPrefix}|${fragranceId}|${mood}`;
    const cached = moodCacheRef.current.get(moodKey);
    if (cached !== undefined) {
      console.log('[Odara] mood cache hit', moodKey);
      return cached;
    }

    // In-flight dedupe: reuse pending promise for same key
    const inFlight = moodInFlightRef.current.get(moodKey);
    if (inFlight) {
      console.log('[Odara] mood in-flight reuse', moodKey);
      return inFlight;
    }

    console.log('[Odara] mood cache miss', moodKey);

    // Capture slot at launch for stale guard
    const capturedSlot = stateKey;

    // Gather already-loaded layer fragrance ids for exclusion — CURRENT SLOT ONLY
    const excludeIds: string[] = [];
    for (const m of ['balance', 'bold', 'smooth', 'wild'] as LayerMood[]) {
      const existing = moodCacheRef.current.get(`${slotPrefix}|${fragranceId}|${m}`);
      if (existing?.layer_fragrance_id) excludeIds.push(existing.layer_fragrance_id);
    }
    // Also include oracle.layer id if present
    const ol = activeOracle?.layer;
    if (ol?.fragrance_id) excludeIds.push(ol.fragrance_id);

    const fetchPromise = (async (): Promise<BackendModeEntry | null> => {
      try {
        console.log('[Odara] lazy mood fetch start', mood, fragranceId, 'slot', capturedSlot);
        setLoadingMood(mood);
        setLayerDebugSource(`rpc:${mood}…`);
        const { data, error } = await odaraSupabase.rpc('get_layer_for_card_mode_v1' as any, {
          p_user: userId,
          p_fragrance_id: fragranceId,
          p_context: selectedContext,
          p_temperature: resolvedTemperature,
          p_brand: 'Alexandria Fragrances',
          p_wear_date: selectedDate,
          p_mode: mood,
          p_exclude_fragrance_ids: excludeIds.length > 0 ? excludeIds : undefined,
        });

        if (activeSlotRef.current !== capturedSlot) {
          console.log('[Odara] ignoring stale mood result for old slot', capturedSlot, '→ current', activeSlotRef.current);
          return null;
        }

        if (error) {
          console.error('[Odara] lazy mood fetch fail', mood, error.message);
          moodCacheRef.current.set(moodKey, null);
          setLayerDebugSource(`err:${error.message}`);
          setLoadingMood(null);
          setMoodCacheVersion(v => v + 1);
          return null;
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.layer_fragrance_id) {
          moodCacheRef.current.set(moodKey, null);
          setLayerDebugSource(`rpc:${mood}(empty)`);
          setLoadingMood(null);
          setMoodCacheVersion(v => v + 1);
          return null;
        }

        const entry: BackendModeEntry = {
          mode: mood,
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
          interaction_type: row.interaction_type ?? mood,
        };

        moodCacheRef.current.set(moodKey, entry);
        console.log('[Odara] lazy mood fetch success', mood, entry.layer_name, 'slot', capturedSlot);
        setLayerDebugSource(`rpc:${mood}`);
        setLoadingMood(null);
        setMoodCacheVersion(v => v + 1);
        return entry;
      } catch (e: any) {
        if (activeSlotRef.current !== capturedSlot) {
          console.log('[Odara] ignoring stale mood error for old slot', capturedSlot);
          return null;
        }
        moodCacheRef.current.set(moodKey, null);
        setLayerDebugSource(`err:${e?.message}`);
        setLoadingMood(null);
        setMoodCacheVersion(v => v + 1);
        return null;
      } finally {
        moodInFlightRef.current.delete(moodKey);
      }
    })();

    moodInFlightRef.current.set(moodKey, fetchPromise);
    return fetchPromise;
  }, [userId, selectedContext, selectedDate, activeOracle, stateKey]);

  const resolveAlternatesForCard = useCallback(async (card: DisplayCard) => {
    const altKey = `${selectedDate}|${selectedContext}|${card.fragrance_id}`;
    const cached = alternatesCacheRef.current.get(altKey);
    if (cached !== undefined) {
      return cached;
    }

    const capturedSlot = stateKey;

    try {
      const { data, error } = await odaraSupabase.rpc('get_alternates_for_card_v1' as any, {
        p_user: userId,
        p_fragrance_id: card.fragrance_id,
        p_context: selectedContext,
        p_temperature: resolvedTemperature,
        p_brand: 'Alexandria Fragrances',
        p_wear_date: selectedDate,
      });

      if (activeSlotRef.current !== capturedSlot) {
        console.log('[Odara] ignoring stale alternates for old slot', capturedSlot);
        return [];
      }

      if (error) {
        alternatesCacheRef.current.set(altKey, []);
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

      alternatesCacheRef.current.set(altKey, normalized);
      return normalized;
    } catch {
      if (activeSlotRef.current !== capturedSlot) return [];
      alternatesCacheRef.current.set(altKey, []);
      return [];
    }
  }, [userId, selectedContext, selectedDate, stateKey]);

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
    const oldSlot = prevSlotRef.current;
    prevSlotRef.current = stateKey;

    console.log('[Odara] slot change -> clearing ALL state', oldSlot, '→', stateKey);
    // Immediately wipe the old slot's card data so it can't bleed
    setVisibleCard(null);
    setActiveOracle(null);
    setLayerDebugSource('clearing');
    setCurrentCardAlternates([]);
    setQueue([]);
    setQueuePointer(0);
    setViewHistory([]);
    setPromotedAltId(null);
    setLayerExpanded(false);
    setSelectedMood(null);
    setLoadingMood(null);
    moodCacheRef.current.clear();
    alternatesCacheRef.current.clear();
  }, [stateKey]);

  // Effect 2: Hydrate card when oracle data arrives — hero-first contract
  // Full-screen loader disappears as soon as oracle resolves.
  // Queue is fetched in the BACKGROUND after hero is set.
  useEffect(() => {
    if (!oracle) {
      setActiveOracle(null);
      setVisibleCard(null);
      setLayerDebugSource('none');
      setQueue([]);
      setQueuePointer(0);
      return;
    }

    const capturedSlot = stateKey;

    // ── FULL STATE RESET before applying new oracle payload ──
    const prevVisibleId = visibleCard?.fragrance_id ?? '(none)';
    const prevPromotedId = promotedAltId ?? '(none)';

    console.log('[Odara] oracle apply', {
      selectedDate,
      selectedContext,
      backendHeroId: oracle.today_pick?.fragrance_id ?? '(none)',
      previousVisibleId: prevVisibleId,
      promotedAltIdBeforeReset: prevPromotedId,
    });

    // 1) Clear ALL stale state first
    // viewHistory is NOT cleared here — slot changes clear it in Effect 1 above
    setPromotedAltId(null);
    setLayerExpanded(false);
    setLoadingMood(null);

    // 2) Set oracle
    setActiveOracle(oracle);

    // 3) Set initial mood from backend ui_default_mode
    const initialMood = (oracle.ui_default_mode as LayerMood) ?? 'balance';
    setSelectedMood(initialMood);

    console.log('[Odara] oracle apply complete', {
      newVisibleId: oracle.today_pick?.fragrance_id ?? '(none)',
      promotedAltIdAfterReset: '(null)',
      initialMood,
    });

    if (oracle.today_pick) {
      const hero = heroToDisplay(oracle.today_pick);
      setVisibleCard(hero);
      console.log('[Odara] applying oracle home for slot', capturedSlot, 'hero:', oracle.today_pick.fragrance_id);

      // 4) Pre-seed mood cache from oracle.layer_modes + oracle.layer for hero card
      const slotPfx = `${selectedDate}|${selectedContext}`;
      const heroId = oracle.today_pick.fragrance_id;
      let balanceSeeded = false;

      if (oracle.layer_modes) {
        for (const mood of LAYER_MODE_ORDER) {
          const modeData = (oracle.layer_modes as any)?.[mood];
          if (modeData && (modeData.fragrance_id || modeData.layer_fragrance_id)) {
            const entry: BackendModeEntry = {
              mode: mood,
              layer_fragrance_id: modeData.layer_fragrance_id ?? modeData.fragrance_id ?? '',
              layer_name: modeData.layer_name ?? modeData.name ?? '',
              layer_brand: modeData.layer_brand ?? modeData.brand ?? '',
              layer_family: modeData.layer_family ?? modeData.family ?? '',
              layer_notes: Array.isArray(modeData.layer_notes) ? modeData.layer_notes : Array.isArray(modeData.notes) ? modeData.notes : [],
              layer_accords: Array.isArray(modeData.layer_accords) ? modeData.layer_accords : Array.isArray(modeData.accords) ? modeData.accords : [],
              layer_score: modeData.layer_score ?? 0,
              reason: modeData.reason ?? '',
              why_it_works: modeData.why_it_works ?? '',
              ratio_hint: modeData.ratio_hint ?? '',
              application_style: modeData.application_style ?? '',
              placement_hint: modeData.placement_hint ?? '',
              spray_guidance: modeData.spray_guidance ?? '',
              interaction_type: modeData.interaction_type ?? modeData.layer_mode ?? mood,
            };
            moodCacheRef.current.set(`${slotPfx}|${heroId}|${mood}`, entry);
            console.log('[Odara] pre-seeded mood cache from oracle.layer_modes', mood, entry.layer_name);
            if (mood === 'balance') balanceSeeded = true;
          }
        }
      }

      // Fallback: seed balance from oracle.layer if layer_modes.balance was absent
      if (!balanceSeeded && oracle.layer && oracle.layer.fragrance_id) {
        const ol = oracle.layer;
        const balanceEntry: BackendModeEntry = {
          mode: 'balance',
          layer_fragrance_id: ol.fragrance_id,
          layer_name: ol.name ?? '',
          layer_brand: ol.brand ?? '',
          layer_family: ol.family ?? '',
          layer_notes: Array.isArray(ol.notes) ? ol.notes : [],
          layer_accords: Array.isArray(ol.accords) ? ol.accords : [],
          layer_score: ol.layer_score ?? 0,
          reason: ol.reason ?? '',
          why_it_works: ol.why_it_works ?? '',
          ratio_hint: ol.ratio_hint ?? '',
          application_style: ol.application_style ?? '',
          placement_hint: ol.placement_hint ?? '',
          spray_guidance: ol.spray_guidance ?? '',
          interaction_type: ol.layer_mode ?? 'balance',
        };
        moodCacheRef.current.set(`${slotPfx}|${heroId}|balance`, balanceEntry);
        console.log('[Odara] pre-seeded balance from oracle.layer fallback', balanceEntry.layer_name);
      }

      setMoodCacheVersion(v => v + 1);

      // 5) Queue fetch is BACKGROUND — never blocks hero render
      fetchQueueRef.current(oracle.today_pick.fragrance_id).then(q => {
        if (activeSlotRef.current !== capturedSlot) return;
        setQueue(q);
        setQueuePointer(0);
      });
    } else {
      setVisibleCard(null);
      setLayerDebugSource('none');
      setQueue([]);
      setQueuePointer(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oracle, stateKey]);

  // No eager modes fetch — moods load lazily on user tap

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

  // Build layer modes from slot-scoped mood cache — lazy loaded
  // Cache is pre-seeded from oracle.layer_modes on hero load (Effect 2)
  // moodCacheVersion is used to trigger re-renders when cache updates
  void moodCacheVersion; // consumed for reactivity
  const cardId = visibleCard?.fragrance_id ?? '';
  const slotPrefix = `${selectedDate}|${selectedContext}`;

  // Mode results — single source: mood cache (pre-seeded for hero, lazy-fetched for promoted/queue)
  const modeResults: LayerModes = {
    balance: backendModeEntryToLayerMode(moodCacheRef.current.get(`${slotPrefix}|${cardId}|balance`)) ?? null,
    bold: backendModeEntryToLayerMode(moodCacheRef.current.get(`${slotPrefix}|${cardId}|bold`)) ?? null,
    smooth: backendModeEntryToLayerMode(moodCacheRef.current.get(`${slotPrefix}|${cardId}|smooth`)) ?? null,
    wild: backendModeEntryToLayerMode(moodCacheRef.current.get(`${slotPrefix}|${cardId}|wild`)) ?? null,
  };
  const visibleModeEntry = selectedMood ? modeResults[selectedMood] ?? null : null;

  useEffect(() => {
    console.log('[Odara] mode-results debug', {
      cardId,
      selectedMood,
      'modeResults.balance': modeResults.balance ? { id: modeResults.balance.id, name: modeResults.balance.name } : null,
      'modeResults.bold': modeResults.bold ? { id: modeResults.bold.id, name: modeResults.bold.name } : null,
      visibleModeEntry: visibleModeEntry ? { id: visibleModeEntry.id, name: visibleModeEntry.name } : null,
      cacheSize: moodCacheRef.current.size,
    });
  }, [cardId, selectedMood, modeResults.balance, modeResults.bold, visibleModeEntry]);

  // Mood tap handler — lazy loads if not cached (slot-scoped)
  const handleMoodSelect = useCallback((mood: LayerMood) => {
    if (lockState === 'locked') return;
    if (!visibleCard) return;
    const currentCardId = visibleCard.fragrance_id;
    const moodKey = `${selectedDate}|${selectedContext}|${currentCardId}|${mood}`;
    const cached = moodCacheRef.current.get(moodKey);
    setSelectedMood(mood);

    console.log('[Odara] mood click', { mood, currentCardId, hasCached: cached !== undefined });

    if (cached !== undefined) return; // already cached (including null = failed)
    // Lazy fetch — with stale-card guard on result
    void fetchMoodForCard(currentCardId, mood).then((entry) => {
      // Stale-card guard: only apply if visibleCard hasn't changed
      console.log('[Odara] mood click result', {
        mood,
        fetchedForCard: currentCardId,
        layerName: entry?.layer_name ?? '(null)',
      });
    });
  }, [lockState, visibleCard, fetchMoodForCard, selectedDate, selectedContext]);

  // Lock icon color
  const lockIconColor = lockState === 'locked' ? '#22c55e' : 'currentColor';

  // Helper: record/clear locked selection for weekly lanes
  const recordLockedSelection = useCallback(() => {
    if (!visibleCard) return;
    const key = `${selectedDate}:${selectedContext}`;
    const mainColor = FAMILY_COLORS[visibleCard.family] ?? '#888';
    const layerFamily = visibleModeEntry?.family_key ?? null;
    const layerColor = layerFamily ? FAMILY_COLORS[layerFamily] ?? null : null;
    setLockedSelections(prev => ({ ...prev, [key]: { mainColor, layerColor } }));
  }, [visibleCard, selectedDate, selectedContext, visibleModeEntry]);

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

    // Fire-and-forget backend skip via canonical RPC
    void odaraSupabase.rpc('skip_oracle_selection_v1' as any, {
      p_user: userId,
      p_fragrance_id: visibleCard.fragrance_id,
      p_context: selectedContext,
      p_skip_date: selectedDate,
    }).then(
      () => console.log('[Odara] skip rpc success (fire-forget)', { userId, fragranceId: visibleCard.fragrance_id, context: selectedContext, skipDate: selectedDate, rpc: 'skip_oracle_selection_v1' }),
      (err: any) => console.error('[Odara] skip rpc fail (fire-forget)', { userId, fragranceId: visibleCard.fragrance_id, context: selectedContext, skipDate: selectedDate, rpc: 'skip_oracle_selection_v1', error: err?.message })
    );

    // Slide the card down
    setSkipAnimating(true);
    await new Promise(r => window.setTimeout(r, 350));
    setSkipAnimating(false);

    try {
      const currentMoodKey = selectedMood ?? 'balance';
      const currentCacheKey = `${selectedDate}|${selectedContext}|${visibleCard.fragrance_id}|${currentMoodKey}`;
      const currentResolvedEntry = moodCacheRef.current.get(currentCacheKey) ?? null;
      console.log('[Odara] history push (skip)', { id: visibleCard.fragrance_id, mood: currentMoodKey, resolved: currentResolvedEntry ? { id: currentResolvedEntry.layer_fragrance_id, name: currentResolvedEntry.layer_name } : null });
      setViewHistory(h => [
        ...h.slice(-(MAX_SESSION_HISTORY - 1)),
        {
          card: visibleCard,
          queuePointerBefore: queuePointer,
          promotedAltId,
          selectedMood,
          resolvedVisibleModeEntry: currentResolvedEntry,
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

    const restoredMood = entry.selectedMood ?? 'balance';
    console.log('[Odara] back restore', {
      restoredId: entry.card.fragrance_id,
      restoredMood,
      restoredPromotedAltId: entry.promotedAltId,
      resolvedEntry: entry.resolvedVisibleModeEntry ? { id: entry.resolvedVisibleModeEntry.layer_fragrance_id, name: entry.resolvedVisibleModeEntry.layer_name } : null,
      historyDepth: viewHistory.length,
    });

    // Seed the mood cache with the saved resolved entry so visibleModeEntry is immediately correct
    if (entry.resolvedVisibleModeEntry) {
      const restoreCacheKey = `${selectedDate}|${selectedContext}|${entry.card.fragrance_id}|${restoredMood}`;
      moodCacheRef.current.set(restoreCacheKey, entry.resolvedVisibleModeEntry);
    }

    setVisibleCard(entry.card);
    setQueuePointer(entry.queuePointerBefore);
    setPromotedAltId(entry.promotedAltId);
    setSelectedMood(restoredMood);
    setViewHistory(h => h.slice(0, -1));
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
      // Resolve visible layer fragrance id
      const visibleLayerId = visibleModeEntry?.id ?? null;
      await onAccept(visibleCard.fragrance_id, visibleLayerId);
      return;
    }

    if (dy > SWIPE_DISTANCE) {
      clearUnlockTimeout();
      void handleSkipLocal();
    }
  }, [clearUnlockTimeout, handleSkipLocal, lockState, onAccept, visibleCard, pulseLock, visibleModeEntry]);

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

    const prevHeroId = visibleCard?.fragrance_id ?? '(none)';
    console.log('[Odara] alternate promotion', {
      tappedAltId: alt.fragrance_id,
      tappedAltName: alt.name,
      previousHeroId: prevHeroId,
    });

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

    // 1. Save history
    const currentMoodKey2 = selectedMood ?? 'balance';
    const currentCacheKey2 = `${selectedDate}|${selectedContext}|${visibleCard!.fragrance_id}|${currentMoodKey2}`;
    const currentResolvedEntry2 = moodCacheRef.current.get(currentCacheKey2) ?? null;
    console.log('[Odara] history push (promote)', { id: visibleCard!.fragrance_id, mood: currentMoodKey2, resolved: currentResolvedEntry2 ? { id: currentResolvedEntry2.layer_fragrance_id, name: currentResolvedEntry2.layer_name } : null });
    setViewHistory(h => [
      ...h.slice(-(MAX_SESSION_HISTORY - 1)),
      { card: visibleCard!, queuePointerBefore: queuePointer, promotedAltId, selectedMood, resolvedVisibleModeEntry: currentResolvedEntry2 },
    ]);

    // 2. Clear stale state completely
    setLayerExpanded(false);
    setLockState('neutral');
    setLoadingMood(null);

    // 3. Set new card state BEFORE fetch
    setVisibleCard(promoted);
    setPromotedAltId(alt.fragrance_id);
    setSelectedMood('balance');

    // 4. Immediately trigger BALANCE layer fetch for the promoted scent
    const capturedAltId = alt.fragrance_id;
    console.log('[Odara] alternate promotion: fetching balance for', capturedAltId);
    void fetchMoodForCard(capturedAltId, 'balance').then((entry) => {
      console.log('[Odara] alternate promotion: balance result', {
        promotedId: capturedAltId,
        balanceLayerName: entry?.layer_name ?? '(null)',
        balanceLayerId: entry?.layer_fragrance_id ?? '(null)',
      });
    });
  }, [lockState, visibleCard, queuePointer, promotedAltId, fetchMoodForCard, selectedDate, selectedContext]);

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
          <div className="rounded-xl px-4 py-4 text-xs flex flex-col gap-1.5" style={{ background: 'rgba(220,60,60,0.08)', border: '1px solid rgba(220,60,60,0.15)', color: '#e55' }}>
            <span className="font-semibold text-sm">Oracle request failed</span>
            <span>error: {oracleError}</span>
            <span>userId: {userId ?? 'null'}</span>
            <span>origin: {typeof window !== 'undefined' ? window.location.origin : '?'}</span>
            <span>oracleKey: {`${userId}|${selectedContext}|${selectedDate}|${resolvedTemperature}`}</span>
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
                  {resolvedTemperature}°
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
                      layerId: visibleModeEntry?.id ?? null,
                      mood: selectedMood ?? 'balance',
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
            <LayerCard
              mainName={visibleCard.name}
              mainBrand={visibleCard.brand}
              mainNotes={visibleCard.notes}
              mainFamily={visibleCard.family}
              mainProjection={null}
              layerModes={modeResults}
              visibleLayerMode={visibleModeEntry}
              selectedMood={selectedMood}
              onSelectMood={handleMoodSelect}
              selectedRatio={selectedRatio}
              onSelectRatio={setSelectedRatio}
              isExpanded={layerExpanded}
              onToggleExpand={() => setLayerExpanded(!layerExpanded)}
              lockPulse={lockPulse}
              locked={lockState === 'locked'}
              loadingMood={loadingMood}
            />

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
