export type LayerFeedbackType = 'too_strong' | 'too_weak' | 'doesnt_work';

export type LayerFeedbackDisplayInput = {
  feedbackType: LayerFeedbackType;
  anchorFragranceId: string;
  companionFragranceId: string;
  recommendationIdentity?: string | null;
  layerMode?: string | null;
  leadRole?: string | null;
  companionRole?: string | null;
  ratioLabel?: string | null;
  anchorSprays?: number | null;
  companionSprays?: number | null;
  context?: string | null;
  temperature?: number | null;
  wearDate?: string | null;
  presentation?: Record<string, unknown> | null;
};

export type LayerFeedbackRpcParams = {
  p_user: string;
  p_feedback_type: LayerFeedbackType;
  p_anchor_fragrance_id: string;
  p_companion_fragrance_id: string;
  p_recommendation_identity: string | null;
  p_layer_mode: string | null;
  p_lead_role: string | null;
  p_companion_role: string | null;
  p_ratio_label: string | null;
  p_anchor_sprays: number | null;
  p_companion_sprays: number | null;
  p_context: string | null;
  p_temperature: number | null;
  p_wear_date: string | null;
  p_presentation_payload: Record<string, unknown>;
  p_idempotency_key: string;
};

const FEEDBACK_LABELS: Record<string, LayerFeedbackType> = {
  'too strong': 'too_strong',
  'too weak': 'too_weak',
  "doesn't work": 'doesnt_work',
  'doesnt work': 'doesnt_work',
  'doesn’t work': 'doesnt_work',
};

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cleanString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cleanSprayCount(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 0 && rounded <= 12 ? rounded : null;
}

export function normalizeLayerFeedbackType(value: unknown): LayerFeedbackType | null {
  if (value === 'too_strong' || value === 'too_weak' || value === 'doesnt_work') return value;
  return FEEDBACK_LABELS[normalizeText(value)] ?? null;
}

export function createLayerFeedbackIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

export function buildLayerFeedbackRpcParams(
  userId: string,
  input: LayerFeedbackDisplayInput,
  idempotencyKey = createLayerFeedbackIdempotencyKey(),
): LayerFeedbackRpcParams {
  return {
    p_user: userId,
    p_feedback_type: input.feedbackType,
    p_anchor_fragrance_id: input.anchorFragranceId,
    p_companion_fragrance_id: input.companionFragranceId,
    p_recommendation_identity: cleanString(input.recommendationIdentity),
    p_layer_mode: cleanString(input.layerMode),
    p_lead_role: cleanString(input.leadRole),
    p_companion_role: cleanString(input.companionRole),
    p_ratio_label: cleanString(input.ratioLabel),
    p_anchor_sprays: cleanSprayCount(input.anchorSprays),
    p_companion_sprays: cleanSprayCount(input.companionSprays),
    p_context: cleanString(input.context),
    p_temperature: cleanNumber(input.temperature),
    p_wear_date: cleanString(input.wearDate),
    p_presentation_payload: input.presentation ?? {},
    p_idempotency_key: idempotencyKey,
  };
}
