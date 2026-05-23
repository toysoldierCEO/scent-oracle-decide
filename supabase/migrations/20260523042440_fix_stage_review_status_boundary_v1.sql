begin;

-- Repair the stageReview status boundary bug for exactly three known review-staged rows.
-- These rows were correctly identity-gated and staged for review, but were persisted
-- with status = 'enriched' instead of the review-only boundary status = 'needs_review'.
do $$
declare
  v_target_ids uuid[] := array[
    '3bc113a9-65ee-4be0-b861-e4652163001d'::uuid,
    '04800dc9-7882-47a4-95d7-9cb67b13a558'::uuid,
    '854765fc-e9f0-400a-966e-bafe37085f69'::uuid
  ];
  v_expected_count integer := 3;
  v_actual_count integer := 0;
  v_updated_count integer := 0;
begin
  select count(*)
  into v_actual_count
  from public.fragrance_text_enrichment e
  where e.fragrance_id = any(v_target_ids);

  if v_actual_count <> v_expected_count then
    raise exception 'Expected % staged enrichment rows, found %', v_expected_count, v_actual_count;
  end if;

  if exists (
    select 1
    from public.fragrances f
    where f.id = any(v_target_ids)
      and (
        coalesce(cardinality(f.notes), 0) > 0
        or coalesce(cardinality(f.accords), 0) > 0
      )
  ) then
    raise exception 'Canonical fragrance notes or accords are already populated for at least one target row';
  end if;

  if exists (
    select 1
    from public.fragrance_text_enrichment_promotions_v1 p
    where p.fragrance_id = any(v_target_ids)
  ) then
    raise exception 'Promotion audit already exists for at least one target row';
  end if;

  if exists (
    select 1
    from public.fragrance_text_enrichment_notes_promotions_v1 p
    where p.fragrance_id = any(v_target_ids)
  ) then
    raise exception 'Notes-only promotion audit already exists for at least one target row';
  end if;

  if exists (
    select 1
    from public.fragrance_text_enrichment_reverts_v1 r
    where r.fragrance_id = any(v_target_ids)
  ) then
    raise exception 'Revert audit already exists for at least one target row';
  end if;

  if exists (
    select 1
    from public.fragrance_text_enrichment e
    where e.fragrance_id = any(v_target_ids)
      and (
        e.status not in ('enriched', 'needs_review')
        or coalesce(array_length(e.notes, 1), 0) = 0
        or coalesce(array_length(e.accords, 1), 0) = 0
        or e.source_confidence is null
        or e.source_url is null
        or e.match_name is null
        or e.match_brand is null
      )
  ) then
    raise exception 'At least one target enrichment row failed staged-evidence safety preconditions';
  end if;

  if exists (
    select 1
    from public.fragrance_text_enrichment e
    where e.fragrance_id = '3bc113a9-65ee-4be0-b861-e4652163001d'::uuid
      and (e.match_name <> 'Roja Amber Aoud' or e.match_brand <> 'Roja Dove')
  ) then
    raise exception 'Amber Aoud staged provider identity no longer matches expected clean candidate';
  end if;

  if exists (
    select 1
    from public.fragrance_text_enrichment e
    where e.fragrance_id = '04800dc9-7882-47a4-95d7-9cb67b13a558'::uuid
      and (e.match_name <> 'Creed Millesime Imperial' or e.match_brand <> 'Creed')
  ) then
    raise exception 'Millesime Imperial staged provider identity no longer matches expected clean candidate';
  end if;

  if exists (
    select 1
    from public.fragrance_text_enrichment e
    where e.fragrance_id = '854765fc-e9f0-400a-966e-bafe37085f69'::uuid
      and (e.match_name <> 'Tom Ford Ombre Leather' or e.match_brand <> 'Tom Ford')
  ) then
    raise exception 'Ombre Leather staged provider identity no longer matches expected clean candidate';
  end if;

  update public.fragrance_text_enrichment
  set
    status = 'needs_review',
    updated_at = now()
  where fragrance_id = any(v_target_ids)
    and status = 'enriched';

  get diagnostics v_updated_count = row_count;

  if v_updated_count > v_expected_count then
    raise exception 'Expected to repair at most % rows, repaired %', v_expected_count, v_updated_count;
  end if;

  if exists (
    select 1
    from public.fragrance_text_enrichment e
    where e.fragrance_id = any(v_target_ids)
      and e.status <> 'needs_review'
  ) then
    raise exception 'At least one target enrichment row did not end in needs_review status';
  end if;
end
$$;

commit;
