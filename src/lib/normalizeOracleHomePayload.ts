/**
 * Normalize the Home oracle payload returned by:
 *   - get_todays_oracle_home_v1 (signed-in)
 *   - get_guest_oracle_home_v1 (guest)
 *
 * Backend contract v3 ("home_v1_explicit_balance_single_source_v3") sends the
 * hero balance layer in MULTIPLE redundant shapes:
 *   - payload.layer
 *   - payload.oracle_layer
 *   - payload.seeded_balance_mode
 *   - payload.layer_modes.balance
 *
 * The frontend must collapse these into ONE stable shape and never treat them
 * as loosely interchangeable. This helper is the single source of truth.
 */
import type { LayerMood } from '@/components/ModeSelector';
import type { OraclePick, OracleAlternate, OracleLayer } from '@/pages/OdaraScreen';

export interface NormalizedHomeLayer {
  fragranceId: string | null;
  name: string | null;
  brand: string | null;
  family: string | null;
  notes: string[];
  accords: string[];
  reason: string | null;
  ratioHint: string | null;
  applicationStyle: string | null;
  placementHint: string | null;
  sprayGuidance: string | null;
  layerMode: LayerMood | null;
  layerScore: number | null;
  whyItWorks: string | null;
  interactionType: string | null;
}

export interface NormalizedOracleHome {
  todayPick: OraclePick | null;
  alternates: OracleAlternate[];
  defaultMode: LayerMood;
  /** Raw layer_modes block — used to pre-seed the mode cache for ALL moods. */
  layerModesRaw: Record<string, any> | null;
  /** Always-present hero layer for `balance` mode, sourced via priority below. */
  seededBalanceLayer: NormalizedHomeLayer | null;
  rawModeContract: string | null;
}

function pickFirst<T>(...vals: (T | null | undefined)[]): T | null {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return null;
}

function toLayerMood(v: any): LayerMood | null {
  return v === 'balance' || v === 'bold' || v === 'smooth' || v === 'wild' ? v : null;
}

function shapeLayer(raw: any, fallbackMode: LayerMood): NormalizedHomeLayer | null {
  if (!raw) return null;
  const fragranceId = pickFirst<string>(raw.fragrance_id, raw.layer_fragrance_id);
  const name = pickFirst<string>(raw.name, raw.layer_name);
  // A layer is only valid if it has at least an id or name.
  if (!fragranceId && !name) return null;

  return {
    fragranceId,
    name,
    brand: pickFirst<string>(raw.brand, raw.layer_brand),
    family: pickFirst<string>(raw.family, raw.family_key, raw.layer_family),
    notes: Array.isArray(raw.notes) ? raw.notes : Array.isArray(raw.layer_notes) ? raw.layer_notes : [],
    accords: Array.isArray(raw.accords) ? raw.accords : Array.isArray(raw.layer_accords) ? raw.layer_accords : [],
    reason: pickFirst<string>(raw.reason),
    ratioHint: pickFirst<string>(raw.ratio_hint),
    applicationStyle: pickFirst<string>(raw.application_style),
    placementHint: pickFirst<string>(raw.placement_hint),
    sprayGuidance: pickFirst<string>(raw.spray_guidance),
    layerMode: toLayerMood(raw.layer_mode ?? raw.mode) ?? fallbackMode,
    layerScore: typeof raw.layer_score === 'number' ? raw.layer_score : null,
    whyItWorks: pickFirst<string>(raw.why_it_works),
    interactionType: pickFirst<string>(raw.interaction_type, raw.layer_mode, raw.mode),
  };
}

/**
 * Resolve the seeded balance layer using strict priority order:
 *   1. payload.layer            (canonical hero layer)
 *   2. payload.oracle_layer     (legacy mirror)
 *   3. payload.seeded_balance_mode
 *   4. payload.layer_modes.balance
 */
function resolveSeededBalanceLayer(payload: any): NormalizedHomeLayer | null {
  return (
    shapeLayer(payload?.layer, 'balance') ??
    shapeLayer(payload?.oracle_layer, 'balance') ??
    shapeLayer(payload?.seeded_balance_mode, 'balance') ??
    shapeLayer(payload?.layer_modes?.balance, 'balance')
  );
}

export function normalizeOracleHomePayload(payload: any): NormalizedOracleHome {
  const seededBalanceLayer = resolveSeededBalanceLayer(payload);
  const alternates = Array.isArray(payload?.alternates) ? payload.alternates : [];

  return {
    todayPick: payload?.today_pick ?? null,
    alternates,
    // PRODUCT LAW: Home always opens on `balance`. Do not honor server-suggested mode.
    defaultMode: 'balance',
    layerModesRaw: payload?.layer_modes ?? null,
    seededBalanceLayer,
    rawModeContract: payload?.layer_mode_contract ?? null,
  };
}

/** Helper used by OdaraScreen to convert NormalizedHomeLayer back into OracleLayer
 *  for components that still consume the older shape. */
export function normalizedToOracleLayer(n: NormalizedHomeLayer | null): OracleLayer | null {
  if (!n || !n.fragranceId) return null;
  return {
    fragrance_id: n.fragranceId,
    name: n.name ?? '',
    family: n.family ?? '',
    brand: n.brand ?? '',
    notes: n.notes,
    accords: n.accords,
    reason: n.reason ?? '',
    ratio_hint: n.ratioHint ?? undefined,
    application_style: n.applicationStyle ?? undefined,
    placement_hint: n.placementHint ?? undefined,
    spray_guidance: n.sprayGuidance ?? undefined,
    why_it_works: n.whyItWorks ?? undefined,
    layer_score: n.layerScore ?? undefined,
    layer_mode: n.layerMode ?? undefined,
  };
}
