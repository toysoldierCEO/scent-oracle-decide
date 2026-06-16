begin;

create table if not exists public.fragrance_intake_requests_v1 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  submitted_name text not null,
  submitted_brand text,
  submitted_concentration text,
  submitted_source_url text,

  desired_status text not null default 'owned',
  request_status text not null default 'pending',
  canonical_fragrance_id uuid references public.fragrances(id),
  limited_intel boolean not null default true,

  admin_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,

  constraint fragrance_intake_requests_v1_submitted_name_check
    check (length(btrim(submitted_name)) between 2 and 160),
  constraint fragrance_intake_requests_v1_submitted_brand_check
    check (submitted_brand is null or length(btrim(submitted_brand)) between 1 and 160),
  constraint fragrance_intake_requests_v1_submitted_concentration_check
    check (submitted_concentration is null or length(btrim(submitted_concentration)) between 1 and 80),
  constraint fragrance_intake_requests_v1_submitted_source_url_check
    check (
      submitted_source_url is null
      or (
        submitted_source_url ~* '^https?://'
        and submitted_source_url !~ '[[:space:]]'
        and length(submitted_source_url) <= 1000
      )
    ),
  constraint fragrance_intake_requests_v1_desired_status_check
    check (desired_status in ('owned', 'wishlist', 'liked', 'disliked', 'tried')),
  constraint fragrance_intake_requests_v1_request_status_check
    check (request_status in (
      'pending',
      'searching',
      'needs_review',
      'matched_existing',
      'canonical_created',
      'resolved',
      'rejected'
    )),
  constraint fragrance_intake_requests_v1_admin_notes_check
    check (admin_notes is null or length(admin_notes) <= 2000),
  constraint fragrance_intake_requests_v1_canonical_status_check
    check (
      canonical_fragrance_id is null
      or request_status in ('matched_existing', 'canonical_created', 'resolved')
    ),
  constraint fragrance_intake_requests_v1_resolved_status_check
    check (
      resolved_at is null
      or request_status in ('matched_existing', 'canonical_created', 'resolved', 'rejected')
    )
);

comment on table public.fragrance_intake_requests_v1 is
  'Private user-submitted missing-fragrance intake requests. This is not canonical fragrance truth and does not write to public.fragrances.';

comment on column public.fragrance_intake_requests_v1.canonical_fragrance_id is
  'Optional link to public.fragrances after review. Pending requests must not be treated as canonical fragrances.';

comment on column public.fragrance_intake_requests_v1.limited_intel is
  'True while the request is pending or lacks canonical enrichment. Pending rows must not feed confident recommendations.';

create index if not exists fragrance_intake_requests_v1_user_status_idx
  on public.fragrance_intake_requests_v1 (user_id, request_status, created_at desc);

create index if not exists fragrance_intake_requests_v1_canonical_fragrance_idx
  on public.fragrance_intake_requests_v1 (canonical_fragrance_id)
  where canonical_fragrance_id is not null;

create index if not exists fragrance_intake_requests_v1_review_queue_idx
  on public.fragrance_intake_requests_v1 (request_status, created_at asc)
  where request_status in ('pending', 'searching', 'needs_review');

create unique index if not exists fragrance_intake_requests_v1_active_user_identity_uidx
  on public.fragrance_intake_requests_v1 (
    user_id,
    lower(btrim(submitted_name)),
    lower(btrim(coalesce(submitted_brand, ''))),
    lower(btrim(coalesce(submitted_concentration, '')))
  )
  where request_status in ('pending', 'searching', 'needs_review');

create table if not exists public.fragrance_intake_request_audit_v1 (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.fragrance_intake_requests_v1(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text not null default coalesce(auth.role(), current_user),
  event_type text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now(),

  constraint fragrance_intake_request_audit_v1_event_type_check
    check (event_type in (
      'created',
      'updated',
      'status_changed',
      'canonical_linked',
      'resolved',
      'rejected'
    ))
);

comment on table public.fragrance_intake_request_audit_v1 is
  'Audit trail for missing-fragrance intake requests and later canonical linking. It stores review history only.';

create index if not exists fragrance_intake_request_audit_v1_request_idx
  on public.fragrance_intake_request_audit_v1 (request_id, created_at desc);

create index if not exists fragrance_intake_request_audit_v1_actor_idx
  on public.fragrance_intake_request_audit_v1 (actor_user_id, created_at desc);

create or replace function public.fragrance_intake_request_audit_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_type text := 'updated';
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';

    insert into public.fragrance_intake_request_audit_v1 (
      request_id,
      actor_user_id,
      actor_role,
      event_type,
      after_snapshot
    )
    values (
      new.id,
      auth.uid(),
      coalesce(auth.role(), current_user),
      v_event_type,
      to_jsonb(new)
    );

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.canonical_fragrance_id is distinct from new.canonical_fragrance_id
      and new.canonical_fragrance_id is not null then
      v_event_type := 'canonical_linked';
    elsif old.request_status is distinct from new.request_status
      and new.request_status = 'rejected' then
      v_event_type := 'rejected';
    elsif old.request_status is distinct from new.request_status
      and new.request_status in ('matched_existing', 'canonical_created', 'resolved') then
      v_event_type := 'resolved';
    elsif old.request_status is distinct from new.request_status then
      v_event_type := 'status_changed';
    end if;

    insert into public.fragrance_intake_request_audit_v1 (
      request_id,
      actor_user_id,
      actor_role,
      event_type,
      before_snapshot,
      after_snapshot
    )
    values (
      new.id,
      auth.uid(),
      coalesce(auth.role(), current_user),
      v_event_type,
      to_jsonb(old),
      to_jsonb(new)
    );

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists fragrance_intake_requests_v1_audit_trigger on public.fragrance_intake_requests_v1;
create trigger fragrance_intake_requests_v1_audit_trigger
after insert or update on public.fragrance_intake_requests_v1
for each row
execute function public.fragrance_intake_request_audit_trigger_v1();

drop trigger if exists fragrance_intake_requests_v1_touch_updated_at on public.fragrance_intake_requests_v1;
create trigger fragrance_intake_requests_v1_touch_updated_at
before update on public.fragrance_intake_requests_v1
for each row
execute function public.set_updated_at_v1();

alter table public.fragrance_intake_requests_v1 enable row level security;
alter table public.fragrance_intake_request_audit_v1 enable row level security;

drop policy if exists fragrance_intake_requests_v1_select_own on public.fragrance_intake_requests_v1;
create policy fragrance_intake_requests_v1_select_own
on public.fragrance_intake_requests_v1
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists fragrance_intake_requests_v1_insert_own_pending on public.fragrance_intake_requests_v1;
create policy fragrance_intake_requests_v1_insert_own_pending
on public.fragrance_intake_requests_v1
for insert
to authenticated
with check (
  auth.uid() = user_id
  and request_status = 'pending'
  and canonical_fragrance_id is null
  and limited_intel = true
  and admin_notes is null
  and resolved_at is null
);

drop policy if exists fragrance_intake_requests_v1_update_own_open_safe on public.fragrance_intake_requests_v1;
create policy fragrance_intake_requests_v1_update_own_open_safe
on public.fragrance_intake_requests_v1
for update
to authenticated
using (
  auth.uid() = user_id
  and request_status = 'pending'
  and canonical_fragrance_id is null
)
with check (
  auth.uid() = user_id
  and request_status = 'pending'
  and canonical_fragrance_id is null
  and limited_intel = true
  and admin_notes is null
  and resolved_at is null
);

revoke all on table public.fragrance_intake_requests_v1 from public, anon, authenticated;
revoke all on table public.fragrance_intake_request_audit_v1 from public, anon, authenticated;

grant select (
  id,
  user_id,
  submitted_name,
  submitted_brand,
  submitted_concentration,
  submitted_source_url,
  desired_status,
  request_status,
  canonical_fragrance_id,
  limited_intel,
  created_at,
  updated_at,
  resolved_at
) on public.fragrance_intake_requests_v1 to authenticated;

grant insert (
  user_id,
  submitted_name,
  submitted_brand,
  submitted_concentration,
  submitted_source_url,
  desired_status
) on public.fragrance_intake_requests_v1 to authenticated;

grant update (
  submitted_name,
  submitted_brand,
  submitted_concentration,
  submitted_source_url,
  desired_status
) on public.fragrance_intake_requests_v1 to authenticated;

grant all on table public.fragrance_intake_requests_v1 to service_role;
grant all on table public.fragrance_intake_request_audit_v1 to service_role;

create or replace function public.create_fragrance_intake_request_v1(
  p_submitted_name text,
  p_submitted_brand text default null,
  p_submitted_concentration text default null,
  p_desired_status text default 'owned',
  p_submitted_source_url text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth_user uuid := auth.uid();
  v_name text := nullif(btrim(p_submitted_name), '');
  v_brand text := nullif(btrim(p_submitted_brand), '');
  v_concentration text := nullif(btrim(p_submitted_concentration), '');
  v_source_url text := nullif(btrim(p_submitted_source_url), '');
  v_status text := lower(coalesce(nullif(btrim(p_desired_status), ''), 'owned'));
  v_existing public.fragrance_intake_requests_v1%rowtype;
  v_row public.fragrance_intake_requests_v1%rowtype;
begin
  if v_auth_user is null then
    raise exception 'Signed-in fragrance intake requires auth.uid().';
  end if;

  if v_name is null or length(v_name) < 2 or length(v_name) > 160 then
    raise exception 'submitted_name must be between 2 and 160 characters.';
  end if;

  if v_brand is not null and length(v_brand) > 160 then
    raise exception 'submitted_brand must be 160 characters or less.';
  end if;

  if v_concentration is not null and length(v_concentration) > 80 then
    raise exception 'submitted_concentration must be 80 characters or less.';
  end if;

  if v_status not in ('owned', 'wishlist', 'liked', 'disliked', 'tried') then
    raise exception 'desired_status must be owned, wishlist, liked, disliked, or tried.';
  end if;

  if v_source_url is not null
    and (v_source_url !~* '^https?://' or v_source_url ~ '[[:space:]]' or length(v_source_url) > 1000) then
    raise exception 'submitted_source_url must be a valid http(s) URL.';
  end if;

  select r.*
  into v_existing
  from public.fragrance_intake_requests_v1 r
  where r.user_id = v_auth_user
    and lower(btrim(r.submitted_name)) = lower(v_name)
    and lower(btrim(coalesce(r.submitted_brand, ''))) = lower(coalesce(v_brand, ''))
    and lower(btrim(coalesce(r.submitted_concentration, ''))) = lower(coalesce(v_concentration, ''))
    and r.request_status in ('pending', 'searching', 'needs_review')
  order by r.created_at desc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'id', v_existing.id,
      'duplicate_active_request', true,
      'request_status', v_existing.request_status,
      'desired_status', v_existing.desired_status,
      'limited_intel', v_existing.limited_intel,
      'canonical_fragrance_id', v_existing.canonical_fragrance_id,
      'created_at', v_existing.created_at,
      'updated_at', v_existing.updated_at
    );
  end if;

  insert into public.fragrance_intake_requests_v1 (
    user_id,
    submitted_name,
    submitted_brand,
    submitted_concentration,
    submitted_source_url,
    desired_status,
    request_status,
    limited_intel
  )
  values (
    v_auth_user,
    v_name,
    v_brand,
    v_concentration,
    v_source_url,
    v_status,
    'pending',
    true
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'duplicate_active_request', false,
    'request_status', v_row.request_status,
    'desired_status', v_row.desired_status,
    'limited_intel', v_row.limited_intel,
    'canonical_fragrance_id', v_row.canonical_fragrance_id,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.get_my_fragrance_intake_requests_v1(
  p_include_resolved boolean default true,
  p_limit integer default 50
)
returns table (
  id uuid,
  submitted_name text,
  submitted_brand text,
  submitted_concentration text,
  submitted_source_url text,
  desired_status text,
  request_status text,
  canonical_fragrance_id uuid,
  limited_intel boolean,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if v_auth_user is null then
    raise exception 'Signed-in fragrance intake read requires auth.uid().';
  end if;

  return query
  select
    r.id,
    r.submitted_name,
    r.submitted_brand,
    r.submitted_concentration,
    r.submitted_source_url,
    r.desired_status,
    r.request_status,
    r.canonical_fragrance_id,
    r.limited_intel,
    r.created_at,
    r.updated_at,
    r.resolved_at
  from public.fragrance_intake_requests_v1 r
  where r.user_id = v_auth_user
    and (
      p_include_resolved
      or r.request_status not in ('matched_existing', 'canonical_created', 'resolved', 'rejected')
    )
  order by
    case when r.request_status in ('pending', 'searching', 'needs_review') then 0 else 1 end,
    r.created_at desc
  limit v_limit;
end;
$$;

revoke all on function public.create_fragrance_intake_request_v1(text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_my_fragrance_intake_requests_v1(boolean, integer)
  from public, anon, authenticated;

grant execute on function public.create_fragrance_intake_request_v1(text, text, text, text, text)
  to authenticated, service_role;
grant execute on function public.get_my_fragrance_intake_requests_v1(boolean, integer)
  to authenticated, service_role;

commit;
