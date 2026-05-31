begin;

-- Harden user event tables as RPC-only surfaces. The app writes these events
-- through guarded SECURITY DEFINER RPCs; direct client table access is not
-- required and should not expose private event history.
alter table public.wear_events enable row level security;
alter table public.pick_skip_events enable row level security;

revoke all privileges on table public.wear_events from public;
revoke all privileges on table public.wear_events from anon;
revoke all privileges on table public.wear_events from authenticated;

revoke all privileges on table public.pick_skip_events from public;
revoke all privileges on table public.pick_skip_events from anon;
revoke all privileges on table public.pick_skip_events from authenticated;

grant all privileges on table public.wear_events to service_role;
grant all privileges on table public.pick_skip_events to service_role;

commit;
