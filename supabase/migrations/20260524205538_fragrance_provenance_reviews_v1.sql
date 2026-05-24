begin;

create table if not exists public.fragrance_provenance_reviews_v1 (
  id uuid primary key default gen_random_uuid(),
  fragrance_id uuid not null references public.fragrances(id),
  review_status text not null,
  provenance_category text not null,
  actor_label text not null,
  review_reason text null,
  recommended_next_action text null,
  queue_state text null,
  queue_lane text null,
  blocker_reason text null,
  evidence_quality_state text null,
  product_priority_score numeric null,
  product_priority_reason text null,
  notes_count integer null,
  accords_count integer null,
  has_source_url boolean null,
  source_confidence numeric null,
  has_text_enrichment_row boolean null,
  has_promoted_text_evidence boolean null,
  has_revert_history boolean null,
  performance_signal_count integer null,
  performance_source_count integer null,
  beast_mode_band text null,
  recommended_spray_caution text null,
  facet_count integer null,
  role_count integer null,
  has_taxonomy_review boolean null,
  has_taxonomy_proposal boolean null,
  refresh_run_id uuid null,
  source_queue_model_version text null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  queue_snapshot jsonb not null default '{}'::jsonb,
  source_snapshot jsonb null,
  performance_snapshot jsonb null,
  taxonomy_snapshot jsonb null,
  reference_gap_summary jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  superseded_at timestamptz null,
  supersedes_review_id uuid null references public.fragrance_provenance_reviews_v1(id),
  constraint fragrance_provenance_reviews_v1_status_check check (
    review_status in (
      'needs_review',
      'provenance_accepted',
      'needs_source_backfill',
      'payload_inconsistent',
      'identity_review_needed',
      'reference_gap',
      'ready_for_classifier',
      'rejected',
      'superseded'
    )
  ),
  constraint fragrance_provenance_reviews_v1_category_check check (
    provenance_category in (
      'structured_but_untrusted',
      'missing_source_provenance',
      'partial_canonical_but_untrusted',
      'payload_inconsistent',
      'identity_risk',
      'reference_gap',
      'truly_insufficient',
      'unknown'
    )
  )
);

create index if not exists fragrance_provenance_reviews_v1_fragrance_idx
  on public.fragrance_provenance_reviews_v1 (fragrance_id);

create index if not exists fragrance_provenance_reviews_v1_status_idx
  on public.fragrance_provenance_reviews_v1 (review_status);

create index if not exists fragrance_provenance_reviews_v1_category_idx
  on public.fragrance_provenance_reviews_v1 (provenance_category);

create index if not exists fragrance_provenance_reviews_v1_created_idx
  on public.fragrance_provenance_reviews_v1 (created_at desc);

create unique index if not exists fragrance_provenance_reviews_v1_one_active_idx
  on public.fragrance_provenance_reviews_v1 (fragrance_id)
  where superseded_at is null and review_status <> 'superseded';

drop trigger if exists fragrance_provenance_reviews_v1_touch_updated_at
  on public.fragrance_provenance_reviews_v1;

create trigger fragrance_provenance_reviews_v1_touch_updated_at
before update on public.fragrance_provenance_reviews_v1
for each row
execute function public.set_updated_at_v1();

alter table public.fragrance_provenance_reviews_v1 enable row level security;

comment on table public.fragrance_provenance_reviews_v1 is
  'Operational provenance review records for structured-but-untrusted fragrance rows. These reviews do not make notes or accords trusted, do not write taxonomy, do not authorize classifier use automatically, and require future explicit review decisions to move beyond needs_review.';

comment on column public.fragrance_provenance_reviews_v1.review_status is
  'Explicit provenance-review workflow state. This migration only seeds needs_review rows; provenance acceptance, source backfill, reference-gap handling, classifier readiness, rejection, and supersession are future explicit review actions.';

comment on column public.fragrance_provenance_reviews_v1.provenance_category is
  'Operational provenance classification only. It describes why a row is in the provenance lane without mutating public.fragrances, copying evidence, or asserting taxonomy truth.';

comment on column public.fragrance_provenance_reviews_v1.evidence_snapshot is
  'Captured evidence summary used to justify provenance review creation. This is operational memory only and must not be treated as source truth, taxonomy truth, classifier acceptance, or frontend payload.';

comment on column public.fragrance_provenance_reviews_v1.queue_snapshot is
  'Fast current-queue snapshot captured at review creation time. It is an operational cache snapshot only and does not replace Queue v2.3 as rebuildable source logic.';

comment on column public.fragrance_provenance_reviews_v1.source_snapshot is
  'Focused source/provenance snapshot from public.fragrances and enrichment-adjacent tables. It records provenance state only and does not make the underlying scent payload trusted.';

comment on column public.fragrance_provenance_reviews_v1.taxonomy_snapshot is
  'Focused taxonomy coverage snapshot. It does not create, accept, or authorize taxonomy output.';

create or replace view public.fragrance_provenance_review_latest_v1
with (security_invoker = true)
as
select
  ranked.fragrance_id,
  ranked.id as latest_review_id,
  ranked.review_status,
  ranked.provenance_category,
  ranked.review_reason,
  ranked.recommended_next_action,
  ranked.actor_label,
  ranked.refresh_run_id,
  ranked.source_queue_model_version,
  ranked.evidence_snapshot,
  ranked.queue_snapshot,
  ranked.source_snapshot,
  ranked.performance_snapshot,
  ranked.taxonomy_snapshot,
  ranked.reference_gap_summary,
  ranked.created_at,
  ranked.updated_at
from (
  select
    r.*,
    row_number() over (
      partition by r.fragrance_id
      order by r.updated_at desc nulls last, r.created_at desc nulls last, r.id desc
    ) as rn
  from public.fragrance_provenance_reviews_v1 r
  where r.superseded_at is null
    and r.review_status <> 'superseded'
) ranked
where ranked.rn = 1;

comment on view public.fragrance_provenance_review_latest_v1 is
  'Latest active provenance review per fragrance row. Operational review memory only: not source truth, not taxonomy truth, not classifier readiness, and not frontend payload.';

create or replace function public.create_fragrance_provenance_review_records_v1(
  p_fragrance_ids uuid[],
  p_actor_label text default 'codex_provenance_review_v1',
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  v_ids uuid[];
  v_actor_label text := coalesce(nullif(btrim(p_actor_label), ''), 'codex_provenance_review_v1');
  v_requested_count integer := 0;
  v_picked_count integer := 0;
  v_eligible_count integer := 0;
  v_would_create_count integer := 0;
  v_created_count integer := 0;
  v_rejected_count integer := 0;
  v_skipped_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_row record;
  v_review_id uuid;
  v_result_status text;
  v_blocker_reason text;
  v_review_reason text;
  v_recommended_action text;
  v_provenance_category text;
begin
  select array_agg(distinct fragrance_id order by fragrance_id)
  into v_ids
  from unnest(coalesce(p_fragrance_ids, array[]::uuid[])) as fragrance_id
  where fragrance_id is not null;

  v_requested_count := coalesce(cardinality(v_ids), 0);

  if v_requested_count = 0 then
    raise exception 'create_fragrance_provenance_review_records_v1 requires explicit non-empty fragrance ids';
  end if;

  if v_requested_count > 25 then
    raise exception 'create_fragrance_provenance_review_records_v1 accepts at most 25 fragrance ids per call';
  end if;

  for v_row in
    with requested as (
      select unnest(v_ids) as fragrance_id
    )
    select
      req.fragrance_id as requested_fragrance_id,
      f.id as fragrance_id,
      coalesce(q.name, f.name) as name,
      coalesce(q.brand, f.brand) as brand,
      f.family_key,
      q.queue_state,
      q.queue_lane,
      q.blocker_reason,
      q.recommended_next_action,
      q.evidence_quality_state,
      q.product_priority_score,
      q.product_priority_reason,
      q.evidence_summary,
      q.taxonomy_missing_summary,
      q.resolver_evidence_summary,
      q.alias_policy_summary,
      q.canonical_identity_decision_summary,
      q.source_snapshot_summary,
      q.refresh_run_id,
      q.source_queue_model_version,
      q.source_view_name,
      coalesce(cardinality(f.notes), 0) as notes_count,
      coalesce(cardinality(f.accords), 0) as accords_count,
      coalesce(cardinality(f.top_notes), 0) as top_notes_count,
      coalesce(cardinality(f.heart_notes), 0) as heart_notes_count,
      coalesce(cardinality(f.base_notes), 0) as base_notes_count,
      f.notes,
      f.accords,
      f.top_notes,
      f.heart_notes,
      f.base_notes,
      f.source_url as fragrance_source_url,
      f.source_confidence as fragrance_source_confidence_text,
      f.updated_at as fragrance_updated_at,
      coalesce(te.has_text_enrichment_row, false) as has_text_enrichment_row,
      te.status as text_enrichment_status,
      te.provider as text_enrichment_provider,
      te.source_url as text_enrichment_source_url,
      te.source_confidence as text_enrichment_source_confidence,
      te.enrichment_snapshot,
      coalesce(tp.promotions_count, 0) as promotions_count,
      tp.latest_promotion_snapshot,
      tp.latest_source_url as latest_promotion_source_url,
      tp.latest_source_confidence as latest_promotion_source_confidence,
      coalesce(tnp.notes_promotion_count, 0) as notes_promotion_count,
      tnp.latest_notes_promotion_snapshot,
      tnp.latest_source_url as latest_notes_source_url,
      tnp.latest_source_confidence as latest_notes_source_confidence,
      coalesce(trv.revert_count, 0) as revert_count,
      trv.latest_revert_snapshot,
      trv.latest_source_url as latest_revert_source_url,
      trv.latest_source_confidence as latest_revert_source_confidence,
      pf.signal_count as performance_signal_count,
      pf.source_count as performance_source_count,
      pf.beast_mode_band,
      pf.recommended_spray_caution,
      pf.feature_snapshot,
      ps.summary_snapshot as performance_summary_snapshot,
      coalesce(ff.facet_count, 0) as facet_count,
      ff.facets_snapshot,
      coalesce(fr.role_count, 0) as role_count,
      fr.roles_snapshot,
      coalesce(tx.review_count, 0) as taxonomy_review_count,
      coalesce(tx.has_taxonomy_review, false) as has_taxonomy_review,
      tx.latest_review_snapshot as taxonomy_review_snapshot,
      coalesce(tpz.proposal_count, 0) as taxonomy_proposal_count,
      coalesce(tpz.has_taxonomy_proposal, false) as has_taxonomy_proposal,
      tpz.latest_proposal_snapshot as taxonomy_proposal_snapshot,
      coalesce(fkr.family_key_active, false) as family_key_active,
      coalesce(rsa.attempt_count, 0) as resolver_attempt_count,
      coalesce(rsa.has_resolver_attempt, false) as has_resolver_attempt,
      rsa.latest_attempt_snapshot,
      rsa.latest_source_url as latest_resolver_source_url,
      rsa.latest_source_confidence as latest_resolver_source_confidence,
      ar.latest_active_review_id,
      ar.latest_active_review_status,
      ref.reference_gap_summary,
      (
        exists (
          select 1
          from unnest(coalesce(f.notes, array[]::text[])) as note_token
          where lower(regexp_replace(btrim(note_token), '\s+', ' ', 'g')) in (
            'tobacco', 'boozy', 'booze', 'rum', 'whiskey', 'whisky', 'cognac', 'brandy', 'liquor'
          )
        )
      ) as has_tobacco_or_boozy_note_token,
      (
        exists (
          select 1
          from unnest(coalesce(f.accords, array[]::text[])) as accord_token
          where lower(regexp_replace(btrim(accord_token), '\s+', ' ', 'g')) in ('tobacco', 'boozy')
        )
      ) as has_tobacco_or_boozy_accord_token,
      (
        coalesce(
          te.source_url,
          tp.latest_source_url,
          tnp.latest_source_url,
          trv.latest_source_url,
          rsa.latest_source_url,
          f.source_url
        ) is not null
      ) as has_any_source_url,
      case
        when te.source_confidence is not null then te.source_confidence
        when tp.latest_source_confidence is not null then tp.latest_source_confidence
        when tnp.latest_source_confidence is not null then tnp.latest_source_confidence
        when trv.latest_source_confidence is not null then trv.latest_source_confidence
        when rsa.latest_source_confidence is not null then rsa.latest_source_confidence
        when f.source_confidence ~ '^-?[0-9]+(\.[0-9]+)?$' then f.source_confidence::numeric
        else null
      end as derived_source_confidence,
      (coalesce(tp.promotions_count, 0) > 0 or coalesce(tnp.notes_promotion_count, 0) > 0) as has_promoted_text_evidence,
      (coalesce(trv.revert_count, 0) > 0) as has_revert_history,
      coalesce(to_jsonb(q), '{}'::jsonb) as queue_snapshot,
      jsonb_strip_nulls(
        jsonb_build_object(
          'captured_at', statement_timestamp(),
          'refresh_run_id', q.refresh_run_id,
          'source_queue_model_version', q.source_queue_model_version,
          'source_view_name', q.source_view_name,
          'fragrance_id', req.fragrance_id,
          'name', coalesce(q.name, f.name),
          'brand', coalesce(q.brand, f.brand),
          'family_key', f.family_key,
          'queue_state', q.queue_state,
          'queue_lane', q.queue_lane,
          'blocker_reason', q.blocker_reason,
          'recommended_next_action', q.recommended_next_action,
          'evidence_quality_state', q.evidence_quality_state,
          'product_priority_score', q.product_priority_score,
          'product_priority_reason', q.product_priority_reason,
          'notes_count', coalesce(cardinality(f.notes), 0),
          'accords_count', coalesce(cardinality(f.accords), 0),
          'top_notes_count', coalesce(cardinality(f.top_notes), 0),
          'heart_notes_count', coalesce(cardinality(f.heart_notes), 0),
          'base_notes_count', coalesce(cardinality(f.base_notes), 0),
          'has_source_url', (
            coalesce(
              te.source_url,
              tp.latest_source_url,
              tnp.latest_source_url,
              trv.latest_source_url,
              rsa.latest_source_url,
              f.source_url
            ) is not null
          ),
          'source_confidence', case
            when te.source_confidence is not null then te.source_confidence
            when tp.latest_source_confidence is not null then tp.latest_source_confidence
            when tnp.latest_source_confidence is not null then tnp.latest_source_confidence
            when trv.latest_source_confidence is not null then trv.latest_source_confidence
            when rsa.latest_source_confidence is not null then rsa.latest_source_confidence
            when f.source_confidence ~ '^-?[0-9]+(\.[0-9]+)?$' then f.source_confidence::numeric
            else null
          end,
          'has_text_enrichment_row', coalesce(te.has_text_enrichment_row, false),
          'has_promoted_text_evidence', (coalesce(tp.promotions_count, 0) > 0 or coalesce(tnp.notes_promotion_count, 0) > 0),
          'has_revert_history', (coalesce(trv.revert_count, 0) > 0),
          'performance_signal_count', pf.signal_count,
          'performance_source_count', pf.source_count,
          'beast_mode_band', pf.beast_mode_band,
          'recommended_spray_caution', pf.recommended_spray_caution,
          'facet_count', coalesce(ff.facet_count, 0),
          'role_count', coalesce(fr.role_count, 0),
          'has_taxonomy_review', coalesce(tx.has_taxonomy_review, false),
          'has_taxonomy_proposal', coalesce(tpz.has_taxonomy_proposal, false),
          'has_resolver_attempt', coalesce(rsa.has_resolver_attempt, false),
          'evidence_summary', q.evidence_summary,
          'taxonomy_missing_summary', q.taxonomy_missing_summary,
          'resolver_evidence_summary', q.resolver_evidence_summary,
          'alias_policy_summary', q.alias_policy_summary,
          'canonical_identity_decision_summary', q.canonical_identity_decision_summary,
          'source_snapshot_summary', q.source_snapshot_summary
        )
      ) as evidence_snapshot,
      jsonb_strip_nulls(
        jsonb_build_object(
          'captured_at', statement_timestamp(),
          'fragrance', jsonb_build_object(
            'id', f.id,
            'name', f.name,
            'brand', f.brand,
            'family_key', f.family_key,
            'notes', coalesce(to_jsonb(f.notes), '[]'::jsonb),
            'accords', coalesce(to_jsonb(f.accords), '[]'::jsonb),
            'top_notes', coalesce(to_jsonb(f.top_notes), '[]'::jsonb),
            'heart_notes', coalesce(to_jsonb(f.heart_notes), '[]'::jsonb),
            'base_notes', coalesce(to_jsonb(f.base_notes), '[]'::jsonb),
            'source_url', f.source_url,
            'source_confidence', f.source_confidence,
            'updated_at', f.updated_at
          ),
          'text_enrichment', case
            when te.has_text_enrichment_row then te.enrichment_snapshot
            else null
          end,
          'text_enrichment_promotions', jsonb_build_object(
            'promotion_count', coalesce(tp.promotions_count, 0),
            'latest_promotion', tp.latest_promotion_snapshot,
            'notes_promotion_count', coalesce(tnp.notes_promotion_count, 0),
            'latest_notes_promotion', tnp.latest_notes_promotion_snapshot,
            'revert_count', coalesce(trv.revert_count, 0),
            'latest_revert', trv.latest_revert_snapshot
          ),
          'resolver_attempts', jsonb_build_object(
            'attempt_count', coalesce(rsa.attempt_count, 0),
            'has_resolver_attempt', coalesce(rsa.has_resolver_attempt, false),
            'latest_attempt', rsa.latest_attempt_snapshot
          )
        )
      ) as source_snapshot,
      jsonb_strip_nulls(
        jsonb_build_object(
          'captured_at', statement_timestamp(),
          'features', pf.feature_snapshot,
          'summary', ps.summary_snapshot
        )
      ) as performance_snapshot,
      jsonb_strip_nulls(
        jsonb_build_object(
          'captured_at', statement_timestamp(),
          'facet_count', coalesce(ff.facet_count, 0),
          'facets', ff.facets_snapshot,
          'role_count', coalesce(fr.role_count, 0),
          'roles', fr.roles_snapshot,
          'has_taxonomy_review', coalesce(tx.has_taxonomy_review, false),
          'taxonomy_review_count', coalesce(tx.review_count, 0),
          'latest_taxonomy_review', tx.latest_review_snapshot,
          'has_taxonomy_proposal', coalesce(tpz.has_taxonomy_proposal, false),
          'taxonomy_proposal_count', coalesce(tpz.proposal_count, 0),
          'latest_taxonomy_proposal', tpz.latest_proposal_snapshot
        )
      ) as taxonomy_snapshot
    from requested req
    left join public.fragrances f
      on f.id = req.fragrance_id
    left join public.taxonomy_operationalization_queue_current_v1 q
      on q.fragrance_id = req.fragrance_id
    left join lateral (
      select
        true as has_text_enrichment_row,
        e.provider,
        e.status,
        e.source_url,
        e.source_confidence,
        to_jsonb(e) as enrichment_snapshot
      from public.fragrance_text_enrichment e
      where e.fragrance_id = req.fragrance_id
      order by e.updated_at desc nulls last, e.created_at desc nulls last
      limit 1
    ) te on true
    left join lateral (
      select
        count(*)::int as promotions_count,
        (array_agg(to_jsonb(p) order by p.promoted_at desc nulls last, p.created_at desc nulls last, p.id desc))[1] as latest_promotion_snapshot,
        (array_agg(p.source_url order by p.promoted_at desc nulls last, p.created_at desc nulls last, p.id desc))[1] as latest_source_url,
        (array_agg(p.source_confidence order by p.promoted_at desc nulls last, p.created_at desc nulls last, p.id desc))[1] as latest_source_confidence
      from public.fragrance_text_enrichment_promotions_v1 p
      where p.fragrance_id = req.fragrance_id
    ) tp on true
    left join lateral (
      select
        count(*)::int as notes_promotion_count,
        (array_agg(to_jsonb(p) order by p.promoted_at desc nulls last, p.created_at desc nulls last, p.id desc))[1] as latest_notes_promotion_snapshot,
        (array_agg(p.source_url order by p.promoted_at desc nulls last, p.created_at desc nulls last, p.id desc))[1] as latest_source_url,
        (array_agg(p.source_confidence order by p.promoted_at desc nulls last, p.created_at desc nulls last, p.id desc))[1] as latest_source_confidence
      from public.fragrance_text_enrichment_notes_promotions_v1 p
      where p.fragrance_id = req.fragrance_id
    ) tnp on true
    left join lateral (
      select
        count(*)::int as revert_count,
        (array_agg(to_jsonb(r) order by r.reverted_at desc nulls last, r.created_at desc nulls last, r.id desc))[1] as latest_revert_snapshot,
        (array_agg(r.source_url order by r.reverted_at desc nulls last, r.created_at desc nulls last, r.id desc))[1] as latest_source_url,
        (array_agg(r.source_confidence order by r.reverted_at desc nulls last, r.created_at desc nulls last, r.id desc))[1] as latest_source_confidence
      from public.fragrance_text_enrichment_reverts_v1 r
      where r.fragrance_id = req.fragrance_id
    ) trv on true
    left join lateral (
      select
        pf.signal_count,
        pf.source_count,
        pf.beast_mode_band,
        pf.recommended_spray_caution,
        to_jsonb(pf) as feature_snapshot
      from public.fragrance_performance_features_v1 pf
      where pf.fragrance_id = req.fragrance_id
      order by pf.updated_at desc nulls last, pf.inferred_at desc nulls last
      limit 1
    ) pf on true
    left join lateral (
      select
        to_jsonb(ps) as summary_snapshot
      from public.fragrance_performance_summary_v1 ps
      where ps.fragrance_id = req.fragrance_id
      limit 1
    ) ps on true
    left join lateral (
      select
        count(*)::int as facet_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'facet_key', x.facet_key,
              'confidence', x.confidence,
              'evidence_source', x.evidence_source,
              'created_at', x.created_at,
              'updated_at', x.updated_at
            )
            order by x.facet_key, x.created_at
          ),
          '[]'::jsonb
        ) as facets_snapshot
      from public.fragrance_facets_v1 x
      where x.fragrance_id = req.fragrance_id
    ) ff on true
    left join lateral (
      select
        count(*)::int as role_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'role_key', x.role_key,
              'role_priority', x.role_priority,
              'confidence', x.confidence,
              'evidence_source', x.evidence_source,
              'created_at', x.created_at,
              'updated_at', x.updated_at
            )
            order by x.role_priority nulls last, x.role_key, x.created_at
          ),
          '[]'::jsonb
        ) as roles_snapshot
      from public.fragrance_wardrobe_roles_v1 x
      where x.fragrance_id = req.fragrance_id
    ) fr on true
    left join lateral (
      select
        count(*)::int as review_count,
        (count(*) > 0) as has_taxonomy_review,
        (array_agg(to_jsonb(x) order by x.updated_at desc nulls last, x.created_at desc nulls last))[1] as latest_review_snapshot
      from public.fragrance_taxonomy_review_v1 x
      where x.fragrance_id = req.fragrance_id
    ) tx on true
    left join lateral (
      select
        count(*)::int as proposal_count,
        (count(*) > 0) as has_taxonomy_proposal,
        (array_agg(to_jsonb(x) order by x.updated_at desc nulls last, x.created_at desc nulls last, x.id desc))[1] as latest_proposal_snapshot
      from public.fragrance_taxonomy_proposals_v1 x
      where x.fragrance_id = req.fragrance_id
    ) tpz on true
    left join lateral (
      select exists (
        select 1
        from public.family_key_reference_v1 x
        where x.family_key = f.family_key
          and x.active
      ) as family_key_active
    ) fkr on true
    left join lateral (
      select
        count(*)::int as attempt_count,
        (count(*) > 0) as has_resolver_attempt,
        (array_agg(to_jsonb(x) order by x.created_at desc nulls last, x.id desc))[1] as latest_attempt_snapshot,
        (array_agg(x.selected_source_url order by x.created_at desc nulls last, x.id desc))[1] as latest_source_url,
        (array_agg(x.source_confidence order by x.created_at desc nulls last, x.id desc))[1] as latest_source_confidence
      from public.fragrance_source_resolver_attempts_v1 x
      where x.fragrance_id = req.fragrance_id
    ) rsa on true
    left join lateral (
      select
        x.id as latest_active_review_id,
        x.review_status as latest_active_review_status
      from public.fragrance_provenance_reviews_v1 x
      where x.fragrance_id = req.fragrance_id
        and x.superseded_at is null
        and x.review_status <> 'superseded'
      order by x.updated_at desc nulls last, x.created_at desc nulls last, x.id desc
      limit 1
    ) ar on true
    left join lateral (
      with accord_tokens as (
        select distinct lower(regexp_replace(btrim(x), '\s+', ' ', 'g')) as token
        from unnest(coalesce(f.accords, array[]::text[])) as x
        where nullif(btrim(x), '') is not null
      ),
      note_tokens as (
        select distinct lower(regexp_replace(btrim(x), '\s+', ' ', 'g')) as token
        from unnest(coalesce(f.notes, array[]::text[])) as x
        where nullif(btrim(x), '') is not null
      ),
      active_facets as (
        select lower(facet_key) as facet_key
        from public.facet_key_reference_v1
        where active
      )
      select jsonb_build_object(
        'active_family_key_exists', coalesce(fkr.family_key_active, false),
        'matched_accord_facet_keys', coalesce(
          (
            select jsonb_agg(t.token order by t.token)
            from accord_tokens t
            join active_facets af on af.facet_key = t.token
          ),
          '[]'::jsonb
        ),
        'unmatched_accord_tokens', coalesce(
          (
            select jsonb_agg(t.token order by t.token)
            from accord_tokens t
            left join active_facets af on af.facet_key = t.token
            where af.facet_key is null
          ),
          '[]'::jsonb
        ),
        'matched_note_facet_keys', coalesce(
          (
            select jsonb_agg(t.token order by t.token)
            from note_tokens t
            join active_facets af on af.facet_key = t.token
          ),
          '[]'::jsonb
        ),
        'unmatched_note_tokens', coalesce(
          (
            select jsonb_agg(t.token order by t.token)
            from note_tokens t
            left join active_facets af on af.facet_key = t.token
            where af.facet_key is null
          ),
          '[]'::jsonb
        ),
        'active_role_keys', coalesce(
          (
            select jsonb_agg(x.role_key order by x.role_key)
            from public.wardrobe_role_reference_v1 x
            where x.active
          ),
          '[]'::jsonb
        )
      ) as reference_gap_summary
    ) ref on true
    order by coalesce(q.name, f.name), req.fragrance_id
  loop
    v_review_id := null;
    v_result_status := null;
    v_blocker_reason := null;
    v_review_reason := null;
    v_recommended_action := null;
    v_provenance_category := null;

    if v_row.fragrance_id is not null then
      v_picked_count := v_picked_count + 1;
    end if;

    if v_row.fragrance_id is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'fragrance_not_found';
      v_rejected_count := v_rejected_count + 1;
    elseif v_row.queue_state is null or v_row.queue_lane is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_current_queue_row';
      v_rejected_count := v_rejected_count + 1;
    elseif v_row.latest_active_review_id is not null then
      v_result_status := 'skipped';
      v_blocker_reason := 'already_active_review';
      v_skipped_count := v_skipped_count + 1;
    elseif v_row.queue_state = 'canonical_alias_policy_blocked'
      or coalesce((v_row.alias_policy_summary ->> 'is_alias_row')::boolean, false)
      or coalesce((v_row.alias_policy_summary ->> 'has_active_alias_mapping')::boolean, false) then
      v_result_status := 'rejected';
      v_blocker_reason := 'canonical_alias_policy_blocked';
      v_rejected_count := v_rejected_count + 1;
    elseif v_row.queue_state in (
      'already_complete',
      'blocked_rejected_match',
      'resolver_identity_conflict',
      'provider_duplicate_reuse',
      'canonical_selection_deferred'
    ) then
      v_result_status := 'rejected';
      v_blocker_reason := v_row.queue_state;
      v_rejected_count := v_rejected_count + 1;
    elseif v_row.queue_lane in (
      'complete_no_action',
      'canonical_alias_policy',
      'product_critical_blocker',
      'canonical_identity_resolved',
      'resolver_conflict_review'
    ) then
      v_result_status := 'rejected';
      v_blocker_reason := v_row.queue_lane;
      v_rejected_count := v_rejected_count + 1;
    elseif v_row.queue_state <> 'insufficient_evidence' then
      v_result_status := 'rejected';
      v_blocker_reason := 'queue_state_not_insufficient_evidence';
      v_rejected_count := v_rejected_count + 1;
    elseif v_row.queue_lane <> 'manual_review' then
      v_result_status := 'rejected';
      v_blocker_reason := 'queue_lane_not_manual_review';
      v_rejected_count := v_rejected_count + 1;
    elseif coalesce(v_row.notes_count, 0) <= 0 and coalesce(v_row.accords_count, 0) <= 0 then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_structured_scent_payload';
      v_rejected_count := v_rejected_count + 1;
    elseif nullif(btrim(coalesce(v_row.family_key, '')), '') is null then
      v_result_status := 'rejected';
      v_blocker_reason := 'missing_family_key';
      v_rejected_count := v_rejected_count + 1;
    else
      v_eligible_count := v_eligible_count + 1;

      v_provenance_category := case
        when v_row.family_key = 'tobacco-boozy'
          and not coalesce(v_row.has_tobacco_or_boozy_note_token, false)
          and not coalesce(v_row.has_tobacco_or_boozy_accord_token, false) then
          'payload_inconsistent'
        else
          'structured_but_untrusted'
      end;

      v_review_reason := case
        when v_provenance_category = 'payload_inconsistent' then
          'Family key suggests tobacco-boozy, but the current notes and accords lack tobacco or boozy tokens; the row still lacks trusted source provenance and needs manual review.'
        else
          'Structured scent payload exists, but trusted source_url/source_confidence or promoted text evidence is missing, so provenance review is required before any classifier expansion.'
      end;

      v_recommended_action := case
        when v_provenance_category = 'payload_inconsistent' then
          'manual_payload_consistency_review'
        else
          'manual_provenance_review_required'
      end;

      if p_dry_run then
        v_would_create_count := v_would_create_count + 1;
        v_result_status := 'would_create';
      else
        insert into public.fragrance_provenance_reviews_v1 (
          fragrance_id,
          review_status,
          provenance_category,
          actor_label,
          review_reason,
          recommended_next_action,
          queue_state,
          queue_lane,
          blocker_reason,
          evidence_quality_state,
          product_priority_score,
          product_priority_reason,
          notes_count,
          accords_count,
          has_source_url,
          source_confidence,
          has_text_enrichment_row,
          has_promoted_text_evidence,
          has_revert_history,
          performance_signal_count,
          performance_source_count,
          beast_mode_band,
          recommended_spray_caution,
          facet_count,
          role_count,
          has_taxonomy_review,
          has_taxonomy_proposal,
          refresh_run_id,
          source_queue_model_version,
          evidence_snapshot,
          queue_snapshot,
          source_snapshot,
          performance_snapshot,
          taxonomy_snapshot,
          reference_gap_summary
        )
        values (
          v_row.fragrance_id,
          'needs_review',
          v_provenance_category,
          v_actor_label,
          v_review_reason,
          v_recommended_action,
          v_row.queue_state,
          v_row.queue_lane,
          v_row.blocker_reason,
          v_row.evidence_quality_state,
          v_row.product_priority_score,
          v_row.product_priority_reason,
          v_row.notes_count,
          v_row.accords_count,
          v_row.has_any_source_url,
          v_row.derived_source_confidence,
          v_row.has_text_enrichment_row,
          v_row.has_promoted_text_evidence,
          v_row.has_revert_history,
          v_row.performance_signal_count,
          v_row.performance_source_count,
          v_row.beast_mode_band,
          v_row.recommended_spray_caution,
          v_row.facet_count,
          v_row.role_count,
          v_row.has_taxonomy_review,
          v_row.has_taxonomy_proposal,
          v_row.refresh_run_id,
          v_row.source_queue_model_version,
          v_row.evidence_snapshot,
          v_row.queue_snapshot,
          v_row.source_snapshot,
          v_row.performance_snapshot,
          v_row.taxonomy_snapshot,
          v_row.reference_gap_summary
        )
        returning id into v_review_id;

        v_created_count := v_created_count + 1;
        v_result_status := 'created';
      end if;
    end if;

    v_results := v_results || jsonb_build_array(
      jsonb_strip_nulls(
        jsonb_build_object(
          'fragrance_id', v_row.requested_fragrance_id,
          'name', v_row.name,
          'brand', v_row.brand,
          'queue_state', v_row.queue_state,
          'queue_lane', v_row.queue_lane,
          'review_status', case
            when v_result_status in ('would_create', 'created') then 'needs_review'
            when v_row.latest_active_review_status is not null then v_row.latest_active_review_status
            else null
          end,
          'provenance_category', v_provenance_category,
          'result_status', v_result_status,
          'blocker_reason', v_blocker_reason,
          'existing_active_review_id', v_row.latest_active_review_id,
          'created_review_id', v_review_id,
          'would_create', (v_result_status = 'would_create'),
          'notes_count', v_row.notes_count,
          'accords_count', v_row.accords_count,
          'has_source_url', v_row.has_any_source_url,
          'source_confidence', v_row.derived_source_confidence,
          'has_text_enrichment_row', v_row.has_text_enrichment_row,
          'has_promoted_text_evidence', v_row.has_promoted_text_evidence,
          'has_revert_history', v_row.has_revert_history,
          'performance_signal_count', v_row.performance_signal_count,
          'performance_source_count', v_row.performance_source_count,
          'review_reason', v_review_reason,
          'recommended_next_action', v_recommended_action
        )
      )
    );
  end loop;

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'picked_count', v_picked_count,
    'eligible_count', v_eligible_count,
    'would_create_count', v_would_create_count,
    'created_count', v_created_count,
    'rejected_count', v_rejected_count,
    'skipped_count', v_skipped_count,
    'dry_run', p_dry_run,
    'actor_label', v_actor_label,
    'results', v_results
  );
end;
$function$;

comment on function public.create_fragrance_provenance_review_records_v1(uuid[], text, boolean) is
  'Creates or previews provenance-review memory for explicit fragrance ids only. It never mutates public.fragrances, writes taxonomy, stages or promotes enrichment, refreshes performance, refreshes the queue, or creates records for the full backlog by default.';

revoke all on public.fragrance_provenance_reviews_v1 from public, anon, authenticated;
grant select, insert, update, delete, references, trigger, truncate
  on public.fragrance_provenance_reviews_v1 to service_role;

revoke all on public.fragrance_provenance_review_latest_v1 from public, anon, authenticated;
grant select on public.fragrance_provenance_review_latest_v1 to service_role;

revoke all on function public.create_fragrance_provenance_review_records_v1(uuid[], text, boolean)
  from public, anon, authenticated;
grant execute on function public.create_fragrance_provenance_review_records_v1(uuid[], text, boolean)
  to service_role;

commit;
