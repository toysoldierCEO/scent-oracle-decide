-- Enable RLS on safe global lookup/reference tables while preserving
-- public read access for app and RPC paths. Client roles may read these
-- dictionaries, but all client writes remain blocked.

alter table public.weather_profiles enable row level security;

drop policy if exists weather_profiles_public_read on public.weather_profiles;

create policy weather_profiles_public_read
on public.weather_profiles
for select
to anon, authenticated
using (true);

revoke all privileges on table public.weather_profiles from public;
revoke all privileges on table public.weather_profiles from anon;
revoke all privileges on table public.weather_profiles from authenticated;

grant select on table public.weather_profiles to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.weather_profiles to service_role;

alter table public.family_keys enable row level security;

drop policy if exists family_keys_public_read on public.family_keys;

create policy family_keys_public_read
on public.family_keys
for select
to anon, authenticated
using (true);

revoke all privileges on table public.family_keys from public;
revoke all privileges on table public.family_keys from anon;
revoke all privileges on table public.family_keys from authenticated;

grant select on table public.family_keys to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.family_keys to service_role;

alter table public.family_keys_v1 enable row level security;

drop policy if exists family_keys_v1_public_read on public.family_keys_v1;

create policy family_keys_v1_public_read
on public.family_keys_v1
for select
to anon, authenticated
using (true);

revoke all privileges on table public.family_keys_v1 from public;
revoke all privileges on table public.family_keys_v1 from anon;
revoke all privileges on table public.family_keys_v1 from authenticated;

grant select on table public.family_keys_v1 to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.family_keys_v1 to service_role;

alter table public.accords_ref enable row level security;

drop policy if exists accords_ref_public_read on public.accords_ref;

create policy accords_ref_public_read
on public.accords_ref
for select
to anon, authenticated
using (true);

revoke all privileges on table public.accords_ref from public;
revoke all privileges on table public.accords_ref from anon;
revoke all privileges on table public.accords_ref from authenticated;

grant select on table public.accords_ref to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.accords_ref to service_role;

alter table public.acord_dictionary enable row level security;

drop policy if exists acord_dictionary_public_read on public.acord_dictionary;

create policy acord_dictionary_public_read
on public.acord_dictionary
for select
to anon, authenticated
using (true);

revoke all privileges on table public.acord_dictionary from public;
revoke all privileges on table public.acord_dictionary from anon;
revoke all privileges on table public.acord_dictionary from authenticated;

grant select on table public.acord_dictionary to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.acord_dictionary to service_role;

alter table public.character_tags enable row level security;

drop policy if exists character_tags_public_read on public.character_tags;

create policy character_tags_public_read
on public.character_tags
for select
to anon, authenticated
using (true);

revoke all privileges on table public.character_tags from public;
revoke all privileges on table public.character_tags from anon;
revoke all privileges on table public.character_tags from authenticated;

grant select on table public.character_tags to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.character_tags to service_role;
