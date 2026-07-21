# Vesper Morning SMS V1

Vesper Morning SMS is a delivery channel for the existing signed-in Today card. It is not a second recommendation engine.

## Required Secrets

Set these only when the feature is ready to run in a deployed Supabase Edge Function:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VESPER_MORNING_SMS_SCHEDULER_SECRET`
- `TEXTBELT_API_KEY`

Do not commit secrets. Do not log phone numbers or full SMS bodies.

## Database Objects

The migration is:

`supabase/migrations/20260721011500_vesper_morning_sms_v1.sql`

It creates:

- `public.vesper_morning_sms_preferences_v1`
- `public.vesper_morning_sms_delivery_ledger_v1`
- `public.claim_due_vesper_morning_sms_v1(...)`
- `public.finish_vesper_morning_sms_delivery_v1(...)`

Apply the migration later through the normal Supabase migration process. This patch does not apply it.

## Configure One Opted-In Test User

Use the user ID and a validated E.164 phone number. Example shape:

```sql
insert into public.vesper_morning_sms_preferences_v1 (
  user_id,
  enabled,
  explicit_consent_at,
  explicit_consent_version,
  phone_e164,
  timezone_name,
  local_delivery_time,
  enabled_weekdays,
  recommendation_context
)
values (
  '<user-id>',
  true,
  now(),
  'vesper_morning_sms_v1',
  '+14155550123',
  'America/New_York',
  '08:00',
  array[1,2,3,4,5],
  'daily'
)
on conflict (user_id) do update
set
  enabled = excluded.enabled,
  explicit_consent_at = excluded.explicit_consent_at,
  explicit_consent_version = excluded.explicit_consent_version,
  phone_e164 = excluded.phone_e164,
  timezone_name = excluded.timezone_name,
  local_delivery_time = excluded.local_delivery_time,
  enabled_weekdays = excluded.enabled_weekdays,
  recommendation_context = excluded.recommendation_context;
```

Use only a phone number with explicit consent.

## Dry-Run Invocation

Dry run requires the scheduler secret but does not contact Textbelt and does not claim a ledger row.

```bash
curl -sS \
  -X POST "$SUPABASE_URL/functions/v1/send-vesper-morning-sms" \
  -H "Content-Type: application/json" \
  -H "x-vesper-scheduler-secret: $VESPER_MORNING_SMS_SCHEDULER_SECRET" \
  -d '{
    "dryRun": true,
    "limit": 1,
    "now": "2026-07-21T12:00:00Z",
    "userId": "<user-id>",
    "temperatureF": 72
  }'
```

The dry-run response may include a preview body for operator verification. It must not be copied into the delivery ledger.

## Safe Ledger Inspection

The ledger stores delivery metadata only. It does not store phone numbers or full SMS bodies.

```sql
select
  user_id,
  local_date,
  recommendation_context,
  status,
  provider,
  provider_message_id,
  body_sha256,
  body_char_count,
  body_segment_count,
  safe_error_category,
  claimed_at,
  finished_at
from public.vesper_morning_sms_delivery_ledger_v1
where user_id = '<user-id>'
order by local_date desc;
```

## Scheduler Activation

Do not activate a scheduler until:

1. The migration is applied.
2. The Edge Function is deployed.
3. Secrets are set.
4. Dry-run output is verified for the opted-in test user.
5. A real Textbelt send is explicitly approved.

Recommended scheduler cadence is every 5-15 minutes. The database evaluates due status in the stored IANA timezone, so daylight-saving transitions are handled by PostgreSQL timezone data.

## Runtime Guarantees

- Calls `get_signed_in_card_contract_v7` for the canonical signed-in Today card.
- Uses the stored local date, context, and available temperature input.
- Uses the existing Solo guide placement resolver.
- Uses `resolveLayeringEligibility` for the exact 0-6 Solo-only and 7+ Layered rule.
- Requests only Smooth, Balance, and Bold layer modes.
- Never requests Wild.
- Passes persisted layer-feedback exclusions to the layer mode RPC.
- Does not invent missing layer recommendations.
- Does not persist phone numbers or full SMS bodies in the delivery ledger.
- Treats Textbelt timeout/network ambiguity as `uncertain` and does not blindly resend because the ledger has a one-user-one-local-date uniqueness boundary.
- Allows retryable pre-provider build failures, such as a transient canonical contract or collection read failure, to be reclaimed without creating a second ledger row or contacting Textbelt twice.
