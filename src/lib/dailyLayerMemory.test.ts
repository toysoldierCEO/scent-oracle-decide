import { describe, expect, it } from 'vitest';

import { resolveLayerRatioGuide } from './layerRatioIntelligence';
import {
  buildDailyLayerWearMemoryRpcParams,
  createDailyLayerWearMemoryIdempotencyKey,
} from './dailyLayerMemory';

describe('daily layer wear memory payloads', () => {
  it('builds a factual worn-layer RPC payload without preference inference', () => {
    const payload = buildDailyLayerWearMemoryRpcParams('user-1', {
      anchorFragranceId: 'anchor-1',
      companionFragranceId: 'companion-1',
      leadFragranceId: 'anchor-1',
      accentFragranceId: 'companion-1',
      recommendationIdentity: '2026-07-21|daily|anchor-1|companion-1|balance',
      layerMode: 'balance',
      ratioLabel: '2 Dark Pleasure : 1 California Winter 2018',
      anchorSprays: 2.2,
      companionSprays: 1,
      anchorPlacement: 'Dark Pleasure - 2 sprays chest / close to body',
      companionPlacement: 'California Winter 2018 - 1 spray back neck or shirt',
      context: 'Daily',
      temperature: 74,
      wearDate: '2026-07-21',
      acceptanceSource: 'layered_double_tap_lock',
      presentation: {
        anchorName: 'Dark Pleasure',
        companionName: 'California Winter 2018',
        matchedRule: 'user_override_dark_pleasure_california_winter_2018',
      },
    }, '00000000-0000-4000-8000-000000000101');

    expect(payload).toEqual({
      p_user: 'user-1',
      p_wear_date: '2026-07-21',
      p_anchor_fragrance_id: 'anchor-1',
      p_companion_fragrance_id: 'companion-1',
      p_lead_fragrance_id: 'anchor-1',
      p_accent_fragrance_id: 'companion-1',
      p_layer_mode: 'balance',
      p_ratio_label: '2 Dark Pleasure : 1 California Winter 2018',
      p_anchor_sprays: 2,
      p_companion_sprays: 1,
      p_placement: {
        anchor: 'Dark Pleasure - 2 sprays chest / close to body',
        companion: 'California Winter 2018 - 1 spray back neck or shirt',
      },
      p_context: 'daily',
      p_temperature: 74,
      p_recommendation_identity: '2026-07-21|daily|anchor-1|companion-1|balance',
      p_presentation_payload: {
        anchorName: 'Dark Pleasure',
        companionName: 'California Winter 2018',
        matchedRule: 'user_override_dark_pleasure_california_winter_2018',
      },
      p_acceptance_source: 'layered_double_tap_lock',
      p_idempotency_key: '00000000-0000-4000-8000-000000000101',
    });
  });

  it('keeps optional invalid values neutral while required fields still fail closed in the RPC', () => {
    const payload = buildDailyLayerWearMemoryRpcParams('user-1', {
      anchorFragranceId: 'anchor-1',
      companionFragranceId: 'companion-1',
      recommendationIdentity: '   ',
      layerMode: 'unsupported',
      ratioLabel: '',
      anchorSprays: 99,
      companionSprays: Number.NaN,
      anchorPlacement: '',
      companionPlacement: null,
      context: '',
      temperature: Number.POSITIVE_INFINITY,
      wearDate: 'not-a-date',
      presentation: ['not', 'object'],
      acceptanceSource: '',
    }, '00000000-0000-4000-8000-000000000102');

    expect(payload.p_lead_fragrance_id).toBe('anchor-1');
    expect(payload.p_accent_fragrance_id).toBe('companion-1');
    expect(payload.p_wear_date).toBeNull();
    expect(payload.p_layer_mode).toBeNull();
    expect(payload.p_ratio_label).toBeNull();
    expect(payload.p_anchor_sprays).toBeNull();
    expect(payload.p_companion_sprays).toBeNull();
    expect(payload.p_placement).toEqual({});
    expect(payload.p_context).toBeNull();
    expect(payload.p_temperature).toBeNull();
    expect(payload.p_recommendation_identity).toBeNull();
    expect(payload.p_presentation_payload).toEqual({});
    expect(payload.p_acceptance_source).toBe('layered_double_tap_lock');
  });

  it('preserves the Dark Pleasure and California Winter 2018 correction in positive memory payloads', () => {
    const guide = resolveLayerRatioGuide(
      {
        name: 'Dark Pleasure',
        family_key: 'dark-leather',
        notes: ['Rose', 'Coffee', 'Patchouli', 'Incense'],
      },
      {
        name: 'California Winter 2018',
        family_key: 'fresh-blue',
        notes: ['Citrus', 'Clean Air', 'Musk'],
        projection: 8,
      },
    );
    const payload = buildDailyLayerWearMemoryRpcParams('user-1', {
      anchorFragranceId: 'dark-pleasure-id',
      companionFragranceId: 'california-winter-id',
      leadFragranceId: 'dark-pleasure-id',
      accentFragranceId: 'california-winter-id',
      layerMode: 'balance',
      ratioLabel: guide.ratioLabel,
      anchorSprays: guide.anchorSprays,
      companionSprays: guide.companionSprays,
      anchorPlacement: guide.anchorPlacement,
      companionPlacement: guide.companionPlacement,
      wearDate: '2026-07-21',
      presentation: {
        matchedRule: guide.matchedRule,
        dominanceReason: guide.dominanceReason,
      },
    }, '00000000-0000-4000-8000-000000000103');

    expect(payload.p_ratio_label).toBe('2 Dark Pleasure : 1 California Winter 2018');
    expect(payload.p_anchor_sprays).toBe(2);
    expect(payload.p_companion_sprays).toBe(1);
    expect(payload.p_presentation_payload).toMatchObject({
      matchedRule: 'user_override_dark_pleasure_california_winter_2018',
    });
  });

  it('creates UUID-shaped idempotency keys for duplicate confirmation protection', () => {
    expect(createDailyLayerWearMemoryIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
