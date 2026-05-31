alter table public.fragrances enable row level security;

revoke insert, update, delete, truncate, references, trigger
on table public.fragrances
from anon, authenticated;

grant select
on table public.fragrances
to anon, authenticated;
