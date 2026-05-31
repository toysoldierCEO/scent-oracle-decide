begin;

-- Harden legacy/user-owned taste and profile tables as non-client direct surfaces.
-- The active app path reads taste/profile context through guarded backend RPCs;
-- direct Data API access is closed to prevent cross-user exposure.
alter table public.user_signature_profile enable row level security;
alter table public.user_taste_mode enable row level security;
alter table public.user_taste_profiles enable row level security;
alter table public.user_taste_profiles_v1 enable row level security;
alter table public.user_daily_recommendations enable row level security;
alter table public.user_seen_recommendations enable row level security;

revoke all privileges on table public.user_signature_profile from public;
revoke all privileges on table public.user_signature_profile from anon;
revoke all privileges on table public.user_signature_profile from authenticated;

revoke all privileges on table public.user_taste_mode from public;
revoke all privileges on table public.user_taste_mode from anon;
revoke all privileges on table public.user_taste_mode from authenticated;

revoke all privileges on table public.user_taste_profiles from public;
revoke all privileges on table public.user_taste_profiles from anon;
revoke all privileges on table public.user_taste_profiles from authenticated;

revoke all privileges on table public.user_taste_profiles_v1 from public;
revoke all privileges on table public.user_taste_profiles_v1 from anon;
revoke all privileges on table public.user_taste_profiles_v1 from authenticated;

revoke all privileges on table public.user_daily_recommendations from public;
revoke all privileges on table public.user_daily_recommendations from anon;
revoke all privileges on table public.user_daily_recommendations from authenticated;

revoke all privileges on table public.user_seen_recommendations from public;
revoke all privileges on table public.user_seen_recommendations from anon;
revoke all privileges on table public.user_seen_recommendations from authenticated;

grant all privileges on table public.user_signature_profile to service_role;
grant all privileges on table public.user_taste_mode to service_role;
grant all privileges on table public.user_taste_profiles to service_role;
grant all privileges on table public.user_taste_profiles_v1 to service_role;
grant all privileges on table public.user_daily_recommendations to service_role;
grant all privileges on table public.user_seen_recommendations to service_role;

commit;
