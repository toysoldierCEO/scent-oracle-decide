-- Enable RLS on recipe / culinary / search-rule tables.
--
-- Global recipe support/rule tables remain public-readable for existing
-- app/RPC/view compatibility, but all client writes are removed.
-- User-owned culinary staging/target tables are authenticated self-only.

alter table public.culinary_category_normalization_rules enable row level security;

drop policy if exists culinary_category_normalization_rules_public_read
on public.culinary_category_normalization_rules;

create policy culinary_category_normalization_rules_public_read
on public.culinary_category_normalization_rules
for select
to anon, authenticated
using (true);

revoke all privileges on table public.culinary_category_normalization_rules from public;
revoke all privileges on table public.culinary_category_normalization_rules from anon;
revoke all privileges on table public.culinary_category_normalization_rules from authenticated;

grant select on table public.culinary_category_normalization_rules to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_category_normalization_rules to service_role;

alter table public.culinary_category_rules enable row level security;

drop policy if exists culinary_category_rules_public_read
on public.culinary_category_rules;

create policy culinary_category_rules_public_read
on public.culinary_category_rules
for select
to anon, authenticated
using (true);

revoke all privileges on table public.culinary_category_rules from public;
revoke all privileges on table public.culinary_category_rules from anon;
revoke all privileges on table public.culinary_category_rules from authenticated;

grant select on table public.culinary_category_rules to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_category_rules to service_role;

alter table public.culinary_exact_dish_rules enable row level security;

drop policy if exists culinary_exact_dish_rules_public_read
on public.culinary_exact_dish_rules;

create policy culinary_exact_dish_rules_public_read
on public.culinary_exact_dish_rules
for select
to anon, authenticated
using (true);

revoke all privileges on table public.culinary_exact_dish_rules from public;
revoke all privileges on table public.culinary_exact_dish_rules from anon;
revoke all privileges on table public.culinary_exact_dish_rules from authenticated;

grant select on table public.culinary_exact_dish_rules to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_exact_dish_rules to service_role;

alter table public.culinary_note_map enable row level security;

drop policy if exists culinary_note_map_public_read
on public.culinary_note_map;

create policy culinary_note_map_public_read
on public.culinary_note_map
for select
to anon, authenticated
using (true);

revoke all privileges on table public.culinary_note_map from public;
revoke all privileges on table public.culinary_note_map from anon;
revoke all privileges on table public.culinary_note_map from authenticated;

grant select on table public.culinary_note_map to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_note_map to service_role;

alter table public.culinary_note_rules enable row level security;

drop policy if exists culinary_note_rules_public_read
on public.culinary_note_rules;

create policy culinary_note_rules_public_read
on public.culinary_note_rules
for select
to anon, authenticated
using (true);

revoke all privileges on table public.culinary_note_rules from public;
revoke all privileges on table public.culinary_note_rules from anon;
revoke all privileges on table public.culinary_note_rules from authenticated;

grant select on table public.culinary_note_rules to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_note_rules to service_role;

alter table public.culinary_overrides enable row level security;

drop policy if exists culinary_overrides_public_read
on public.culinary_overrides;

create policy culinary_overrides_public_read
on public.culinary_overrides
for select
to anon, authenticated
using (true);

revoke all privileges on table public.culinary_overrides from public;
revoke all privileges on table public.culinary_overrides from anon;
revoke all privileges on table public.culinary_overrides from authenticated;

grant select on table public.culinary_overrides to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_overrides to service_role;

alter table public.culinary_recipe_templates enable row level security;

drop policy if exists culinary_recipe_templates_public_read
on public.culinary_recipe_templates;

create policy culinary_recipe_templates_public_read
on public.culinary_recipe_templates
for select
to anon, authenticated
using (true);

revoke all privileges on table public.culinary_recipe_templates from public;
revoke all privileges on table public.culinary_recipe_templates from anon;
revoke all privileges on table public.culinary_recipe_templates from authenticated;

grant select on table public.culinary_recipe_templates to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_recipe_templates to service_role;

alter table public.culinary_reject_term_policy enable row level security;

drop policy if exists culinary_reject_term_policy_public_read
on public.culinary_reject_term_policy;

create policy culinary_reject_term_policy_public_read
on public.culinary_reject_term_policy
for select
to anon, authenticated
using (true);

revoke all privileges on table public.culinary_reject_term_policy from public;
revoke all privileges on table public.culinary_reject_term_policy from anon;
revoke all privileges on table public.culinary_reject_term_policy from authenticated;

grant select on table public.culinary_reject_term_policy to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_reject_term_policy to service_role;

alter table public.culinary_score_thresholds enable row level security;

drop policy if exists culinary_score_thresholds_public_read
on public.culinary_score_thresholds;

create policy culinary_score_thresholds_public_read
on public.culinary_score_thresholds
for select
to anon, authenticated
using (true);

revoke all privileges on table public.culinary_score_thresholds from public;
revoke all privileges on table public.culinary_score_thresholds from anon;
revoke all privileges on table public.culinary_score_thresholds from authenticated;

grant select on table public.culinary_score_thresholds to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_score_thresholds to service_role;

alter table public.culinary_signal_normalization_rules enable row level security;

drop policy if exists culinary_signal_normalization_rules_public_read
on public.culinary_signal_normalization_rules;

create policy culinary_signal_normalization_rules_public_read
on public.culinary_signal_normalization_rules
for select
to anon, authenticated
using (true);

revoke all privileges on table public.culinary_signal_normalization_rules from public;
revoke all privileges on table public.culinary_signal_normalization_rules from anon;
revoke all privileges on table public.culinary_signal_normalization_rules from authenticated;

grant select on table public.culinary_signal_normalization_rules to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_signal_normalization_rules to service_role;

alter table public.recipe_validation_anchors enable row level security;

drop policy if exists recipe_validation_anchors_public_read
on public.recipe_validation_anchors;

create policy recipe_validation_anchors_public_read
on public.recipe_validation_anchors
for select
to anon, authenticated
using (true);

revoke all privileges on table public.recipe_validation_anchors from public;
revoke all privileges on table public.recipe_validation_anchors from anon;
revoke all privileges on table public.recipe_validation_anchors from authenticated;

grant select on table public.recipe_validation_anchors to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.recipe_validation_anchors to service_role;

alter table public.recipes enable row level security;

drop policy if exists recipes_public_read
on public.recipes;

create policy recipes_public_read
on public.recipes
for select
to anon, authenticated
using (true);

revoke all privileges on table public.recipes from public;
revoke all privileges on table public.recipes from anon;
revoke all privileges on table public.recipes from authenticated;

grant select on table public.recipes to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.recipes to service_role;

alter table public.search_term_canonical_rules enable row level security;

drop policy if exists search_term_canonical_rules_public_read
on public.search_term_canonical_rules;

create policy search_term_canonical_rules_public_read
on public.search_term_canonical_rules
for select
to anon, authenticated
using (true);

revoke all privileges on table public.search_term_canonical_rules from public;
revoke all privileges on table public.search_term_canonical_rules from anon;
revoke all privileges on table public.search_term_canonical_rules from authenticated;

grant select on table public.search_term_canonical_rules to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.search_term_canonical_rules to service_role;

alter table public.culinary_recipe_name_stage enable row level security;

drop policy if exists culinary_recipe_name_stage_self_select
on public.culinary_recipe_name_stage;

drop policy if exists culinary_recipe_name_stage_self_insert
on public.culinary_recipe_name_stage;

drop policy if exists culinary_recipe_name_stage_self_update
on public.culinary_recipe_name_stage;

drop policy if exists culinary_recipe_name_stage_self_delete
on public.culinary_recipe_name_stage;

drop policy if exists culinary_recipe_name_stage_self_access
on public.culinary_recipe_name_stage;

create policy culinary_recipe_name_stage_self_select
on public.culinary_recipe_name_stage
for select
to authenticated
using (auth.uid() = user_id);

create policy culinary_recipe_name_stage_self_insert
on public.culinary_recipe_name_stage
for insert
to authenticated
with check (auth.uid() = user_id);

create policy culinary_recipe_name_stage_self_update
on public.culinary_recipe_name_stage
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy culinary_recipe_name_stage_self_delete
on public.culinary_recipe_name_stage
for delete
to authenticated
using (auth.uid() = user_id);

revoke all privileges on table public.culinary_recipe_name_stage from public;
revoke all privileges on table public.culinary_recipe_name_stage from anon;
revoke all privileges on table public.culinary_recipe_name_stage from authenticated;

grant select, insert, update, delete on table public.culinary_recipe_name_stage to authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_recipe_name_stage to service_role;

alter table public.culinary_recipe_targets enable row level security;

drop policy if exists culinary_recipe_targets_self_select
on public.culinary_recipe_targets;

drop policy if exists culinary_recipe_targets_self_insert
on public.culinary_recipe_targets;

drop policy if exists culinary_recipe_targets_self_update
on public.culinary_recipe_targets;

drop policy if exists culinary_recipe_targets_self_delete
on public.culinary_recipe_targets;

drop policy if exists culinary_recipe_targets_self_access
on public.culinary_recipe_targets;

create policy culinary_recipe_targets_self_select
on public.culinary_recipe_targets
for select
to authenticated
using (auth.uid() = user_id);

create policy culinary_recipe_targets_self_insert
on public.culinary_recipe_targets
for insert
to authenticated
with check (auth.uid() = user_id);

create policy culinary_recipe_targets_self_update
on public.culinary_recipe_targets
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy culinary_recipe_targets_self_delete
on public.culinary_recipe_targets
for delete
to authenticated
using (auth.uid() = user_id);

revoke all privileges on table public.culinary_recipe_targets from public;
revoke all privileges on table public.culinary_recipe_targets from anon;
revoke all privileges on table public.culinary_recipe_targets from authenticated;

grant select, insert, update, delete on table public.culinary_recipe_targets to authenticated;
grant select, insert, update, delete, truncate, references, trigger on table public.culinary_recipe_targets to service_role;
