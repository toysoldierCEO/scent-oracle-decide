begin;

-- Keep signed-in day memory as a direct signed-in frontend table, but remove
-- broad exposed-role privileges that are not required by the self-only RLS
-- policies already installed on this table.
revoke all privileges on table public.odara_signed_in_day_memory from public;
revoke all privileges on table public.odara_signed_in_day_memory from anon;
revoke all privileges on table public.odara_signed_in_day_memory from authenticated;

grant select, insert, update, delete on table public.odara_signed_in_day_memory to authenticated;
grant all privileges on table public.odara_signed_in_day_memory to service_role;

commit;
