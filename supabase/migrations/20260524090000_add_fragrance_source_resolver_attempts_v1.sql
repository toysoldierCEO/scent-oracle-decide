begin;

create table if not exists public.fragrance_source_resolver_attempts_v1 (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  fragrance_id uuid not null references public.fragrances (id) on delete cascade,
  actor_label text,
  mode text,
  dry_run boolean not null,
  stage_review boolean not null,
  audit_resolver_attempt boolean not null,
  target_name text,
  target_brand text,
  selected_candidate_name text,
  selected_candidate_brand text,
  selected_source_url text,
  selected_provider_key text,
  selected_provider_name text,
  selected_provider_brand text,
  identity_match_status text,
  identity_conflict_reason text,
  meaningful_target_tokens jsonb not null default '[]'::jsonb,
  candidate_tokens jsonb not null default '[]'::jsonb,
  slug_tokens jsonb not null default '[]'::jsonb,
  matched_meaningful_tokens jsonb not null default '[]'::jsonb,
  missing_meaningful_tokens jsonb not null default '[]'::jsonb,
  duplicate_provider_key text,
  duplicate_provider_reuse boolean not null default false,
  duplicate_provider_affected_ids jsonb not null default '[]'::jsonb,
  source_confidence numeric,
  provider_confidence_label text,
  proposed_notes_count integer,
  proposed_accords_count integer,
  stage_review_allowed boolean,
  stage_review_reason text,
  would_stage_review boolean,
  will_write boolean,
  updated_count integer,
  result_status text not null,
  resolver_outcome text not null,
  resolver_diagnostics jsonb not null default '{}'::jsonb,
  raw_result_summary jsonb not null default '{}'::jsonb,
  resolver_model_version text,
  function_version text,
  created_at timestamptz not null default now(),
  constraint fragrance_source_resolver_attempts_v1_result_status_check check (
    result_status = any (
      array[
        'audit_recorded'::text,
        'audit_preview'::text,
        'skipped_not_audit_mode'::text,
        'blocked_invalid_scope'::text,
        'failed'::text
      ]
    )
  ),
  constraint fragrance_source_resolver_attempts_v1_outcome_check check (
    resolver_outcome = any (
      array[
        'matched'::text,
        'no_match'::text,
        'identity_conflict'::text,
        'duplicate_provider_reuse'::text,
        'source_url_conflict'::text,
        'manual_review_needed'::text,
        'rejected_candidate'::text,
        'unknown'::text
      ]
    )
  )
);

comment on table public.fragrance_source_resolver_attempts_v1 is
  'Backend-only operational audit table for explicit source resolver attempts. Rows are diagnostics only and are not canonical source truth, enrichment staging, fragrance notes/accords, taxonomy, or recommendation evidence.';

comment on column public.fragrance_source_resolver_attempts_v1.resolver_diagnostics is
  'Safe resolver diagnostic summary from enrich-fragrances, including selected/rejected candidate reasoning. This is intended for Queue v2 blocker classification and resolver tuning only.';

comment on column public.fragrance_source_resolver_attempts_v1.raw_result_summary is
  'Small response summary proving dry-run/stage-review/write boundaries for the resolver attempt without storing provider secrets or full provider payloads.';

create index if not exists fragrance_source_resolver_attempts_v1_fragrance_created_idx
  on public.fragrance_source_resolver_attempts_v1 (fragrance_id, created_at desc);

create index if not exists fragrance_source_resolver_attempts_v1_run_idx
  on public.fragrance_source_resolver_attempts_v1 (run_id);

create index if not exists fragrance_source_resolver_attempts_v1_outcome_idx
  on public.fragrance_source_resolver_attempts_v1 (resolver_outcome);

create index if not exists fragrance_source_resolver_attempts_v1_identity_idx
  on public.fragrance_source_resolver_attempts_v1 (identity_match_status);

create index if not exists fragrance_source_resolver_attempts_v1_duplicate_idx
  on public.fragrance_source_resolver_attempts_v1 (duplicate_provider_reuse);

create index if not exists fragrance_source_resolver_attempts_v1_created_idx
  on public.fragrance_source_resolver_attempts_v1 (created_at desc);

alter table public.fragrance_source_resolver_attempts_v1 enable row level security;

revoke all on public.fragrance_source_resolver_attempts_v1 from public, anon, authenticated;
grant select, insert, update, delete on public.fragrance_source_resolver_attempts_v1 to service_role;

commit;
