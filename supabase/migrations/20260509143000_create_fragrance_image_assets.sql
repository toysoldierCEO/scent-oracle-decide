create table if not exists public.fragrance_image_assets (
  fragrance_id uuid primary key references public.fragrances(id) on delete cascade,
  image_url text,
  thumbnail_url text,
  image_source text not null,
  source_url text,
  source_confidence numeric,
  provider_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fragrance_image_assets enable row level security;

grant select on public.fragrance_image_assets to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fragrance_image_assets'
      and policyname = 'Public read fragrance image assets'
  ) then
    create policy "Public read fragrance image assets"
      on public.fragrance_image_assets
      for select
      using (true);
  end if;
end
$$;
