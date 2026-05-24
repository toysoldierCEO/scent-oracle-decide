begin;

create table if not exists public.taxonomy_queue_refresh_runs_v1 (
  id uuid primary key default gen_random_uuid(),
  actor_label text not null,
  refresh_reason text null,
  refresh_scope text not null,
  requested_ids uuid[] null,
  affected_count integer not null default 0,
  source_queue_model_version text null,
  source_view_name text not null default 'taxonomy_operationalization_queue_v2_3',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  status text not null,
  warning_count integer not null default 0,
  error_count integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint taxonomy_queue_refresh_runs_v1_scope_check check (
    refresh_scope in ('full', 'explicit_ids', 'cluster', 'unknown')
  ),
  constraint taxonomy_queue_refresh_runs_v1_status_check check (
    status in ('started', 'completed', 'failed', 'completed_with_warnings')
  )
);

create index if not exists taxonomy_queue_refresh_runs_v1_status_started_idx
  on public.taxonomy_queue_refresh_runs_v1 (status, started_at desc);

create index if not exists taxonomy_queue_refresh_runs_v1_created_idx
  on public.taxonomy_queue_refresh_runs_v1 (created_at desc);

create index if not exists taxonomy_queue_refresh_runs_v1_source_model_idx
  on public.taxonomy_queue_refresh_runs_v1 (source_queue_model_version);

alter table public.taxonomy_queue_refresh_runs_v1 enable row level security;

comment on table public.taxonomy_queue_refresh_runs_v1 is
  'Audit log for rebuilds of the current operational taxonomy queue snapshot. These rows record refresh intent, scope, completion status, warnings, and errors without mutating source truth tables.';

create table if not exists public.taxonomy_operationalization_queue_current_v1 (
  fragrance_id uuid primary key references public.fragrances(id),
  name text null,
  brand text null,
  family_key text null,
  legacy_family_key text null,
  universal_family_key text null,
  evidence_quality_state text null,
  queue_state text null,
  queue_lane text null,
  blocker_reason text null,
  recommended_next_action text null,
  product_priority_score integer not null default 0,
  product_priority_reason text null,
  taxonomy_missing_summary jsonb not null default '{}'::jsonb,
  evidence_summary jsonb not null default '{}'::jsonb,
  resolver_evidence_summary jsonb not null default '{}'::jsonb,
  canonical_identity_evidence_summary jsonb not null default '{}'::jsonb,
  canonical_identity_decision_summary jsonb not null default '{}'::jsonb,
  alias_policy_summary jsonb not null default '{}'::jsonb,
  queue_model_version text not null,
  source_queue_model_version text null,
  source_view_name text not null default 'taxonomy_operationalization_queue_v2_3',
  source_snapshot_summary jsonb not null default '{}'::jsonb,
  refresh_run_id uuid null references public.taxonomy_queue_refresh_runs_v1(id),
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists taxonomy_operationalization_queue_current_v1_queue_state_idx
  on public.taxonomy_operationalization_queue_current_v1 (queue_state);

create index if not exists taxonomy_operationalization_queue_current_v1_queue_lane_idx
  on public.taxonomy_operationalization_queue_current_v1 (queue_lane);

create index if not exists taxonomy_operationalization_queue_current_v1_evidence_quality_idx
  on public.taxonomy_operationalization_queue_current_v1 (evidence_quality_state);

create index if not exists taxonomy_operationalization_queue_current_v1_priority_idx
  on public.taxonomy_operationalization_queue_current_v1 (product_priority_score desc, fragrance_id);

create index if not exists taxonomy_operationalization_queue_current_v1_refreshed_idx
  on public.taxonomy_operationalization_queue_current_v1 (refreshed_at desc);

create index if not exists taxonomy_operationalization_queue_current_v1_model_idx
  on public.taxonomy_operationalization_queue_current_v1 (queue_model_version);

create index if not exists taxonomy_operationalization_queue_current_v1_lane_priority_idx
  on public.taxonomy_operationalization_queue_current_v1 (queue_lane, product_priority_score desc, fragrance_id);

create index if not exists taxonomy_operationalization_queue_current_v1_state_priority_idx
  on public.taxonomy_operationalization_queue_current_v1 (queue_state, product_priority_score desc, fragrance_id);

create index if not exists taxonomy_operationalization_queue_current_v1_refresh_run_idx
  on public.taxonomy_operationalization_queue_current_v1 (refresh_run_id);

drop trigger if exists taxonomy_operationalization_queue_current_v1_touch_updated_at
  on public.taxonomy_operationalization_queue_current_v1;

create trigger taxonomy_operationalization_queue_current_v1_touch_updated_at
before update on public.taxonomy_operationalization_queue_current_v1
for each row
execute function public.set_updated_at_v1();

alter table public.taxonomy_operationalization_queue_current_v1 enable row level security;

comment on table public.taxonomy_operationalization_queue_current_v1 is
  'Fast operational snapshot/cache for the taxonomy queue. It is rebuildable from public.taxonomy_operationalization_queue_v2_3, is not source truth, is not frontend payload, and does not replace source/audit views.';

comment on column public.taxonomy_operationalization_queue_current_v1.source_snapshot_summary is
  'Compact metadata captured from the source queue view at refresh time. This preserves source-model traceability without turning the snapshot into source truth.';

comment on column public.taxonomy_operationalization_queue_current_v1.alias_policy_summary is
  'Operational alias-routing summary copied from Queue v2.3 at refresh time. It does not apply aliases to app payloads, merge rows, or rewrite user history.';

create or replace function public.refresh_taxonomy_operationalization_queue_current_v1(
  p_actor_label text default 'codex_queue_current_refresh_v1',
  p_reason text default 'manual_refresh',
  p_refresh_scope text default 'full',
  p_fragrance_ids uuid[] default null
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_queue_current_refresh_v1');
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'manual_refresh');
  v_refresh_scope text := coalesce(nullif(btrim(p_refresh_scope), ''), 'full');
  v_requested_ids uuid[] := p_fragrance_ids;
  v_refresh_run_id uuid;
  v_expected_count integer := 0;
  v_staged_count integer := 0;
  v_affected_count integer := 0;
  v_warning_count integer := 0;
  v_error_count integer := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_source_queue_model_version text := null;
  v_refreshed_at timestamptz := statement_timestamp();
begin
  insert into public.taxonomy_queue_refresh_runs_v1 (
    actor_label,
    refresh_reason,
    refresh_scope,
    requested_ids,
    status,
    source_view_name,
    metadata
  )
  values (
    v_actor_label,
    v_reason,
    v_refresh_scope,
    v_requested_ids,
    'started',
    'taxonomy_operationalization_queue_v2_3',
    jsonb_build_object(
      'requested_ids_count', coalesce(cardinality(v_requested_ids), 0),
      'partial_refresh_supported', false
    )
  )
  returning id into v_refresh_run_id;

  if v_refresh_scope <> 'full' then
    v_error_count := 1;
    v_errors := jsonb_build_array(
      jsonb_build_object(
        'code', 'unsupported_refresh_scope',
        'message', 'Hybrid Queue Snapshot v1 supports full refresh only.',
        'requested_scope', v_refresh_scope
      )
    );

    update public.taxonomy_queue_refresh_runs_v1
    set
      status = 'failed',
      completed_at = statement_timestamp(),
      warning_count = v_warning_count,
      error_count = v_error_count,
      warnings = v_warnings,
      errors = v_errors,
      metadata = metadata || jsonb_build_object(
        'final_status', 'failed',
        'source_queue_model_version', v_source_queue_model_version
      )
    where id = v_refresh_run_id;

    return jsonb_build_object(
      'refresh_run_id', v_refresh_run_id,
      'status', 'failed',
      'refresh_scope', v_refresh_scope,
      'affected_count', 0,
      'source_queue_model_version', v_source_queue_model_version,
      'warnings', v_warnings,
      'errors', v_errors
    );
  end if;

  begin
    drop table if exists pg_temp.tmp_taxonomy_operationalization_queue_current_v1;

    create temporary table tmp_taxonomy_operationalization_queue_current_v1
    on commit drop
    as
    select
      q.fragrance_id,
      q.name,
      q.brand,
      q.family_key,
      q.legacy_family_key,
      q.universal_family_key,
      q.evidence_quality_state,
      q.queue_state,
      q.queue_lane,
      q.blocker_reason,
      q.recommended_next_action,
      coalesce(q.product_priority_score, 0)::integer as product_priority_score,
      q.product_priority_reason,
      coalesce(q.taxonomy_missing_summary, '{}'::jsonb) as taxonomy_missing_summary,
      coalesce(q.evidence_summary, '{}'::jsonb) as evidence_summary,
      coalesce(q.resolver_evidence_summary, '{}'::jsonb) as resolver_evidence_summary,
      coalesce(q.canonical_identity_evidence_summary, '{}'::jsonb) as canonical_identity_evidence_summary,
      coalesce(q.canonical_identity_decision_summary, '{}'::jsonb) as canonical_identity_decision_summary,
      coalesce(q.alias_policy_summary, '{}'::jsonb) as alias_policy_summary,
      'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24'::text as queue_model_version,
      q.queue_model_version as source_queue_model_version,
      'taxonomy_operationalization_queue_v2_3'::text as source_view_name,
      jsonb_build_object(
        'source_generated_at', q.generated_at,
        'source_queue_state', q.queue_state,
        'source_queue_lane', q.queue_lane,
        'has_taxonomy_missing_summary', q.taxonomy_missing_summary is not null,
        'has_evidence_summary', q.evidence_summary is not null,
        'has_resolver_evidence_summary', q.resolver_evidence_summary is not null,
        'has_canonical_identity_evidence_summary', q.canonical_identity_evidence_summary is not null,
        'has_canonical_identity_decision_summary', q.canonical_identity_decision_summary is not null,
        'has_alias_policy_summary', q.alias_policy_summary is not null
      ) as source_snapshot_summary,
      v_refresh_run_id as refresh_run_id,
      v_refreshed_at as refreshed_at,
      v_refreshed_at as created_at,
      v_refreshed_at as updated_at
    from public.taxonomy_operationalization_queue_v2_3 q;

    select count(*)::integer
    into v_expected_count
    from public.fragrances;

    select count(*)::integer
    into v_staged_count
    from tmp_taxonomy_operationalization_queue_current_v1;

    if v_staged_count = 0 then
      raise exception 'queue_current_refresh_empty_source';
    end if;

    if v_staged_count <> v_expected_count then
      raise exception 'queue_current_refresh_count_mismatch: expected %, staged %', v_expected_count, v_staged_count;
    end if;

    select min(source_queue_model_version)
    into v_source_queue_model_version
    from tmp_taxonomy_operationalization_queue_current_v1;

    if exists (
      select 1
      from tmp_taxonomy_operationalization_queue_current_v1
      group by source_queue_model_version
      having count(*) > 0
      offset 1
    ) then
      v_warning_count := 1;
      v_warnings := jsonb_build_array(
        jsonb_build_object(
          'code', 'multiple_source_queue_model_versions',
          'message', 'Queue v2.3 returned more than one source queue model version during refresh.'
        )
      );
    end if;

    delete from public.taxonomy_operationalization_queue_current_v1;

    insert into public.taxonomy_operationalization_queue_current_v1 (
      fragrance_id,
      name,
      brand,
      family_key,
      legacy_family_key,
      universal_family_key,
      evidence_quality_state,
      queue_state,
      queue_lane,
      blocker_reason,
      recommended_next_action,
      product_priority_score,
      product_priority_reason,
      taxonomy_missing_summary,
      evidence_summary,
      resolver_evidence_summary,
      canonical_identity_evidence_summary,
      canonical_identity_decision_summary,
      alias_policy_summary,
      queue_model_version,
      source_queue_model_version,
      source_view_name,
      source_snapshot_summary,
      refresh_run_id,
      refreshed_at,
      created_at,
      updated_at
    )
    select
      fragrance_id,
      name,
      brand,
      family_key,
      legacy_family_key,
      universal_family_key,
      evidence_quality_state,
      queue_state,
      queue_lane,
      blocker_reason,
      recommended_next_action,
      product_priority_score,
      product_priority_reason,
      taxonomy_missing_summary,
      evidence_summary,
      resolver_evidence_summary,
      canonical_identity_evidence_summary,
      canonical_identity_decision_summary,
      alias_policy_summary,
      queue_model_version,
      source_queue_model_version,
      source_view_name,
      source_snapshot_summary,
      refresh_run_id,
      refreshed_at,
      created_at,
      updated_at
    from tmp_taxonomy_operationalization_queue_current_v1;

    get diagnostics v_affected_count = row_count;

    update public.taxonomy_queue_refresh_runs_v1
    set
      status = case
        when v_warning_count > 0 then 'completed_with_warnings'
        else 'completed'
      end,
      completed_at = statement_timestamp(),
      affected_count = v_affected_count,
      source_queue_model_version = v_source_queue_model_version,
      warning_count = v_warning_count,
      error_count = v_error_count,
      warnings = v_warnings,
      errors = v_errors,
      metadata = metadata || jsonb_build_object(
        'expected_count', v_expected_count,
        'staged_count', v_staged_count,
        'final_status', case
          when v_warning_count > 0 then 'completed_with_warnings'
          else 'completed'
        end,
        'queue_model_version', 'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24'
      )
    where id = v_refresh_run_id;
  exception
    when others then
      v_error_count := greatest(v_error_count, 1);
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object(
          'code', 'refresh_failed',
          'message', sqlerrm,
          'sqlstate', sqlstate
        )
      );

      update public.taxonomy_queue_refresh_runs_v1
      set
        status = 'failed',
        completed_at = statement_timestamp(),
        affected_count = 0,
        source_queue_model_version = v_source_queue_model_version,
        warning_count = v_warning_count,
        error_count = v_error_count,
        warnings = v_warnings,
        errors = v_errors,
        metadata = metadata || jsonb_build_object(
          'expected_count', v_expected_count,
          'staged_count', v_staged_count,
          'final_status', 'failed',
          'queue_model_version', 'taxonomy_operationalization_queue_current_v1_snapshot_2026_05_24'
        )
      where id = v_refresh_run_id;

      return jsonb_build_object(
        'refresh_run_id', v_refresh_run_id,
        'status', 'failed',
        'refresh_scope', v_refresh_scope,
        'affected_count', 0,
        'source_queue_model_version', v_source_queue_model_version,
        'warnings', v_warnings,
        'errors', v_errors
      );
  end;

  return jsonb_build_object(
    'refresh_run_id', v_refresh_run_id,
    'status', case
      when v_warning_count > 0 then 'completed_with_warnings'
      else 'completed'
    end,
    'refresh_scope', v_refresh_scope,
    'affected_count', v_affected_count,
    'source_queue_model_version', v_source_queue_model_version,
    'warnings', v_warnings,
    'errors', v_errors
  );
end;
$function$;

comment on function public.refresh_taxonomy_operationalization_queue_current_v1(text, text, text, uuid[]) is
  'Rebuilds the fast operational taxonomy queue snapshot from public.taxonomy_operationalization_queue_v2_3. It writes only to the snapshot table and refresh-run audit table, and it does not mutate source truth tables, taxonomy, enrichment, resolver attempts, alias mappings, or frontend payloads.';

revoke all on public.taxonomy_queue_refresh_runs_v1 from public, anon, authenticated;
revoke all on public.taxonomy_operationalization_queue_current_v1 from public, anon, authenticated;
revoke all on function public.refresh_taxonomy_operationalization_queue_current_v1(text, text, text, uuid[]) from public, anon, authenticated;

grant select, insert, update, delete on public.taxonomy_queue_refresh_runs_v1 to service_role;
grant select, insert, update, delete on public.taxonomy_operationalization_queue_current_v1 to service_role;
grant execute on function public.refresh_taxonomy_operationalization_queue_current_v1(text, text, text, uuid[]) to service_role;

commit;
