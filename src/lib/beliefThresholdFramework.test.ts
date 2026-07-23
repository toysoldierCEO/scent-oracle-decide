import { describe, expect, it } from 'vitest';

import {
  buildLayerModeBeliefKey,
  createSuggestedBeliefThresholds,
  dailyLayerMemoryToModeEvidence,
  evaluateBeliefState,
  groupEvidenceByBeliefKey,
  layerFeedbackMemoryToModeEvidence,
  resolveRecencyWeight,
} from './beliefThresholdFramework';

function positiveModeEvent(index: number, mode = 'smooth', context = 'daily', date = `2026-07-${String(index).padStart(2, '0')}`) {
  const event = dailyLayerMemoryToModeEvidence({
    id: `positive-${index}`,
    created_at: `${date}T12:00:00.000Z`,
    context_key: context,
    layer_mode: mode,
    ratio_label: '2 Anchor : 1 Companion',
    anchor_fragrance_id: 'anchor-1',
    companion_fragrance_id: 'companion-1',
    lead_fragrance_id: 'anchor-1',
    accent_fragrance_id: 'companion-1',
    recommendation_identity: `${date}|${context}|anchor-1|companion-1|${mode}`,
  });

  if (!event) throw new Error('expected positive evidence event');
  return event;
}

function feedbackModeEvent(index: number, feedbackType = 'too_strong', mode = 'smooth', context = 'daily', date = `2026-07-${String(index).padStart(2, '0')}`) {
  const event = layerFeedbackMemoryToModeEvidence({
    id: `feedback-${index}`,
    created_at: `${date}T12:00:00.000Z`,
    context_key: context,
    layer_mode: mode,
    feedback_type: feedbackType,
    ratio_label: '2 Anchor : 1 Companion',
    anchor_fragrance_id: 'anchor-1',
    companion_fragrance_id: 'companion-1',
    lead_fragrance_id: 'anchor-1',
    accent_fragrance_id: 'companion-1',
    recommendation_identity: `${date}|${context}|anchor-1|companion-1|${mode}`,
  });

  if (!event) throw new Error('expected feedback evidence event');
  return event;
}

describe('belief threshold framework', () => {
  it('keeps a single factual observation at stage 0', () => {
    const beliefKey = buildLayerModeBeliefKey('smooth', 'daily');
    const state = evaluateBeliefState({
      beliefKey,
      observationKind: 'layer_mode',
      contextKey: 'daily',
      now: '2026-07-22T12:00:00.000Z',
      events: [positiveModeEvent(1)],
    });

    expect(state.current_stage).toBe(0);
    expect(state.current_status).toBe('observation_only');
    expect(state.evidence_count).toBe(1);
    expect(state.supporting_events).toEqual(['positive-1']);
    expect(state.contradicting_events).toEqual([]);
  });

  it('requires repeated support before forming a hypothesis', () => {
    const beliefKey = buildLayerModeBeliefKey('smooth', 'daily');
    const state = evaluateBeliefState({
      beliefKey,
      observationKind: 'layer_mode',
      contextKey: 'daily',
      now: '2026-07-22T12:00:00.000Z',
      events: [positiveModeEvent(1), positiveModeEvent(2), positiveModeEvent(3)],
    });

    expect(state.current_stage).toBe(1);
    expect(state.current_status).toBe('hypothesis');
    expect(state.confidence).toBeGreaterThanOrEqual(0.25);
  });

  it('advances only with repeated evidence over time', () => {
    const beliefKey = buildLayerModeBeliefKey('smooth', 'daily');
    const events = [1, 5, 9, 13, 17, 21].map((day, index) => (
      positiveModeEvent(index + 1, 'smooth', 'daily', `2026-06-${String(day).padStart(2, '0')}`)
    ));
    const state = evaluateBeliefState({
      beliefKey,
      observationKind: 'layer_mode',
      contextKey: 'daily',
      now: '2026-07-01T12:00:00.000Z',
      events,
    });

    expect(state.current_stage).toBe(2);
    expect(state.current_status).toBe('emerging_pattern');
    expect(state.first_seen).toBe('2026-06-01T12:00:00.000Z');
    expect(state.last_confirmed).toBe('2026-06-21T12:00:00.000Z');
  });

  it('lets a heavily supported pattern survive one contradiction without binary erasure', () => {
    const beliefKey = buildLayerModeBeliefKey('smooth', 'daily');
    const support = [1, 5, 9, 13, 17, 21, 25, 29, 30, 31].map((day, index) => (
      positiveModeEvent(index + 1, 'smooth', 'daily', `2026-05-${String(day).padStart(2, '0')}`)
    ));
    const contradiction = feedbackModeEvent(99, 'too_strong', 'smooth', 'daily', '2026-06-01');
    const state = evaluateBeliefState({
      beliefKey,
      observationKind: 'layer_mode',
      contextKey: 'daily',
      now: '2026-06-02T12:00:00.000Z',
      events: [...support, contradiction],
    });

    expect(state.current_stage).toBeGreaterThanOrEqual(2);
    expect(state.supporting_count).toBe(10);
    expect(state.contradicting_count).toBe(1);
    expect(state.confidence).toBeLessThan(0.7);
  });

  it('does not create a strong belief from one isolated experiment', () => {
    const beliefKey = buildLayerModeBeliefKey('bold', 'daily');
    const state = evaluateBeliefState({
      beliefKey,
      observationKind: 'layer_mode',
      contextKey: 'daily',
      now: '2026-07-22T12:00:00.000Z',
      events: [positiveModeEvent(1, 'bold')],
    });

    expect(state.current_stage).toBe(0);
    expect(state.current_status).toBe('observation_only');
  });

  it('weakens beliefs when contradictory feedback repeats', () => {
    const beliefKey = buildLayerModeBeliefKey('smooth', 'daily');
    const support = [1, 5, 9, 13, 17, 21, 25, 29].map((day, index) => (
      positiveModeEvent(index + 1, 'smooth', 'daily', `2026-05-${String(day).padStart(2, '0')}`)
    ));
    const contradictions = [
      feedbackModeEvent(1, 'too_strong', 'smooth', 'daily', '2026-05-30'),
      feedbackModeEvent(2, 'doesnt_work', 'smooth', 'daily', '2026-06-01'),
      feedbackModeEvent(3, 'too_weak', 'smooth', 'daily', '2026-06-03'),
    ];
    const state = evaluateBeliefState({
      beliefKey,
      observationKind: 'layer_mode',
      contextKey: 'daily',
      now: '2026-06-04T12:00:00.000Z',
      events: [...support, ...contradictions],
    });

    expect(state.current_stage).toBeLessThan(3);
    expect(state.weighted_contradiction).toBeGreaterThan(0);
    expect(state.contradicting_events).toEqual(['feedback-1', 'feedback-2', 'feedback-3']);
  });

  it('keeps incompatible contexts isolated', () => {
    const dailyKey = buildLayerModeBeliefKey('smooth', 'daily');
    const officeKey = buildLayerModeBeliefKey('smooth', 'office');
    const events = [
      positiveModeEvent(1, 'smooth', 'daily'),
      positiveModeEvent(2, 'smooth', 'daily'),
      positiveModeEvent(3, 'smooth', 'daily'),
      positiveModeEvent(4, 'smooth', 'office'),
      positiveModeEvent(5, 'smooth', 'office'),
    ];

    const dailyState = evaluateBeliefState({
      beliefKey: dailyKey,
      observationKind: 'layer_mode',
      contextKey: 'daily',
      now: '2026-07-22T12:00:00.000Z',
      events,
    });
    const officeState = evaluateBeliefState({
      beliefKey: officeKey,
      observationKind: 'layer_mode',
      contextKey: 'office',
      now: '2026-07-22T12:00:00.000Z',
      events,
    });

    expect(dailyState.supporting_count).toBe(3);
    expect(dailyState.current_stage).toBe(1);
    expect(officeState.supporting_count).toBe(2);
    expect(officeState.current_stage).toBe(0);
  });

  it('weights newer evidence more than older evidence', () => {
    const recent = resolveRecencyWeight('2026-07-20T00:00:00.000Z', '2026-07-22T00:00:00.000Z', 90);
    const old = resolveRecencyWeight('2025-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z', 90);

    expect(recent).toBeGreaterThan(old);
    expect(old).toBeGreaterThan(0);
  });

  it('groups only events that carry explicit belief keys', () => {
    const keyed = positiveModeEvent(1, 'smooth', 'daily');
    const unkeyed = { ...positiveModeEvent(2, 'smooth', 'daily'), beliefKey: null };
    const groups = groupEvidenceByBeliefKey([keyed, unkeyed]);

    expect(Object.keys(groups)).toEqual([keyed.beliefKey]);
    expect(groups[keyed.beliefKey!]).toHaveLength(1);
  });

  it('keeps the suggested thresholds conservative and internal', () => {
    const config = createSuggestedBeliefThresholds();

    expect(config.stageRules.map((rule) => rule.stage)).toEqual([1, 2, 3, 4]);
    expect(config.stageRules[0].minSupportingEvents).toBeGreaterThan(1);
    expect(config.stageRules[3].minSupportingEvents).toBeGreaterThan(config.stageRules[2].minSupportingEvents);
  });
});
