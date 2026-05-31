begin;

-- Legacy fragrance staging/manual-map tables are admin/internal-only surfaces.
-- Direct anon/authenticated Data API access is closed; no public policies are added.

alter table public.fragella_match_overrides enable row level security;
alter table public.fragrance_manual_map enable row level security;
alter table public.fragrance_product_canonical_map enable row level security;
alter table public.fragrances_stage enable row level security;

revoke all privileges on table public.fragella_match_overrides from public;
revoke all privileges on table public.fragella_match_overrides from anon;
revoke all privileges on table public.fragella_match_overrides from authenticated;

revoke all privileges on table public.fragrance_manual_map from public;
revoke all privileges on table public.fragrance_manual_map from anon;
revoke all privileges on table public.fragrance_manual_map from authenticated;

revoke all privileges on table public.fragrance_product_canonical_map from public;
revoke all privileges on table public.fragrance_product_canonical_map from anon;
revoke all privileges on table public.fragrance_product_canonical_map from authenticated;

revoke all privileges on table public.fragrances_stage from public;
revoke all privileges on table public.fragrances_stage from anon;
revoke all privileges on table public.fragrances_stage from authenticated;

grant select, insert, update, delete, truncate, references, trigger
  on table public.fragella_match_overrides
  to service_role;

grant select, insert, update, delete, truncate, references, trigger
  on table public.fragrance_manual_map
  to service_role;

grant select, insert, update, delete, truncate, references, trigger
  on table public.fragrance_product_canonical_map
  to service_role;

grant select, insert, update, delete, truncate, references, trigger
  on table public.fragrances_stage
  to service_role;

commit;
