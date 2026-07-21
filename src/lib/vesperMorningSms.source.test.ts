import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = readFileSync(
  join(root, 'supabase/migrations/20260721011500_vesper_morning_sms_v1.sql'),
  'utf8',
);
const edgeFunction = readFileSync(
  join(root, 'supabase/functions/send-vesper-morning-sms/index.ts'),
  'utf8',
);
const helper = readFileSync(
  join(root, 'supabase/functions/_shared/vesperMorningSms.ts'),
  'utf8',
);

const ledgerTableDefinition = (() => {
  const start = migration.indexOf('create table if not exists public.vesper_morning_sms_delivery_ledger_v1');
  const end = migration.indexOf('comment on table public.vesper_morning_sms_delivery_ledger_v1', start);
  return migration.slice(start, end);
})();

describe('Vesper Morning SMS source contract', () => {
  it('creates an opt-in preference table with consent, E.164, timezone, local time, weekdays, and context', () => {
    expect(migration).toContain('create table if not exists public.vesper_morning_sms_preferences_v1');
    expect(migration).toContain('explicit_consent_at timestamptz');
    expect(migration).toContain('explicit_consent_version text');
    expect(migration).toContain('phone_e164 text');
    expect(migration).toContain("timezone_name text not null default 'America/New_York'");
    expect(migration).toContain("local_delivery_time time not null default '08:00'");
    expect(migration).toContain('enabled_weekdays integer[] not null');
    expect(migration).toContain("recommendation_context text not null default 'daily'");
    expect(migration).toContain("phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'");
  });

  it('protects phone preferences with user-scoped RLS', () => {
    expect(migration).toContain('alter table public.vesper_morning_sms_preferences_v1 enable row level security');
    expect(migration).toContain('revoke all on table public.vesper_morning_sms_preferences_v1 from anon');
    expect(migration).toContain('grant select, insert, update on table public.vesper_morning_sms_preferences_v1 to authenticated');
    expect(migration).toContain('for select');
    expect(migration).toContain('for insert');
    expect(migration).toContain('for update');
    expect(migration).toContain('(select auth.uid()) = user_id');
  });

  it('creates a safe ledger with one delivery per user/local date and no phone/body storage', () => {
    expect(migration).toContain('create table if not exists public.vesper_morning_sms_delivery_ledger_v1');
    expect(migration).toContain('constraint vesper_sms_delivery_once_per_day_v1 unique (user_id, local_date)');
    expect(migration).toContain('body_sha256 text');
    expect(migration).toContain('body_char_count integer');
    expect(migration).toContain('body_segment_count integer');
    expect(ledgerTableDefinition).not.toContain('phone_e164');
    expect(ledgerTableDefinition).not.toMatch(/sms_body|message_body/i);
  });

  it('prevents authenticated clients from forging delivery ledger rows or statuses', () => {
    expect(migration).toContain('alter table public.vesper_morning_sms_delivery_ledger_v1 enable row level security');
    expect(migration).toContain('revoke all on table public.vesper_morning_sms_delivery_ledger_v1 from authenticated');
    expect(migration).toContain('grant select on table public.vesper_morning_sms_delivery_ledger_v1 to authenticated');
    expect(migration).toContain('create policy "Users read own Vesper morning SMS delivery ledger"');
    expect(migration).not.toContain('grant insert on table public.vesper_morning_sms_delivery_ledger_v1 to authenticated');
    expect(migration).not.toContain('grant update on table public.vesper_morning_sms_delivery_ledger_v1 to authenticated');
  });

  it('claims due deliveries atomically and keeps dry-run non-mutating', () => {
    expect(migration).toContain('create or replace function public.claim_due_vesper_morning_sms_v1');
    expect(migration).toContain("raise exception 'Access denied: morning SMS delivery claim requires service role.'");
    expect(migration).toContain('if coalesce(p_dry_run, false) then');
    expect(migration).toContain('on conflict (user_id, local_date) do update');
    expect(migration).toContain("ledger.status = 'failed'");
    expect(migration).toContain('ledger.safe_error_category = any(v_retryable_pre_provider_errors)');
    expect(migration).toContain("public.vesper_morning_sms_delivery_ledger_v1.status = 'failed'");
    expect(migration).toContain('public.vesper_morning_sms_delivery_ledger_v1.safe_error_category = any(v_retryable_pre_provider_errors)');
    expect(migration).toContain('exists (');
    expect(migration).toContain('from pg_timezone_names tz');
    expect(migration).toContain('extract(isodow from timezone(pref.timezone_name, p_now))');
    expect(migration).toContain('(timezone(pref.timezone_name, p_now))::date');
    expect(migration).toContain('(timezone(pref.timezone_name, p_now))::time >= pref.local_delivery_time');
    expect(migration).toContain('grant execute on function public.claim_due_vesper_morning_sms_v1(timestamptz, integer, boolean, uuid) to service_role');
  });

  it('uses server-only delivery finalization and safe status categories', () => {
    expect(migration).toContain('create or replace function public.finish_vesper_morning_sms_delivery_v1');
    expect(migration).toContain("status in ('claimed', 'sent', 'failed', 'uncertain', 'skipped')");
    expect(migration).toContain("v_status not in ('sent', 'failed', 'uncertain', 'skipped')");
    expect(migration).toContain("where claim_token = p_claim_token");
    expect(migration).toContain("and status = 'claimed'");
    expect(migration).toContain('grant execute on function public.finish_vesper_morning_sms_delivery_v1(uuid, text, text, text, text, integer, integer, text) to service_role');
  });

  it('wires the Edge Function to canonical Today and backend mode contracts only', () => {
    expect(edgeFunction).toContain('verifySchedulerSecret');
    expect(edgeFunction).toContain('TEXTBELT_API_KEY');
    expect(edgeFunction).toContain('claim_due_vesper_morning_sms_v1');
    expect(edgeFunction).toContain('get_signed_in_card_contract_v7');
    expect(edgeFunction).toContain('get_collection_wardrobe_v1');
    expect(edgeFunction).toContain('resolveLayeringEligibility(collectionItems)');
    expect(edgeFunction).toContain('resolveSoloWearGuide');
    expect(edgeFunction).toContain('.from("fragrances")');
    expect(edgeFunction).toContain('.select("family_key,family_label,accords,notes,top_notes,heart_notes,middle_notes,base_notes")');
    expect(edgeFunction).toContain('get_layer_for_card_mode_v1');
    expect(edgeFunction).toContain('layer_recommendation_feedback_v1');
    expect(edgeFunction).toContain('collectMorningSmsFeedbackExclusionIds');
    expect(edgeFunction).toContain('finish_vesper_morning_sms_delivery_v1');
  });

  it('never requests Wild for morning SMS layer modes', () => {
    expect(helper).toContain("export const MORNING_SMS_LAYER_MODES: MorningSmsModeKey[] = ['smooth', 'balance', 'bold']");
    expect(edgeFunction).toContain('for (const mode of MORNING_SMS_LAYER_MODES)');
    expect(helper).not.toContain("'wild'");
    expect(edgeFunction).not.toContain('"wild"');
  });

  it('keeps Textbelt behind the provider adapter', () => {
    expect(helper).toContain('createTextbeltProvider');
    expect(helper).toContain('https://textbelt.com/text');
    expect(edgeFunction).toContain('createTextbeltProvider(textbeltKey)');
    expect(edgeFunction).not.toContain('https://textbelt.com/text');
  });
});
