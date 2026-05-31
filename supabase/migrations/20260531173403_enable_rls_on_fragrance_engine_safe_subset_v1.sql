-- Harden safe fragrance intelligence internals.
--
-- Scope is intentionally limited to tables with either no live dependencies,
-- maintenance-only dependencies, or SECURITY DEFINER owner-backed reads.
-- No policies are added: these surfaces are treated as RPC/admin-only for
-- direct table access.

alter table public.fragrance_accords_stage enable row level security;

revoke all privileges on table public.fragrance_accords_stage from public;
revoke all privileges on table public.fragrance_accords_stage from anon;
revoke all privileges on table public.fragrance_accords_stage from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_accords_stage to service_role;

alter table public.fragrance_axes_backup enable row level security;

revoke all privileges on table public.fragrance_axes_backup from public;
revoke all privileges on table public.fragrance_axes_backup from anon;
revoke all privileges on table public.fragrance_axes_backup from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_axes_backup to service_role;

alter table public.fragrance_concentration_fixes enable row level security;

revoke all privileges on table public.fragrance_concentration_fixes from public;
revoke all privileges on table public.fragrance_concentration_fixes from anon;
revoke all privileges on table public.fragrance_concentration_fixes from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_concentration_fixes to service_role;

alter table public.fragrance_emotion_tags enable row level security;

revoke all privileges on table public.fragrance_emotion_tags from public;
revoke all privileges on table public.fragrance_emotion_tags from anon;
revoke all privileges on table public.fragrance_emotion_tags from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_emotion_tags to service_role;

alter table public.fragrance_family_key_fixes enable row level security;

revoke all privileges on table public.fragrance_family_key_fixes from public;
revoke all privileges on table public.fragrance_family_key_fixes from anon;
revoke all privileges on table public.fragrance_family_key_fixes from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_family_key_fixes to service_role;

alter table public.fragrance_material_tags enable row level security;

revoke all privileges on table public.fragrance_material_tags from public;
revoke all privileges on table public.fragrance_material_tags from anon;
revoke all privileges on table public.fragrance_material_tags from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_material_tags to service_role;

alter table public.fragrance_notes_stage enable row level security;

revoke all privileges on table public.fragrance_notes_stage from public;
revoke all privileges on table public.fragrance_notes_stage from anon;
revoke all privileges on table public.fragrance_notes_stage from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_notes_stage to service_role;

alter table public.fragrance_phase_vectors enable row level security;

revoke all privileges on table public.fragrance_phase_vectors from public;
revoke all privileges on table public.fragrance_phase_vectors from anon;
revoke all privileges on table public.fragrance_phase_vectors from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_phase_vectors to service_role;

alter table public.fragrance_similarity enable row level security;

revoke all privileges on table public.fragrance_similarity from public;
revoke all privileges on table public.fragrance_similarity from anon;
revoke all privileges on table public.fragrance_similarity from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_similarity to service_role;

alter table public.fragrance_situation_tags enable row level security;

revoke all privileges on table public.fragrance_situation_tags from public;
revoke all privileges on table public.fragrance_situation_tags from anon;
revoke all privileges on table public.fragrance_situation_tags from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_situation_tags to service_role;

alter table public.fragrance_situations enable row level security;

revoke all privileges on table public.fragrance_situations from public;
revoke all privileges on table public.fragrance_situations from anon;
revoke all privileges on table public.fragrance_situations from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_situations to service_role;

alter table public.fragrance_texture_tags enable row level security;

revoke all privileges on table public.fragrance_texture_tags from public;
revoke all privileges on table public.fragrance_texture_tags from anon;
revoke all privileges on table public.fragrance_texture_tags from authenticated;

grant select, insert, update, delete, truncate, references, trigger on table public.fragrance_texture_tags to service_role;
