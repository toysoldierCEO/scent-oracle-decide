create table if not exists public.fragrance_text_enrichment_promotions_v1 (
  id bigint generated always as identity primary key,
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  action text not null check (action in ('promote', 'reject')),
  actor_label text not null default 'service_role',
  staged_status text,
  source_url text,
  source_confidence numeric,
  match_name text,
  match_brand text,
  before_notes text[] not null default '{}'::text[],
  before_accords text[] not null default '{}'::text[],
  after_notes text[] not null default '{}'::text[],
  after_accords text[] not null default '{}'::text[],
  enrichment_evidence_snapshot jsonb not null default '{}'::jsonb,
  refresh_result jsonb not null default '{}'::jsonb,
  result_status text not null,
  rejection_reason text,
  overwrite_existing boolean not null default false,
  function_version text not null default 'fragrance_text_enrichment_promote_v1',
  promoted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.fragrance_text_enrichment_promotions_v1 enable row level security;

revoke all on table public.fragrance_text_enrichment_promotions_v1 from public;
revoke all on table public.fragrance_text_enrichment_promotions_v1 from anon;
revoke all on table public.fragrance_text_enrichment_promotions_v1 from authenticated;

grant select, insert on table public.fragrance_text_enrichment_promotions_v1 to service_role;
grant usage, select on sequence public.fragrance_text_enrichment_promotions_v1_id_seq to service_role;

create index if not exists fragrance_text_enrichment_promotions_v1_fragrance_idx
  on public.fragrance_text_enrichment_promotions_v1 (fragrance_id, created_at desc);

create index if not exists fragrance_text_enrichment_promotions_v1_status_idx
  on public.fragrance_text_enrichment_promotions_v1 (result_status, created_at desc);

create or replace function public.promote_fragrance_text_enrichment_v1(
  p_fragrance_ids text[],
  p_actor text default 'service_role',
  p_dry_run boolean default true,
  p_allow_overwrite boolean default false,
  p_run_performance_refresh boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_function_version constant text := 'fragrance_text_enrichment_promote_v1';
  v_max_ids constant integer := 10;
  v_requested_count integer := coalesce(array_length(p_fragrance_ids, 1), 0);
  v_distinct_count integer := 0;
  v_picked integer := 0;
  v_promoted_count integer := 0;
  v_rejected_count integer := 0;
  v_refreshed_count integer := 0;
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'service_role');
  v_refresh_function_available boolean := exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'refresh_fragrance_performance_features_v1'
      and pg_get_function_identity_arguments(p.oid) = 'p_fragrance_id uuid'
  );
  v_invalid_ids text[] := '{}'::text[];
  v_missing_ids text[] := '{}'::text[];
  v_results jsonb := '[]'::jsonb;
  v_audit_id bigint;
  v_before_notes text[];
  v_before_accords text[];
  v_after_notes text[];
  v_after_accords text[];
  v_refresh_result jsonb;
  v_rejection_reason text;
  v_result_status text;
  v_should_promote boolean;
  rec record;
begin
  if v_requested_count = 0 then
    return jsonb_build_object(
      'ok', false,
      'dry_run', p_dry_run,
      'requested_count', 0,
      'distinct_requested_count', 0,
      'picked', 0,
      'results_count', 0,
      'promoted_count', 0,
      'rejected_count', 0,
      'refreshed_count', 0,
      'invalid_ids', '[]'::jsonb,
      'missing_ids', '[]'::jsonb,
      'max_ids', v_max_ids,
      'allow_overwrite', p_allow_overwrite,
      'run_performance_refresh', p_run_performance_refresh,
      'refresh_function_available', v_refresh_function_available,
      'scope_mode', 'explicit_ids',
      'function_version', v_function_version,
      'error', 'explicit fragrance IDs are required'
    );
  end if;

  with raw_ids as (
    select nullif(trim(value), '') as input_id, ord
    from unnest(coalesce(p_fragrance_ids, '{}'::text[])) with ordinality as t(value, ord)
  ),
  ordered_ids as (
    select input_id, min(ord) as ord
    from raw_ids
    where input_id is not null
    group by input_id
  )
  select count(*)::integer
  into v_distinct_count
  from ordered_ids;

  if v_distinct_count = 0 then
    return jsonb_build_object(
      'ok', false,
      'dry_run', p_dry_run,
      'requested_count', v_requested_count,
      'distinct_requested_count', 0,
      'picked', 0,
      'results_count', 0,
      'promoted_count', 0,
      'rejected_count', 0,
      'refreshed_count', 0,
      'invalid_ids', '[]'::jsonb,
      'missing_ids', '[]'::jsonb,
      'max_ids', v_max_ids,
      'allow_overwrite', p_allow_overwrite,
      'run_performance_refresh', p_run_performance_refresh,
      'refresh_function_available', v_refresh_function_available,
      'scope_mode', 'explicit_ids',
      'function_version', v_function_version,
      'error', 'explicit fragrance IDs are required'
    );
  end if;

  if v_distinct_count > v_max_ids then
    return jsonb_build_object(
      'ok', false,
      'dry_run', p_dry_run,
      'requested_count', v_requested_count,
      'distinct_requested_count', v_distinct_count,
      'picked', 0,
      'results_count', 0,
      'promoted_count', 0,
      'rejected_count', 0,
      'refreshed_count', 0,
      'invalid_ids', '[]'::jsonb,
      'missing_ids', '[]'::jsonb,
      'max_ids', v_max_ids,
      'allow_overwrite', p_allow_overwrite,
      'run_performance_refresh', p_run_performance_refresh,
      'refresh_function_available', v_refresh_function_available,
      'scope_mode', 'explicit_ids',
      'function_version', v_function_version,
      'error', format('promotion is limited to %s explicit IDs per call', v_max_ids)
    );
  end if;

  for rec in
    with raw_ids as (
      select nullif(trim(value), '') as input_id, ord
      from unnest(coalesce(p_fragrance_ids, '{}'::text[])) with ordinality as t(value, ord)
    ),
    ordered_ids as (
      select input_id, min(ord) as ord
      from raw_ids
      where input_id is not null
      group by input_id
    )
    select
      o.input_id,
      o.ord,
      case
        when o.input_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then o.input_id::uuid
        else null::uuid
      end as fragrance_id,
      f.id as existing_fragrance_id,
      f.name,
      f.brand,
      f.notes as before_notes,
      f.accords as before_accords,
      te.provider,
      te.status as staged_status,
      te.source_url,
      te.source_confidence,
      te.match_name,
      te.match_brand,
      te.proposed_family_key,
      te.concentration,
      te.notes as staged_notes,
      te.accords as staged_accords,
      te.provider_payload,
      te.last_error,
      te.last_enriched_at
    from ordered_ids o
    left join public.fragrances f
      on f.id = case
        when o.input_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then o.input_id::uuid
        else null::uuid
      end
    left join public.fragrance_text_enrichment te
      on te.fragrance_id = f.id
    order by o.ord
  loop
    v_before_notes := coalesce(rec.before_notes, '{}'::text[]);
    v_before_accords := coalesce(rec.before_accords, '{}'::text[]);
    v_after_notes := v_before_notes;
    v_after_accords := v_before_accords;
    v_refresh_result := jsonb_build_object('status', 'not_requested');
    v_rejection_reason := null;
    v_result_status := null;
    v_should_promote := false;
    v_audit_id := null;

    if rec.fragrance_id is null then
      v_result_status := 'invalid_id';
      v_rejection_reason := 'invalid_fragrance_id';
      v_invalid_ids := array_append(v_invalid_ids, rec.input_id);
    elsif rec.existing_fragrance_id is null then
      v_result_status := 'missing_fragrance';
      v_rejection_reason := 'fragrance_not_found';
      v_missing_ids := array_append(v_missing_ids, rec.input_id);
    else
      v_picked := v_picked + 1;

      if rec.staged_status is null then
        v_rejection_reason := 'staged_row_missing';
      elsif rec.staged_status <> 'needs_review' then
        v_rejection_reason := 'staged_status_not_needs_review';
      elsif coalesce(array_length(rec.staged_notes, 1), 0) = 0
         or coalesce(array_length(rec.staged_accords, 1), 0) = 0 then
        v_rejection_reason := 'staged_notes_or_accords_missing';
      elsif (
        coalesce(array_length(v_before_notes, 1), 0) > 0
        or coalesce(array_length(v_before_accords, 1), 0) > 0
      ) and not p_allow_overwrite then
        v_rejection_reason := 'canonical_notes_or_accords_present';
      else
        v_should_promote := true;
        v_after_notes := coalesce(rec.staged_notes, '{}'::text[]);
        v_after_accords := coalesce(rec.staged_accords, '{}'::text[]);
      end if;

      if p_dry_run then
        if v_should_promote then
          v_result_status := 'eligible_preview';
          if p_run_performance_refresh then
            if v_refresh_function_available then
              v_refresh_result := jsonb_build_object(
                'status', 'would_refresh_after_promotion'
              );
            else
              v_refresh_result := jsonb_build_object(
                'status', 'refresh_function_unavailable'
              );
            end if;
          end if;
        else
          v_result_status := 'rejected';
          if p_run_performance_refresh then
            v_refresh_result := jsonb_build_object(
              'status', 'skipped',
              'reason', 'promotion_not_eligible'
            );
          end if;
        end if;
      elsif v_should_promote then
        update public.fragrances
        set
          notes = v_after_notes,
          accords = v_after_accords,
          updated_at = now()
        where id = rec.existing_fragrance_id
          and (
            p_allow_overwrite
            or (
              coalesce(array_length(notes, 1), 0) = 0
              and coalesce(array_length(accords, 1), 0) = 0
            )
          );

        if not found then
          v_result_status := 'rejected';
          v_rejection_reason := 'canonical_write_precondition_failed';
          v_after_notes := v_before_notes;
          v_after_accords := v_before_accords;
        else
          update public.fragrance_text_enrichment
          set
            status = 'already_enriched',
            last_error = null,
            last_enriched_at = now(),
            updated_at = now()
          where fragrance_id = rec.existing_fragrance_id;

          if p_run_performance_refresh then
            if v_refresh_function_available then
              begin
                select public.refresh_fragrance_performance_features_v1(rec.existing_fragrance_id)
                into v_refresh_result;
                v_refreshed_count := v_refreshed_count + 1;
              exception
                when others then
                  v_refresh_result := jsonb_build_object(
                    'status', 'error',
                    'error', sqlerrm
                  );
              end;
            else
              v_refresh_result := jsonb_build_object(
                'status', 'refresh_function_unavailable'
              );
            end if;
          end if;

          insert into public.fragrance_text_enrichment_promotions_v1 (
            fragrance_id,
            action,
            actor_label,
            staged_status,
            source_url,
            source_confidence,
            match_name,
            match_brand,
            before_notes,
            before_accords,
            after_notes,
            after_accords,
            enrichment_evidence_snapshot,
            refresh_result,
            result_status,
            rejection_reason,
            overwrite_existing,
            function_version,
            promoted_at
          )
          values (
            rec.existing_fragrance_id,
            'promote',
            v_actor,
            rec.staged_status,
            rec.source_url,
            rec.source_confidence,
            rec.match_name,
            rec.match_brand,
            v_before_notes,
            v_before_accords,
            v_after_notes,
            v_after_accords,
            jsonb_build_object(
              'provider', rec.provider,
              'proposed_family_key', rec.proposed_family_key,
              'concentration', rec.concentration,
              'notes', coalesce(rec.staged_notes, '{}'::text[]),
              'accords', coalesce(rec.staged_accords, '{}'::text[]),
              'provider_payload', coalesce(rec.provider_payload, '{}'::jsonb),
              'last_error', rec.last_error,
              'last_enriched_at', rec.last_enriched_at
            ),
            coalesce(v_refresh_result, '{}'::jsonb),
            'promoted',
            null,
            p_allow_overwrite,
            v_function_version,
            now()
          )
          returning id into v_audit_id;

          v_result_status := 'promoted';
          v_promoted_count := v_promoted_count + 1;
        end if;
      else
        v_result_status := 'rejected';
      end if;

      if not p_dry_run and v_result_status = 'rejected' then
        insert into public.fragrance_text_enrichment_promotions_v1 (
          fragrance_id,
          action,
          actor_label,
          staged_status,
          source_url,
          source_confidence,
          match_name,
          match_brand,
          before_notes,
          before_accords,
          after_notes,
          after_accords,
          enrichment_evidence_snapshot,
          refresh_result,
          result_status,
          rejection_reason,
          overwrite_existing,
          function_version,
          promoted_at
        )
        values (
          rec.existing_fragrance_id,
          'reject',
          v_actor,
          rec.staged_status,
          rec.source_url,
          rec.source_confidence,
          rec.match_name,
          rec.match_brand,
          v_before_notes,
          v_before_accords,
          v_after_notes,
          v_after_accords,
          jsonb_build_object(
            'provider', rec.provider,
            'proposed_family_key', rec.proposed_family_key,
            'concentration', rec.concentration,
            'notes', coalesce(rec.staged_notes, '{}'::text[]),
            'accords', coalesce(rec.staged_accords, '{}'::text[]),
            'provider_payload', coalesce(rec.provider_payload, '{}'::jsonb),
            'last_error', rec.last_error,
            'last_enriched_at', rec.last_enriched_at
          ),
          coalesce(v_refresh_result, '{}'::jsonb),
          'rejected',
          v_rejection_reason,
          p_allow_overwrite,
          v_function_version,
          null
        )
        returning id into v_audit_id;
      end if;
    end if;

    if v_result_status in ('invalid_id', 'missing_fragrance', 'rejected') then
      v_rejected_count := v_rejected_count + 1;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'input_id', rec.input_id,
        'fragrance_id', rec.existing_fragrance_id,
        'name', rec.name,
        'brand', rec.brand,
        'action', case when p_dry_run then 'preview' else 'promote' end,
        'actor_label', v_actor,
        'staged_status', rec.staged_status,
        'source_url', rec.source_url,
        'source_confidence', rec.source_confidence,
        'match_name', rec.match_name,
        'match_brand', rec.match_brand,
        'before_notes', v_before_notes,
        'before_accords', v_before_accords,
        'after_notes', v_after_notes,
        'after_accords', v_after_accords,
        'before_notes_count', coalesce(array_length(v_before_notes, 1), 0),
        'before_accords_count', coalesce(array_length(v_before_accords, 1), 0),
        'after_notes_count', coalesce(array_length(v_after_notes, 1), 0),
        'after_accords_count', coalesce(array_length(v_after_accords, 1), 0),
        'eligible_for_promotion', v_should_promote,
        'result_status', v_result_status,
        'rejection_reason', v_rejection_reason,
        'would_refresh', p_run_performance_refresh and v_should_promote,
        'refresh_result', coalesce(v_refresh_result, '{}'::jsonb),
        'audit_row_id', v_audit_id,
        'function_version', v_function_version
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'distinct_requested_count', v_distinct_count,
    'picked', v_picked,
    'results_count', jsonb_array_length(v_results),
    'promoted_count', v_promoted_count,
    'rejected_count', v_rejected_count,
    'refreshed_count', v_refreshed_count,
    'invalid_ids', to_jsonb(coalesce(v_invalid_ids, '{}'::text[])),
    'missing_ids', to_jsonb(coalesce(v_missing_ids, '{}'::text[])),
    'max_ids', v_max_ids,
    'allow_overwrite', p_allow_overwrite,
    'run_performance_refresh', p_run_performance_refresh,
    'refresh_function_available', v_refresh_function_available,
    'scope_mode', 'explicit_ids',
    'function_version', v_function_version,
    'results', v_results
  );
end;
$function$;

revoke all on function public.promote_fragrance_text_enrichment_v1(text[], text, boolean, boolean, boolean) from public;
revoke all on function public.promote_fragrance_text_enrichment_v1(text[], text, boolean, boolean, boolean) from anon;
revoke all on function public.promote_fragrance_text_enrichment_v1(text[], text, boolean, boolean, boolean) from authenticated;
grant execute on function public.promote_fragrance_text_enrichment_v1(text[], text, boolean, boolean, boolean) to service_role;

do $$
declare
  v_definition text;
  v_old text := $old$
      from public.fragrance_text_enrichment te
      where te.fragrance_id = tf.fragrance_id
$old$;
  v_new text := $new$
      from public.fragrance_text_enrichment te
      where te.fragrance_id = tf.fragrance_id
        and te.status in ('enriched', 'already_enriched', 'skipped_existing_good_data')
$new$;
begin
  select pg_get_functiondef('public.refresh_fragrance_performance_features_v1(uuid)'::regprocedure)
  into v_definition;

  if v_definition is null then
    raise exception 'refresh_fragrance_performance_features_v1(uuid) not found';
  end if;

  if position(v_new in v_definition) > 0 then
    null;
  elsif position(v_old in v_definition) > 0 then
    v_definition := replace(v_definition, v_old, v_new);
    execute v_definition;
  else
    raise exception 'Unable to patch refresh_fragrance_performance_features_v1(uuid) for approved enrichment-only input';
  end if;
end;
$$;

notify pgrst, 'reload schema';
