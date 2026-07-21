export type MorningSmsModeKey = 'balance' | 'bold' | 'smooth';

export type MorningSmsTodayPick = {
  fragranceId?: string | null;
  name?: string | null;
  brand?: string | null;
};

export type MorningSmsLayerOption = {
  mode: MorningSmsModeKey | string;
  companionName?: string | null;
  companionBrand?: string | null;
  guidance?: string | null;
  sprayGuidance?: string | null;
  placementHint?: string | null;
  whyItWorks?: string | null;
};

export type MorningSmsFormatInput = {
  todayPick: MorningSmsTodayPick | null | undefined;
  soloPlacement: string | null | undefined;
  layeringUnlocked: boolean;
  modes?: MorningSmsLayerOption[] | null;
};

export type SmsEncoding = 'gsm7' | 'ucs2';

export type SmsMessageMetadata = {
  body: string;
  charCount: number;
  encoding: SmsEncoding;
  segmentCount: number;
};

export type TextbeltProviderResult =
  | {
      status: 'sent';
      providerId: string | null;
      safeErrorCategory: null;
      rawStatus: number;
    }
  | {
      status: 'failed' | 'uncertain';
      providerId: null;
      safeErrorCategory: string;
      rawStatus: number | null;
    };

export type TextbeltFetch = (
  input: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type TextbeltProvider = {
  sendSms(input: {
    phoneE164: string;
    body: string;
    timeoutMs?: number;
  }): Promise<TextbeltProviderResult>;
};

export type MorningSmsLocalScheduleInput = {
  now: string | Date;
  timezoneName: string;
  localDeliveryTime: string;
  enabledWeekdays: number[];
};

export const MORNING_SMS_LAYER_MODES: MorningSmsModeKey[] = ['smooth', 'balance', 'bold'];
export const RETRYABLE_MORNING_SMS_PRE_PROVIDER_FAILURES = [
  'canonical_contract_failed',
  'collection_eligibility_failed',
  'sms_build_failed',
] as const;

const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;

const MODE_LABELS: Record<MorningSmsModeKey, string> = {
  smooth: 'Smooth',
  balance: 'Balanced',
  bold: 'Bold',
};

const GSM_7_BASIC = new Set([
  ...'@ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  ...' !"#%&\'()*+,-./:;<=>?',
  '\n',
  '\r',
  '$',
  '_',
]);

const GSM_7_EXTENDED = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

function normalizeText(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeLine(value: unknown) {
  return normalizeText(value).replace(/\s+([,.!?:;])/g, '$1');
}

function cleanName(value: unknown) {
  const normalized = normalizeLine(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeMode(value: unknown): MorningSmsModeKey | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'balanced') return 'balance';
  return MORNING_SMS_LAYER_MODES.includes(normalized as MorningSmsModeKey)
    ? normalized as MorningSmsModeKey
    : null;
}

function dedupeJoin(parts: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const normalized = normalizeLine(part);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result.join(' ');
}

function parseLocalDeliveryTime(value: unknown) {
  const match = typeof value === 'string'
    ? value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/)
    : null;
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function getZonedParts(now: Date, timezoneName: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezoneName,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = new Map(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const hour = Number(parts.get('hour') ?? '0') % 24;
  const minute = Number(parts.get('minute') ?? '0');
  return {
    localDate: `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`,
    localWeekday: weekdayMap[parts.get('weekday') ?? ''] ?? null,
    localMinutes: hour * 60 + minute,
  };
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

export function isValidE164Phone(value: unknown) {
  return typeof value === 'string' && E164_PATTERN.test(value.trim());
}

export function maskE164Phone(value: unknown) {
  if (!isValidE164Phone(value)) return null;
  const phone = String(value).trim();
  return `${phone.slice(0, 2)}***${phone.slice(-4)}`;
}

export function normalizeEnabledWeekdays(value: unknown) {
  if (!Array.isArray(value)) return [];
  const days = new Set<number>();
  for (const item of value) {
    const day = Number(item);
    if (Number.isInteger(day) && day >= 1 && day <= 7) days.add(day);
  }
  return Array.from(days).sort((a, b) => a - b);
}

export function resolveMorningSmsLocalSchedule(input: MorningSmsLocalScheduleInput) {
  const now = input.now instanceof Date ? input.now : new Date(input.now);
  const deliveryMinutes = parseLocalDeliveryTime(input.localDeliveryTime);
  const enabledWeekdays = normalizeEnabledWeekdays(input.enabledWeekdays);

  if (!Number.isFinite(now.getTime()) || deliveryMinutes === null || enabledWeekdays.length === 0) {
    return { ok: false, due: false, category: 'invalid_schedule' } as const;
  }

  try {
    const zoned = getZonedParts(now, input.timezoneName);
    const weekdayEnabled = zoned.localWeekday !== null && enabledWeekdays.includes(zoned.localWeekday);
    return {
      ok: true,
      due: weekdayEnabled && zoned.localMinutes >= deliveryMinutes,
      category: null,
      localDate: zoned.localDate,
      localWeekday: zoned.localWeekday,
      localMinutes: zoned.localMinutes,
      deliveryMinutes,
    } as const;
  } catch {
    return { ok: false, due: false, category: 'invalid_timezone' } as const;
  }
}

export function isSmsBodyPersistable(value: unknown) {
  return typeof value !== 'string' || value.trim().length === 0;
}

export function extractSchedulerSecret(
  schedulerHeader: string | null | undefined,
  authorizationHeader: string | null | undefined,
) {
  if (typeof schedulerHeader === 'string' && schedulerHeader.length > 0) {
    return schedulerHeader;
  }
  const bearer = typeof authorizationHeader === 'string'
    ? authorizationHeader.match(/^Bearer\s+(.+)$/i)
    : null;
  return bearer ? bearer[1] : null;
}

export function verifySchedulerSecret(
  providedSecret: string | null | undefined,
  expectedSecret: string | null | undefined,
) {
  const expected = typeof expectedSecret === 'string' ? expectedSecret : '';
  const provided = typeof providedSecret === 'string' ? providedSecret : '';
  if (!expected.trim()) {
    return { ok: false, status: 503, category: 'missing_scheduler_secret' } as const;
  }
  if (!provided || !constantTimeEqual(provided, expected)) {
    return { ok: false, status: 401, category: 'unauthorized' } as const;
  }
  return { ok: true, status: 200, category: null } as const;
}

export function isRetryableMorningSmsPreProviderFailure(value: unknown) {
  return RETRYABLE_MORNING_SMS_PRE_PROVIDER_FAILURES.includes(
    String(value ?? '') as typeof RETRYABLE_MORNING_SMS_PRE_PROVIDER_FAILURES[number],
  );
}

export function collectMorningSmsFeedbackExclusionIds(
  rows: Array<{
    feedback_type?: unknown;
    anchor_fragrance_id?: unknown;
    companion_fragrance_id?: unknown;
  }> | null | undefined,
  anchorId: string | null | undefined,
) {
  const normalizedAnchorId = cleanName(anchorId);
  if (!normalizedAnchorId) return [];

  const excluded = new Set<string>();
  for (const row of rows ?? []) {
    const feedbackType = normalizeText(row.feedback_type);
    const feedbackAnchorId = cleanName(row.anchor_fragrance_id);
    const companionId = cleanName(row.companion_fragrance_id);
    if (feedbackAnchorId === normalizedAnchorId && companionId) {
      excluded.add(companionId);
    }
    if (feedbackType === 'doesnt_work' && companionId === normalizedAnchorId && feedbackAnchorId) {
      excluded.add(feedbackAnchorId);
    }
  }
  return Array.from(excluded);
}

export function qualifyMorningSmsLayerModes(
  modes: MorningSmsLayerOption[] | null | undefined,
) {
  const byMode = new Map<MorningSmsModeKey, MorningSmsLayerOption>();

  for (const option of modes ?? []) {
    const mode = normalizeMode(option.mode);
    if (!mode) continue;
    const companionName = cleanName(option.companionName);
    if (!companionName) continue;
    const guidance = dedupeJoin([
      option.guidance,
      option.sprayGuidance,
      option.placementHint,
      option.whyItWorks,
    ]);
    if (!guidance) continue;
    if (!byMode.has(mode)) {
      byMode.set(mode, {
        ...option,
        mode,
        companionName,
        guidance,
      });
    }
  }

  return MORNING_SMS_LAYER_MODES
    .map((mode) => byMode.get(mode))
    .filter((option): option is MorningSmsLayerOption => Boolean(option));
}

export function formatVesperMorningSms(input: MorningSmsFormatInput) {
  const fragranceName = cleanName(input.todayPick?.name);
  const soloPlacement = normalizeLine(input.soloPlacement);

  if (!fragranceName || !soloPlacement) {
    throw new Error('canonical_today_pick_required');
  }

  const lines = [
    "VESPER - TODAY'S PICK",
    fragranceName,
    `Solo: ${soloPlacement}`,
  ];

  if (input.layeringUnlocked) {
    const qualifiedModes = qualifyMorningSmsLayerModes(input.modes);
    if (qualifiedModes.length > 0) {
      for (const mode of qualifiedModes) {
        const modeKey = normalizeMode(mode.mode);
        if (!modeKey) continue;
        lines.push(`${MODE_LABELS[modeKey]}: + ${cleanName(mode.companionName)} - ${normalizeLine(mode.guidance)}`);
      }
    } else {
      lines.push('Solo recommended today.');
    }
  } else {
    lines.push('Solo recommended today.');
  }

  return lines.join('\n');
}

export function analyzeSmsMessage(body: string): SmsMessageMetadata {
  const chars = Array.from(body);
  const gsmUnits = chars.reduce((total, char) => {
    if (GSM_7_BASIC.has(char)) return total + 1;
    if (GSM_7_EXTENDED.has(char)) return total + 2;
    return Number.POSITIVE_INFINITY;
  }, 0);

  const isGsm7 = Number.isFinite(gsmUnits);
  const charCount = isGsm7 ? gsmUnits : chars.length;
  const singleLimit = isGsm7 ? 160 : 70;
  const multiLimit = isGsm7 ? 153 : 67;
  const segmentCount = charCount <= singleLimit
    ? 1
    : Math.ceil(charCount / multiLimit);

  return {
    body,
    charCount,
    encoding: isGsm7 ? 'gsm7' : 'ucs2',
    segmentCount,
  };
}

export async function sha256Hex(value: string) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function parseTextbeltResponse(
  response: { ok: boolean; status: number },
  payload: unknown,
): TextbeltProviderResult {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};

  if (response.ok && record.success === true) {
    const providerId = typeof record.textId === 'string'
      ? record.textId
      : typeof record.id === 'string'
        ? record.id
        : null;
    return {
      status: 'sent',
      providerId,
      safeErrorCategory: null,
      rawStatus: response.status,
    };
  }

  const errorText = typeof record.error === 'string' ? record.error.toLowerCase() : '';
  const safeErrorCategory = response.status >= 500
    ? 'provider_server_error'
    : response.status === 429 || errorText.includes('quota')
      ? 'provider_rate_limited'
      : response.status === 401 || response.status === 403 || errorText.includes('key')
        ? 'provider_auth_error'
        : errorText.includes('number') || errorText.includes('phone')
          ? 'provider_phone_rejected'
          : 'provider_rejected';

  return {
    status: 'failed',
    providerId: null,
    safeErrorCategory,
    rawStatus: response.status,
  };
}

export function createTextbeltProvider(
  apiKey: string,
  fetchImpl: TextbeltFetch = fetch as TextbeltFetch,
): TextbeltProvider {
  return {
    async sendSms({ phoneE164, body, timeoutMs = 10_000 }) {
      if (!apiKey) {
        return {
          status: 'failed',
          providerId: null,
          safeErrorCategory: 'missing_provider_secret',
          rawStatus: null,
        };
      }
      if (!isValidE164Phone(phoneE164)) {
        return {
          status: 'failed',
          providerId: null,
          safeErrorCategory: 'invalid_phone',
          rawStatus: null,
        };
      }

      const controller = typeof AbortController !== 'undefined'
        ? new AbortController()
        : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

      try {
        const response = await fetchImpl('https://textbelt.com/text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phoneE164, message: body, key: apiKey }),
          signal: controller?.signal,
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return {
            status: 'uncertain',
            providerId: null,
            safeErrorCategory: 'provider_malformed_response',
            rawStatus: response.status,
          };
        }
        return parseTextbeltResponse(response, payload);
      } catch (error) {
        const name = error && typeof error === 'object' ? (error as { name?: string }).name : '';
        return {
          status: 'uncertain',
          providerId: null,
          safeErrorCategory: name === 'AbortError' ? 'provider_timeout' : 'provider_network_error',
          rawStatus: null,
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}
