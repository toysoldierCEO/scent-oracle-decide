begin;

create table if not exists public.vesper_morning_sms_preferences_v1 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  explicit_consent_at timestamptz,
  explicit_consent_version text,
  phone_e164 text,
  timezone_name text not null default 'America/New_York',
  local_delivery_time time not null default '08:00',
  enabled_weekdays integer[] not null default array[1,2,3,4,5,6,7],
  recommendation_context text not null default 'daily',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vesper_sms_phone_e164_v1 check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint vesper_sms_enabled_requires_consent_v1 check (
    enabled = false
    or (
      explicit_consent_at is not null
      and nullif(trim(coalesce(explicit_consent_version, '')), '') is not null
      and phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
    )
  ),
  constraint vesper_sms_timezone_name_present_v1 check (
    nullif(trim(timezone_name), '') is not null
  ),
  constraint vesper_sms_weekdays_valid_v1 check (
    cardinality(enabled_weekdays) between 1 and 7
    and enabled_weekdays <@ array[1,2,3,4,5,6,7]
  ),
  constraint vesper_sms_context_valid_v1 check (
    recommendation_context in ('daily', 'work', 'date', 'hangout')
  )
);

comment on table public.vesper_morning_sms_preferences_v1 is
  'Opt-in Vesper Morning SMS preferences. phone_e164 is sensitive PII and must not be logged.';

comment on column public.vesper_morning_sms_preferences_v1.phone_e164 is
  'Validated E.164 phone number. Treat as sensitive PII; never mirror into delivery ledger or logs.';

create or replace function public.touch_vesper_morning_sms_preferences_updated_at_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists touch_vesper_morning_sms_preferences_updated_at_v1
  on public.vesper_morning_sms_preferences_v1;

create trigger touch_vesper_morning_sms_preferences_updated_at_v1
before update on public.vesper_morning_sms_preferences_v1
for each row execute function public.touch_vesper_morning_sms_preferences_updated_at_v1();

alter table public.vesper_morning_sms_preferences_v1 enable row level security;

revoke all on table public.vesper_morning_sms_preferences_v1 from public;
revoke all on table public.vesper_morning_sms_preferences_v1 from anon;
revoke all on table public.vesper_morning_sms_preferences_v1 from authenticated;

grant select, insert, update on table public.vesper_morning_sms_preferences_v1 to authenticated;
grant all privileges on table public.vesper_morning_sms_preferences_v1 to service_role;

drop policy if exists "Users read own Vesper morning SMS preferences"
  on public.vesper_morning_sms_preferences_v1;
create policy "Users read own Vesper morning SMS preferences"
  on public.vesper_morning_sms_preferences_v1
  for select
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users insert own Vesper morning SMS preferences"
  on public.vesper_morning_sms_preferences_v1;
create policy "Users insert own Vesper morning SMS preferences"
  on public.vesper_morning_sms_preferences_v1
  for insert
  to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users update own Vesper morning SMS preferences"
  on public.vesper_morning_sms_preferences_v1;
create policy "Users update own Vesper morning SMS preferences"
  on public.vesper_morning_sms_preferences_v1
  for update
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create table if not exists public.vesper_morning_sms_delivery_ledger_v1 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  timezone_name text not null,
  local_delivery_time time not null,
  recommendation_context text not null,
  status text not null default 'claimed',
  claim_token uuid not null default gen_random_uuid(),
  provider text,
  provider_message_id text,
  body_sha256 text,
  body_char_count integer,
  body_segment_count integer,
  safe_error_category text,
  dry_run boolean not null default false,
  claimed_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vesper_sms_delivery_status_v1 check (
    status in ('claimed', 'sent', 'failed', 'uncertain', 'skipped')
  ),
  constraint vesper_sms_delivery_context_v1 check (
    recommendation_context in ('daily', 'work', 'date', 'hangout')
  ),
  constraint vesper_sms_delivery_body_hash_shape_v1 check (
    body_sha256 is null or body_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint vesper_sms_delivery_body_counts_v1 check (
    (body_char_count is null or body_char_count >= 0)
    and (body_segment_count is null or body_segment_count >= 0)
  ),
  constraint vesper_sms_delivery_once_per_day_v1 unique (user_id, local_date),
  constraint vesper_sms_delivery_claim_token_unique_v1 unique (claim_token)
);

comment on table public.vesper_morning_sms_delivery_ledger_v1 is
  'Append-only Vesper Morning SMS delivery ledger. Never stores phone numbers or full SMS bodies.';

comment on column public.vesper_morning_sms_delivery_ledger_v1.body_sha256 is
  'SHA-256 hash of the SMS body for idempotent audit only; complete SMS body is never persisted.';

create index if not exists vesper_sms_delivery_user_date_idx_v1
  on public.vesper_morning_sms_delivery_ledger_v1 (user_id, local_date desc);

create index if not exists vesper_sms_delivery_status_idx_v1
  on public.vesper_morning_sms_delivery_ledger_v1 (status, claimed_at desc);

alter table public.vesper_morning_sms_delivery_ledger_v1 enable row level security;

revoke all on table public.vesper_morning_sms_delivery_ledger_v1 from public;
revoke all on table public.vesper_morning_sms_delivery_ledger_v1 from anon;
revoke all on table public.vesper_morning_sms_delivery_ledger_v1 from authenticated;

grant select on table public.vesper_morning_sms_delivery_ledger_v1 to authenticated;
grant all privileges on table public.vesper_morning_sms_delivery_ledger_v1 to service_role;

drop policy if exists "Users read own Vesper morning SMS delivery ledger"
  on public.vesper_morning_sms_delivery_ledger_v1;
create policy "Users read own Vesper morning SMS delivery ledger"
  on public.vesper_morning_sms_delivery_ledger_v1
  for select
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.claim_due_vesper_morning_sms_v1(
  p_now timestamptz default now(),
  p_limit integer default 25,
  p_dry_run boolean default false,
  p_user_id uuid default null
)
returns table (
  claim_token uuid,
  user_id uuid,
  local_date date,
  timezone_name text,
  local_delivery_time time,
  recommendation_context text,
  phone_e164 text,
  dry_run boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_limit integer := greatest(least(coalesce(p_limit, 25), 100), 1);
  v_retryable_pre_provider_errors text[] := array[
    'canonical_contract_failed',
    'collection_eligibility_failed',
    'sms_build_failed'
  ];
begin
  if not (v_role = 'service_role' or session_user = 'postgres') then
    raise exception 'Access denied: morning SMS delivery claim requires service role.'
      using errcode = '42501';
  end if;

  if coalesce(p_dry_run, false) then
    return query
    with due as (
      select
        gen_random_uuid() as claim_token,
        pref.user_id,
        (timezone(pref.timezone_name, p_now))::date as local_date,
        pref.timezone_name,
        pref.local_delivery_time,
        pref.recommendation_context,
        pref.phone_e164,
        true as dry_run
      from public.vesper_morning_sms_preferences_v1 pref
      where pref.enabled = true
        and pref.explicit_consent_at is not null
        and nullif(trim(coalesce(pref.explicit_consent_version, '')), '') is not null
        and pref.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
        and exists (
          select 1
          from pg_timezone_names tz
          where tz.name = pref.timezone_name
        )
        and extract(isodow from timezone(pref.timezone_name, p_now))::integer = any(pref.enabled_weekdays)
        and (timezone(pref.timezone_name, p_now))::time >= pref.local_delivery_time
        and (p_user_id is null or pref.user_id = p_user_id)
        and not exists (
          select 1
          from public.vesper_morning_sms_delivery_ledger_v1 ledger
          where ledger.user_id = pref.user_id
            and ledger.local_date = (timezone(pref.timezone_name, p_now))::date
            and not (
              ledger.status = 'failed'
              and ledger.safe_error_category = any(v_retryable_pre_provider_errors)
            )
        )
      order by pref.local_delivery_time, pref.user_id
      limit v_limit
    )
    select * from due;
    return;
  end if;

  return query
  with due as (
    select
      pref.user_id,
      (timezone(pref.timezone_name, p_now))::date as local_date,
      pref.timezone_name,
      pref.local_delivery_time,
      pref.recommendation_context,
      pref.phone_e164
    from public.vesper_morning_sms_preferences_v1 pref
    where pref.enabled = true
      and pref.explicit_consent_at is not null
      and nullif(trim(coalesce(pref.explicit_consent_version, '')), '') is not null
      and pref.phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
      and exists (
        select 1
        from pg_timezone_names tz
        where tz.name = pref.timezone_name
      )
      and extract(isodow from timezone(pref.timezone_name, p_now))::integer = any(pref.enabled_weekdays)
      and (timezone(pref.timezone_name, p_now))::time >= pref.local_delivery_time
      and (p_user_id is null or pref.user_id = p_user_id)
    order by pref.local_delivery_time, pref.user_id
    limit v_limit
  ),
  claimed as (
    insert into public.vesper_morning_sms_delivery_ledger_v1 (
      user_id,
      local_date,
      timezone_name,
      local_delivery_time,
      recommendation_context,
      status,
      dry_run
    )
    select
      due.user_id,
      due.local_date,
      due.timezone_name,
      due.local_delivery_time,
      due.recommendation_context,
      'claimed',
      false
    from due
    on conflict (user_id, local_date) do update
    set
      status = 'claimed',
      claim_token = gen_random_uuid(),
      provider = null,
      provider_message_id = null,
      body_sha256 = null,
      body_char_count = null,
      body_segment_count = null,
      safe_error_category = null,
      dry_run = false,
      claimed_at = now(),
      finished_at = null,
      updated_at = now()
    where public.vesper_morning_sms_delivery_ledger_v1.status = 'failed'
      and public.vesper_morning_sms_delivery_ledger_v1.safe_error_category = any(v_retryable_pre_provider_errors)
    returning
      public.vesper_morning_sms_delivery_ledger_v1.claim_token,
      public.vesper_morning_sms_delivery_ledger_v1.user_id,
      public.vesper_morning_sms_delivery_ledger_v1.local_date,
      public.vesper_morning_sms_delivery_ledger_v1.timezone_name,
      public.vesper_morning_sms_delivery_ledger_v1.local_delivery_time,
      public.vesper_morning_sms_delivery_ledger_v1.recommendation_context,
      public.vesper_morning_sms_delivery_ledger_v1.dry_run
  )
  select
    claimed.claim_token,
    claimed.user_id,
    claimed.local_date,
    claimed.timezone_name,
    claimed.local_delivery_time,
    claimed.recommendation_context,
    due.phone_e164,
    claimed.dry_run
  from claimed
  join due
    on due.user_id = claimed.user_id
   and due.local_date = claimed.local_date;
end;
$function$;

create or replace function public.finish_vesper_morning_sms_delivery_v1(
  p_claim_token uuid,
  p_status text,
  p_provider text default null,
  p_provider_message_id text default null,
  p_body_sha256 text default null,
  p_body_char_count integer default null,
  p_body_segment_count integer default null,
  p_safe_error_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_status text := lower(coalesce(nullif(p_status, ''), ''));
  v_row_id uuid;
begin
  if not (v_role = 'service_role' or session_user = 'postgres') then
    raise exception 'Access denied: morning SMS delivery finish requires service role.'
      using errcode = '42501';
  end if;

  if v_status not in ('sent', 'failed', 'uncertain', 'skipped') then
    raise exception 'Invalid morning SMS delivery status: %', p_status
      using errcode = '22023';
  end if;

  update public.vesper_morning_sms_delivery_ledger_v1
  set
    status = v_status,
    provider = nullif(p_provider, ''),
    provider_message_id = nullif(p_provider_message_id, ''),
    body_sha256 = nullif(p_body_sha256, ''),
    body_char_count = p_body_char_count,
    body_segment_count = p_body_segment_count,
    safe_error_category = nullif(p_safe_error_category, ''),
    finished_at = now(),
    updated_at = now()
  where claim_token = p_claim_token
    and status = 'claimed'
  returning id into v_row_id;

  if v_row_id is null then
    raise exception 'Morning SMS delivery claim was not claimable.'
      using errcode = '23505';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'delivery_id', v_row_id
  );
end;
$function$;

revoke all on function public.claim_due_vesper_morning_sms_v1(timestamptz, integer, boolean, uuid) from public;
revoke all on function public.claim_due_vesper_morning_sms_v1(timestamptz, integer, boolean, uuid) from anon;
revoke all on function public.claim_due_vesper_morning_sms_v1(timestamptz, integer, boolean, uuid) from authenticated;
grant execute on function public.claim_due_vesper_morning_sms_v1(timestamptz, integer, boolean, uuid) to service_role;

revoke all on function public.finish_vesper_morning_sms_delivery_v1(uuid, text, text, text, text, integer, integer, text) from public;
revoke all on function public.finish_vesper_morning_sms_delivery_v1(uuid, text, text, text, text, integer, integer, text) from anon;
revoke all on function public.finish_vesper_morning_sms_delivery_v1(uuid, text, text, text, text, integer, integer, text) from authenticated;
grant execute on function public.finish_vesper_morning_sms_delivery_v1(uuid, text, text, text, text, integer, integer, text) to service_role;

notify pgrst, 'reload schema';

commit;
