create table if not exists public.fragrance_family_assignment_audit_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  fragrance_name text,
  fragrance_brand text,
  old_family_key text,
  new_family_key text not null,
  evidence_source text,
  evidence_confidence numeric,
  evidence_json jsonb not null default '{}'::jsonb,
  assignment_reason text,
  assigned_by text not null default 'odara_family_completeness_task',
  created_at timestamptz not null default now()
);

alter table public.fragrance_family_assignment_audit_v1 enable row level security;

revoke all on table public.fragrance_family_assignment_audit_v1 from public;
revoke all on table public.fragrance_family_assignment_audit_v1 from anon;
revoke all on table public.fragrance_family_assignment_audit_v1 from authenticated;

grant select, insert on table public.fragrance_family_assignment_audit_v1 to service_role;

create index if not exists fragrance_family_assignment_audit_v1_fragrance_idx
  on public.fragrance_family_assignment_audit_v1 (fragrance_id, created_at desc);

create index if not exists fragrance_family_assignment_audit_v1_new_family_idx
  on public.fragrance_family_assignment_audit_v1 (new_family_key, created_at desc);

insert into public.fragrance_family_assignment_audit_v1 (
  fragrance_id,
  fragrance_name,
  fragrance_brand,
  old_family_key,
  new_family_key,
  evidence_source,
  evidence_confidence,
  evidence_json,
  assignment_reason,
  assigned_by
)
select
  f.id,
  f.name,
  f.brand,
  null,
  'sweet-gourmand',
  'canonical notes/accords + fragrance_family_suggestions_v1',
  0.9,
  jsonb_build_object(
    'retroactive', true,
    'suggested_family_key', 'sweet-gourmand',
    'suggestion_confidence', 0.9,
    'suggestion_why', 'amber, citrus, gourmand, powdery, resinous, woody'
  ),
  'retroactive audit for prior safe family assignment',
  'odara_family_completeness_task'
from public.fragrances f
where f.id = '83bf7466-cd6d-4bd6-88da-939f785cf863'::uuid
  and not exists (
    select 1
    from public.fragrance_family_assignment_audit_v1 audit
    where audit.fragrance_id = f.id
      and audit.new_family_key = 'sweet-gourmand'
      and audit.assigned_by = 'odara_family_completeness_task'
      and audit.assignment_reason = 'retroactive audit for prior safe family assignment'
  );

insert into public.fragrance_family_assignment_audit_v1 (
  fragrance_id,
  fragrance_name,
  fragrance_brand,
  old_family_key,
  new_family_key,
  evidence_source,
  evidence_confidence,
  evidence_json,
  assignment_reason,
  assigned_by
)
select
  f.id,
  f.name,
  f.brand,
  null,
  'sweet-gourmand',
  'canonical notes/accords + fragrance_family_suggestions_v1',
  0.8,
  jsonb_build_object(
    'retroactive', true,
    'suggested_family_key', 'sweet-gourmand',
    'suggestion_confidence', 0.8,
    'suggestion_why', 'amber, gourmand, resinous, woody'
  ),
  'retroactive audit for prior safe family assignment',
  'odara_family_completeness_task'
from public.fragrances f
where f.id = 'fcfc59e5-a889-497c-9e84-cf4586a2e54d'::uuid
  and not exists (
    select 1
    from public.fragrance_family_assignment_audit_v1 audit
    where audit.fragrance_id = f.id
      and audit.new_family_key = 'sweet-gourmand'
      and audit.assigned_by = 'odara_family_completeness_task'
      and audit.assignment_reason = 'retroactive audit for prior safe family assignment'
  );
