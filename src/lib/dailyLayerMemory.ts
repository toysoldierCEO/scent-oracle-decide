export type DailyLayerWearMemoryDisplayInput = {
  anchorFragranceId: string;
  companionFragranceId: string;
  leadFragranceId?: string | null;
  accentFragranceId?: string | null;
  recommendationIdentity?: string | null;
  layerMode?: string | null;
  ratioLabel?: string | null;
  anchorSprays?: number | null;
  companionSprays?: number | null;
  anchorPlacement?: string | null;
  companionPlacement?: string | null;
  context?: string | null;
  temperature?: number | null;
  wearDate?: string | null;
  presentation?: unknown;
  acceptanceSource?: string | null;
};

export type DailyLayerWearMemoryRpcParams = {
  p_user: string;
  p_wear_date: string | null;
  p_anchor_fragrance_id: string;
  p_companion_fragrance_id: string;
  p_lead_fragrance_id: string;
  p_accent_fragrance_id: string;
  p_layer_mode: string | null;
  p_ratio_label: string | null;
  p_anchor_sprays: number | null;
  p_companion_sprays: number | null;
  p_placement: Record<string, unknown>;
  p_context: string | null;
  p_temperature: number | null;
  p_recommendation_identity: string | null;
  p_presentation_payload: Record<string, unknown>;
  p_acceptance_source: string;
  p_idempotency_key: string;
};

const VALID_LAYER_MODES = new Set(['balance', 'bold', 'smooth', 'wild']);
const DEFAULT_ACCEPTANCE_SOURCE = 'layered_double_tap_lock';

function sanitizeText(value: unknown, maxLength = 240) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function sanitizeDate(value: unknown) {
  const text = sanitizeText(value, 10);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function sanitizeLayerMode(value: unknown) {
  const text = sanitizeText(value, 24)?.toLowerCase() ?? null;
  return text && VALID_LAYER_MODES.has(text) ? text : null;
}

function sanitizeSprays(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded <= 12 ? rounded : null;
}

function sanitizeTemperature(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? { ...value } : {};
}

function buildPlacementPayload(input: DailyLayerWearMemoryDisplayInput) {
  const anchor = sanitizeText(input.anchorPlacement, 500);
  const companion = sanitizeText(input.companionPlacement, 500);

  return {
    ...(anchor ? { anchor } : {}),
    ...(companion ? { companion } : {}),
  };
}

export function createDailyLayerWearMemoryIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function buildDailyLayerWearMemoryRpcParams(
  userId: string,
  input: DailyLayerWearMemoryDisplayInput,
  idempotencyKey = createDailyLayerWearMemoryIdempotencyKey(),
): DailyLayerWearMemoryRpcParams {
  const anchorFragranceId = sanitizeText(input.anchorFragranceId, 80) ?? '';
  const companionFragranceId = sanitizeText(input.companionFragranceId, 80) ?? '';

  return {
    p_user: userId,
    p_wear_date: sanitizeDate(input.wearDate),
    p_anchor_fragrance_id: anchorFragranceId,
    p_companion_fragrance_id: companionFragranceId,
    p_lead_fragrance_id: sanitizeText(input.leadFragranceId, 80) ?? anchorFragranceId,
    p_accent_fragrance_id: sanitizeText(input.accentFragranceId, 80) ?? companionFragranceId,
    p_layer_mode: sanitizeLayerMode(input.layerMode),
    p_ratio_label: sanitizeText(input.ratioLabel, 240),
    p_anchor_sprays: sanitizeSprays(input.anchorSprays),
    p_companion_sprays: sanitizeSprays(input.companionSprays),
    p_placement: buildPlacementPayload(input),
    p_context: sanitizeText(input.context, 80)?.toLowerCase() ?? null,
    p_temperature: sanitizeTemperature(input.temperature),
    p_recommendation_identity: sanitizeText(input.recommendationIdentity, 320),
    p_presentation_payload: sanitizeObject(input.presentation),
    p_acceptance_source: sanitizeText(input.acceptanceSource, 80) ?? DEFAULT_ACCEPTANCE_SOURCE,
    p_idempotency_key: idempotencyKey,
  };
}
