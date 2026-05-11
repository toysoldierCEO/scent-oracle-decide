create table if not exists public.fragrance_text_enrichment (
  fragrance_id uuid not null references public.fragrances(id) on delete cascade,
  provider text not null default 'fragella',
  status text not null default 'pending',
  source_url text,
  source_confidence numeric,
  match_name text,
  match_brand text,
  proposed_family_key text,
  concentration text,
  notes text[] not null default '{}'::text[],
  accords text[] not null default '{}'::text[],
  provider_payload jsonb,
  last_error text,
  last_enriched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fragrance_text_enrichment_pkey primary key (fragrance_id),
  constraint fragrance_text_enrichment_status_check check (
    status in (
      'pending',
      'enriched',
      'skipped_existing_good_data',
      'no_match',
      'low_confidence',
      'needs_review',
      'error',
      'already_enriched'
    )
  )
);

alter table public.fragrance_text_enrichment enable row level security;

revoke all on public.fragrance_text_enrichment from anon;
revoke all on public.fragrance_text_enrichment from authenticated;

create index if not exists fragrance_text_enrichment_status_idx
  on public.fragrance_text_enrichment (status, updated_at desc);

create index if not exists fragrance_text_enrichment_confidence_idx
  on public.fragrance_text_enrichment (source_confidence desc nulls last);

create or replace view public.fragrances_missing_enrichment_v1 as
select
  f.id as fragrance_id,
  f.name,
  coalesce(f.brand, '') as brand,
  f.family_key,
  f.notes,
  f.accords,
  coalesce(cardinality(f.notes), 0) as note_count,
  coalesce(cardinality(f.accords), 0) as accord_count,
  case
    when coalesce(cardinality(f.notes), 0) = 0 and coalesce(cardinality(f.accords), 0) = 0 then 'missing_both'
    when coalesce(cardinality(f.notes), 0) = 0 then 'missing_notes'
    when coalesce(cardinality(f.accords), 0) = 0 then 'missing_accords'
    else 'partial'
  end as gap_kind,
  e.status as enrichment_status,
  e.source_confidence,
  e.updated_at as enrichment_updated_at
from public.fragrances f
left join public.fragrance_text_enrichment e
  on e.fragrance_id = f.id
where coalesce(cardinality(f.notes), 0) = 0
   or coalesce(cardinality(f.accords), 0) = 0;
