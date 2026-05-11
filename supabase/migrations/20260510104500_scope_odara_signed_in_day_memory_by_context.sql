alter table public.odara_signed_in_day_memory
  add column if not exists context_key text;

update public.odara_signed_in_day_memory
set context_key = lower(
  coalesce(
    nullif(trim(state_json ->> 'lockedContext'), ''),
    'daily'
  )
)
where context_key is null
   or trim(context_key) = '';

alter table public.odara_signed_in_day_memory
  alter column context_key set default 'daily';

update public.odara_signed_in_day_memory
set context_key = 'daily'
where context_key is null
   or trim(context_key) = '';

alter table public.odara_signed_in_day_memory
  alter column context_key set not null;

alter table public.odara_signed_in_day_memory
  drop constraint if exists odara_signed_in_day_memory_pkey;

alter table public.odara_signed_in_day_memory
  add constraint odara_signed_in_day_memory_pkey
  primary key (user_id, date_key, context_key);

create index if not exists odara_signed_in_day_memory_user_context_date_idx
  on public.odara_signed_in_day_memory (user_id, context_key, date_key);
