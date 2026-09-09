alter table public.news_sources add column if not exists default_category public.news_category null;

create index if not exists news_articles_category_published_idx
  on public.news_articles (category, published_at desc)
  where is_pending_verification = false;

create index if not exists news_articles_importance_updated_idx
  on public.news_articles (importance_score desc, updated_at desc)
  where is_pending_verification = false;

create index if not exists news_articles_cluster_updated_idx
  on public.news_articles (cluster_id, updated_at desc)
  where is_pending_verification = false;

create index if not exists news_articles_source_url_idx
  on public.news_articles (source_url);