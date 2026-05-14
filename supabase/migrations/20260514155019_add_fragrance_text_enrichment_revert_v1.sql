do $$
begin
  if exists (
    select 1
    from public.fragrance_text_enrichment
    where status not in (
      'pending',
      'enriched',
      'skipped_existing_good_data',
      'no_match',
      'low_confidence',
      'needs_review',
      'error',
      'already_enriched',
      'rejected_match'
    )
  ) then
    raise exception 'Cannot extend fragrance_text_enrichment status check: unexpected status values exist';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class cl
      on cl.oid = c.conrelid
    join pg_namespace n
      on n.oid = cl.relnamespace
    where n.nspname = 'public'
      and cl.relname = 'fragrance_text_enrichment'
      and c.conname = 'fragrance_text_enrichment_status_check'
      and pg_get_constraintdef(c.oid) like '%rejected_match%'
  ) then
    alter table public.fragrance_text_enrichment
      drop constraint if exists fragrance_text_enrichment_status_check;

    alter table public.fragrance_text_enrichment
      add constraint fragrance_text_enrichment_status_check check (
        status in (
          'pending',
          'enriched',
          'skipped_existing_good_data',
          'no_match',
          'low_confidence',
          'needs_review',
          'error',
          'already_enriched',
          'rejected_match'
        )
      );
  end if;
end;
$$;

create table if not exists public.fragrance_text_enrichment_reverts_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  action text not null default 'revert_wrong_match',
  actor_label text not null default 'operator',
  reason text,
  promotion_audit_id bigint references public.fragrance_text_enrichment_promotions_v1(id) on delete set null,
  previous_enrichment_status text,
  new_enrichment_status text,
  source_url text,
  source_confidence numeric,
  match_name text,
  match_brand text,
  canonical_notes_before_revert text[] not null default '{}'::text[],
  canonical_accords_before_revert text[] not null default '{}'::text[],
  canonical_notes_after_revert text[] not null default '{}'::text[],
  canonical_accords_after_revert text[] not null default '{}'::text[],
  promotion_before_notes text[] not null default '{}'::text[],
  promotion_before_accords text[] not null default '{}'::text[],
  promotion_after_notes text[] not null default '{}'::text[],
  promotion_after_accords text[] not null default '{}'::text[],
  enrichment_snapshot jsonb not null default '{}'::jsonb,
  refresh_result jsonb not null default '{}'::jsonb,
  result_status text not null,
  rejection_reason text,
  function_version text not null default 'fragrance_text_enrichment_revert_v1',
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fragrance_text_enrichment_reverts_v1_action_check check (
    action in ('revert_wrong_match')
  ),
  constraint fragrance_text_enrichment_reverts_v1_result_status_check check (
    result_status in ('reverted', 'rejected')
  )
);

alter table public.fragrance_text_enrichment_reverts_v1 enable row level security;

revoke all on table public.fragrance_text_enrichment_reverts_v1 from public;
revoke all on table public.fragrance_text_enrichment_reverts_v1 from anon;
revoke all on table public.fragrance_text_enrichment_reverts_v1 from authenticated;

grant select, insert on table public.fragrance_text_enrichment_reverts_v1 to service_role;

create index if not exists fragrance_text_enrichment_reverts_v1_fragrance_idx
  on public.fragrance_text_enrichment_reverts_v1 (fragrance_id, created_at desc);

create index if not exists fragrance_text_enrichment_reverts_v1_promotion_idx
  on public.fragrance_text_enrichment_reverts_v1 (promotion_audit_id);

create or replace function public.revert_fragrance_text_enrichment_promotion_v1(
  p_fragrance_ids text[],
  p_actor_label text default 'operator',
  p_reason text default 'wrong_provider_match',
  p_dry_run boolean default true,
  p_refresh_after_revert boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_function_version constant text := 'fragrance_text_enrichment_revert_v1';
  v_max_ids constant integer := 10;
  v_requested_count integer := coalesce(array_length(p_fragrance_ids, 1), 0);
  v_distinct_count integer := 0;
  v_picked integer := 0;
  v_would_revert_count integer := 0;
  v_reverted_count integer := 0;
  v_rejected_count integer := 0;
  v_refreshed_count integer := 0;
  v_actor_label text := coalesce(nullif(trim(p_actor_label), ''), 'operator');
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'wrong_provider_match');
  v_new_enrichment_status text := 'rejected_match';
  v_refresh_function_available boolean := exists (
    select 1
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'refresh_fragrance_performance_features_v1'
      and pg_get_function_identity_arguments(p.oid) = 'p_fragrance_id uuid'
  );
  v_invalid_ids text[] := '{}'::text[];
  v_missing_ids text[] := '{}'::text[];
  v_results jsonb := '[]'::jsonb;
  v_revert_audit_id uuid;
  v_refresh_result jsonb;
  v_rejection_reason text;
  v_result_status text;
  v_should_revert boolean;
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
      'would_revert_count', 0,
      'reverted_count', 0,
      'rejected_count', 0,
      'refreshed_count', 0,
      'invalid_ids', '[]'::jsonb,
      'missing_ids', '[]'::jsonb,
      'max_ids', v_max_ids,
      'refresh_after_revert', p_refresh_after_revert,
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
      'would_revert_count', 0,
      'reverted_count', 0,
      'rejected_count', 0,
      'refreshed_count', 0,
      'invalid_ids', '[]'::jsonb,
      'missing_ids', '[]'::jsonb,
      'max_ids', v_max_ids,
      'refresh_after_revert', p_refresh_after_revert,
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
      'would_revert_count', 0,
      'reverted_count', 0,
      'rejected_count', 0,
      'refreshed_count', 0,
      'invalid_ids', '[]'::jsonb,
      'missing_ids', '[]'::jsonb,
      'max_ids', v_max_ids,
      'refresh_after_revert', p_refresh_after_revert,
      'refresh_function_available', v_refresh_function_available,
      'scope_mode', 'explicit_ids',
      'function_version', v_function_version,
      'error', format('revert is limited to %s explicit IDs per call', v_max_ids)
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
    ),
    parsed_ids as (
      select
        input_id,
        ord,
        case
          when input_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then input_id::uuid
          else null::uuid
        end as fragrance_id
      from ordered_ids
    )
    select
      pi.input_id,
      pi.ord,
      pi.fragrance_id as parsed_fragrance_id,
      f.id as existing_fragrance_id,
      f.name,
      f.brand,
      f.notes as current_notes,
      f.accords as current_accords,
      te.status as enrichment_status,
      te.source_url,
      te.source_confidence,
      te.match_name,
      te.match_brand,
      te.provider,
      te.proposed_family_key,
      te.concentration,
      te.notes as staged_notes,
      te.accords as staged_accords,
      te.provider_payload,
      te.last_error,
      te.last_enriched_at,
      p.id as promotion_audit_id,
      p.before_notes as promotion_before_notes,
      p.before_accords as promotion_before_accords,
      p.after_notes as promotion_after_notes,
      p.after_accords as promotion_after_accords,
      p.created_at as promotion_created_at,
      p.promoted_at as promoted_at
    from parsed_ids pi
    left join public.fragrances f
      on f.id = pi.fragrance_id
    left join public.fragrance_text_enrichment te
      on te.fragrance_id = f.id
    left join lateral (
      select p_inner.*
      from public.fragrance_text_enrichment_promotions_v1 p_inner
      where p_inner.fragrance_id = f.id
        and p_inner.action = 'promote'
        and p_inner.result_status = 'promoted'
      order by p_inner.created_at desc, p_inner.id desc
      limit 1
    ) p on true
    order by pi.ord
  loop
    v_revert_audit_id := null;
    v_refresh_result := jsonb_build_object('status', 'not_requested');
    v_rejection_reason := null;
    v_result_status := null;
    v_should_revert := false;

    if rec.parsed_fragrance_id is null then
      v_result_status := 'invalid_id';
      v_rejection_reason := 'invalid_fragrance_id';
      v_invalid_ids := array_append(v_invalid_ids, rec.input_id);
    elsif rec.existing_fragrance_id is null then
      v_result_status := 'missing_fragrance';
      v_rejection_reason := 'fragrance_not_found';
      v_missing_ids := array_append(v_missing_ids, rec.input_id);
    else
      v_picked := v_picked + 1;

      if rec.enrichment_status is null then
        v_rejection_reason := 'enrichment_row_missing';
      elsif rec.enrichment_status not in ('already_enriched', 'enriched') then
        v_rejection_reason := 'enrichment_status_not_revertible';
      elsif rec.promotion_audit_id is null then
        v_rejection_reason := 'successful_promotion_audit_missing';
      elsif coalesce(rec.current_notes, '{}'::text[]) <> coalesce(rec.promotion_after_notes, '{}'::text[]) then
        v_rejection_reason := 'canonical_notes_do_not_match_promotion_after';
      elsif coalesce(rec.current_accords, '{}'::text[]) <> coalesce(rec.promotion_after_accords, '{}'::text[]) then
        v_rejection_reason := 'canonical_accords_do_not_match_promotion_after';
      elsif p_refresh_after_revert and not v_refresh_function_available then
        v_rejection_reason := 'refresh_function_unavailable';
      else
        v_should_revert := true;
      end if;

      if p_dry_run then
        if v_should_revert then
          v_result_status := 'eligible_preview';
          v_would_revert_count := v_would_revert_count + 1;
          if p_refresh_after_revert then
            v_refresh_result := jsonb_build_object('status', 'would_refresh_after_revert');
          end if;
        else
          v_result_status := 'rejected';
        end if;
      elsif v_should_revert then
        update public.fragrances
        set
          notes = coalesce(rec.promotion_before_notes, '{}'::text[]),
          accords = coalesce(rec.promotion_before_accords, '{}'::text[]),
          updated_at = now()
        where id = rec.existing_fragrance_id
          and coalesce(notes, '{}'::text[]) = coalesce(rec.promotion_after_notes, '{}'::text[])
          and coalesce(accords, '{}'::text[]) = coalesce(rec.promotion_after_accords, '{}'::text[]);

        if not found then
          v_result_status := 'rejected';
          v_rejection_reason := 'canonical_write_precondition_failed';
        else
          update public.fragrance_text_enrichment
          set
            status = v_new_enrichment_status,
            last_error = format(
              'reverted_wrong_provider_match: %s; promotion_audit_id=%s; match_name=%s; match_brand=%s',
              v_reason,
              rec.promotion_audit_id,
              coalesce(rec.match_name, ''),
              coalesce(rec.match_brand, '')
            ),
            updated_at = now()
          where fragrance_id = rec.existing_fragrance_id;

          if p_refresh_after_revert then
            select public.refresh_fragrance_performance_features_v1(rec.existing_fragrance_id)
            into v_refresh_result;

            if coalesce(v_refresh_result ->> 'status', '') = 'completed' then
              v_refreshed_count := v_refreshed_count + 1;
            end if;
          end if;

          insert into public.fragrance_text_enrichment_reverts_v1 (
            fragrance_id,
            action,
            actor_label,
            reason,
            promotion_audit_id,
            previous_enrichment_status,
            new_enrichment_status,
            source_url,
            source_confidence,
            match_name,
            match_brand,
            canonical_notes_before_revert,
            canonical_accords_before_revert,
            canonical_notes_after_revert,
            canonical_accords_after_revert,
            promotion_before_notes,
            promotion_before_accords,
            promotion_after_notes,
            promotion_after_accords,
            enrichment_snapshot,
            refresh_result,
            result_status,
            rejection_reason,
            function_version,
            reverted_at
          )
          values (
            rec.existing_fragrance_id,
            'revert_wrong_match',
            v_actor_label,
            v_reason,
            rec.promotion_audit_id,
            rec.enrichment_status,
            v_new_enrichment_status,
            rec.source_url,
            rec.source_confidence,
            rec.match_name,
            rec.match_brand,
            coalesce(rec.current_notes, '{}'::text[]),
            coalesce(rec.current_accords, '{}'::text[]),
            coalesce(rec.promotion_before_notes, '{}'::text[]),
            coalesce(rec.promotion_before_accords, '{}'::text[]),
            coalesce(rec.promotion_before_notes, '{}'::text[]),
            coalesce(rec.promotion_before_accords, '{}'::text[]),
            coalesce(rec.promotion_after_notes, '{}'::text[]),
            coalesce(rec.promotion_after_accords, '{}'::text[]),
            jsonb_build_object(
              'provider', rec.provider,
              'proposed_family_key', rec.proposed_family_key,
              'concentration', rec.concentration,
              'staged_notes', coalesce(rec.staged_notes, '{}'::text[]),
              'staged_accords', coalesce(rec.staged_accords, '{}'::text[]),
              'provider_payload', coalesce(rec.provider_payload, '{}'::jsonb),
              'last_error_before_revert', rec.last_error,
              'last_enriched_at', rec.last_enriched_at,
              'promotion_created_at', rec.promotion_created_at,
              'promoted_at', rec.promoted_at
            ),
            coalesce(v_refresh_result, '{}'::jsonb),
            'reverted',
            null,
            v_function_version,
            now()
          )
          returning id into v_revert_audit_id;

          v_result_status := 'reverted';
          v_reverted_count := v_reverted_count + 1;
        end if;
      else
        v_result_status := 'rejected';
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
        'dry_run', p_dry_run,
        'actor_label', v_actor_label,
        'reason', v_reason,
        'promotion_audit_id', rec.promotion_audit_id,
        'previous_enrichment_status', rec.enrichment_status,
        'new_enrichment_status', case when v_should_revert then v_new_enrichment_status else null end,
        'source_url', rec.source_url,
        'source_confidence', rec.source_confidence,
        'match_name', rec.match_name,
        'match_brand', rec.match_brand,
        'canonical_notes_before_revert_count', coalesce(cardinality(rec.current_notes), 0),
        'canonical_accords_before_revert_count', coalesce(cardinality(rec.current_accords), 0),
        'canonical_notes_after_revert_count', coalesce(cardinality(rec.promotion_before_notes), 0),
        'canonical_accords_after_revert_count', coalesce(cardinality(rec.promotion_before_accords), 0),
        'promotion_before_notes_count', coalesce(cardinality(rec.promotion_before_notes), 0),
        'promotion_before_accords_count', coalesce(cardinality(rec.promotion_before_accords), 0),
        'promotion_after_notes_count', coalesce(cardinality(rec.promotion_after_notes), 0),
        'promotion_after_accords_count', coalesce(cardinality(rec.promotion_after_accords), 0),
        'canonical_notes_match_promotion_after',
          coalesce(rec.current_notes, '{}'::text[]) = coalesce(rec.promotion_after_notes, '{}'::text[]),
        'canonical_accords_match_promotion_after',
          coalesce(rec.current_accords, '{}'::text[]) = coalesce(rec.promotion_after_accords, '{}'::text[]),
        'eligible_for_revert', v_should_revert,
        'result_status', v_result_status,
        'rejection_reason', v_rejection_reason,
        'would_refresh', p_refresh_after_revert and v_should_revert,
        'refresh_result', coalesce(v_refresh_result, '{}'::jsonb),
        'revert_audit_id', v_revert_audit_id,
        'function_version', v_function_version
      )
    );
  end loop;

  return jsonb_build_object(
    'ok', v_rejected_count = 0,
    'dry_run', p_dry_run,
    'requested_count', v_requested_count,
    'distinct_requested_count', v_distinct_count,
    'picked', v_picked,
    'results_count', jsonb_array_length(v_results),
    'would_revert_count', v_would_revert_count,
    'reverted_count', v_reverted_count,
    'rejected_count', v_rejected_count,
    'refreshed_count', v_refreshed_count,
    'invalid_ids', to_jsonb(coalesce(v_invalid_ids, '{}'::text[])),
    'missing_ids', to_jsonb(coalesce(v_missing_ids, '{}'::text[])),
    'max_ids', v_max_ids,
    'refresh_after_revert', p_refresh_after_revert,
    'refresh_function_available', v_refresh_function_available,
    'scope_mode', 'explicit_ids',
    'function_version', v_function_version,
    'results', v_results
  );
end;
$function$;

revoke all on function public.revert_fragrance_text_enrichment_promotion_v1(text[], text, text, boolean, boolean) from public;
revoke all on function public.revert_fragrance_text_enrichment_promotion_v1(text[], text, text, boolean, boolean) from anon;
revoke all on function public.revert_fragrance_text_enrichment_promotion_v1(text[], text, text, boolean, boolean) from authenticated;
grant execute on function public.revert_fragrance_text_enrichment_promotion_v1(text[], text, text, boolean, boolean) to service_role;

notify pgrst, 'reload schema';
