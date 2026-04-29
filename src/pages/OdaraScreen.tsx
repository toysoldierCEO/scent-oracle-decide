import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { normalizeNotes } from "@/lib/normalizeNotes";
import { odaraSupabase } from "@/lib/odara-client";
import LayerCard from "@/components/LayerCard";
import { LAYER_MODE_ORDER, type LayerMood, type LayerModes, type InteractionType } from "@/components/ModeSelector";
import { normalizeOracleHomePayload } from "@/lib/normalizeOracleHomePayload";
import { haptic } from "@/lib/haptics";
// NOTE: guest-content.ts is INTENTIONALLY no longer imported.
// Guest mode renders strictly from the backend payload returned by
// get_guest_oracle_home_v1 (today_pick, layer, alternates, layer_modes,
// layer_mode_order, ui_default_mode, hero_tokens, layer_tokens,
// accord_tokens). Do NOT reintroduce frontend curation here.

type GuestModeKey = 'balance' | 'bold' | 'smooth' | 'wild';
const GUEST_DEFAULT_MODE_ORDER: GuestModeKey[] = ['balance', 'bold', 'smooth', 'wild'];

type GuestRenderSource =
  | 'guest_main_bundle'
  | 'guest_selected_alternate'
  | 'guest_skip_target'
  | 'guest_back_restore';

interface GuestResolverState {
  source: GuestRenderSource;
  selectedMood: GuestModeKey;
  activeLayerIdx: number;
}

interface ResolvedGuestCardVM {
  source: GuestRenderSource;
  selectedAlternateIndex: number | null;
  selectedMode: GuestModeKey;
  activeLayerIndex: number;
  hero: any | null;
  heroTokens: any[];
  layer: any | null;
  layerTokens: any[];
  layerModes: Record<GuestModeKey, any | null>;
  modeOrder: GuestModeKey[];
  modeLayerStack: any[];
  alternates: any[];
  renderedFromFullBundle: boolean;
}

function isGuestModeKey(value: any): value is GuestModeKey {
  return value === 'balance' || value === 'bold' || value === 'smooth' || value === 'wild';
}

function resolveGuestCardVM(
  payload: any,
  selectedAlternateIdx: number | null,
  state: GuestResolverState,
): ResolvedGuestCardVM | null {
  const main: any = payload?.main_bundle ?? null;
  if (!main?.hero) return null;

  const altBundles: any[] = Array.isArray(payload?.alternate_bundles) ? payload.alternate_bundles : [];
  const bundle: any = selectedAlternateIdx === null ? main : (altBundles[selectedAlternateIdx] ?? null);
  if (!bundle?.hero) return null;

  const modeOrderRaw: any[] = Array.isArray(bundle?.layer_mode_order) && bundle.layer_mode_order.length > 0
    ? bundle.layer_mode_order
    : Array.isArray(main?.layer_mode_order) && main.layer_mode_order.length > 0
      ? main.layer_mode_order
      : GUEST_DEFAULT_MODE_ORDER;
  const modeOrder = modeOrderRaw.filter(isGuestModeKey);
  const layerModesObj: Record<string, any> = bundle?.layer_modes && typeof bundle.layer_modes === 'object'
    ? bundle.layer_modes
    : {};
  const defaultMode: GuestModeKey = isGuestModeKey(bundle?.ui_default_mode)
    ? bundle.ui_default_mode
    : modeOrder.find((mode) => !!layerModesObj[mode]) ?? 'balance';

  let selectedMode: GuestModeKey = state.selectedMood;
  if (!layerModesObj[selectedMode]) {
    selectedMode = defaultMode;
  }
  if (!layerModesObj[selectedMode]) {
    selectedMode = modeOrder.find((mode) => !!layerModesObj[mode]) ?? defaultMode;
  }

  const modeLayerStack: any[] = Array.isArray(layerModesObj[selectedMode]?.layers)
    ? layerModesObj[selectedMode].layers
    : [];
  let activeLayerIndex = state.activeLayerIdx;
  if (activeLayerIndex < 0 || activeLayerIndex >= modeLayerStack.length) {
    activeLayerIndex = 0;
  }

  const layerFromMode = modeLayerStack[activeLayerIndex] ?? null;
  const layer = layerFromMode ?? bundle?.layer ?? null;
  const heroTokens = Array.isArray(bundle?.hero_tokens)
    ? bundle.hero_tokens
    : Array.isArray(bundle?.hero?.tokens)
      ? bundle.hero.tokens
      : [];
  const layerTokens = Array.isArray(layerFromMode?.tokens) && layerFromMode.tokens.length > 0
    ? layerFromMode.tokens
    : Array.isArray(bundle?.layer_tokens)
      ? bundle.layer_tokens
      : Array.isArray(bundle?.layer?.tokens)
        ? bundle.layer.tokens
        : [];

  return {
    source: state.source,
    selectedAlternateIndex: selectedAlternateIdx,
    selectedMode,
    activeLayerIndex,
    hero: bundle.hero ?? null,
    heroTokens,
    layer,
    layerTokens,
    layerModes: {
      balance: layerModesObj.balance ?? null,
      bold: layerModesObj.bold ?? null,
      smooth: layerModesObj.smooth ?? null,
      wild: layerModesObj.wild ?? null,
    },
    modeOrder,
    modeLayerStack,
    alternates: altBundles,
    renderedFromFullBundle: true,
  };
}

function guestLayerToModeEntry(layer: any): NonNullable<LayerModes[LayerMood]> | null {
  if (!layer) return null;
  return {
    id: layer.fragrance_id ?? layer.id ?? '',
    name: layer.name ?? '',
    brand: layer.brand ?? null,
    family_key: layer.family ?? layer.family_key ?? '',
    notes: Array.isArray(layer.notes) ? layer.notes : null,
    accords: Array.isArray(layer.accords) ? layer.accords : null,
    interactionType: (layer.interaction_type ?? layer.layer_mode ?? 'balance') as InteractionType,
    reason: layer.reason ?? '',
    why_it_works: layer.why_it_works ?? '',
    projection: typeof layer.projection === 'number' ? layer.projection : null,
    ratio_hint: layer.ratio_hint ?? undefined,
    application_style: layer.application_style ?? undefined,
    placement_hint: layer.placement_hint ?? undefined,
    spray_guidance: layer.spray_guidance ?? undefined,
  };
}

function guestLayerModesToModeSelector(layerModes: Record<GuestModeKey, any | null>): LayerModes {
  return {
    balance: guestLayerToModeEntry(layerModes.balance),
    bold: guestLayerToModeEntry(layerModes.bold),
    smooth: guestLayerToModeEntry(layerModes.smooth),
    wild: guestLayerToModeEntry(layerModes.wild),
  };
}

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

/* ── Forecast days ──
 * Local-date parsing only. Never use toISOString() for UI day labels or
 * selected-day matching — that introduces UTC drift near day boundaries
 * and makes the card header date and calendar highlight disagree. */
function fmtLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildForecastDays(selectedDate: string) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  const todayStr = fmtLocalDateStr(today);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = fmtLocalDateStr(d);
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

/* ── Gesture constants ──
 * Card approval is a double-tap (click-based).
 * Swipe-up-to-lock is REMOVED and must not be reintroduced.
 * Swipe-DOWN remains a two-step contract:
 *   - locked   → swipe down = unlock
 *   - neutral  → swipe down = skip
 */
const SWIPE_DOWN_DISTANCE = 60;     // px of downward travel to trigger
const SWIPE_DIRECTION_LOCK = 8;     // px before we lock direction
const SWIPE_HORIZONTAL_TOLERANCE = 1.2; // |dy| must exceed |dx| * this

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

/** Convert a v6 layer entry (from get_signed_in_card_contract_v6, either the
 *  top-level `layer` object or `layer_modes[mood].layers[idx]`) into the
 *  LayerMode shape consumed by LayerCard. Pure mapping — no inference. */
function v6LayerToLayerMode(
  layer: any,
  mood: LayerMood,
): NonNullable<LayerModes[LayerMood]> | null {
  if (!layer || typeof layer !== 'object') return null;
  const id = layer.fragrance_id ?? layer.layer_fragrance_id ?? layer.id ?? '';
  const name = layer.name ?? layer.layer_name ?? '';
  if (!id && !name) return null;
  return {
    id,
    name,
    brand: layer.brand ?? layer.layer_brand ?? '',
    family_key: layer.family ?? layer.family_key ?? layer.layer_family ?? '',
    notes: Array.isArray(layer.notes) ? layer.notes : Array.isArray(layer.layer_notes) ? layer.layer_notes : [],
    accords: Array.isArray(layer.accords) ? layer.accords : Array.isArray(layer.layer_accords) ? layer.layer_accords : [],
    interactionType: ((layer.interaction_type ?? layer.layer_mode ?? mood) as InteractionType) || mood,
    reason: layer.reason ?? '',
    why_it_works: layer.why_it_works ?? '',
    projection: layer.projection ?? null,
    ratio_hint: layer.ratio_hint ?? '',
    application_style: layer.application_style ?? '',
    placement_hint: layer.placement_hint ?? '',
    spray_guidance: layer.spray_guidance ?? '',
  } as any;
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
  // ── Signed-in v6: per-mood active layer index into payload.layer_modes[mood].layers[]
  // Reset to {balance:0,bold:0,smooth:0,wild:0} on every payload change.
  // Repeated taps on the same mood cycle this index modulo stack length.
  const [signedInLayerIdxByMood, setSignedInLayerIdxByMood] = useState<Record<LayerMood, number>>({
    balance: 0, bold: 0, smooth: 0, wild: 0,
  });

  // ── Guest-mode v5 state machine (guest_single_bundle_v3_mode_layers) ──
  // Two render states only:
  //   A) selectedAlternateIdx === null → main-mode state
  //      Drives selectedMode + activeLayerIndex against payload.main_bundle.layer_modes[mode].layers[]
  //   B) selectedAlternateIdx !== null → alternate-bundle state
  //      Renders payload.alternate_bundles[idx]; mode row hidden.
  // selectedAlternateIdx must NOT overwrite selectedMode/activeLayerIndex —
  // those are restored verbatim when the alternate is cleared.
  const [guestLayerExpanded, setGuestLayerExpanded] = useState(false);
  const [guestSelectedMood, setGuestSelectedMood] = useState<GuestModeKey>('balance');
  const [guestActiveLayerIdx, setGuestActiveLayerIdx] = useState(0);
  const [selectedAlternateIdx, setSelectedAlternateIdx] = useState<number | null>(null);
  // Snapshot of main-state at time alternate was selected, for clean restore.
  const guestPrevMainStateRef = useRef<{ mood: GuestModeKey; idx: number } | null>(null);
  const guestRenderSourceRef = useRef<GuestRenderSource>('guest_main_bundle');
  // Multi-step guest skip history: each entry is the alternate index that was
  // visible BEFORE the skip (null = main bundle). Pushed on every guest skip,
  // popped by the back button to restore the previous guest card.
  const [guestSkipHistory, setGuestSkipHistory] = useState<Array<number | null>>([]);

  // ── Guest-local action state (session-only, no Supabase writes) ──
  // Card-scoped: keyed by `${date}|${context}|${heroId}|${brand}` so that
  // navigating to a different visible card does NOT inherit the prior
  // card's local star/lock visual state. Returning to the same card during
  // the same session restores the local state.
  const [guestStarredByKey, setGuestStarredByKey] = useState<Record<string, boolean>>({});
  const [guestLockedByKey, setGuestLockedByKey] = useState<Record<string, boolean>>({});
  const [guestStarFlash, setGuestStarFlash] = useState(false);
  const [guestLockFlash, setGuestLockFlash] = useState(false);
  const [guestUnlockFlash, setGuestUnlockFlash] = useState(false);

  // Reset guest state whenever the slot (date/context) or backend payload changes.
  useEffect(() => {
    guestRenderSourceRef.current = 'guest_main_bundle';
    setSelectedAlternateIdx(null);
    guestPrevMainStateRef.current = null;
    setGuestSkipHistory([]);
    setGuestLayerExpanded(false);
    setGuestActiveLayerIdx(0);
    const def = (oracle as any)?.main_bundle?.ui_default_mode ?? (oracle as any)?.ui_default_mode;
    const safeDef: GuestModeKey = (def === 'balance' || def === 'bold' || def === 'smooth' || def === 'wild') ? def : 'balance';
    setGuestSelectedMood(safeDef);
  }, [selectedDate, selectedContext, (oracle as any)?.style_key, (oracle as any)?.main_bundle?.ui_default_mode, (oracle as any)?.ui_default_mode]);

  // ── Guest v5 contract guard + single derivation helper ──
  // ALL guest JSX must read from `activeGuestRender` only. Do NOT reach back into
  // payload fields directly elsewhere.
  const activeGuestRender = useMemo(() => {
    if (!isGuestMode) return null;
    // Prefer the freshest payload — `oracle` (latest prop) before
    // `activeOracle` (state mirror) so guest tokens paint on the very first
    // render pass after hydration without needing a manual repaint/scroll.
    const o: any = oracle ?? activeOracle ?? {};
    // Accept v5 either via the explicit contract flag OR by structural
    // signature (main_bundle.hero present). This eliminates the hydration
    // race where the contract field arrives one tick after main_bundle.
    const isV5 = !!(o?.main_bundle?.hero) &&
      (o?.guest_mode_contract === 'guest_single_bundle_v3_mode_layers' || !!o?.main_bundle?.layer_modes);
    if (!isV5) return null;

    // PHASE 2 STALE PAYLOAD GUARD: if the v6 payload's requested_context or
    // wear_date does not match the current selection, treat it as stale and
    // do not render. The fetch-layer requestId guard already discards stale
    // responses; this is defense-in-depth at the render layer.
    const payloadCtx = o?.requested_context ?? o?.main_bundle?.requested_context ?? null;
    const payloadDate = o?.wear_date ?? o?.main_bundle?.wear_date ?? null;
    if (payloadCtx && payloadCtx !== selectedContext) return null;
    if (payloadDate && payloadDate !== selectedDate) return null;


    const resolved = resolveGuestCardVM(o, selectedAlternateIdx, {
      source: guestRenderSourceRef.current,
      selectedMood: guestSelectedMood,
      activeLayerIdx: guestActiveLayerIdx,
    });
    if (!resolved) return null;
    return {
      contract: 'v5' as const,
      source: resolved.source,
      showModeRow: resolved.modeOrder.length > 0,
      modeOrder: resolved.modeOrder,
      selectedMode: resolved.selectedMode,
      activeLayerIndex: resolved.activeLayerIndex,
      selectedAlternateIndex: resolved.selectedAlternateIndex,
      activeHero: resolved.hero,
      activeHeroTokens: resolved.heroTokens,
      activeLayer: resolved.layer ? { ...resolved.layer, tokens: resolved.layerTokens } : null,
      layerModes: resolved.layerModes,
      modeLayerStack: resolved.modeLayerStack,
      alternates: resolved.alternates,
      renderedFromFullBundle: resolved.renderedFromFullBundle,
    };
  }, [isGuestMode, oracle, activeOracle, selectedAlternateIdx, guestSelectedMood, guestActiveLayerIdx, selectedContext, selectedDate]);

  useEffect(() => {
    if (!isGuestMode || !activeGuestRender) return;
    const heroTokens = Array.isArray(activeGuestRender.activeHeroTokens) ? activeGuestRender.activeHeroTokens : [];
    const layerTokens = Array.isArray(activeGuestRender.activeLayer?.tokens) ? activeGuestRender.activeLayer.tokens : [];
    const modeKeys = Object.keys(activeGuestRender.layerModes ?? {}).filter((key) => !!(activeGuestRender.layerModes as any)?.[key]);
    console.info('ODARA_GUEST_VM_RENDER_PROOF', {
      source: activeGuestRender.source,
      selectedAlternateIdx,
      heroName: activeGuestRender.activeHero?.name ?? null,
      heroTokenCount: heroTokens.length,
      layerName: activeGuestRender.activeLayer?.name ?? null,
      layerTokenCount: layerTokens.length,
      hasLayer: !!activeGuestRender.activeLayer,
      hasLayerModes: modeKeys.length > 0,
      modeKeys,
      hasBalance: !!activeGuestRender.layerModes?.balance,
      hasBold: !!activeGuestRender.layerModes?.bold,
      hasSmooth: !!activeGuestRender.layerModes?.smooth,
      hasWild: !!activeGuestRender.layerModes?.wild,
      renderedFromFullBundle: !!activeGuestRender.renderedFromFullBundle,
    });
  }, [isGuestMode, activeGuestRender, selectedAlternateIdx]);

  // Guest mode-row tap: different mode → switch + reset idx; same mode → cycle.
  const handleGuestModeTap = useCallback((mode: GuestModeKey) => {
    const o: any = activeOracle ?? oracle ?? {};
    const resolved = resolveGuestCardVM(o, selectedAlternateIdx, {
      source: guestRenderSourceRef.current,
      selectedMood: mode,
      activeLayerIdx: 0,
    });
    const stack: any[] = Array.isArray(resolved?.layerModes?.[mode]?.layers) ? resolved!.layerModes[mode]!.layers : [];
    if (stack.length === 0) return;
    if (mode !== guestSelectedMood) {
      setGuestSelectedMood(mode);
      setGuestActiveLayerIdx(0);
    } else {
      // cycle within current mode using backend layers.length (no hard-coded N)
      setGuestActiveLayerIdx((cur) => (cur + 1) % stack.length);
    }
  }, [activeOracle, oracle, guestSelectedMood, selectedAlternateIdx]);

  // Guest alternate tap: PHASE 2 — promotion model matches signed-in.
  // Tapping an alternate promotes it to hero. Tapping the SAME (already-active)
  // alternate is a no-op (no toggle-off). Use the back arrow to undo.
  const handleGuestAlternateTap = useCallback((idx: number) => {
    if (selectedAlternateIdx === idx) {
      // Active alternate tapped again → no-op (matches main Odara behavior).
      return;
    }
    // Snapshot main state once (only if not already in alternate state)
    if (selectedAlternateIdx === null) {
      guestPrevMainStateRef.current = { mood: guestSelectedMood, idx: guestActiveLayerIdx };
    }
    guestRenderSourceRef.current = 'guest_selected_alternate';
    setSelectedAlternateIdx(idx);
    setGuestLayerExpanded(true);
    haptic('selection');
  }, [selectedAlternateIdx, guestSelectedMood, guestActiveLayerIdx]);

  // Guest back-button unwind: skip-history → alternate → mode-depth → normal back
  const handleGuestBack = useCallback((): boolean => {
    if (!isGuestMode) return false;
    // 1. Skip-history rewind takes priority — walks back through every skipped guest card.
    if (guestSkipHistory.length > 0) {
      const prevIdx = guestSkipHistory[guestSkipHistory.length - 1];
      const o: any = (oracle ?? activeOracle ?? {});
      const altBundles: any[] = Array.isArray(o?.alternate_bundles) ? o.alternate_bundles : [];
      const beforeName =
        selectedAlternateIdx === null
          ? (o?.main_bundle?.hero?.name ?? null)
          : (altBundles[selectedAlternateIdx]?.hero?.name ?? null);
      const restoredName =
        prevIdx === null
          ? (o?.main_bundle?.hero?.name ?? null)
          : (altBundles[prevIdx]?.hero?.name ?? null);
      const lengthBefore = guestSkipHistory.length;
      setGuestSkipHistory((h) => h.slice(0, -1));
      guestRenderSourceRef.current = 'guest_back_restore';
      setSelectedAlternateIdx(prevIdx);
      // Reset alternate snapshot since we're walking the skip stack, not unwinding a tap.
      guestPrevMainStateRef.current = null;
      console.info('ODARA_GUEST_BACK_PROOF', {
        actionTaken: 'guest_back_skip',
        previousCardName: beforeName,
        restoredCardName: restoredName,
        guestHistoryLengthBefore: lengthBefore,
        guestHistoryLengthAfter: lengthBefore - 1,
      });
      return true;
    }
    if (selectedAlternateIdx !== null) {
      const prev = guestPrevMainStateRef.current;
      if (prev) {
        setGuestSelectedMood(prev.mood);
        setGuestActiveLayerIdx(prev.idx);
      }
      guestPrevMainStateRef.current = null;
      guestRenderSourceRef.current = 'guest_main_bundle';
      setSelectedAlternateIdx(null);
      return true; // consumed
    }
    if (guestActiveLayerIdx > 0) {
      setGuestActiveLayerIdx((cur) => Math.max(0, cur - 1));
      return true; // consumed
    }
    return false; // let normal back run
  }, [isGuestMode, selectedAlternateIdx, guestActiveLayerIdx, guestSkipHistory, oracle, activeOracle]);


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
          // Fallback: if the home payload pre-seeded this mood block, hydrate
          // from there instead of surfacing a hard error to the user. This
          // keeps mode buttons functional even when the per-mode RPC is
          // unavailable on the backend.
          const hp: any = activeOracle ?? oracle ?? {};
          const heroIdHp = hp?.today_pick?.fragrance_id ?? null;
          const seed: any = (heroIdHp === fragranceId) ? hp?.layer_modes?.[mood] : null;
          if (seed && (seed.layer_fragrance_id || seed.fragrance_id || seed.layer_name || seed.name)) {
            const fbEntry: BackendModeEntry = {
              mode: mood,
              layer_fragrance_id: seed.layer_fragrance_id ?? seed.fragrance_id ?? '',
              layer_name: seed.layer_name ?? seed.name ?? '',
              layer_brand: seed.layer_brand ?? seed.brand ?? '',
              layer_family: seed.layer_family ?? seed.family ?? '',
              layer_notes: Array.isArray(seed.layer_notes) ? seed.layer_notes : Array.isArray(seed.notes) ? seed.notes : [],
              layer_accords: Array.isArray(seed.layer_accords) ? seed.layer_accords : Array.isArray(seed.accords) ? seed.accords : [],
              layer_score: seed.layer_score ?? 0,
              reason: seed.reason ?? '',
              why_it_works: seed.why_it_works ?? '',
              ratio_hint: seed.ratio_hint ?? '',
              application_style: seed.application_style ?? '',
              placement_hint: seed.placement_hint ?? '',
              spray_guidance: seed.spray_guidance ?? '',
              interaction_type: seed.interaction_type ?? mood,
            };
            (fbEntry as any).tokens = Array.isArray(seed.tokens) ? seed.tokens : undefined;
            moodCacheRef.current.set(moodKey, fbEntry);
            setModeErrors(prev => ({ ...prev, [mood]: null }));
            setLayerDebugSource(`fallback:${mood}`);
            setModeLoading(prev => ({ ...prev, [mood]: false }));
            setMoodCacheVersion(v => v + 1);
            console.log('[Odara] mood RPC failed → seeded from home payload', mood);
            return fbEntry;
          }
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
    setSignedInLayerIdxByMood({ balance: 0, bold: 0, smooth: 0, wild: 0 });
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

    const v6Peek: any = (oracle as any)?.__v6 ?? null;
    const balanceLayersPeek = Array.isArray(v6Peek?.layer_modes?.balance?.layers)
      ? v6Peek.layer_modes.balance.layers
      : [];
    console.info('[Odara] oracle apply', {
      selectedDate,
      selectedContext,
      backendHeroId: v6Peek?.hero?.fragrance_id ?? oracle.today_pick?.fragrance_id ?? '(none)',
      previousVisibleId: prevVisibleId,
      promotedAltIdBeforeReset: prevPromotedId,
      contract: v6Peek?.card_contract_version ?? (oracle as any)?.card_contract_version ?? normalized.rawModeContract,
      surfaceType: v6Peek?.surface_type ?? (oracle as any)?.surface_type ?? null,
      heroName: v6Peek?.hero?.name ?? oracle.today_pick?.name ?? null,
      seededBalanceLayerName: balanceLayersPeek[0]?.name ?? normalized.seededBalanceLayer?.name ?? '(null)',
      seededBalanceLayerId: balanceLayersPeek[0]?.fragrance_id ?? normalized.seededBalanceLayer?.fragranceId ?? '(null)',
    });

    // 1) Clear ALL stale state first
    // viewHistory is NOT cleared here — slot changes clear it in Effect 1 above
    setPromotedAltId(null);
    setLayerExpanded(false);
    setModeLoading({ balance: false, bold: false, smooth: false, wild: false });
    setModeErrors({ balance: null, bold: null, smooth: null, wild: null });

    // 2) Set oracle
    setActiveOracle(oracle);

    // 3) Initialize from v6 contract: ui_default_mode + reset all mode indexes to 0
    const v6 = (oracle as any)?.__v6 ?? null;
    const v6DefaultMood: LayerMood = (() => {
      const def = v6?.ui_default_mode ?? normalized.defaultMode;
      return (def === 'balance' || def === 'bold' || def === 'smooth' || def === 'wild') ? def : normalized.defaultMode;
    })();
    const initialMood: LayerMood = v6DefaultMood;
    setSelectedMood(initialMood);
    setSignedInLayerIdxByMood({ balance: 0, bold: 0, smooth: 0, wild: 0 });

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

  // ────────────────────────────────────────────────────────────────────
  // SIGNED-IN CANONICAL VIEW MODEL — v6 contract (get_signed_in_card_contract_v6)
  // Single resolved source for the visible signed-in card. All signed-in JSX
  // MUST read hero/layer/tokens through this object.
  //
  // Resolution order for the visible layer:
  //   1) payload.layer_modes[selectedMood].layers[ activeIdx ]
  //   2) payload.layer_modes[selectedMood] (if backend used flat per-mode shape)
  //   3) payload.layer (top-level fallback for balance only)
  //
  // Tokens:
  //   hero  → payload.hero_tokens
  //   layer → visibleLayer.tokens ?? payload.layer_tokens (balance only) ?? []
  // ────────────────────────────────────────────────────────────────────
  const v6Payload: any = (activeOracle as any)?.__v6 ?? (oracle as any)?.__v6 ?? null;

  // First-paint mode results — derived directly from v6 layer_modes (preview
  // stack) instead of the slot-scoped mood cache. The cache is still used as
  // a fallback (legacy/promoted/queue cards).
  const modeResults: LayerModes = useMemo(() => {
    const lm: any = v6Payload?.layer_modes ?? (activeOracle as any)?.layer_modes ?? null;
    const fromV6 = (mood: LayerMood) => {
      const block = lm?.[mood] ?? null;
      if (!block) return null;
      const idx = signedInLayerIdxByMood[mood] ?? 0;
      const stack: any[] = Array.isArray(block.layers) ? block.layers : [];
      const picked = stack.length > 0 ? stack[idx % stack.length] : block;
      return v6LayerToLayerMode(picked, mood);
    };
    const fallback = (mood: LayerMood) =>
      backendModeEntryToLayerMode(moodCacheRef.current.get(`${slotPrefix}|${cardId}|${mood}`)) ?? null;
    return {
      balance: fromV6('balance') ?? fallback('balance'),
      bold:    fromV6('bold')    ?? fallback('bold'),
      smooth:  fromV6('smooth')  ?? fallback('smooth'),
      wild:    fromV6('wild')    ?? fallback('wild'),
    };
    // moodCacheVersion read above keeps this fresh when cache changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v6Payload, activeOracle, signedInLayerIdxByMood, slotPrefix, cardId, moodCacheVersion]);
  const visibleModeEntry = selectedMood ? modeResults[selectedMood] ?? null : null;

  // ── SINGLE-SOURCE RENDER for the signed-in main card — bound to v6. ──
  const activeMainCardRender = useMemo(() => {
    if (isGuestMode || !visibleCard) return null;
    // Prefer the v6 raw payload (carries hero_tokens / layer_tokens / per-mode
    // tokens). Fall back to legacy oracle prop for non-v6 paths.
    const v6: any = v6Payload;
    const o: any = activeOracle ?? oracle ?? {};
    const heroId = (v6?.hero?.fragrance_id ?? o?.today_pick?.fragrance_id) ?? null;
    const isHeroCard = !!heroId && visibleCard.fragrance_id === heroId;

    // Hero tokens — payload.hero_tokens (v6) or legacy o.hero_tokens.
    const heroTokensSrc: any[] = isHeroCard
      ? (Array.isArray(v6?.hero_tokens) ? v6.hero_tokens
        : Array.isArray(o?.hero_tokens) ? o.hero_tokens
        : [])
      : [];

    // Visible layer — resolved from the v6 mode stack (already in modeResults).
    const visibleLayer = visibleModeEntry;

    // Layer tokens — visibleLayer.tokens FIRST (per-layer in the stack),
    // then payload.layer_tokens (balance hero fallback only), then [].
    const stackBlock: any = v6?.layer_modes?.[selectedMood] ?? null;
    const stackArr: any[] = Array.isArray(stackBlock?.layers) ? stackBlock.layers : [];
    const stackIdx = signedInLayerIdxByMood[selectedMood] ?? 0;
    const stackPick: any = stackArr.length > 0 ? stackArr[stackIdx % stackArr.length] : stackBlock;
    let layerTokens: any[] = [];
    if (Array.isArray(stackPick?.tokens) && stackPick.tokens.length > 0) {
      layerTokens = stackPick.tokens;
    } else if (isHeroCard && selectedMood === 'balance' && Array.isArray(v6?.layer_tokens)) {
      layerTokens = v6.layer_tokens;
    } else if (isHeroCard && selectedMood === 'balance' && Array.isArray(o?.layer_tokens)) {
      layerTokens = o.layer_tokens;
    } else if (Array.isArray((visibleLayer as any)?.tokens)) {
      layerTokens = (visibleLayer as any).tokens;
    }

    return {
      activeHero: visibleCard,
      activeHeroTokens: heroTokensSrc,
      activeLayer: visibleLayer,
      activeLayerTokens: layerTokens,
      selectedMode: selectedMood,
      visibleCardId: visibleCard.fragrance_id,
      isLocked: lockState === 'locked',
    };
  }, [isGuestMode, visibleCard, v6Payload, activeOracle, oracle, selectedMood, signedInLayerIdxByMood, visibleModeEntry, lockState, moodCacheVersion]);

  // ── DEBUG PROOF — signed-in v7 contract ──
  useEffect(() => {
    if (isGuestMode) return;
    const contract: any = v6Payload ?? activeOracle ?? oracle ?? {};
    const lm: any = contract?.layer_modes ?? {};
    const heroTokensArr = Array.isArray(activeMainCardRender?.activeHeroTokens) ? activeMainCardRender!.activeHeroTokens : [];
    const layerTokensArr = Array.isArray(activeMainCardRender?.activeLayerTokens) ? activeMainCardRender!.activeLayerTokens : [];
    console.info('ODARA_SIGNED_IN_CONTRACT_PROOF', {
      contractVersion: contract?.card_contract_version ?? contract?.layer_mode_contract ?? null,
      surfaceType: contract?.surface_type ?? null,
      heroName: activeMainCardRender?.activeHero?.name ?? null,
      heroTokenObjects: heroTokensArr,
      heroTokenLabels: heroTokensArr.map((t: any) => t?.label ?? t?.token_label ?? t?.name ?? null),
      activeMode: activeMainCardRender?.selectedMode ?? null,
      activeLayerIndex: signedInLayerIdxByMood[selectedMood] ?? 0,
      layerName: activeMainCardRender?.activeLayer?.name ?? null,
      layerTokenObjects: layerTokensArr,
      layerTokenLabels: layerTokensArr.map((t: any) => t?.label ?? t?.token_label ?? t?.name ?? null),
      balanceNames: Array.isArray(lm?.balance?.layers) ? lm.balance.layers.map((l: any) => l?.name) : null,
      boldNames: Array.isArray(lm?.bold?.layers) ? lm.bold.layers.map((l: any) => l?.name) : null,
      smoothNames: Array.isArray(lm?.smooth?.layers) ? lm.smooth.layers.map((l: any) => l?.name) : null,
      wildNames: Array.isArray(lm?.wild?.layers) ? lm.wild.layers.map((l: any) => l?.name) : null,
    });
  }, [isGuestMode, v6Payload, activeMainCardRender, selectedMood, signedInLayerIdxByMood]);

  // ── DEBUG PROOF — token render ──
  useEffect(() => {
    const heroTokens = isGuestMode
      ? (activeGuestRender?.activeHeroTokens ?? [])
      : (activeMainCardRender?.activeHeroTokens ?? []);
    const layerTokens = isGuestMode
      ? (Array.isArray(activeGuestRender?.activeLayer?.tokens) ? activeGuestRender!.activeLayer!.tokens : [])
      : (activeMainCardRender?.activeLayerTokens ?? []);
    const heroName = isGuestMode
      ? (activeGuestRender?.activeHero?.name ?? null)
      : (activeMainCardRender?.activeHero?.name ?? null);
    const layerName = isGuestMode
      ? (activeGuestRender?.activeLayer?.name ?? null)
      : (activeMainCardRender?.activeLayer?.name ?? null);
    const heroTokensArrR = Array.isArray(heroTokens) ? heroTokens : [];
    const layerTokensArrR = Array.isArray(layerTokens) ? layerTokens : [];
    console.info('ODARA_TOKEN_RENDER_PROOF', {
      surfaceType: isGuestMode ? 'guest' : 'signed_in',
      heroName,
      heroTokenObjects: heroTokensArrR,
      heroTokenLabels: heroTokensArrR.map((t: any) => t?.label ?? t?.token_label ?? t?.name ?? null),
      layerName,
      layerTokenObjects: layerTokensArrR,
      layerTokenLabels: layerTokensArrR.map((t: any) => t?.label ?? t?.token_label ?? t?.name ?? null),
      activeMode: isGuestMode ? activeGuestRender?.selectedMode : activeMainCardRender?.selectedMode,
      activeLayerIndex: isGuestMode
        ? (activeGuestRender?.activeLayerIndex ?? 0)
        : (signedInLayerIdxByMood[selectedMood] ?? 0),
      selectedAlternateName: null,
      rawAccordsTextRendered: false,
      numericTokenRendered: false,
      frontendGeneratedTokensRendered: false,
    });
  }, [isGuestMode, activeMainCardRender, activeGuestRender, selectedMood, signedInLayerIdxByMood]);

  // ── UNIFIED ACTIVE-CARD VIEW MODEL ──
  // Single resolved shape that BOTH signed-in and guest renderers describe.
  // The JSX above already renders the same logical layout for each surface
  // (hero name/brand/family/tokens → layer name/brand/family/tokens → mode row
  // → alternates). This VM is the single source of truth that proves the
  // shared shell and exposes any guest payload incompleteness.
  const activeCardVM = useMemo(() => {
    if (isGuestMode) {
      const o: any = oracle ?? activeOracle ?? {};
      const main: any = o?.main_bundle ?? {};
      const altBundles: any[] = Array.isArray(o?.alternate_bundles) ? o.alternate_bundles : [];
      const inAlt = selectedAlternateIdx !== null && !!altBundles[selectedAlternateIdx];
      const inSkipRestore = guestSkipHistory.length === 0 && selectedAlternateIdx !== null && !!altBundles[selectedAlternateIdx];
      let source: 'guest_main' | 'guest_skip' | 'guest_alternate' | 'guest_back_restore' = 'guest_main';
      if (inAlt) source = guestSkipHistory.length > 0 ? 'guest_skip' : 'guest_alternate';
      const hero = activeGuestRender?.activeHero ?? null;
      const heroTokens = activeGuestRender?.activeHeroTokens ?? [];
      const layer = activeGuestRender?.activeLayer ?? null;
      const layerTokens = Array.isArray(layer?.tokens) ? layer!.tokens : [];
      const layerModesObj: Record<string, any> = main?.layer_modes ?? {};
      const modeKeys = Object.keys(layerModesObj);
      return {
        surfaceType: 'guest' as const,
        source,
        cardId: hero?.fragrance_id ?? hero?.id ?? null,
        isLocked: lockState === 'locked',
        hero: hero ? {
          id: hero.fragrance_id ?? hero.id ?? null,
          name: hero.name ?? null,
          brand: hero.brand ?? null,
          family: hero.family ?? null,
          tokens: heroTokens,
        } : null,
        layer: layer ? {
          id: layer.fragrance_id ?? layer.id ?? null,
          name: layer.name ?? null,
          brand: layer.brand ?? null,
          family: layer.family ?? null,
          tokens: layerTokens,
          visible: true,
        } : null,
        layerModes: {
          balance: !!layerModesObj.balance,
          bold: !!layerModesObj.bold,
          smooth: !!layerModesObj.smooth,
          wild: !!layerModesObj.wild,
        },
        selectedMode: activeGuestRender?.selectedMode ?? null,
        activeLayerIndex: activeGuestRender?.activeLayerIndex ?? 0,
        alternateCount: altBundles.length,
        modeKeys,
      };
    }
    // Signed-in
    const hero = activeMainCardRender?.activeHero ?? null;
    const heroTokens = activeMainCardRender?.activeHeroTokens ?? [];
    const layer = activeMainCardRender?.activeLayer ?? null;
    const layerTokens = activeMainCardRender?.activeLayerTokens ?? [];
    const heroAny: any = hero;
    const layerAny: any = layer;
    return {
      surfaceType: 'signed_in' as const,
      source: 'signed_in' as const,
      cardId: heroAny?.fragrance_id ?? heroAny?.id ?? null,
      isLocked: lockState === 'locked',
      hero: heroAny ? {
        id: heroAny.fragrance_id ?? heroAny.id ?? null,
        name: heroAny.name ?? null,
        brand: heroAny.brand ?? null,
        family: heroAny.family ?? null,
        tokens: heroTokens,
      } : null,
      layer: layerAny ? {
        id: layerAny.fragrance_id ?? layerAny.id ?? null,
        name: layerAny.name ?? null,
        brand: layerAny.brand ?? null,
        family: layerAny.family ?? null,
        tokens: layerTokens,
        visible: true,
      } : null,
      layerModes: {
        balance: !!modeResults.balance,
        bold: !!modeResults.bold,
        smooth: !!modeResults.smooth,
        wild: !!modeResults.wild,
      },
      selectedMode: activeMainCardRender?.selectedMode ?? selectedMood,
      activeLayerIndex: signedInLayerIdxByMood[selectedMood] ?? 0,
      alternateCount: Array.isArray((activeOracle as any)?.alternates) ? (activeOracle as any).alternates.length : 0,
      modeKeys: ['balance', 'bold', 'smooth', 'wild'].filter(k => !!(modeResults as any)[k]),
    };
  }, [isGuestMode, oracle, activeOracle, activeGuestRender, activeMainCardRender, selectedAlternateIdx, guestSkipHistory, lockState, modeResults, selectedMood, signedInLayerIdxByMood]);

  useEffect(() => {
    const vm = activeCardVM;
    const heroTokensArr = Array.isArray(vm.hero?.tokens) ? vm.hero!.tokens : [];
    const layerTokensArr = Array.isArray(vm.layer?.tokens) ? vm.layer!.tokens : [];
    console.info('ODARA_ACTIVE_CARD_VM_PROOF', {
      surfaceType: vm.surfaceType,
      source: vm.source,
      heroName: vm.hero?.name ?? null,
      heroTokenCount: heroTokensArr.length,
      layerName: vm.layer?.name ?? null,
      layerTokenCount: layerTokensArr.length,
      hasLayer: !!vm.layer,
      modeKeys: vm.modeKeys,
      hasBalance: vm.layerModes.balance,
      hasBold: vm.layerModes.bold,
      hasSmooth: vm.layerModes.smooth,
      hasWild: vm.layerModes.wild,
      alternateCount: vm.alternateCount,
      renderedThroughSharedShell: true,
    });
    // Guest VM completeness gate — log missing fields when an alternate bundle
    // can't be resolved into a full card (no layer or no modes available).
    if (vm.surfaceType === 'guest' && (vm.source === 'guest_alternate' || vm.source === 'guest_skip')) {
      const missing: string[] = [];
      if (!vm.hero?.name) missing.push('hero.name');
      if (!vm.hero?.brand) missing.push('hero.brand');
      if (!vm.hero?.family) missing.push('hero.family');
      if (!heroTokensArr.length) missing.push('hero.tokens');
      if (!vm.layer?.name) missing.push('layer.name');
      if (!vm.layer?.brand) missing.push('layer.brand');
      if (!vm.layer?.family) missing.push('layer.family');
      if (!layerTokensArr.length) missing.push('layer.tokens');
      if (missing.length > 0) {
        console.warn('fail_guest_vm_incomplete', { source: vm.source, missing });
      }
    }
  }, [activeCardVM]);

  // (Skip gesture lifecycle reset effect lives just below swipeRef declaration.)

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

  // ── v6 mood tap handler ──
  // Different mood  → switch selectedMood; if no idx exists, start at 0.
  // Same mood again → cycle (idx + 1) % layer_modes[mood].layers.length.
  // Mood cycling source is ONLY payload.layer_modes[mood].layers[]. Never alternates.
  // Falls back to legacy lazy fetch (signed-in non-v6 cards: queue / promoted alts).
  const handleMoodSelect = useCallback((mood: LayerMood) => {
    if (lockState === 'locked') return;
    if (!visibleCard) return;
    const currentCardId = visibleCard.fragrance_id;
    const v6: any = (activeOracle as any)?.__v6 ?? (oracle as any)?.__v6 ?? null;
    const heroIdV6 = v6?.hero?.fragrance_id ?? null;
    const isHeroCard = !!heroIdV6 && currentCardId === heroIdV6;
    const stackArr: any[] = isHeroCard && Array.isArray(v6?.layer_modes?.[mood]?.layers)
      ? v6.layer_modes[mood].layers
      : [];

    if (mood !== selectedMood) {
      // DIFFERENT mood: switch and reset to current index for that mood (or 0 if first time).
      setSelectedMood(mood);
      console.log('[Odara][SignedIn][v6] mood switch', { mood, stackLen: stackArr.length, idx: signedInLayerIdxByMood[mood] ?? 0 });
    } else if (stackArr.length > 1) {
      // SAME mood: cycle through this mood's stack only.
      const cur = signedInLayerIdxByMood[mood] ?? 0;
      const next = (cur + 1) % stackArr.length;
      setSignedInLayerIdxByMood(prev => ({ ...prev, [mood]: next }));
      console.log('[Odara][SignedIn][v6] mood cycle', { mood, from: cur, to: next, stackLen: stackArr.length });
      return;
    } else {
      console.log('[Odara][SignedIn][v6] mood re-tap (no cycle, single layer)', { mood });
    }

    // Legacy fallback for non-v6 cards (promoted alternates / queue): lazy fetch.
    if (!isHeroCard || stackArr.length === 0) {
      const moodKey = `${selectedDate}|${selectedContext}|${currentCardId}|${mood}`;
      const cached = moodCacheRef.current.get(moodKey);
      if (cached === undefined) {
        void fetchMoodForCard(currentCardId, mood).then((entry) => {
          console.log('[Odara] mood click result (legacy)', { mood, fetchedForCard: currentCardId, layerName: entry?.layer_name ?? '(null)' });
        });
      }
    }
  }, [lockState, visibleCard, activeOracle, oracle, selectedMood, signedInLayerIdxByMood, fetchMoodForCard, selectedDate, selectedContext]);

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
      setSignedInLayerIdxByMood({ balance: 0, bold: 0, smooth: 0, wild: 0 });
      setLayerExpanded(false);
      setLockState('neutral');
    } finally {
      setSkipLoading(false);
    }
  }, [skipLoading, visibleCard, lockState, queue, queuePointer, fetchQueue, userId, selectedContext, selectedDate, selectedMood, promotedAltId, setLockState]);

  // ── Back button — restore exact history snapshot ──
  const handleBack = useCallback(() => {
    // Guest v5: unwind alternate state, then mode-layer depth, before normal back.
    if (handleGuestBack()) return;
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
  }, [viewHistory, handleGuestBack]);

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
    haptic('medium');

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

  /* ──────────────────────────────────────────────────────────────
   * Swipe-DOWN two-step contract (state-aware):
   *   - lockState === 'locked'  → swipe down UNLOCKS the card
   *   - lockState === 'neutral' → swipe down SKIPS to next card
   * Swipe-UP is intentionally a no-op (lock is double-tap only).
   * Same contract applies to signed-in AND guest/fallback profiles.
   * ────────────────────────────────────────────────────────────── */
  const swipeRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    direction: 'none' | 'vertical' | 'horizontal';
    fired: boolean;
    pointerId: number | null;
  }>({ active: false, startX: 0, startY: 0, direction: 'none', fired: false, pointerId: null });

  // ── SKIP GESTURE LIFECYCLE RESET ──
  // Any pending pointer/gesture state from the prior visible card MUST be
  // cleared the instant a new visible card mounts. Without this, a leaked
  // `fired:true` flag (e.g. from an aborted pointer or rapid card swap) can
  // block subsequent swipes from firing on later cards.
  useEffect(() => {
    swipeRef.current = {
      active: false,
      startX: 0,
      startY: 0,
      direction: 'none',
      fired: false,
      pointerId: null,
    };
  }, [visibleCard?.fragrance_id, lockState, queuePointer, viewHistory.length, skipAnimating]);

  // Swipe-down must work when the gesture STARTS on the visible card body,
  // including the layer card area. Only true interactive controls block it.
  const isInteractiveSwipeTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el || !el.closest) return false;
    return !!(
      el.closest('[data-action-stack]') ||
      el.closest('[data-debug-controls]') ||
      el.closest('[data-mode-chip]') ||
      el.closest('[data-alternate-chip]') ||
      el.closest('[data-no-card-swipe]') ||
      el.closest('button, a, input, textarea, select, [role="button"]')
    );
  };

  const handleCardPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!visibleCard) return;
    if (isInteractiveSwipeTarget(e.target)) return;
    // Capture the pointer so the gesture stays attached to the card shell
    // until pointer up/cancel — prevents the browser/scroll container from
    // stealing vertical motion mid-swipe.
    try {
      if (e.currentTarget.setPointerCapture) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    } catch {
      /* setPointerCapture can throw if pointer is already captured elsewhere */
    }
    swipeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      direction: 'none',
      fired: false,
      pointerId: e.pointerId,
    };
  }, [visibleCard]);

  const handleCardPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipeRef.current;
    if (!s.active || s.pointerId !== e.pointerId || s.fired) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (s.direction === 'none') {
      if (Math.abs(dx) < SWIPE_DIRECTION_LOCK && Math.abs(dy) < SWIPE_DIRECTION_LOCK) return;
      s.direction = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
    }
    const surfaceType = isGuestMode ? 'guest' : 'signed_in';
    const dominantAxis = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
    const downwardOk = dy >= SWIPE_DOWN_DISTANCE && Math.abs(dy) >= Math.abs(dx) * SWIPE_HORIZONTAL_TOLERANCE;

    const activeCardNameBefore = visibleCard?.name ?? null;
    const activeCardIdBefore = visibleCard?.fragrance_id ?? null;
    const activeMode = selectedMood;
    const activeLayerIndex = isGuestMode ? guestActiveLayerIdx : (signedInLayerIdxByMood[selectedMood] ?? 0);

    const baseProof = {
      surfaceType,
      isLockedBefore: lockState === 'locked',
      deltaX: dx,
      deltaY: dy,
      velocityX: 0,
      velocityY: 0,
      dominantAxis,
      thresholdPassed: downwardOk,
      activeCardNameBefore,
      activeCardIdBefore,
      activeMode,
      activeLayerIndex,
    };
    if (s.direction === 'horizontal') {
      if (Math.abs(dx) >= SWIPE_DOWN_DISTANCE) {
        s.fired = true;
        console.info('ODARA_SWIPE_DOWN_PROOF', {
          ...baseProof,
          actionTaken: 'ignored_horizontal_dominant',
          activeCardNameAfter: activeCardNameBefore,
          activeCardIdAfter: activeCardIdBefore,
        });
      }
      return;
    }
    // vertical
    if (dy < 0) return; // upward — ignored silently
    if (!downwardOk) return; // not far enough yet

    // Threshold reached: fire the state-aware swipe-down action ONCE.
    s.fired = true;
    let actionTaken: string;
    let activeCardNameAfter: string | null = activeCardNameBefore;
    let activeCardIdAfter: string | null = activeCardIdBefore;

    if (lockState === 'locked') {
      actionTaken = 'unlock';
      setLockState('neutral');
      clearLockedSelection();
      setUnlockFlash(true);
      window.setTimeout(() => setUnlockFlash(false), 700);
      pulseLock();
    } else if (isGuestMode) {
      // Guest locked-card contract: swipe/skip must NOT change the card while
      // guest local lock is engaged. Mirrors signed-in lock semantics.
      {
        const gh: any = activeGuestRender?.activeHero ?? null;
        const ghId = gh?.fragrance_id ?? gh?.id ?? gh?.name ?? '';
        const ghBrand = gh?.brand ?? '';
        const gKey = `${selectedDate}|${selectedContext}|${ghId}|${ghBrand}`;
        if (!!guestLockedByKey[gKey]) {
          actionTaken = 'fail_guest_locked';
          console.info('ODARA_SWIPE_DOWN_PROOF', { ...baseProof, thresholdPassed: true, actionTaken, activeCardNameAfter, activeCardIdAfter });
          return;
        }
      }
      // GUEST SKIP — read-only cycle through alternate_bundles. No backend writes.
      const o: any = (oracle ?? activeOracle ?? {});
      const altBundles: any[] = Array.isArray(o?.alternate_bundles) ? o.alternate_bundles : [];
      if (altBundles.length === 0) {
        actionTaken = 'fail_guest_no_skip_source';
      } else {
        actionTaken = 'skip_guest';
        // Premium downward-dismiss animation (same `cardSlideDown` keyframe
        // used by signed-in skip) so the user clearly sees the card advance.
        setSkipFlash(true);
        window.setTimeout(() => setSkipFlash(false), 500);
        setSkipAnimating(true);
        window.setTimeout(() => setSkipAnimating(false), 350);

        // Advance to next bundle (or wrap to 0). null treated as "main" → go to 0.
        const current = selectedAlternateIdx;
        const nextIdx = current === null ? 0 : (current + 1) % altBundles.length;
        const previousCardName =
          current === null
            ? (o?.main_bundle?.hero?.name ?? activeCardNameBefore)
            : (altBundles[current]?.hero?.name ?? activeCardNameBefore);
        const nextHero = altBundles[nextIdx]?.hero ?? null;

        // Push the previously visible guest card onto the multi-step history
        // BEFORE advancing, so back can rewind step-by-step through every skip.
        const lengthBefore = guestSkipHistory.length;
        setGuestSkipHistory((h) => [...h, current]);
        guestRenderSourceRef.current = 'guest_skip_target';
        setSelectedAlternateIdx(nextIdx);
        haptic('selection');
        // Clear alternate-tap snapshot — skip flow owns the stack now.
        guestPrevMainStateRef.current = null;

        activeCardNameAfter = nextHero?.name ?? activeCardNameBefore;
        activeCardIdAfter = nextHero?.fragrance_id ?? nextHero?.id ?? activeCardIdBefore;

        console.info('ODARA_GUEST_SKIP_PROOF', {
          actionTaken,
          previousCardName,
          nextCardName: nextHero?.name ?? null,
          guestHistoryLengthBefore: lengthBefore,
          guestHistoryLengthAfter: lengthBefore + 1,
          selectedAlternateIdxBefore: current,
          selectedAlternateIdxAfter: nextIdx,
        });
      }
    } else {
      actionTaken = 'skip_signed_in';
      setSkipFlash(true);
      window.setTimeout(() => setSkipFlash(false), 500);
      void handleSkipLocal();
    }
    console.info('ODARA_SWIPE_DOWN_PROOF', {
      ...baseProof,
      thresholdPassed: true,
      actionTaken,
      activeCardNameAfter,
      activeCardIdAfter,
    });
  }, [
    lockState,
    setLockState,
    clearLockedSelection,
    pulseLock,
    handleSkipLocal,
    isGuestMode,
    visibleCard,
    selectedMood,
    guestActiveLayerIdx,
    signedInLayerIdxByMood,
    oracle,
    activeOracle,
    selectedAlternateIdx,
    setSelectedAlternateIdx,
    guestSkipHistory,
    guestLockedByKey,
    activeGuestRender,
  ]);

  const handleCardPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = swipeRef.current;
    if (s.pointerId !== e.pointerId) return;
    try {
      if (e.currentTarget.releasePointerCapture && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* safe release */
    }
    swipeRef.current = { active: false, startX: 0, startY: 0, direction: 'none', fired: false, pointerId: null };
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
    setModeLoading({ balance: false, bold: false, smooth: false, wild: false });
    setModeErrors({ balance: null, bold: null, smooth: null, wild: null });

    // 3. Set new card state BEFORE fetch
    setVisibleCard(promoted);
    setPromotedAltId(alt.fragrance_id);
    setSelectedMood('balance');
    setSignedInLayerIdxByMood({ balance: 0, bold: 0, smooth: 0, wild: 0 });

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

  // ─────────────────────────────────────────────────────────────────────────
  // SHARED CARD CONTROLLER BRIDGE
  // Minimal-diff normalization layer over existing guest/signed-in handlers.
  // JSX must call cardController.actions instead of the underlying handlers
  // so the same interaction gates apply to BOTH modes.
  // ─────────────────────────────────────────────────────────────────────────

  // (1) Normalized guest action key — current visible guest card only.
  //     Excludes mood/layerIdx/expanded/animation state by design.
  const __guestHero: any = activeGuestRender?.activeHero ?? null;
  const __guestHeroId = __guestHero?.fragrance_id ?? __guestHero?.id ?? __guestHero?.name ?? '';
  const __guestHeroBrand = __guestHero?.brand ?? '';
  const guestActionKey = isGuestMode
    ? `${selectedDate}|${selectedContext}|${__guestHeroId}|${__guestHeroBrand}`
    : '';

  // (2) Single normalized lock gate — applies to both modes.
  const guestLockedForCurrentCard = isGuestMode && !!guestLockedByKey[guestActionKey];
  const isCardLocked = isGuestMode
    ? guestLockedForCurrentCard
    : (lockState === 'locked');

  // (3) Normalized action-rail state.
  const guestStarredForCurrentCard = isGuestMode && !!guestStarredByKey[guestActionKey];
  const guestHasRealHistory =
    isGuestMode && (selectedAlternateIdx !== null || guestSkipHistory.length > 0);
  const actionRailState = {
    locked: isCardLocked,
    starred: isGuestMode ? guestStarredForCurrentCard : isFavorited,
    showBack: isGuestMode ? guestHasRealHistory : hasHistory,
  };

  // (4) cardController — single behavior contract for both modes.
  //     Each action enforces isCardLocked before delegating to the existing
  //     mode-specific handler. JSX must call these — not the raw handlers.
  const cardController = {
    state: {
      isCardLocked,
      actionRailState,
    },
    actions: {
      toggleLock: () => {
        if (isGuestMode) {
          if (!guestActionKey) return;
          const wasLocked = guestLockedForCurrentCard;
          setGuestLockedByKey(prev => {
            const next = { ...prev };
            if (wasLocked) delete next[guestActionKey];
            else next[guestActionKey] = true;
            return next;
          });
          if (wasLocked) {
            setGuestUnlockFlash(true);
            window.setTimeout(() => setGuestUnlockFlash(false), 700);
            haptic('selection');
          } else {
            setGuestLockFlash(true);
            window.setTimeout(() => setGuestLockFlash(false), 700);
            haptic('success');
          }
          return;
        }
        // Signed-in: only the unlock half is exposed via tap (lock is engaged
        // by gestures). Preserve existing behavior.
        if (lockState === 'locked') {
          setLockState('neutral');
          clearLockedSelection();
          setUnlockFlash(true);
          window.setTimeout(() => setUnlockFlash(false), 700);
          pulseLock();
          haptic('success');
        }
      },
      toggleStar: () => {
        if (isGuestMode) {
          if (!guestActionKey) return;
          const wasStarred = guestStarredForCurrentCard;
          setGuestStarredByKey(prev => {
            const next = { ...prev };
            if (wasStarred) delete next[guestActionKey];
            else next[guestActionKey] = true;
            return next;
          });
          setGuestStarFlash(true);
          window.setTimeout(() => setGuestStarFlash(false), 500);
          haptic(wasStarred ? 'selection' : 'success');
          return;
        }
        if (!visibleCard) return;
        const combo: FavoriteCombo = {
          mainId: visibleCard.fragrance_id,
          layerId: visibleModeEntry?.id ?? null,
          mood: selectedMood ?? 'balance',
          ratio: selectedRatio,
        };
        if (isFavorited) {
          setFavoriteMap(prev => {
            const next = { ...prev };
            delete next[stateKey];
            return next;
          });
        } else {
          setFavoriteMap(prev => ({ ...prev, [stateKey]: combo }));
        }
        haptic(isFavorited ? 'light' : 'success');
      },
      selectMood: (mood: any) => {
        if (isCardLocked) return;
        if (isGuestMode) {
          handleGuestModeTap(mood as GuestModeKey);
        } else {
          handleMoodSelect(mood as LayerMood);
        }
      },
      promoteAlternate: (alt: any, idx?: number) => {
        if (isCardLocked) return;
        if (isGuestMode) {
          if (typeof idx === 'number') handleGuestAlternateTap(idx);
        } else {
          handlePromoteAlternate(alt);
        }
      },
      back: () => {
        // Back never modifies the locked decision — the locked card stays
        // visible. We still allow back to be a no-op while locked.
        if (isCardLocked) return;
        handleBack();
      },
      skipOrSwipe: () => {
        // Locked cards cannot be skipped. Signed-in unlock-via-swipe remains
        // handled by the existing pointer handler (which still inspects
        // lockState directly inside its own internals).
        if (isCardLocked) return;
        // No direct external invocation here — the pointer handler owns it.
      },
    },
  };

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

        {/* ODARA title — centered on the main card centerline */}
        <h1
          className="text-center text-[13px] tracking-[0.42em] font-semibold uppercase text-foreground/90 mt-1 mb-3"
          style={{ fontFamily: "'Geist Sans', system-ui, sans-serif" }}
        >
          ODARA
        </h1>

        {/* Context chips — centered under the ODARA title */}
        <div className="flex gap-1.5 mb-3 justify-center">
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
              touchAction: 'none',
              ...(skipAnimating ? { animation: 'cardSlideDown 0.35s ease-in forwards' } : {}),
            }}
            onClick={handleCardClick}
            onPointerDown={handleCardPointerDown}
            onPointerMove={handleCardPointerMove}
            onPointerUp={handleCardPointerEnd}
            onPointerCancel={handleCardPointerEnd}
          >
            {/* Glow orb */}
            <div
              className="absolute -top-16 -right-16 w-52 h-52 rounded-full blur-3xl pointer-events-none"
              style={{ background: tint.glow, opacity: 0.35 }}
            />

            {/* Like flash — restrained white pulse confirming the "like" half
                of the double-tap. Lock burst lives on the lock icon. */}
            {likeFlash && (
              <div
                className="absolute inset-0 pointer-events-none rounded-[24px] z-[1]"
                style={{
                  background:
                    'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 60%)',
                  animation: 'orbBreathe 0.55s ease-out forwards',
                }}
              />
            )}
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

              {/* Right: SHARED action stack (lock → star → back).
                  Single rail used by BOTH signed-in and guest modes.
                  - Lock: interactive when signed-in; visually disabled no-op for guest.
                  - Star: always rendered; interactive when signed-in; disabled no-op for guest.
                  - Back: rendered only when there is promotion/history (signed-in OR guest). */}
              {(() => {
                // Action rail consumes the normalized cardController state —
                // single source of truth for both signed-in and guest.
                const showBack = actionRailState.showBack;
                const starActive = actionRailState.starred;
                const lockActive = actionRailState.locked;
                const lockColor = lockActive ? '#22c55e' : 'currentColor';

                return (
                <div className="flex flex-col items-center gap-1.5 min-w-[52px]" data-action-stack>
                {/* Lock button — interactive for both signed-in and guest.
                    Guest writes only to local guestLockedByKey (no Supabase). */}
                <button
                  type="button"
                  aria-label="Lock"
                  onClick={() => cardController.actions.toggleLock()}
                  className="p-0.5 relative"
                >
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke={lockColor} strokeWidth="1.5"
                    className="transition-colors duration-300 relative z-[1]"
                    style={lockPulse ? { filter: `drop-shadow(0 0 6px ${lockColor})` } : undefined}
                  >
                    {lockActive ? (
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

                  {/* GREEN Tron lock-engagement animation (signed-in OR guest local) */}
                  {(lockFlash || guestLockFlash) && (
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

                  {/* YELLOW Tron unlock animation (signed-in OR guest local) */}
                  {(unlockFlash || guestUnlockFlash) && (
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

                  {/* RED Tron skip animation (signed-in only) */}
                  {!isGuestMode && skipFlash && (
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

                {/* Favorite star — interactive for both signed-in and guest.
                    Signed-in persists combo via favoriteMap.
                    Guest writes only to local guestStarredByKey (no Supabase). */}
                <button
                  type="button"
                  aria-label="Favorite"
                  onClick={() => cardController.actions.toggleStar()}
                  className="p-0.5 relative"
                >
                  <svg
                    width="13" height="13" viewBox="0 0 24 24"
                    fill={starActive ? '#eab308' : 'none'}
                    stroke={starActive ? '#eab308' : 'currentColor'}
                    strokeWidth="1.5"
                    className={`transition-all duration-300 ${
                      starActive
                        ? 'drop-shadow-[0_0_4px_rgba(234,179,8,0.6)]'
                        : 'text-foreground/40 hover:text-foreground/70'
                    } ${guestStarFlash ? 'scale-125' : 'scale-100'}`}
                    style={{ transitionProperty: 'transform, fill, stroke, filter' }}
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>

                {/* Back arrow — history-gated for both signed-in and guest */}
                {showBack && (
                  <button onClick={() => cardController.actions.back()} className="p-0.5" aria-label="Back">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground/50">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                </div>
                );
              })()}
            </div>

            {/* Source badge for queue cards */}
            {!isHeroStyle && (
              <span className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground/40 text-center mb-0.5">
                from queue
              </span>
            )}

            {/* Recipe header — Guest Recipe Mode only. Rendered above hero
                title in quotes using backend-provided color_hex. Source:
                option.recipe_header (attached to hero by guest-recipe.ts). */}
            {isGuestMode && (() => {
              const rh: any =
                (activeGuestRender?.activeHero as any)?.recipe_header ??
                ((activeOracle ?? oracle) as any)?.main_bundle?.recipe_header ??
                null;
              if (!rh?.text) return null;
              const color = typeof rh.color_hex === 'string' && rh.color_hex.startsWith('#')
                ? rh.color_hex
                : undefined;
              return (
                <div
                  className="text-center mt-1 mb-1 text-[12px] uppercase tracking-[0.22em] font-medium"
                  style={color ? { color } : undefined}
                  data-recipe-header
                >
                  {rh.text}
                </div>
              );
            })()}

            {/* Fragrance name — guest v5: from activeGuestRender.activeHero */}
            <h2
              className="text-[32px] leading-[1.1] font-normal text-foreground mt-0.5 mb-0.5 text-center"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              {isGuestMode && activeGuestRender?.activeHero
                ? getDisplayName(activeGuestRender.activeHero.name, activeGuestRender.activeHero.brand)
                : getDisplayName(visibleCard.name, visibleCard.brand)}
            </h2>

            {/* Brand */}
            <span className="text-[13px] text-muted-foreground/60 text-center mb-1.5">
              {isGuestMode && activeGuestRender?.activeHero
                ? activeGuestRender.activeHero.brand
                : visibleCard.brand}
            </span>

            {/* Family label — signed-in: derived label; guest v5: backend family verbatim */}
            {!isGuestMode ? (
              <span
                className="text-[12px] uppercase tracking-[0.15em] font-medium text-center mb-1.5"
                style={{ color: familyColor }}
              >
                {familyLabel}
              </span>
            ) : (() => {
              const guestHeroFamily: string | null = activeGuestRender?.activeHero?.family
                ? String(activeGuestRender.activeHero.family)
                : null;
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

            {/* Signed-in hero token rail — sourced from activeMainCardRender.activeHeroTokens */}
            {!isGuestMode && (() => {
              const tokens: Array<any> = activeMainCardRender?.activeHeroTokens ?? [];
              if (tokens.length === 0) return null;
              return (
                <div
                  className="flex flex-nowrap items-center gap-1.5 px-3 mb-2 overflow-x-auto justify-start sm:justify-center w-full"
                  style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
                >
                  {tokens.map((t, i) => (
                    <span
                      key={`mhero-tok-${t.token_key ?? 'tok'}-${i}`}
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
            })()}

            {/* Accords (signed-in) / Hero tokens (guest v5: from activeGuestRender.activeHeroTokens) */}
            {isGuestMode ? (() => {
              const tokens: Array<any> = activeGuestRender?.activeHeroTokens ?? [];
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
            })() : null /* signed-in: hero tokens rendered above from activeMainCardRender.activeHeroTokens; raw "accords:" text removed per v7 contract — backend tokens are the only approved source */}

            {/* ── Layer card — signed-in and guest both render through LayerCard. ── */}
            {isGuestMode ? (() => {
              if (!activeGuestRender) return null;
              const { activeHero, activeLayer, selectedMode, layerModes } = activeGuestRender;
              if (!activeLayer) return null;
              const guestLayerModes = guestLayerModesToModeSelector(layerModes);
              const guestVisibleLayerMode = guestLayerToModeEntry(activeLayer);

              return (
                <div data-layer-section>
                  <LayerCard
                    mainName={activeHero?.name ?? ''}
                    mainBrand={activeHero?.brand ?? null}
                    mainNotes={Array.isArray(activeHero?.notes) ? activeHero.notes : null}
                    mainFamily={activeHero?.family ?? null}
                    mainProjection={typeof activeHero?.projection === 'number' ? activeHero.projection : null}
                    layerModes={guestLayerModes}
                    visibleLayerMode={guestVisibleLayerMode}
                    selectedMood={selectedMode as LayerMood}
                    onSelectMood={(mood) => cardController.actions.selectMood(mood)}
                    selectedRatio={selectedRatio}
                    onSelectRatio={setSelectedRatio}
                    isExpanded={guestLayerExpanded}
                    onToggleExpand={() => setGuestLayerExpanded(v => !v)}
                    locked={isCardLocked}
                    layerTokens={Array.isArray(activeGuestRender.activeLayer?.tokens) ? activeGuestRender.activeLayer.tokens : []}
                  />
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
                  onSelectMood={(mood) => cardController.actions.selectMood(mood)}
                  selectedRatio={selectedRatio}
                  onSelectRatio={setSelectedRatio}
                  isExpanded={layerExpanded}
                  onToggleExpand={() => setLayerExpanded(!layerExpanded)}
                  lockPulse={lockPulse}
                  locked={isCardLocked}
                  modeLoading={modeLoading}
                  modeErrors={modeErrors}
                  onRetryMood={(mood) => {
                    if (!visibleCard) return;
                    void fetchMoodForCard(visibleCard.fragrance_id, mood, true);
                  }}
                  layerTokens={activeMainCardRender?.activeLayerTokens ?? null}
                />
              </div>
            )}

            {/* ── Alternatives — guest v6 (alternate_bundles).
                PHASE 2 PROMOTION MODEL: the active promoted alternate is
                hidden from the rail (refill behavior); previous hero only
                returns through the back arrow. ── */}
            {isGuestMode ? (() => {
              const o: any = activeOracle ?? oracle ?? {};
              const altBundles: any[] = Array.isArray(o?.alternate_bundles) ? o.alternate_bundles : [];
              if (altBundles.length === 0) return null;
              // Filter out the active promoted alternate so it disappears from
              // the rail; remaining alternates flow forward to fill the row.
              const visibleBundles = altBundles
                .map((ab, originalIdx) => ({ ab, originalIdx }))
                .filter(({ originalIdx }) => originalIdx !== selectedAlternateIdx);
              if (visibleBundles.length === 0) return null;
              return (
                <div className="flex flex-col items-center gap-2 mt-3">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/40">
                    Alternatives
                  </span>
                  <div
                    className="flex flex-nowrap gap-2 w-full overflow-x-auto pb-1 px-3 justify-start sm:justify-center"
                    style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
                  >
                    {visibleBundles.map(({ ab, originalIdx }) => {
                      const heroName = ab?.hero?.name ?? '—';
                      const heroBrand = ab?.hero?.brand ?? '';
                      return (
                        <button
                          key={`${heroName}-${originalIdx}`}
                          type="button"
                          onClick={() => cardController.actions.promoteAlternate(ab, originalIdx)}
                          className="flex-shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200 active:scale-95 text-foreground/70 hover:text-foreground/95 border border-foreground/15 bg-foreground/[0.04]"
                        >
                          {getDisplayName(heroName, heroBrand)}
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
                        onClick={promotionDisabled ? undefined : () => cardController.actions.promoteAlternate(alt)}
                        disabled={promotionDisabled}
                        className={`flex-shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200
                          text-foreground/70 ${promotionDisabled ? 'cursor-default' : 'hover:text-foreground/90 active:scale-95'}
                          ${isCardLocked ? 'opacity-30 pointer-events-none' : ''}`}
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
