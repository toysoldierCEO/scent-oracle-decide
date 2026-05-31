-- Enable RLS and remove direct client table access for remaining
-- user-private/event/cache surfaces that are currently not used directly
-- by the frontend. These tables remain available to service_role/admin
-- and privileged backend flows only.

alter table public.layer_wear_events enable row level security;
revoke all privileges on table public.layer_wear_events from public;
revoke all privileges on table public.layer_wear_events from anon;
revoke all privileges on table public.layer_wear_events from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.layer_wear_events to service_role;

alter table public.longevity_feedback enable row level security;
revoke all privileges on table public.longevity_feedback from public;
revoke all privileges on table public.longevity_feedback from anon;
revoke all privileges on table public.longevity_feedback from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.longevity_feedback to service_role;

alter table public.onboarding_interactions enable row level security;
revoke all privileges on table public.onboarding_interactions from public;
revoke all privileges on table public.onboarding_interactions from anon;
revoke all privileges on table public.onboarding_interactions from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.onboarding_interactions to service_role;

alter table public.user_collection_truth_cache_v1 enable row level security;
revoke all privileges on table public.user_collection_truth_cache_v1 from public;
revoke all privileges on table public.user_collection_truth_cache_v1 from anon;
revoke all privileges on table public.user_collection_truth_cache_v1 from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.user_collection_truth_cache_v1 to service_role;

alter table public.user_daily_explorations_v1 enable row level security;
revoke all privileges on table public.user_daily_explorations_v1 from public;
revoke all privileges on table public.user_daily_explorations_v1 from anon;
revoke all privileges on table public.user_daily_explorations_v1 from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.user_daily_explorations_v1 to service_role;

alter table public.wear_log enable row level security;
revoke all privileges on table public.wear_log from public;
revoke all privileges on table public.wear_log from anon;
revoke all privileges on table public.wear_log from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.wear_log to service_role;
