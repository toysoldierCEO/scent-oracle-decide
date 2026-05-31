begin;

-- Harden legacy/user-owned saved layer and recipe tables as non-client direct surfaces.
-- Current app paths do not directly read/write these tables from the frontend;
-- guarded backend/profile helpers may still read them while direct Data API access is closed.
alter table public.saved_layers enable row level security;
alter table public.saved_layer_combos enable row level security;
alter table public.saved_recipes enable row level security;

revoke all privileges on table public.saved_layers from public;
revoke all privileges on table public.saved_layers from anon;
revoke all privileges on table public.saved_layers from authenticated;

revoke all privileges on table public.saved_layer_combos from public;
revoke all privileges on table public.saved_layer_combos from anon;
revoke all privileges on table public.saved_layer_combos from authenticated;

revoke all privileges on table public.saved_recipes from public;
revoke all privileges on table public.saved_recipes from anon;
revoke all privileges on table public.saved_recipes from authenticated;

grant all privileges on table public.saved_layers to service_role;
grant all privileges on table public.saved_layer_combos to service_role;
grant all privileges on table public.saved_recipes to service_role;

commit;
