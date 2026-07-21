begin;

create table if not exists public.daily_layer_wear_memory_v1 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wear_date date not null,
  anchor_fragrance_id uuid not null references public.fragrances(id) on delete restrict,
  companion_fragrance_id uuid not null references public.fragrances(id) on delete restrict,
  lead_fragrance_id uuid not null references public.fragrances(id) on delete restrict,
  accent_fragrance_id uuid not null references public.fragrances(id) on delete restrict,
  layer_mode text not null,
  ratio_label text,
  anchor_sprays integer check (anchor_sprays is null or anchor_sprays between 0 and 12),
  companion_sprays integer check (companion_sprays is null or companion_sprays between 0 and 12),
  placement jsonb not null default '{}'::jsonb,
  context_key text,
  temperature numeric,
  recommendation_identity text,
  presentation_payload jsonb not null default '{}'::jsonb,
  acceptance_source text not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint daily_layer_memory_distinct_pair_v1 check (anchor_fragrance_id <> companion_fragrance_id),
  constraint daily_layer_memory_distinct_roles_v1 check (lead_fragrance_id <> accent_fragrance_id),
  constraint daily_layer_memory_lead_in_pair_v1 check (
    lead_fragrance_id = anchor_fragrance_id
    or lead_fragrance_id = companion_fragrance_id
  ),
  constraint daily_layer_memory_accent_in_pair_v1 check (
    accent_fragrance_id = anchor_fragrance_id
    or accent_fragrance_id = companion_fragrance_id
  ),
  constraint daily_layer_memory_layer_mode_known_v1 check (layer_mode in ('balance', 'bold', 'smooth', 'wild')),
  constraint daily_layer_memory_placement_object_v1 check (jsonb_typeof(placement) = 'object'),
  constraint daily_layer_memory_presentation_object_v1 check (jsonb_typeof(presentation_payload) = 'object'),
  constraint daily_layer_memory_acceptance_source_known_v1 check (
    acceptance_source in ('layered_double_tap_lock', 'layer_card_wear_confirmed', 'today_card_accept')
  ),
  constraint daily_layer_memory_idempotency_unique_v1 unique (user_id, idempotency_key)
);

comment on table public.daily_layer_wear_memory_v1 is
  'Append-only factual memory for layered recommendations the user positively confirmed wearing. This table stores observations only; it must not infer durable preference beliefs.';

comment on column public.daily_layer_wear_memory_v1.presentation_payload is
  'Display snapshot for the worn layer card: names, roles, mode, ratio, spray counts, placement, and recommendation context. No preference conclusions.';

comment on column public.daily_layer_wear_memory_v1.acceptance_source is
  'Factual source of positive confirmation. This records that the user wore the recommendation; viewing, skipping, and negative feedback do not write here.';

create index if not exists daily_layer_memory_user_created_idx_v1
  on public.daily_layer_wear_memory_v1 (user_id, created_at desc);

create index if not exists daily_layer_memory_pair_idx_v1
  on public.daily_layer_wear_memory_v1 (user_id, anchor_fragrance_id, companion_fragrance_id, layer_mode, created_at desc);

create index if not exists daily_layer_memory_recommendation_idx_v1
  on public.daily_layer_wear_memory_v1 (user_id, recommendation_identity, created_at desc);

alter table public.daily_layer_wear_memory_v1 enable row level security;

revoke all on table public.daily_layer_wear_memory_v1 from public;
revoke all on table public.daily_layer_wear_memory_v1 from anon;
revoke all on table public.daily_layer_wear_memory_v1 from authenticated;

grant select on table public.daily_layer_wear_memory_v1 to authenticated;
grant all privileges on table public.daily_layer_wear_memory_v1 to service_role;

create policy "Users read own daily layer wear memory"
  on public.daily_layer_wear_memory_v1
  for select
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.submit_daily_layer_wear_memory_v1(
  p_user uuid,
  p_wear_date text,
  p_anchor_fragrance_id uuid,
  p_companion_fragrance_id uuid,
  p_lead_fragrance_id uuid,
  p_accent_fragrance_id uuid,
  p_layer_mode text,
  p_ratio_label text default null,
  p_anchor_sprays integer default null,
  p_companion_sprays integer default null,
  p_placement jsonb default '{}'::jsonb,
  p_context text default null,
  p_temperature numeric default null,
  p_recommendation_identity text default null,
  p_presentation_payload jsonb default '{}'::jsonb,
  p_acceptance_source text default 'layered_double_tap_lock',
  p_idempotency_key uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_auth_user uuid := auth.uid();
  v_request_role text := nullif(current_setting('request.jwt.claim.role', true), '');
  v_layer_mode text := lower(coalesce(nullif(p_layer_mode, ''), ''));
  v_acceptance_source text := lower(coalesce(nullif(p_acceptance_source, ''), ''));
  v_event_id uuid;
  v_inserted boolean := false;
  v_wear_date date;
  v_idempotency_key uuid := coalesce(p_idempotency_key, gen_random_uuid());
  v_placement jsonb := coalesce(p_placement, '{}'::jsonb);
  v_presentation_payload jsonb := coalesce(p_presentation_payload, '{}'::jsonb);
begin
  if not (
    v_request_role = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user = v_auth_user)
  ) then
    raise exception 'Access denied: p_user must match auth.uid() for daily layer memory.'
      using errcode = '42501';
  end if;

  if p_wear_date is null or p_wear_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Daily layer memory requires an ISO wear date.'
      using errcode = '22023';
  end if;
  v_wear_date := p_wear_date::date;

  if p_anchor_fragrance_id is null
    or p_companion_fragrance_id is null
    or p_lead_fragrance_id is null
    or p_accent_fragrance_id is null
  then
    raise exception 'Daily layer memory requires anchor, companion, lead, and accent fragrance IDs.'
      using errcode = '23502';
  end if;

  if p_anchor_fragrance_id = p_companion_fragrance_id then
    raise exception 'Daily layer memory requires two distinct paired fragrances.'
      using errcode = '22023';
  end if;

  if p_lead_fragrance_id = p_accent_fragrance_id then
    raise exception 'Daily layer memory requires distinct lead and accent fragrances.'
      using errcode = '22023';
  end if;

  if p_lead_fragrance_id not in (p_anchor_fragrance_id, p_companion_fragrance_id)
    or p_accent_fragrance_id not in (p_anchor_fragrance_id, p_companion_fragrance_id)
  then
    raise exception 'Daily layer memory lead and accent must match the displayed pair.'
      using errcode = '22023';
  end if;

  if v_layer_mode not in ('balance', 'bold', 'smooth', 'wild') then
    raise exception 'Invalid daily layer memory mode: %', p_layer_mode
      using errcode = '22023';
  end if;

  if v_acceptance_source not in ('layered_double_tap_lock', 'layer_card_wear_confirmed', 'today_card_accept') then
    raise exception 'Invalid daily layer memory acceptance source: %', p_acceptance_source
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_placement) <> 'object' then
    raise exception 'Daily layer memory placement must be a JSON object.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_presentation_payload) <> 'object' then
    raise exception 'Daily layer memory presentation payload must be a JSON object.'
      using errcode = '22023';
  end if;

  insert into public.daily_layer_wear_memory_v1 (
    user_id,
    wear_date,
    anchor_fragrance_id,
    companion_fragrance_id,
    lead_fragrance_id,
    accent_fragrance_id,
    layer_mode,
    ratio_label,
    anchor_sprays,
    companion_sprays,
    placement,
    context_key,
    temperature,
    recommendation_identity,
    presentation_payload,
    acceptance_source,
    idempotency_key
  )
  values (
    p_user,
    v_wear_date,
    p_anchor_fragrance_id,
    p_companion_fragrance_id,
    p_lead_fragrance_id,
    p_accent_fragrance_id,
    v_layer_mode,
    nullif(p_ratio_label, ''),
    p_anchor_sprays,
    p_companion_sprays,
    v_placement,
    nullif(lower(coalesce(p_context, '')), ''),
    p_temperature,
    nullif(p_recommendation_identity, ''),
    v_presentation_payload,
    v_acceptance_source,
    v_idempotency_key
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    v_inserted := true;
  else
    select id
    into v_event_id
    from public.daily_layer_wear_memory_v1
    where user_id = p_user
      and idempotency_key = v_idempotency_key;
  end if;

  if v_event_id is null then
    raise exception 'Daily layer memory idempotency lookup failed.'
      using errcode = '23505';
  end if;

  return jsonb_build_object(
    'status', 'recorded',
    'event_id', v_event_id,
    'inserted', v_inserted,
    'layer_mode', v_layer_mode
  );
end;
$function$;

revoke all on function public.submit_daily_layer_wear_memory_v1(
  uuid, text, uuid, uuid, uuid, uuid, text, text, integer, integer, jsonb, text, numeric, text, jsonb, text, uuid
) from public;
revoke all on function public.submit_daily_layer_wear_memory_v1(
  uuid, text, uuid, uuid, uuid, uuid, text, text, integer, integer, jsonb, text, numeric, text, jsonb, text, uuid
) from anon;
grant execute on function public.submit_daily_layer_wear_memory_v1(
  uuid, text, uuid, uuid, uuid, uuid, text, text, integer, integer, jsonb, text, numeric, text, jsonb, text, uuid
) to authenticated, service_role;

commit;
