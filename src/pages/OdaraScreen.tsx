import { useState, useRef, useCallback, useEffect } from "react";
import { normalizeNotes } from "@/lib/normalizeNotes";
import { odaraSupabase } from "@/lib/odara-client";
import LayerCard from "@/components/LayerCard";
import { LAYER_MODE_ORDER, type LayerMood, type LayerModes, type InteractionType } from "@/components/ModeSelector";
import { normalizeOracleHomePayload } from "@/lib/normalizeOracleHomePayload";
// NOTE: guest-content.ts is INTENTIONALLY no longer imported.
// Guest mode renders strictly from the backend payload returned by
// get_guest_oracle_home_v1 (today_pick, layer, alternates, layer_modes,
// layer_mode_order, ui_default_mode, hero_tokens, layer_tokens,
// accord_tokens). Do NOT reintroduce frontend curation here.

type GuestModeKey = 'balance' | 'bold' | 'smooth' | 'wild';
const GUEST_DEFAULT_MODE_ORDER: GuestModeKey[] = ['balance', 'bold', 'smooth', 'wild'];

interface GuestBottle {
  fragrance_id: string | null;
  name: string;
  brand: string;
  bind_status?: 'bound' | 'pending_catalog' | 'duplicate_review' | null;
  reason?: string | null;
  why_it_works?: string | null;
  family?: string | null;
  /** When tapped from alternates, carries the alternate's nested layer bundle so the
   *  layer card can render the alternate's real backend layer (not the main mode). */
  layer?: any | null;
}

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

/** Home hero payload shape from get_todays_oracle_home_v1 / get_guest_oracle_home_v1.
 *  Backend contract v3 sends the hero balance layer in multiple redundant shapes —
 *  see normalizeOracleHomePayload for the canonical resolution order. */
export interface OracleResult {
  today_pick: OraclePick;
  layer: OracleLayer | null;
  /** v3 mirror of `layer` — must agree with payload.layer */
  oracle_layer?: OracleLayer | null;
  /** v3 explicit balance-mode block — must agree with layer_modes.balance */
  seeded_balance_mode?: any;
  alternates: OracleAlternate[];
  ui_default_mode?: string;
  layer_mode_contract?: string;
  layer_modes?: {
    balance?: any;
    bold?: any;
    smooth?: any;
    wild?: any;
  };
  // ── Guest-mode fields (from get_guest_oracle_home_v1) ──
  style_key?: string;
  style_name?: string;
  style_descriptor?: string;
  style_blurb?: string;
  context_key?: string;
  context_note?: string | null;
  weekday_slot?: string | null;
  guest_mode_contract?: string | null;
  accord_tokens?: Array<{
    token_rank: number;
    token_key: string;
    token_label: string;
    color_hex: string;
    phase_hint?: string;
  }>;
  hero_tokens?: Array<any>;
  layer_tokens?: Array<any>;
  layer_mode_order?: string[];
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
  /** Guest mode: read-only, no signed-in RPCs (queue/alternates/mood). Render strictly from raw payload. */
  isGuestMode?: boolean;
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
  isGuestMode = false,
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
  // Key: `${date}|${context}|${fragranceId}|${mood}` → BackendModeEntry (never null — failures go to modeErrors)
  const moodCacheRef = useRef<Map<string, BackendModeEntry>>(new Map());
  const moodInFlightRef = useRef<Map<string, Promise<BackendModeEntry | null>>>(new Map());
  const [moodCacheVersion, setMoodCacheVersion] = useState(0); // bump to trigger re-render
  const [modeLoading, setModeLoading] = useState<Record<LayerMood, boolean>>({ balance: false, bold: false, smooth: false, wild: false });
  const [modeErrors, setModeErrors] = useState<Record<LayerMood, string | null>>({ balance: null, bold: null, smooth: null, wild: null });
  const [layerDebugSource, setLayerDebugSource] = useState<string>('none');
  // Key: `${date}|${context}|${fragranceId}` → OracleAlternate[]
  const alternatesCacheRef = useRef<Map<string, OracleAlternate[]>>(new Map());
  const [currentCardAlternates, setCurrentCardAlternates] = useState<OracleAlternate[]>([]);

  const hasHistory = viewHistory.length > 0;

  // Fetch queue from backend — background only, never blocks hero.
  // GUEST MODE: skip — queue is signed-in only.
  const fetchQueue = useCallback(async (excludeId?: string) => {
    if (isGuestMode) {
      console.log('[Odara][Guest] queue fetch skipped (read-only)');
      return [];
    }
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
  }, [userId, selectedContext, selectedDate, isGuestMode]);

  // Interactive state
  const [selectedMood, setSelectedMood] = useState<LayerMood>('balance');
  const [selectedRatio, setSelectedRatio] = useState('1:1');
  const [layerExpanded, setLayerExpanded] = useState(false);

  // ── Guest-mode-only state: curated visual sampler ──
  // Tracks which curated alternate the guest tapped (swaps the hero name+brand).
  // null = show backend payload hero (today_pick).
  const [guestHeroOverride, setGuestHeroOverride] = useState<GuestBottle | null>(null);
  const [guestLayerExpanded, setGuestLayerExpanded] = useState(false);
  const [guestSelectedMood, setGuestSelectedMood] = useState<GuestModeKey>('balance');
  // Reset guest swap state whenever the slot (date/context) or backend style changes.
  useEffect(() => {
    setGuestHeroOverride(null);
    setGuestLayerExpanded(false);
    const def = (oracle as any)?.ui_default_mode;
    const safeDef: GuestModeKey = (def === 'balance' || def === 'bold' || def === 'smooth' || def === 'wild') ? def : 'balance';
    setGuestSelectedMood(safeDef);
  }, [selectedDate, selectedContext, (oracle as any)?.style_key, (oracle as any)?.ui_default_mode]);

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
  const [likeFlash, setLikeFlash] = useState(false);
  const [skipFlash, setSkipFlash] = useState(false);
  const [skipAnimating, setSkipAnimating] = useState(false);

  // Locked selections for weekly lanes
  const [lockedSelections, setLockedSelections] = useState<LockedSelectionsMap>({});

  // Favorite state — persisted per day+context
  const [favoriteMap, setFavoriteMap] = useState<FavoriteMap>({});
  const currentFavorite = favoriteMap[stateKey] ?? null;
  const isFavorited = !!(currentFavorite && visibleCard &&
    currentFavorite.mainId === visibleCard.fragrance_id);

  // ── Lazy per-mood fetcher via get_layer_for_card_mode_v1 (slot-scoped) ──
  const fetchMoodForCard = useCallback(async (fragranceId: string, mood: LayerMood, isRetry = false) => {
    if (isGuestMode) {
      console.log('[Odara][Guest] mood fetch skipped (read-only)', { mood, fragranceId });
      return null;
    }
    const slotPrefix = `${selectedDate}|${selectedContext}`;
    const moodKey = `${slotPrefix}|${fragranceId}|${mood}`;
    const cached = moodCacheRef.current.get(moodKey);
    if (cached !== undefined && !isRetry) {
      console.log('[Odara] mood cache hit', moodKey);
      return cached;
    }

    // In-flight dedupe: reuse pending promise for same key
    const inFlight = moodInFlightRef.current.get(moodKey);
    if (inFlight && !isRetry) {
      console.log('[Odara] mood in-flight reuse', moodKey);
      return inFlight;
    }

    console.log('[Odara] mood cache miss', moodKey, isRetry ? '(retry)' : '');

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
        setModeLoading(prev => ({ ...prev, [mood]: true }));
        setModeErrors(prev => ({ ...prev, [mood]: null }));
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
          setModeErrors(prev => ({ ...prev, [mood]: error.message }));
          setLayerDebugSource(`err:${error.message}`);
          setModeLoading(prev => ({ ...prev, [mood]: false }));
          setMoodCacheVersion(v => v + 1);
          return null;
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.layer_fragrance_id) {
          // Empty result — no layer available for this mode. Not an error, just empty.
          setLayerDebugSource(`rpc:${mood}(empty)`);
          setModeLoading(prev => ({ ...prev, [mood]: false }));
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
        setModeLoading(prev => ({ ...prev, [mood]: false }));
        setMoodCacheVersion(v => v + 1);
        return entry;
      } catch (e: any) {
        if (activeSlotRef.current !== capturedSlot) {
          console.log('[Odara] ignoring stale mood error for old slot', capturedSlot);
          return null;
        }
        setModeErrors(prev => ({ ...prev, [mood]: e?.message ?? 'Fetch failed' }));
        setLayerDebugSource(`err:${e?.message}`);
        setModeLoading(prev => ({ ...prev, [mood]: false }));
        setMoodCacheVersion(v => v + 1);
        return null;
      } finally {
        moodInFlightRef.current.delete(moodKey);
      }
    })();

    moodInFlightRef.current.set(moodKey, fetchPromise);
    return fetchPromise;
  }, [userId, selectedContext, selectedDate, activeOracle, stateKey, isGuestMode]);

  const resolveAlternatesForCard = useCallback(async (card: DisplayCard) => {
    // GUEST MODE: source alternates directly from raw payload — no signed-in RPC.
    // Null fragrance_id is valid (pending_catalog) — keep the row visible, only id-dependent actions are gated.
    if (isGuestMode) {
      const raw = (oracle?.alternates ?? []) as any[];
      const guestAlts: OracleAlternate[] = raw.map((row, idx) => ({
        fragrance_id: row?.fragrance_id ?? `__guest_alt_${idx}`,
        name: row?.name ?? '',
        family: row?.family ?? '',
        reason: row?.reason ?? '',
        brand: row?.brand ?? '',
        notes: Array.isArray(row?.notes) ? row.notes : [],
        accords: Array.isArray(row?.accords) ? row.accords : [],
      })).filter(a => a.name);
      console.log('[Odara][Guest] alternates from raw payload', { count: guestAlts.length });
      return guestAlts;
    }

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
  }, [userId, selectedContext, selectedDate, stateKey, isGuestMode, oracle]);

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
    setSelectedMood('balance');
    setModeLoading({ balance: false, bold: false, smooth: false, wild: false });
    setModeErrors({ balance: null, bold: null, smooth: null, wild: null });
    moodCacheRef.current.clear();
    moodInFlightRef.current.clear();
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

    // ── Normalize raw payload ONCE — single source of truth ──
    const normalized = normalizeOracleHomePayload(oracle);

    console.log('[Odara] oracle apply', {
      selectedDate,
      selectedContext,
      backendHeroId: oracle.today_pick?.fragrance_id ?? '(none)',
      previousVisibleId: prevVisibleId,
      promotedAltIdBeforeReset: prevPromotedId,
      contract: normalized.rawModeContract,
      seededBalanceLayerName: normalized.seededBalanceLayer?.name ?? '(null)',
      seededBalanceLayerId: normalized.seededBalanceLayer?.fragranceId ?? '(null)',
    });

    // 1) Clear ALL stale state first
    // viewHistory is NOT cleared here — slot changes clear it in Effect 1 above
    setPromotedAltId(null);
    setLayerExpanded(false);
    setModeLoading({ balance: false, bold: false, smooth: false, wild: false });
    setModeErrors({ balance: null, bold: null, smooth: null, wild: null });

    // 2) Set oracle
    setActiveOracle(oracle);

    // 3) PRODUCT LAW: Home always opens on `balance`. Ignore server-suggested mode.
    const initialMood: LayerMood = normalized.defaultMode;
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

      // 4) Pre-seed mood cache from normalized payload for hero card
      const slotPfx = `${selectedDate}|${selectedContext}`;
      const heroId = oracle.today_pick.fragrance_id;

      // 4a) Seed every mode block from layer_modes when present
      if (normalized.layerModesRaw) {
        for (const mood of LAYER_MODE_ORDER) {
          const modeData = (normalized.layerModesRaw as any)?.[mood];
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
            console.log('[Odara] pre-seeded mood cache from layer_modes', mood, entry.layer_name);
          }
        }
      }

      // 4b) GUARANTEE balance is seeded — fall back to normalized.seededBalanceLayer
      // (which already prefers payload.layer → oracle_layer → seeded_balance_mode → layer_modes.balance)
      const balanceCacheKey = `${slotPfx}|${heroId}|balance`;
      if (!moodCacheRef.current.has(balanceCacheKey) && normalized.seededBalanceLayer?.fragranceId) {
        const sb = normalized.seededBalanceLayer;
        const balanceEntry: BackendModeEntry = {
          mode: 'balance',
          layer_fragrance_id: sb.fragranceId!,
          layer_name: sb.name ?? '',
          layer_brand: sb.brand ?? '',
          layer_family: sb.family ?? '',
          layer_notes: sb.notes,
          layer_accords: sb.accords,
          layer_score: sb.layerScore ?? 0,
          reason: sb.reason ?? '',
          why_it_works: sb.whyItWorks ?? '',
          ratio_hint: sb.ratioHint ?? '',
          application_style: sb.applicationStyle ?? '',
          placement_hint: sb.placementHint ?? '',
          spray_guidance: sb.sprayGuidance ?? '',
          interaction_type: sb.interactionType ?? 'balance',
        };
        moodCacheRef.current.set(balanceCacheKey, balanceEntry);
        console.log('[Odara] pre-seeded balance from normalized.seededBalanceLayer', balanceEntry.layer_name);
      }

      console.log('[Odara] mode cache after init', {
        heroId,
        keys: Array.from(moodCacheRef.current.keys()).filter(k => k.includes(heroId)),
        balanceLoaded: moodCacheRef.current.has(balanceCacheKey),
      });

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

  // Double-tap detector ref (replaces old swipe-gesture system).
  // double tap on card = like + lock
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });
  const unlockTimeoutRef = useRef<number | null>(null);
  const DOUBLE_TAP_MS = 320;
  const DOUBLE_TAP_DIST = 32;

  const oracleHeroId = activeOracle?.today_pick?.fragrance_id ?? null;
  const isShowingHeroCard =
    !!visibleCard &&
    (
      // Signed-in: must match oracle hero id
      (!!oracleHeroId && visibleCard.fragrance_id === oracleHeroId) ||
      // Guest mode: today_pick may have null fragrance_id (pending_catalog) — still treat as hero
      (isGuestMode && !!activeOracle?.today_pick && visibleCard.isHero)
    );
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

  useEffect(() => {
    return () => clearUnlockTimeout();
  }, [clearUnlockTimeout]);

  /* ──────────────────────────────────────────────────────────────
   * Card interaction contract:
   *   - double tap on the overall card = like + lock
   *   - single tap on the layer section = expand/collapse
   *     (LayerCard handles its own onClick + stopPropagation)
   *   - swipe-up lock has been REMOVED
   *   - manual unlock is still available via the lock icon button
   * ────────────────────────────────────────────────────────────── */
  const handleCardClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!visibleCard) return;

    const target = e.target as HTMLElement;
    // Never treat taps on action stack buttons, layer section, or other
    // interactive elements as a card double-tap.
    if (target.closest('[data-action-stack]')) return;
    if (target.closest('[data-debug-controls]')) return;
    if (target.closest('[data-layer-section]')) return;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return;

    // Already locked → no-op (use the lock icon to unlock).
    if (lockState === 'locked') return;

    const now = Date.now();
    const last = lastTapRef.current;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    const within = (now - last.time) <= DOUBLE_TAP_MS &&
      Math.hypot(dx, dy) <= DOUBLE_TAP_DIST;

    if (!within) {
      lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
      return;
    }

    // Second tap → like + lock together.
    lastTapRef.current = { time: 0, x: 0, y: 0 };
    clearUnlockTimeout();
    setLockState('locked');
    recordLockedSelection();

    // Visual confirmation: like pulse + lock burst.
    setLikeFlash(true);
    window.setTimeout(() => setLikeFlash(false), 600);
    setLockFlash(true);
    window.setTimeout(() => setLockFlash(false), 700);
    pulseLock();

    // NOTE: backend "like" persistence is not yet wired — when it lands,
    // call it here alongside onAccept. Lock persistence runs through onAccept.
    const visibleLayerId = visibleModeEntry?.id ?? null;
    try {
      await onAccept(visibleCard.fragrance_id, visibleLayerId);
    } catch (err) {
      console.warn('[Odara] onAccept failed after double-tap lock', err);
    }
  }, [
    visibleCard,
    lockState,
    clearUnlockTimeout,
    setLockState,
    recordLockedSelection,
    pulseLock,
    onAccept,
    visibleModeEntry,
  ]);

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
    setModeLoading({ balance: false, bold: false, smooth: false, wild: false });
    setModeErrors({ balance: null, bold: null, smooth: null, wild: null });

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

  if (isGuestMode) {
    const o: any = oracle ?? {};
    console.log('[Odara][Guest] render summary', {
      style_key: o.style_key ?? null,
      style_name: o.style_name ?? null,
      weekday_slot: o.weekday_slot ?? null,
      hero_name: o.today_pick?.name ?? null,
      hero_bind_status: o.today_pick?.bind_status ?? null,
      layer_name: o.layer?.name ?? null,
      alternates_count: Array.isArray(o.alternates) ? o.alternates.length : 0,
      visibleCardId: visibleCard?.fragrance_id ?? null,
      isShowingHeroCard,
    });
  }

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
              touchAction: 'manipulation',
              ...(skipAnimating ? { animation: 'cardSlideDown 0.35s ease-in forwards' } : {}),
            }}
            onClick={isGuestMode ? undefined : handleCardClick}
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

              {/* Right: lock → star → back vertical stack — HIDDEN in guest mode (read-only) */}
              {!isGuestMode && (
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
              )}
              {/* Guest mode: visible-but-disabled lock to preserve card chrome */}
              {isGuestMode && (
                <div className="flex flex-col items-center gap-1.5 min-w-[52px]" data-action-stack>
                  <button
                    type="button"
                    disabled
                    aria-label="Lock (sign in to use)"
                    className="p-0.5 cursor-default opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/40">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Source badge for queue cards */}
            {!isHeroStyle && (
              <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/40 text-center mb-0.5">
                from queue
              </span>
            )}

            {/* Fragrance name (guest may override via curated alternate tap) */}
            <h2
              className="text-[32px] leading-[1.1] font-normal text-foreground mt-0.5 mb-0.5 text-center"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              {isGuestMode && guestHeroOverride
                ? getDisplayName(guestHeroOverride.name, guestHeroOverride.brand)
                : getDisplayName(visibleCard.name, visibleCard.brand)}
            </h2>

            {/* Brand */}
            <span className="text-[13px] text-muted-foreground/60 text-center mb-1.5">
              {isGuestMode && guestHeroOverride ? guestHeroOverride.brand : visibleCard.brand}
            </span>

            {/* Family label — signed-in: derived label; guest: backend family string verbatim */}
            {!isGuestMode ? (
              <span
                className="text-[12px] uppercase tracking-[0.15em] font-medium text-center mb-1.5"
                style={{ color: familyColor }}
              >
                {familyLabel}
              </span>
            ) : (() => {
              const o: any = activeOracle ?? oracle ?? {};
              const guestHeroFamily: string | null =
                (guestHeroOverride && (guestHeroOverride as any).family)
                  ? String((guestHeroOverride as any).family)
                  : (o.today_pick?.family ? String(o.today_pick.family) : null);
              if (!guestHeroFamily) return null;
              const fam = guestHeroFamily as keyof typeof FAMILY_COLORS;
              const guestHeroFamilyColor = FAMILY_COLORS[fam] ?? '#aaa';
              return (
                <span
                  className="text-[12px] uppercase tracking-[0.15em] font-medium text-center mb-1.5"
                  style={{ color: guestHeroFamilyColor }}
                >
                  {guestHeroFamily}
                </span>
              );
            })()}

            {/* Accords (signed-in) / Hero tokens (guest) — tokens carry the meaning in guest mode */}
            {isGuestMode ? (() => {
              const o: any = activeOracle ?? oracle ?? {};
              const tokens: Array<any> = Array.isArray(o.hero_tokens) && o.hero_tokens.length > 0
                ? o.hero_tokens
                : (Array.isArray(o.accord_tokens) ? o.accord_tokens : []);
              if (tokens.length === 0) return null;
              return (
                <div
                  className="flex flex-nowrap items-center gap-1.5 px-3 mb-3 overflow-x-auto justify-start sm:justify-center w-full"
                  style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
                >
                  {tokens.map((t, i) => (
                    <span
                      key={`hero-tok-${t.token_key ?? 'tok'}-${i}`}
                      className="flex-shrink-0 whitespace-nowrap text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-full"
                      style={{
                        color: t.color_hex || '#aaa',
                        border: `1px solid ${(t.color_hex || '#888')}55`,
                        background: `${(t.color_hex || '#888')}10`,
                      }}
                    >
                      {t.token_label}
                    </span>
                  ))}
                </div>
              );
            })() : (pickAccords.length > 0 && (
              <p className="text-[13px] text-center mb-3" style={{ lineHeight: 1.5, letterSpacing: '0.06em' }}>
                <span className="text-foreground/50">accords: </span>
                <span className="text-foreground/85 font-medium lowercase">
                  {pickAccords.join(', ')}
                </span>
              </p>
            ))}

            {/* ── Guest mode: backend-driven layer card. All content from payload. ── */}
            {isGuestMode ? (() => {
              const o: any = activeOracle ?? oracle ?? {};
              const heroTokens: Array<any> = Array.isArray(o.hero_tokens) && o.hero_tokens.length > 0
                ? o.hero_tokens
                : (Array.isArray(o.accord_tokens) ? o.accord_tokens : []);
              const layerModesRaw: Record<string, any> = (o.layer_modes && typeof o.layer_modes === 'object') ? o.layer_modes : {};
              const modeOrder: GuestModeKey[] = (Array.isArray(o.layer_mode_order) && o.layer_mode_order.length > 0
                ? o.layer_mode_order
                : GUEST_DEFAULT_MODE_ORDER
              ).filter((m: any): m is GuestModeKey =>
                m === 'balance' || m === 'bold' || m === 'smooth' || m === 'wild'
              );
              // ── Alternate-bundle override: when a guest taps an alternate that carries
              //    a nested backend `layer` bundle, the layer card switches to render
              //    THAT alternate's backend layer (name/brand/family/tokens/why_it_works),
              //    and the mode row hides (alternates have no backend mode set).
              const altLayer: any = (guestHeroOverride && (guestHeroOverride as any).layer) ? (guestHeroOverride as any).layer : null;
              const altBundleActive = !!altLayer;
              const selectedModeRaw: any = altLayer ?? (layerModesRaw[guestSelectedMood] ?? null);
              // Layer token rail: FIRST CHOICE is the selected mode's own tokens,
              // so the rail updates together with the scent/brand/why-it-works.
              const layerTokens: Array<any> =
                (Array.isArray(selectedModeRaw?.tokens) && selectedModeRaw.tokens.length > 0)
                  ? selectedModeRaw.tokens
                  : (Array.isArray(o.layer?.tokens) && o.layer.tokens.length > 0)
                    ? o.layer.tokens
                    : (Array.isArray(o.layer_tokens) && o.layer_tokens.length > 0)
                      ? o.layer_tokens
                      : (Array.isArray(o.accord_tokens) ? o.accord_tokens : []);
              // SINGLE source of truth for the layer scent block:
              //   - prefer payload.layer_modes[selectedMood]
              //   - fallback to payload.layer (which == layer_modes.balance per backend contract)
              const fallbackLayer = o.layer ?? null;
              const activeBottle: GuestBottle | null = selectedModeRaw
                ? {
                    fragrance_id: selectedModeRaw.fragrance_id ?? null,
                    name: selectedModeRaw.name ?? '—',
                    brand: selectedModeRaw.brand ?? '',
                    bind_status: selectedModeRaw.bind_status ?? null,
                    why_it_works: selectedModeRaw.why_it_works ?? null,
                  }
                : fallbackLayer
                  ? {
                      fragrance_id: fallbackLayer.fragrance_id ?? null,
                      name: fallbackLayer.name ?? '—',
                      brand: fallbackLayer.brand ?? '',
                      bind_status: fallbackLayer.bind_status ?? null,
                      why_it_works: fallbackLayer.why_it_works ?? null,
                    }
                  : null;
              console.log('[Odara][Guest] render summary', {
                selected_mode: guestSelectedMood,
                selected_mode_scent: activeBottle?.name ?? null,
                why_it_works_present: !!activeBottle?.why_it_works,
                hero_token_count: heroTokens.length,
                layer_token_count: layerTokens.length,
                alternates_count: Array.isArray(o.alternates) ? o.alternates.length : 0,
              });
              if (!activeBottle) return null;
              return (
                <div className="flex flex-col gap-3 mt-1">
                  <div
                    className="rounded-[16px] overflow-hidden"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    {/* Collapsed face — single scent block (updates in-place when mode changes) */}
                    <button
                      type="button"
                      onClick={() => setGuestLayerExpanded(v => !v)}
                      aria-expanded={guestLayerExpanded}
                      className="w-full px-4 py-3 flex flex-col items-center gap-1 text-center transition-colors"
                    >
                      {/* 1. "Layer with" */}
                      <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/50">
                        Layer with
                      </span>
                      {/* 2. selected layer scent name */}
                      <span
                        className="text-[20px] leading-tight text-foreground"
                        style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
                      >
                        {getDisplayName(activeBottle.name, activeBottle.brand)}
                      </span>
                      {/* 3. selected layer brand */}
                      {activeBottle.brand && (
                        <span className="text-[12px] text-muted-foreground/60">
                          {activeBottle.brand}
                        </span>
                      )}
                      {/* 4. selected layer family tag — backend verbatim, updates with selectedMode */}
                      {(() => {
                        const layerFamily: string | null =
                          (selectedModeRaw && selectedModeRaw.family)
                            ? String(selectedModeRaw.family)
                            : (fallbackLayer && fallbackLayer.family)
                              ? String(fallbackLayer.family)
                              : null;
                        if (!layerFamily) return null;
                        const fam = layerFamily as keyof typeof FAMILY_COLORS;
                        const layerFamilyColor = FAMILY_COLORS[fam] ?? '#aaa';
                        return (
                          <span
                            className="text-[10px] uppercase tracking-[0.15em] font-medium mt-0.5"
                            style={{ color: layerFamilyColor }}
                          >
                            {layerFamily}
                          </span>
                        );
                      })()}
                      {/* 5. selected layer token rail */}
                      {layerTokens.length > 0 && (
                        <div
                          className="flex flex-nowrap items-center gap-1.5 mt-1.5 w-full overflow-x-auto px-1"
                          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {layerTokens.map((t, i) => (
                            <span
                              key={`layer-tok-${t.token_key ?? 'tok'}-${i}`}
                              className="flex-shrink-0 whitespace-nowrap text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full"
                              style={{
                                color: t.color_hex || '#aaa',
                                border: `1px solid ${(t.color_hex || '#888')}44`,
                                background: `${(t.color_hex || '#888')}0A`,
                              }}
                            >
                              {t.token_label}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>

                    {/* Expanded section — mode row + Why It Works ONLY.
                        No second scent title block — collapsed face already updates in-place. */}
                    {guestLayerExpanded && (modeOrder.length > 0 || altBundleActive) && (
                      <div
                        className="px-4 pb-3 pt-3 flex flex-col gap-3"
                        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        {/* 5. mode row — hidden while alternate bundle is active (alternates have no mode set) */}
                        {!altBundleActive && modeOrder.length > 0 && (
                          <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${modeOrder.length}, minmax(0, 1fr))` }}>
                            {modeOrder.map(m => {
                              const active = guestSelectedMood === m;
                              const present = !!layerModesRaw[m];
                              return (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => present && setGuestSelectedMood(m)}
                                  disabled={!present}
                                  className={`text-[10px] uppercase tracking-[0.12em] py-1.5 rounded-full transition-all ${
                                    active
                                      ? 'bg-foreground/10 text-foreground border border-foreground/25'
                                      : present
                                        ? 'text-muted-foreground/55 hover:text-foreground/80 border border-transparent'
                                        : 'text-muted-foreground/20 border border-transparent cursor-default'
                                  }`}
                                >
                                  {m}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* 6 + 7. Why it works heading + body — backend-supplied copy only */}
                        <div className="pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                          <span className="text-[9px] uppercase tracking-[0.15em] text-white/50 block text-center">
                            Why it works
                          </span>
                          {activeBottle.why_it_works && (
                            <p className="text-[12px] text-foreground/75 text-center mt-2 leading-relaxed">
                              {activeBottle.why_it_works}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })() : (
              // Mark the layer section so the card-level double-tap handler
              // ignores taps that land inside it. LayerCard already calls
              // stopPropagation on its expand/collapse trigger.
              <div data-layer-section>
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
                  modeLoading={modeLoading}
                  modeErrors={modeErrors}
                  onRetryMood={(mood) => {
                    if (!visibleCard) return;
                    void fetchMoodForCard(visibleCard.fragrance_id, mood, true);
                  }}
                />
              </div>
            )}

            {/* ── Alternatives ── */}
            {isGuestMode ? (() => {
              // Guest mode: alternates come strictly from backend payload.alternates.
              // Tapping swaps the visible hero name+brand (read-only sampler — no signed-in RPCs).
              const o: any = activeOracle ?? oracle ?? {};
              const rawAlts: any[] = Array.isArray(o.alternates) ? o.alternates : [];
              const alts: GuestBottle[] = rawAlts.map((a) => ({
                fragrance_id: a?.fragrance_id ?? null,
                name: a?.name ?? '—',
                brand: a?.brand ?? '',
                bind_status: a?.bind_status ?? null,
                family: a?.family ?? null,
                // Carry the alternate's nested backend layer bundle (when present)
                // so the layer card can render the alternate's real layer set.
                layer: a?.layer ?? null,
              }));
              if (alts.length === 0) return null;
              return (
                <div className="flex flex-col items-center gap-2 mt-3">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
                    Alternatives
                  </span>
                  <div
                    className="flex flex-nowrap gap-2 w-full overflow-x-auto pb-1 px-3 justify-start sm:justify-center"
                    style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
                  >
                    {alts.map((alt, i) => {
                      const isActive =
                        guestHeroOverride?.name === alt.name && guestHeroOverride?.brand === alt.brand;
                      return (
                        <button
                          key={`${alt.name}-${i}`}
                          type="button"
                          onClick={() => {
                            if (isActive) {
                              setGuestHeroOverride(null);
                            } else {
                              setGuestHeroOverride(alt);
                              if (alt.layer) setGuestLayerExpanded(true);
                            }
                          }}
                          className={`flex-shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200 active:scale-95 ${
                            isActive
                              ? 'bg-foreground/12 text-foreground border border-foreground/30'
                              : 'text-foreground/70 hover:text-foreground/95 border border-foreground/15 bg-foreground/[0.04]'
                          }`}
                        >
                          {getDisplayName(alt.name)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })() : (alternatesRendered && (
              <div className="flex flex-col items-center gap-2 mt-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
                  Alternatives
                </span>
                <div className="flex gap-2 overflow-x-auto w-full pb-1 px-1" style={{ scrollbarWidth: 'none' }}>
                  {visibleAlts.map((alt, i) => {
                    const altColor = FAMILY_COLORS[alt.family] ?? '#888';
                    const isSyntheticId = !alt.fragrance_id || alt.fragrance_id.startsWith('__guest_alt_');
                    const promotionDisabled = isGuestMode || isSyntheticId;
                    return (
                      <button
                        key={alt.fragrance_id || i}
                        onClick={promotionDisabled ? undefined : () => handlePromoteAlternate(alt)}
                        disabled={promotionDisabled}
                        className={`flex-shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200
                          text-foreground/70 ${promotionDisabled ? 'cursor-default' : 'hover:text-foreground/90 active:scale-95'}
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
            ))}


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
