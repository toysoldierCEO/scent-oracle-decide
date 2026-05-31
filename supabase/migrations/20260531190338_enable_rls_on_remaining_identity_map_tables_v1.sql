begin;

alter table public.curated_fragrance_candidates enable row level security;
revoke all privileges on table public.curated_fragrance_candidates from public;
revoke all privileges on table public.curated_fragrance_candidates from anon;
revoke all privileges on table public.curated_fragrance_candidates from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.curated_fragrance_candidates to service_role;

alter table public.fragrance_aliases enable row level security;
revoke all privileges on table public.fragrance_aliases from public;
revoke all privileges on table public.fragrance_aliases from anon;
revoke all privileges on table public.fragrance_aliases from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_aliases to service_role;

alter table public.fragrance_canonical_map enable row level security;
revoke all privileges on table public.fragrance_canonical_map from public;
revoke all privileges on table public.fragrance_canonical_map from anon;
revoke all privileges on table public.fragrance_canonical_map from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_canonical_map to service_role;

alter table public.fragrance_identity_redirects enable row level security;
revoke all privileges on table public.fragrance_identity_redirects from public;
revoke all privileges on table public.fragrance_identity_redirects from anon;
revoke all privileges on table public.fragrance_identity_redirects from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_identity_redirects to service_role;

alter table public.fragrance_identity_redirects_product_v1 enable row level security;
revoke all privileges on table public.fragrance_identity_redirects_product_v1 from public;
revoke all privileges on table public.fragrance_identity_redirects_product_v1 from anon;
revoke all privileges on table public.fragrance_identity_redirects_product_v1 from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_identity_redirects_product_v1 to service_role;

alter table public.fragrance_identity_redirects_v2 enable row level security;
revoke all privileges on table public.fragrance_identity_redirects_v2 from public;
revoke all privileges on table public.fragrance_identity_redirects_v2 from anon;
revoke all privileges on table public.fragrance_identity_redirects_v2 from authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_identity_redirects_v2 to service_role;

commit;
