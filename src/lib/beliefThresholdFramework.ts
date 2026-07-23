export const BELIEF_THRESHOLD_FRAMEWORK_VERSION = 'belief_threshold_framework_v1';

// Memory stores facts; this module only evaluates when repeated facts are strong
// enough to become internal, non-user-facing belief candidates.
export type BeliefEvidenceSource =
  | 'daily_layer_wear_memory_v1'
  | 'layer_recommendation_feedback_v1'
  | 'wear_events';

export type BeliefEvidencePolarity = 'supporting' | 'contradicting';

export type BeliefObservationKind =
  | 'layer_mode'
  | 'layer_ratio'
  | 'layer_pair'
  | 'layer_role_assignment'
  | 'contextual_layer';

export type BeliefCurrentStatus =
  | 'observation_only'
  | 'hypothesis'
  | 'emerging_pattern'
  | 'established_pattern'
  | 'trusted_preference';

export type BeliefStage = 0 | 1 | 2 | 3 | 4;

export type LayerFeedbackBeliefType = 'too_strong' | 'too_weak' | 'doesnt_work';

export type BeliefEvidenceEvent = {
  eventId: string;
  source: BeliefEvidenceSource;
  polarity: BeliefEvidencePolarity;
  observationKind: BeliefObservationKind;
  occurredAt: string;
  contextKey?: string | null;
  beliefKey?: string | null;
  layerMode?: string | null;
  ratioLabel?: string | null;
  anchorFragranceId?: string | null;
  companionFragranceId?: string | null;
  leadFragranceId?: string | null;
  accentFragranceId?: string | null;
  recommendationIdentity?: string | null;
  feedbackType?: LayerFeedbackBeliefType | null;
  strength?: number | null;
};

export type DailyLayerMemoryObservation = {
  id?: string | null;
  created_at?: string | null;
  wear_date?: string | null;
  context_key?: string | null;
  layer_mode?: string | null;
  ratio_label?: string | null;
  anchor_fragrance_id?: string | null;
  companion_fragrance_id?: string | null;
  lead_fragrance_id?: string | null;
  accent_fragrance_id?: string | null;
  recommendation_identity?: string | null;
};

export type LayerFeedbackMemoryObservation = {
  id?: string | null;
  created_at?: string | null;
  wear_date?: string | null;
  context_key?: string | null;
  layer_mode?: string | null;
  ratio_label?: string | null;
  anchor_fragrance_id?: string | null;
  companion_fragrance_id?: string | null;
  lead_fragrance_id?: string | null;
  accent_fragrance_id?: string | null;
  recommendation_identity?: string | null;
  feedback_type?: LayerFeedbackBeliefType | string | null;
};

export type BeliefStageRule = {
  stage: Exclude<BeliefStage, 0>;
  currentStatus: Exclude<BeliefCurrentStatus, 'observation_only'>;
  minSupportingEvents: number;
  minWeightedSupport: number;
  minConsistency: number;
  minConfidence: number;
  minObservationSpanDays: number;
};

export type BeliefThresholdConfig = {
  recencyHalfLifeDays: number;
  contradictionPenalty: number;
  priorWeight: number;
  stageRules: BeliefStageRule[];
};

export type BeliefEvaluationInput = {
  beliefKey: string;
  observationKind: BeliefObservationKind;
  events: BeliefEvidenceEvent[];
  contextKey?: string | null;
  now?: string | Date | null;
  config?: BeliefThresholdConfig;
};

export type BeliefState = {
  belief_key: string;
  observation_kind: BeliefObservationKind;
  evidence_count: number;
  supporting_events: string[];
  contradicting_events: string[];
  supporting_count: number;
  contradicting_count: number;
  weighted_support: number;
  weighted_contradiction: number;
  consistency: number;
  confidence: number;
  first_seen: string | null;
  last_confirmed: string | null;
  context_key: string | null;
  current_stage: BeliefStage;
  current_status: BeliefCurrentStatus;
  framework_version: typeof BELIEF_THRESHOLD_FRAMEWORK_VERSION;
};

const STAGE_RULES: BeliefStageRule[] = [
  {
    stage: 1,
    currentStatus: 'hypothesis',
    minSupportingEvents: 3,
    minWeightedSupport: 2,
    minConsistency: 0.65,
    minConfidence: 0.25,
    minObservationSpanDays: 0,
  },
  {
    stage: 2,
    currentStatus: 'emerging_pattern',
    minSupportingEvents: 5,
    minWeightedSupport: 4,
    minConsistency: 0.75,
    minConfidence: 0.45,
    minObservationSpanDays: 7,
  },
  {
    stage: 3,
    currentStatus: 'established_pattern',
    minSupportingEvents: 8,
    minWeightedSupport: 6,
    minConsistency: 0.85,
    minConfidence: 0.62,
    minObservationSpanDays: 21,
  },
  {
    stage: 4,
    currentStatus: 'trusted_preference',
    minSupportingEvents: 14,
    minWeightedSupport: 10,
    minConsistency: 0.9,
    minConfidence: 0.74,
    minObservationSpanDays: 60,
  },
];

export function createSuggestedBeliefThresholds(): BeliefThresholdConfig {
  return {
    recencyHalfLifeDays: 90,
    contradictionPenalty: 1.35,
    priorWeight: 4,
    stageRules: STAGE_RULES.map((rule) => ({ ...rule })),
  };
}

function cleanText(value: unknown, maxLength = 320) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function normalizeBeliefContextKey(value: unknown) {
  return cleanText(value, 80)?.toLowerCase() ?? null;
}

function normalizeLayerMode(value: unknown) {
  return cleanText(value, 40)?.toLowerCase() ?? null;
}

function normalizeFeedbackType(value: unknown): LayerFeedbackBeliefType | null {
  const text = cleanText(value, 40)?.toLowerCase().replace(/\s+/g, '_') ?? null;
  if (text === 'too_strong' || text === 'too_weak' || text === 'doesnt_work') return text;
  if (text === "doesn't_work" || text === 'doesn_t_work') return 'doesnt_work';
  return null;
}

function isoDateForObservation(row: { created_at?: string | null; wear_date?: string | null }) {
  return cleanText(row.created_at, 80) ?? (cleanText(row.wear_date, 10) ? `${row.wear_date}T00:00:00.000Z` : null);
}

function safeEventId(prefix: string, value: unknown) {
  return cleanText(value, 160) ?? `${prefix}:unknown`;
}

export function buildLayerModeBeliefKey(layerMode: unknown, contextKey?: unknown) {
  const mode = normalizeLayerMode(layerMode) ?? 'unknown';
  const context = normalizeBeliefContextKey(contextKey) ?? 'global';
  return `layer_mode:${context}:${mode}`;
}

export function buildLayerRatioBeliefKey(ratioLabel: unknown, contextKey?: unknown) {
  const ratio = cleanText(ratioLabel, 160)?.toLowerCase().replace(/\s+/g, ' ') ?? 'unknown';
  const context = normalizeBeliefContextKey(contextKey) ?? 'global';
  return `layer_ratio:${context}:${ratio}`;
}

export function buildLayerPairBeliefKey(anchorFragranceId: unknown, companionFragranceId: unknown, contextKey?: unknown) {
  const anchor = cleanText(anchorFragranceId, 80) ?? 'unknown-anchor';
  const companion = cleanText(companionFragranceId, 80) ?? 'unknown-companion';
  const context = normalizeBeliefContextKey(contextKey) ?? 'global';
  return `layer_pair:${context}:${anchor}:${companion}`;
}

export function dailyLayerMemoryToModeEvidence(row: DailyLayerMemoryObservation): BeliefEvidenceEvent | null {
  const occurredAt = isoDateForObservation(row);
  const layerMode = normalizeLayerMode(row.layer_mode);
  if (!occurredAt || !layerMode) return null;

  const contextKey = normalizeBeliefContextKey(row.context_key);
  return {
    eventId: safeEventId('daily-layer-memory', row.id ?? row.recommendation_identity),
    source: 'daily_layer_wear_memory_v1',
    polarity: 'supporting',
    observationKind: 'layer_mode',
    occurredAt,
    contextKey,
    beliefKey: buildLayerModeBeliefKey(layerMode, contextKey),
    layerMode,
    ratioLabel: cleanText(row.ratio_label, 240),
    anchorFragranceId: cleanText(row.anchor_fragrance_id, 80),
    companionFragranceId: cleanText(row.companion_fragrance_id, 80),
    leadFragranceId: cleanText(row.lead_fragrance_id, 80),
    accentFragranceId: cleanText(row.accent_fragrance_id, 80),
    recommendationIdentity: cleanText(row.recommendation_identity, 320),
    strength: 1,
  };
}

export function layerFeedbackMemoryToModeEvidence(row: LayerFeedbackMemoryObservation): BeliefEvidenceEvent | null {
  const occurredAt = isoDateForObservation(row);
  const layerMode = normalizeLayerMode(row.layer_mode);
  const feedbackType = normalizeFeedbackType(row.feedback_type);
  if (!occurredAt || !layerMode || !feedbackType) return null;

  const contextKey = normalizeBeliefContextKey(row.context_key);
  return {
    eventId: safeEventId('layer-feedback-memory', row.id ?? row.recommendation_identity),
    source: 'layer_recommendation_feedback_v1',
    polarity: 'contradicting',
    observationKind: 'layer_mode',
    occurredAt,
    contextKey,
    beliefKey: buildLayerModeBeliefKey(layerMode, contextKey),
    layerMode,
    ratioLabel: cleanText(row.ratio_label, 240),
    anchorFragranceId: cleanText(row.anchor_fragrance_id, 80),
    companionFragranceId: cleanText(row.companion_fragrance_id, 80),
    leadFragranceId: cleanText(row.lead_fragrance_id, 80),
    accentFragranceId: cleanText(row.accent_fragrance_id, 80),
    recommendationIdentity: cleanText(row.recommendation_identity, 320),
    feedbackType,
    strength: feedbackType === 'doesnt_work' ? 1.25 : 0.8,
  };
}

function toDate(value: string | Date | null | undefined) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = cleanText(value, 80);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(earlier: Date, later: Date) {
  return Math.max(0, (later.getTime() - earlier.getTime()) / 86_400_000);
}

export function resolveRecencyWeight(
  occurredAt: string | Date | null | undefined,
  now: string | Date | null | undefined,
  halfLifeDays: number,
) {
  const eventDate = toDate(occurredAt);
  const nowDate = toDate(now) ?? new Date();
  if (!eventDate || halfLifeDays <= 0) return 0;
  const ageDays = daysBetween(eventDate, nowDate);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sortDates(events: BeliefEvidenceEvent[]) {
  return events
    .map((event) => toDate(event.occurredAt))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime());
}

function formatDate(date: Date | null) {
  return date ? date.toISOString() : null;
}

function resolveObservationSpanDays(supportingEvents: BeliefEvidenceEvent[]) {
  const dates = sortDates(supportingEvents);
  if (dates.length < 2) return 0;
  return daysBetween(dates[0], dates[dates.length - 1]);
}

function resolveStage(args: {
  supportingCount: number;
  weightedSupport: number;
  consistency: number;
  confidence: number;
  observationSpanDays: number;
  config: BeliefThresholdConfig;
}) {
  return [...args.config.stageRules]
    .sort((a, b) => b.stage - a.stage)
    .find((rule) => (
      args.supportingCount >= rule.minSupportingEvents
      && args.weightedSupport >= rule.minWeightedSupport
      && args.consistency >= rule.minConsistency
      && args.confidence >= rule.minConfidence
      && args.observationSpanDays >= rule.minObservationSpanDays
    )) ?? null;
}

export function evaluateBeliefState(input: BeliefEvaluationInput): BeliefState {
  const config = input.config ?? createSuggestedBeliefThresholds();
  const contextKey = normalizeBeliefContextKey(input.contextKey);
  const relevantEvents = input.events.filter((event) => {
    if (event.beliefKey && event.beliefKey !== input.beliefKey) return false;
    if (contextKey && normalizeBeliefContextKey(event.contextKey) !== contextKey) return false;
    return event.observationKind === input.observationKind;
  });
  const supportingEvents = relevantEvents.filter((event) => event.polarity === 'supporting');
  const contradictingEvents = relevantEvents.filter((event) => event.polarity === 'contradicting');
  const now = input.now ?? new Date();

  const weightedSupport = supportingEvents.reduce((sum, event) => {
    const strength = typeof event.strength === 'number' && Number.isFinite(event.strength) ? event.strength : 1;
    return sum + strength * resolveRecencyWeight(event.occurredAt, now, config.recencyHalfLifeDays);
  }, 0);

  const weightedContradiction = contradictingEvents.reduce((sum, event) => {
    const strength = typeof event.strength === 'number' && Number.isFinite(event.strength) ? event.strength : 1;
    return sum + strength * resolveRecencyWeight(event.occurredAt, now, config.recencyHalfLifeDays) * config.contradictionPenalty;
  }, 0);

  const consistency = weightedSupport + weightedContradiction > 0
    ? weightedSupport / (weightedSupport + weightedContradiction)
    : 0;
  const confidence = clamp01(weightedSupport / (weightedSupport + weightedContradiction + config.priorWeight));
  const observationSpanDays = resolveObservationSpanDays(supportingEvents);
  const rule = resolveStage({
    supportingCount: supportingEvents.length,
    weightedSupport,
    consistency,
    confidence,
    observationSpanDays,
    config,
  });
  const allDates = sortDates(relevantEvents);
  const supportDates = sortDates(supportingEvents);

  return {
    belief_key: input.beliefKey,
    observation_kind: input.observationKind,
    evidence_count: relevantEvents.length,
    supporting_events: supportingEvents.map((event) => event.eventId),
    contradicting_events: contradictingEvents.map((event) => event.eventId),
    supporting_count: supportingEvents.length,
    contradicting_count: contradictingEvents.length,
    weighted_support: Number(weightedSupport.toFixed(4)),
    weighted_contradiction: Number(weightedContradiction.toFixed(4)),
    consistency: Number(consistency.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    first_seen: formatDate(allDates[0] ?? null),
    last_confirmed: formatDate(supportDates[supportDates.length - 1] ?? null),
    context_key: contextKey,
    current_stage: rule?.stage ?? 0,
    current_status: rule?.currentStatus ?? 'observation_only',
    framework_version: BELIEF_THRESHOLD_FRAMEWORK_VERSION,
  };
}

export function groupEvidenceByBeliefKey(events: BeliefEvidenceEvent[]) {
  return events.reduce<Record<string, BeliefEvidenceEvent[]>>((groups, event) => {
    const key = cleanText(event.beliefKey, 320);
    if (!key) return groups;
    groups[key] = groups[key] ?? [];
    groups[key].push(event);
    return groups;
  }, {});
}
