begin;

create table if not exists public.layer_recommendation_feedback_v1 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('too_strong', 'too_weak', 'doesnt_work')),
  anchor_fragrance_id uuid not null references public.fragrances(id) on delete restrict,
  companion_fragrance_id uuid not null references public.fragrances(id) on delete restrict,
  recommendation_identity text,
  layer_mode text,
  lead_role text,
  companion_role text,
  ratio_label text,
  anchor_sprays integer check (anchor_sprays is null or anchor_sprays between 0 and 12),
  companion_sprays integer check (companion_sprays is null or companion_sprays between 0 and 12),
  context_key text,
  temperature numeric,
  wear_date date,
  presentation_payload jsonb not null default '{}'::jsonb,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint layer_feedback_distinct_pair_v1 check (anchor_fragrance_id <> companion_fragrance_id),
  constraint layer_feedback_layer_mode_known_v1 check (layer_mode is null or layer_mode in ('balance', 'bold', 'smooth', 'wild')),
  constraint layer_feedback_presentation_object_v1 check (jsonb_typeof(presentation_payload) = 'object'),
  constraint layer_feedback_idempotency_unique_v1 unique (user_id, idempotency_key)
);

comment on table public.layer_recommendation_feedback_v1 is
  'Append-only factual memory for user feedback on a specific displayed layered recommendation. This table stores observations only; it must not infer durable preference beliefs.';

comment on column public.layer_recommendation_feedback_v1.feedback_type is
  'Raw user correction: too_strong, too_weak, or doesnt_work. This is not an individual fragrance dislike.';

comment on column public.layer_recommendation_feedback_v1.presentation_payload is
  'Display snapshot for the corrected layer card: names, roles, ratio, mode, and lightweight presentation context. No secrets or auth data.';

create index if not exists layer_feedback_user_created_idx_v1
  on public.layer_recommendation_feedback_v1 (user_id, created_at desc);

create index if not exists layer_feedback_pair_idx_v1
  on public.layer_recommendation_feedback_v1 (user_id, anchor_fragrance_id, companion_fragrance_id, feedback_type, created_at desc);

alter table public.layer_recommendation_feedback_v1 enable row level security;

revoke all on table public.layer_recommendation_feedback_v1 from public;
revoke all on table public.layer_recommendation_feedback_v1 from anon;
revoke all on table public.layer_recommendation_feedback_v1 from authenticated;

grant select on table public.layer_recommendation_feedback_v1 to authenticated;
grant all privileges on table public.layer_recommendation_feedback_v1 to service_role;

create policy "Users read own layer feedback memory"
  on public.layer_recommendation_feedback_v1
  for select
  to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.submit_layer_recommendation_feedback_v1(
  p_user uuid,
  p_feedback_type text,
  p_anchor_fragrance_id uuid,
  p_companion_fragrance_id uuid,
  p_recommendation_identity text default null,
  p_layer_mode text default null,
  p_lead_role text default null,
  p_companion_role text default null,
  p_ratio_label text default null,
  p_anchor_sprays integer default null,
  p_companion_sprays integer default null,
  p_context text default null,
  p_temperature numeric default null,
  p_wear_date text default null,
  p_presentation_payload jsonb default '{}'::jsonb,
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
  v_feedback_type text := lower(coalesce(nullif(p_feedback_type, ''), ''));
  v_event_id uuid;
  v_inserted boolean := false;
  v_wear_date date := null;
  v_idempotency_key uuid := coalesce(p_idempotency_key, gen_random_uuid());
  v_presentation_payload jsonb := coalesce(p_presentation_payload, '{}'::jsonb);
begin
  if not (
    v_request_role = 'service_role'
    or session_user = 'postgres'
    or (v_auth_user is not null and p_user = v_auth_user)
  ) then
    raise exception 'Access denied: p_user must match auth.uid() for layer feedback.'
      using errcode = '42501';
  end if;

  if v_feedback_type not in ('too_strong', 'too_weak', 'doesnt_work') then
    raise exception 'Invalid layer feedback type: %', p_feedback_type
      using errcode = '22023';
  end if;

  if p_anchor_fragrance_id is null or p_companion_fragrance_id is null then
    raise exception 'Layer feedback requires anchor and companion fragrance IDs.'
      using errcode = '23502';
  end if;

  if p_anchor_fragrance_id = p_companion_fragrance_id then
    raise exception 'Layer feedback requires two distinct fragrances.'
      using errcode = '22023';
  end if;

  if p_layer_mode is not null
    and nullif(lower(p_layer_mode), '') is not null
    and lower(p_layer_mode) not in ('balance', 'bold', 'smooth', 'wild')
  then
    raise exception 'Invalid layer mode: %', p_layer_mode
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_presentation_payload) <> 'object' then
    raise exception 'Layer feedback presentation payload must be a JSON object.'
      using errcode = '22023';
  end if;

  if p_wear_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_wear_date := p_wear_date::date;
  end if;

  insert into public.layer_recommendation_feedback_v1 (
    user_id,
    feedback_type,
    anchor_fragrance_id,
    companion_fragrance_id,
    recommendation_identity,
    layer_mode,
    lead_role,
    companion_role,
    ratio_label,
    anchor_sprays,
    companion_sprays,
    context_key,
    temperature,
    wear_date,
    presentation_payload,
    idempotency_key
  )
  values (
    p_user,
    v_feedback_type,
    p_anchor_fragrance_id,
    p_companion_fragrance_id,
    nullif(p_recommendation_identity, ''),
    nullif(lower(coalesce(p_layer_mode, '')), ''),
    nullif(p_lead_role, ''),
    nullif(p_companion_role, ''),
    nullif(p_ratio_label, ''),
    p_anchor_sprays,
    p_companion_sprays,
    nullif(lower(coalesce(p_context, '')), ''),
    p_temperature,
    v_wear_date,
    v_presentation_payload,
    v_idempotency_key
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    v_inserted := true;
  else
    select id
    into v_event_id
    from public.layer_recommendation_feedback_v1
    where user_id = p_user
      and idempotency_key = v_idempotency_key;
  end if;

  if v_event_id is null then
    raise exception 'Layer feedback idempotency lookup failed.'
      using errcode = '23505';
  end if;

  return jsonb_build_object(
    'status', 'recorded',
    'event_id', v_event_id,
    'inserted', v_inserted,
    'feedback_type', v_feedback_type
  );
end;
$function$;

revoke all on function public.submit_layer_recommendation_feedback_v1(
  uuid, text, uuid, uuid, text, text, text, text, text, integer, integer, text, numeric, text, jsonb, uuid
) from public;
revoke all on function public.submit_layer_recommendation_feedback_v1(
  uuid, text, uuid, uuid, text, text, text, text, text, integer, integer, text, numeric, text, jsonb, uuid
) from anon;
grant execute on function public.submit_layer_recommendation_feedback_v1(
  uuid, text, uuid, uuid, text, text, text, text, text, integer, integer, text, numeric, text, jsonb, uuid
) to authenticated, service_role;

commit;
