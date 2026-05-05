create table if not exists public.odara_signed_in_day_memory (
  user_id uuid not null,
  date_key text not null,
  state_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odara_signed_in_day_memory_pkey primary key (user_id, date_key),
  constraint odara_signed_in_day_memory_date_key_format
    check (date_key ~ '^\d{4}-\d{2}-\d{2}$')
);

alter table public.odara_signed_in_day_memory enable row level security;

grant select, insert, update, delete on public.odara_signed_in_day_memory to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'odara_signed_in_day_memory'
      and policyname = 'Users can view own odara day memory'
  ) then
    create policy "Users can view own odara day memory"
      on public.odara_signed_in_day_memory
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'odara_signed_in_day_memory'
      and policyname = 'Users can insert own odara day memory'
  ) then
    create policy "Users can insert own odara day memory"
      on public.odara_signed_in_day_memory
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'odara_signed_in_day_memory'
      and policyname = 'Users can update own odara day memory'
  ) then
    create policy "Users can update own odara day memory"
      on public.odara_signed_in_day_memory
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'odara_signed_in_day_memory'
      and policyname = 'Users can delete own odara day memory'
  ) then
    create policy "Users can delete own odara day memory"
      on public.odara_signed_in_day_memory
      for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;
