import { describe, expect, it } from 'vitest';

import {
  buildLayerFeedbackRpcParams,
  createLayerFeedbackIdempotencyKey,
  normalizeLayerFeedbackType,
} from './layerFeedbackMemory';

describe('layer feedback memory payloads', () => {
  it.each([
    ['Too strong', 'too_strong'],
    ['Too weak', 'too_weak'],
    ["Doesn't work", 'doesnt_work'],
    ['Doesn’t work', 'doesnt_work'],
    ['doesnt work', 'doesnt_work'],
  ] as const)('normalizes %s to %s', (label, expected) => {
    expect(normalizeLayerFeedbackType(label)).toBe(expected);
  });

  it('builds a factual pairing-scoped feedback RPC payload', () => {
    const payload = buildLayerFeedbackRpcParams('user-1', {
      feedbackType: 'too_strong',
      anchorFragranceId: 'anchor-1',
      companionFragranceId: 'companion-1',
      recommendationIdentity: '2026-07-13|evening|anchor-1|companion-1|balance',
      layerMode: 'balance',
      leadRole: 'Lead',
      companionRole: 'Accent',
      ratioLabel: '2 Dark Pleasure : 1 California Winter 2018',
      anchorSprays: 2.2,
      companionSprays: 1,
      context: 'Evening',
      temperature: 74,
      wearDate: '2026-07-13',
      presentation: {
        anchorName: 'Dark Pleasure',
        companionName: 'California Winter 2018',
        matchedRule: 'dark-pleasure-california-winter-2018',
      },
    }, '00000000-0000-4000-8000-000000000001');

    expect(payload).toEqual({
      p_user: 'user-1',
      p_feedback_type: 'too_strong',
      p_anchor_fragrance_id: 'anchor-1',
      p_companion_fragrance_id: 'companion-1',
      p_recommendation_identity: '2026-07-13|evening|anchor-1|companion-1|balance',
      p_layer_mode: 'balance',
      p_lead_role: 'Lead',
      p_companion_role: 'Accent',
      p_ratio_label: '2 Dark Pleasure : 1 California Winter 2018',
      p_anchor_sprays: 2,
      p_companion_sprays: 1,
      p_context: 'Evening',
      p_temperature: 74,
      p_wear_date: '2026-07-13',
      p_presentation_payload: {
        anchorName: 'Dark Pleasure',
        companionName: 'California Winter 2018',
        matchedRule: 'dark-pleasure-california-winter-2018',
      },
      p_idempotency_key: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('keeps invalid optional values neutral instead of inventing context', () => {
    const payload = buildLayerFeedbackRpcParams('user-1', {
      feedbackType: 'doesnt_work',
      anchorFragranceId: 'anchor-1',
      companionFragranceId: 'companion-1',
      recommendationIdentity: '   ',
      layerMode: '',
      leadRole: null,
      companionRole: null,
      ratioLabel: '',
      anchorSprays: 99,
      companionSprays: Number.NaN,
      context: '',
      temperature: Number.POSITIVE_INFINITY,
      wearDate: '   ',
      presentation: null,
    }, '00000000-0000-4000-8000-000000000002');

    expect(payload.p_recommendation_identity).toBeNull();
    expect(payload.p_layer_mode).toBeNull();
    expect(payload.p_ratio_label).toBeNull();
    expect(payload.p_anchor_sprays).toBeNull();
    expect(payload.p_companion_sprays).toBeNull();
    expect(payload.p_context).toBeNull();
    expect(payload.p_temperature).toBeNull();
    expect(payload.p_wear_date).toBeNull();
    expect(payload.p_presentation_payload).toEqual({});
  });

  it('creates UUID-shaped idempotency keys for duplicate-tap protection', () => {
    expect(createLayerFeedbackIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
