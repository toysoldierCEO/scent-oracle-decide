import { describe, expect, it } from 'vitest';

import {
  analyzeSmsMessage,
  collectMorningSmsFeedbackExclusionIds,
  createTextbeltProvider,
  extractSchedulerSecret,
  formatVesperMorningSms,
  isRetryableMorningSmsPreProviderFailure,
  isSmsBodyPersistable,
  isValidE164Phone,
  maskE164Phone,
  parseTextbeltResponse,
  qualifyMorningSmsLayerModes,
  resolveMorningSmsLocalSchedule,
  verifySchedulerSecret,
} from '../../supabase/functions/_shared/vesperMorningSms';
import { resolveLayeringEligibility } from './wearModeEligibility';

const eligibleScent = (index: number, overrides = {}) => ({
  id: `fragrance-${index}`,
  fragrance_id: `fragrance-${index}`,
  name: `Scent ${index}`,
  collection_status: 'owned',
  family_key: 'fresh-blue',
  notes: ['Bergamot'],
  ...overrides,
});

describe('Vesper Morning SMS formatter', () => {
  it('keeps the shared 6 versus 7 scent layering threshold', () => {
    expect(resolveLayeringEligibility(Array.from({ length: 6 }, (_, index) => eligibleScent(index))).isLayeringUnlocked).toBe(false);
    expect(resolveLayeringEligibility(Array.from({ length: 7 }, (_, index) => eligibleScent(index))).isLayeringUnlocked).toBe(true);
  });

  it('formats Solo-only users without leaking Layered or Wild', () => {
    const body = formatVesperMorningSms({
      todayPick: { fragranceId: 'a', name: 'Sichuan Tea X' },
      soloPlacement: '2 sprays neck • 1 spray chest',
      layeringUnlocked: false,
      modes: [
        { mode: 'wild', companionName: 'Chaos', guidance: 'Should not appear' },
        { mode: 'bold', companionName: 'Hafez 1984', guidance: 'Real guidance' },
      ],
    });

    expect(body).toContain("VESPER - TODAY'S PICK");
    expect(body).toContain('Sichuan Tea X');
    expect(body).toContain('Solo: 2 sprays neck • 1 spray chest');
    expect(body).toContain('Solo recommended today.');
    expect(body).not.toMatch(/Wild|Chaos|Bold:/);
  });

  it('includes all three qualifying modes in the approved order', () => {
    const body = formatVesperMorningSms({
      todayPick: { fragranceId: 'a', name: 'Dark Pleasure' },
      soloPlacement: '1 spray chest • 1 spray back neck • optional wrist',
      layeringUnlocked: true,
      modes: [
        { mode: 'bold', companionName: 'Hafez 1984', guidance: '1 spray each' },
        { mode: 'balance', companionName: 'Ghostbusters', guidance: '2 anchor / 1 layer' },
        { mode: 'smooth', companionName: 'Vanille Doree', guidance: 'Keep it close' },
      ],
    });

    expect(body).toContain('Smooth: + Vanille Doree - Keep it close');
    expect(body).toContain('Balanced: + Ghostbusters - 2 anchor / 1 layer');
    expect(body).toContain('Bold: + Hafez 1984 - 1 spray each');
    expect(body.indexOf('Smooth:')).toBeLessThan(body.indexOf('Balanced:'));
    expect(body.indexOf('Balanced:')).toBeLessThan(body.indexOf('Bold:'));
  });

  it('omits partial or missing layer modes and falls back when zero qualify', () => {
    const partial = formatVesperMorningSms({
      todayPick: { fragranceId: 'a', name: 'Reflection Man' },
      soloPlacement: '2 sprays chest • 1 spray back neck',
      layeringUnlocked: true,
      modes: [
        { mode: 'smooth', companionName: 'Molecule 01', guidance: '1 spray shirt' },
        { mode: 'balance', companionName: 'No Guidance' },
        { mode: 'bold', guidance: 'No companion' },
      ],
    });
    expect(partial).toContain('Smooth: + Molecule 01 - 1 spray shirt');
    expect(partial).not.toContain('No Guidance');
    expect(partial).not.toContain('Bold:');

    const fallback = formatVesperMorningSms({
      todayPick: { fragranceId: 'a', name: 'Reflection Man' },
      soloPlacement: '2 sprays chest • 1 spray back neck',
      layeringUnlocked: true,
      modes: [{ mode: 'balance', companionName: 'Empty' }],
    });
    expect(fallback).toContain('Solo recommended today.');
  });

  it('does not fabricate guidance for unavailable modes', () => {
    expect(qualifyMorningSmsLayerModes([
      { mode: 'balance', companionName: 'Ghostbusters' },
      { mode: 'bold', companionName: 'Hafez 1984', whyItWorks: 'Real backend why.' },
    ])).toEqual([
      expect.objectContaining({
        mode: 'bold',
        companionName: 'Hafez 1984',
        guidance: 'Real backend why.',
      }),
    ]);
  });

  it('validates E.164 and masks phones without logging complete PII', () => {
    expect(isValidE164Phone('+14155550123')).toBe(true);
    expect(isValidE164Phone('4155550123')).toBe(false);
    expect(isValidE164Phone('+0123456789')).toBe(false);
    expect(maskE164Phone('+14155550123')).toBe('+1***0123');
  });

  it('reports SMS length and segment metadata', () => {
    expect(analyzeSmsMessage('A'.repeat(160))).toMatchObject({
      encoding: 'gsm7',
      charCount: 160,
      segmentCount: 1,
    });
    expect(analyzeSmsMessage('A'.repeat(161)).segmentCount).toBe(2);
    expect(analyzeSmsMessage('Morning ☕').encoding).toBe('ucs2');
  });

  it('evaluates local schedules across DST boundaries without hardcoded UTC offsets', () => {
    expect(resolveMorningSmsLocalSchedule({
      now: '2026-03-08T06:59:00Z',
      timezoneName: 'America/New_York',
      localDeliveryTime: '02:30',
      enabledWeekdays: [7],
    })).toMatchObject({
      ok: true,
      due: false,
      localDate: '2026-03-08',
      localWeekday: 7,
    });
    expect(resolveMorningSmsLocalSchedule({
      now: '2026-03-08T07:00:00Z',
      timezoneName: 'America/New_York',
      localDeliveryTime: '02:30',
      enabledWeekdays: [7],
    })).toMatchObject({
      ok: true,
      due: true,
      localDate: '2026-03-08',
      localWeekday: 7,
    });
    expect(resolveMorningSmsLocalSchedule({
      now: '2026-11-01T05:30:00Z',
      timezoneName: 'America/New_York',
      localDeliveryTime: '01:30',
      enabledWeekdays: [7],
    })).toMatchObject({
      ok: true,
      due: true,
      localDate: '2026-11-01',
      localWeekday: 7,
    });
    expect(resolveMorningSmsLocalSchedule({
      now: '2026-11-01T06:30:00Z',
      timezoneName: 'America/New_York',
      localDeliveryTime: '01:30',
      enabledWeekdays: [7],
    })).toMatchObject({
      ok: true,
      due: true,
      localDate: '2026-11-01',
      localWeekday: 7,
    });
  });

  it('fails invalid schedule inputs closed', () => {
    expect(resolveMorningSmsLocalSchedule({
      now: '2026-07-21T12:00:00Z',
      timezoneName: 'Not/AZone',
      localDeliveryTime: '08:00',
      enabledWeekdays: [2],
    })).toMatchObject({ ok: false, due: false, category: 'invalid_timezone' });
    expect(resolveMorningSmsLocalSchedule({
      now: '2026-07-21T12:00:00Z',
      timezoneName: 'America/New_York',
      localDeliveryTime: '25:00',
      enabledWeekdays: [2],
    })).toMatchObject({ ok: false, due: false, category: 'invalid_schedule' });
    expect(resolveMorningSmsLocalSchedule({
      now: 'not-a-date',
      timezoneName: 'America/New_York',
      localDeliveryTime: '08:00',
      enabledWeekdays: [2],
    })).toMatchObject({ ok: false, due: false, category: 'invalid_schedule' });
  });

  it('blocks unauthorized scheduler invocation and missing scheduler secret', () => {
    expect(verifySchedulerSecret(null, 'secret')).toMatchObject({ ok: false, status: 401 });
    expect(verifySchedulerSecret('wrong', 'secret')).toMatchObject({ ok: false, category: 'unauthorized' });
    expect(verifySchedulerSecret('secret', '')).toMatchObject({ ok: false, status: 503 });
    expect(verifySchedulerSecret('secret', 'secret')).toMatchObject({ ok: true });
    expect(verifySchedulerSecret(' secret', 'secret')).toMatchObject({ ok: false, category: 'unauthorized' });
    expect(verifySchedulerSecret('secret ', 'secret')).toMatchObject({ ok: false, category: 'unauthorized' });
    expect(extractSchedulerSecret(null, 'Bearer secret')).toBe('secret');
    expect(extractSchedulerSecret('direct-secret', 'Bearer other')).toBe('direct-secret');
    expect(extractSchedulerSecret(null, 'Basic secret')).toBeNull();
    expect(extractSchedulerSecret(null, 'Bearer')).toBeNull();
  });

  it('parses Textbelt success, failure, and timeout outcomes safely', async () => {
    expect(parseTextbeltResponse({ ok: true, status: 200 }, { success: true, textId: 'text-1' })).toEqual({
      status: 'sent',
      providerId: 'text-1',
      safeErrorCategory: null,
      rawStatus: 200,
    });
    expect(parseTextbeltResponse({ ok: false, status: 403 }, { success: false, error: 'bad key' })).toMatchObject({
      status: 'failed',
      safeErrorCategory: 'provider_auth_error',
    });
    expect(parseTextbeltResponse({ ok: false, status: 429 }, { success: false, error: 'Out of quota' })).toMatchObject({
      status: 'failed',
      safeErrorCategory: 'provider_rate_limited',
    });
    expect(parseTextbeltResponse({ ok: false, status: 400 }, { success: false, error: 'Incomplete request' })).toMatchObject({
      status: 'failed',
      safeErrorCategory: 'provider_rejected',
    });

    const timeoutProvider = createTextbeltProvider('key', async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    await expect(timeoutProvider.sendSms({ phoneE164: '+14155550123', body: 'Hello' })).resolves.toMatchObject({
      status: 'uncertain',
      safeErrorCategory: 'provider_timeout',
    });

    const malformedProvider = createTextbeltProvider('key', async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('invalid json');
      },
    }));
    await expect(malformedProvider.sendSms({ phoneE164: '+14155550123', body: 'Hello' })).resolves.toMatchObject({
      status: 'uncertain',
      safeErrorCategory: 'provider_malformed_response',
      rawStatus: 200,
    });

    const networkProvider = createTextbeltProvider('key', async () => {
      throw new Error('network down');
    });
    await expect(networkProvider.sendSms({ phoneE164: '+14155550123', body: 'Hello' })).resolves.toMatchObject({
      status: 'uncertain',
      safeErrorCategory: 'provider_network_error',
    });
  });

  it('sends Textbelt the documented JSON request shape without leaking it to ledger helpers', async () => {
    let requestBody = '';
    const provider = createTextbeltProvider('key', async (_input, init) => {
      requestBody = init.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, textId: 'text-1' }),
      };
    });

    await expect(provider.sendSms({ phoneE164: '+14155550123', body: 'VESPER body' })).resolves.toMatchObject({
      status: 'sent',
    });
    expect(JSON.parse(requestBody)).toEqual({
      phone: '+14155550123',
      message: 'VESPER body',
      key: 'key',
    });
  });

  it('fails provider calls closed when secret or phone is invalid', async () => {
    await expect(createTextbeltProvider('').sendSms({ phoneE164: '+14155550123', body: 'Hello' })).resolves.toMatchObject({
      status: 'failed',
      safeErrorCategory: 'missing_provider_secret',
    });
    await expect(createTextbeltProvider('key').sendSms({ phoneE164: 'bad', body: 'Hello' })).resolves.toMatchObject({
      status: 'failed',
      safeErrorCategory: 'invalid_phone',
    });
  });

  it('treats raw SMS bodies as non-persistable ledger values', () => {
    expect(isSmsBodyPersistable('VESPER body')).toBe(false);
    expect(isSmsBodyPersistable(null)).toBe(true);
  });

  it('applies exact and reversed doesnt_work layer feedback exclusions', () => {
    expect(collectMorningSmsFeedbackExclusionIds([
      {
        feedback_type: 'too_strong',
        anchor_fragrance_id: 'anchor',
        companion_fragrance_id: 'companion-a',
      },
      {
        feedback_type: 'doesnt_work',
        anchor_fragrance_id: 'old-anchor',
        companion_fragrance_id: 'anchor',
      },
      {
        feedback_type: 'too_weak',
        anchor_fragrance_id: 'other-anchor',
        companion_fragrance_id: 'companion-b',
      },
    ], 'anchor')).toEqual(['companion-a', 'old-anchor']);
  });

  it('distinguishes retryable pre-provider failures from terminal skips', () => {
    expect(isRetryableMorningSmsPreProviderFailure('canonical_contract_failed')).toBe(true);
    expect(isRetryableMorningSmsPreProviderFailure('collection_eligibility_failed')).toBe(true);
    expect(isRetryableMorningSmsPreProviderFailure('sms_build_failed')).toBe(true);
    expect(isRetryableMorningSmsPreProviderFailure('canonical_today_pick_missing')).toBe(false);
    expect(isRetryableMorningSmsPreProviderFailure('provider_timeout')).toBe(false);
  });
});
