create table if not exists public.country_article_translations (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.country_news_articles(id) on delete cascade,
  target_language text not null default 'ar' check (target_language in ('ar')),
  translated_headline text not null,
  translated_summary text not null default '',
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(article_id, target_language)
);

create index if not exists country_article_translations_article_idx
  on public.country_article_translations(article_id, target_language);

alter table public.country_article_translations enable row level security;

drop policy if exists country_article_translations_public_read on public.country_article_translations;
create policy country_article_translations_public_read
  on public.country_article_translations
  for select to anon, authenticated
  using (exists (
    select 1 from public.country_news_articles a
    where a.id = article_id and a.is_published = true
  ));
