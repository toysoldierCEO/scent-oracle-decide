begin;

-- Harden legacy recommendation session tables as non-client direct surfaces.
-- Current beta card/recommendation flows do not directly use these tables;
-- session-id-bearing recommendation data must not be exposed through broad Data API grants.
alter table public.recommendation_sessions enable row level security;
alter table public.recommendation_session_items enable row level security;

revoke all privileges on table public.recommendation_sessions from public;
revoke all privileges on table public.recommendation_sessions from anon;
revoke all privileges on table public.recommendation_sessions from authenticated;

revoke all privileges on table public.recommendation_session_items from public;
revoke all privileges on table public.recommendation_session_items from anon;
revoke all privileges on table public.recommendation_session_items from authenticated;

grant all privileges on table public.recommendation_sessions to service_role;
grant all privileges on table public.recommendation_session_items to service_role;

commit;
