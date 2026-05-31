-- Enable RLS on active fragrance engine/canonical support tables while
-- preserving existing public read behavior for app/RPC/view compatibility.
-- Client writes are removed; service_role keeps full operator/admin access.

alter table public.fragrance_accords enable row level security;

drop policy if exists fragrance_accords_public_read on public.fragrance_accords;

create policy fragrance_accords_public_read
on public.fragrance_accords
for select
to anon, authenticated
using (true);

revoke all privileges on table public.fragrance_accords from public;
revoke all privileges on table public.fragrance_accords from anon;
revoke all privileges on table public.fragrance_accords from authenticated;

grant select on table public.fragrance_accords to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_accords to service_role;

alter table public.fragrance_bottle_intelligence enable row level security;

drop policy if exists fragrance_bottle_intelligence_public_read on public.fragrance_bottle_intelligence;

create policy fragrance_bottle_intelligence_public_read
on public.fragrance_bottle_intelligence
for select
to anon, authenticated
using (true);

revoke all privileges on table public.fragrance_bottle_intelligence from public;
revoke all privileges on table public.fragrance_bottle_intelligence from anon;
revoke all privileges on table public.fragrance_bottle_intelligence from authenticated;

grant select on table public.fragrance_bottle_intelligence to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_bottle_intelligence to service_role;

alter table public.fragrance_character_tags enable row level security;

drop policy if exists fragrance_character_tags_public_read on public.fragrance_character_tags;

create policy fragrance_character_tags_public_read
on public.fragrance_character_tags
for select
to anon, authenticated
using (true);

revoke all privileges on table public.fragrance_character_tags from public;
revoke all privileges on table public.fragrance_character_tags from anon;
revoke all privileges on table public.fragrance_character_tags from authenticated;

grant select on table public.fragrance_character_tags to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_character_tags to service_role;

alter table public.fragrance_features_v1 enable row level security;

drop policy if exists fragrance_features_v1_public_read on public.fragrance_features_v1;

create policy fragrance_features_v1_public_read
on public.fragrance_features_v1
for select
to anon, authenticated
using (true);

revoke all privileges on table public.fragrance_features_v1 from public;
revoke all privileges on table public.fragrance_features_v1 from anon;
revoke all privileges on table public.fragrance_features_v1 from authenticated;

grant select on table public.fragrance_features_v1 to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_features_v1 to service_role;

alter table public.fragrance_genome enable row level security;

drop policy if exists fragrance_genome_public_read on public.fragrance_genome;

create policy fragrance_genome_public_read
on public.fragrance_genome
for select
to anon, authenticated
using (true);

revoke all privileges on table public.fragrance_genome from public;
revoke all privileges on table public.fragrance_genome from anon;
revoke all privileges on table public.fragrance_genome from authenticated;

grant select on table public.fragrance_genome to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_genome to service_role;

alter table public.fragrance_notes enable row level security;

drop policy if exists fragrance_notes_public_read on public.fragrance_notes;

create policy fragrance_notes_public_read
on public.fragrance_notes
for select
to anon, authenticated
using (true);

revoke all privileges on table public.fragrance_notes from public;
revoke all privileges on table public.fragrance_notes from anon;
revoke all privileges on table public.fragrance_notes from authenticated;

grant select on table public.fragrance_notes to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_notes to service_role;

alter table public.fragrance_verified_notes enable row level security;

drop policy if exists fragrance_verified_notes_public_read on public.fragrance_verified_notes;

create policy fragrance_verified_notes_public_read
on public.fragrance_verified_notes
for select
to anon, authenticated
using (true);

revoke all privileges on table public.fragrance_verified_notes from public;
revoke all privileges on table public.fragrance_verified_notes from anon;
revoke all privileges on table public.fragrance_verified_notes from authenticated;

grant select on table public.fragrance_verified_notes to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_verified_notes to service_role;
