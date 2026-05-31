begin;

-- Import/staging/admin pipeline tables are RPC/admin-only surfaces.
-- They should not be directly readable or writable through anon/authenticated
-- Data API roles, and they intentionally receive no public RLS policies.

alter table public.catalog_import_batches enable row level security;
alter table public.catalog_import_staging enable row level security;
alter table public.fragella_import_queue enable row level security;
alter table public.accords_import enable row level security;
alter table public.parfumo_best_match enable row level security;
alter table public.parfumo_best_match_v2 enable row level security;
alter table public.parfumo_best_match_v3 enable row level security;
alter table public.parfumo_clean enable row level security;
alter table public.parfumo_import enable row level security;
alter table public.parfumo_raw enable row level security;

revoke all privileges on table public.catalog_import_batches from public, anon, authenticated;
revoke all privileges on table public.catalog_import_staging from public, anon, authenticated;
revoke all privileges on table public.fragella_import_queue from public, anon, authenticated;
revoke all privileges on table public.accords_import from public, anon, authenticated;
revoke all privileges on table public.parfumo_best_match from public, anon, authenticated;
revoke all privileges on table public.parfumo_best_match_v2 from public, anon, authenticated;
revoke all privileges on table public.parfumo_best_match_v3 from public, anon, authenticated;
revoke all privileges on table public.parfumo_clean from public, anon, authenticated;
revoke all privileges on table public.parfumo_import from public, anon, authenticated;
revoke all privileges on table public.parfumo_raw from public, anon, authenticated;

grant all privileges on table public.catalog_import_batches to service_role;
grant all privileges on table public.catalog_import_staging to service_role;
grant all privileges on table public.fragella_import_queue to service_role;
grant all privileges on table public.accords_import to service_role;
grant all privileges on table public.parfumo_best_match to service_role;
grant all privileges on table public.parfumo_best_match_v2 to service_role;
grant all privileges on table public.parfumo_best_match_v3 to service_role;
grant all privileges on table public.parfumo_clean to service_role;
grant all privileges on table public.parfumo_import to service_role;
grant all privileges on table public.parfumo_raw to service_role;

commit;
