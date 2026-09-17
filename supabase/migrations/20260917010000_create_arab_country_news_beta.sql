create table if not exists public.arab_countries (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text not null,
  slug text not null unique,
  flag_code text not null,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.country_news_sources (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references public.arab_countries(id) on delete cascade,
  source_key text not null unique,
  source_name text not null,
  source_url text not null,
  feed_url text not null,
  source_type text not null check (source_type in ('local','regional','international','official')),
  scope_keywords text[] not null default '{}',
  priority smallint not null default 1 check (priority between 1 and 3),
  is_active boolean not null default true,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.country_news_articles (
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references public.arab_countries(id) on delete cascade,
  source_id uuid not null references public.country_news_sources(id) on delete cascade,
  source_item_key text not null,
  source_url text not null,
  headline text not null,
  summary text not null default '',
  category text,
  language text not null default 'ar',
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  importance_score smallint not null default 50 check (importance_score between 1 and 100),
  confidence_score numeric(5,2) not null default 0 check (confidence_score between 0 and 100),
  cluster_id uuid,
  update_count integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, source_item_key),
  unique(source_url)
);

create index if not exists country_news_sources_country_idx on public.country_news_sources(country_id, priority);
create index if not exists country_news_articles_country_published_idx on public.country_news_articles(country_id, published_at desc nulls last);
create index if not exists country_news_articles_source_published_idx on public.country_news_articles(source_id, published_at desc nulls last);

alter table public.arab_countries enable row level security;
alter table public.country_news_sources enable row level security;
alter table public.country_news_articles enable row level security;

drop policy if exists arab_countries_public_read on public.arab_countries;
create policy arab_countries_public_read on public.arab_countries for select to anon, authenticated using (is_active = true);
drop policy if exists country_news_sources_public_read on public.country_news_sources;
create policy country_news_sources_public_read on public.country_news_sources for select to anon, authenticated using (is_active = true);
drop policy if exists country_news_articles_public_read on public.country_news_articles;
create policy country_news_articles_public_read on public.country_news_articles for select to anon, authenticated using (is_published = true);

insert into public.arab_countries(name_ar,name_en,slug,flag_code,display_order)
values
  ('الجزائر','Algeria','algeria','dz',1),
  ('مصر','Egypt','egypt','eg',2),
  ('اليمن','Yemen','yemen','ye',3)
on conflict (slug) do update set name_ar=excluded.name_ar,name_en=excluded.name_en,flag_code=excluded.flag_code,display_order=excluded.display_order,is_active=true,updated_at=now();

insert into public.country_news_sources(country_id,source_key,source_name,source_url,feed_url,source_type,scope_keywords,priority)
select c.id, v.source_key, v.source_name, v.source_url, v.feed_url, v.source_type, v.scope_keywords, v.priority
from public.arab_countries c
join (values
  ('algeria','dz_tsa','TSA Algérie','https://www.tsa-algerie.com/','https://www.tsa-algerie.com/feed/','local',array['الجزائر','الجزائري','الجزائرية','Algeria'],1),
  ('algeria','dz_france24','France 24 عربية — الجزائر','https://www.france24.com/ar/','https://www.france24.com/ar/rss','international',array['الجزائر','الجزائري','الجزائرية'],2),
  ('algeria','dz_aljazeera','الجزيرة — الجزائر','https://www.aljazeera.net/where/algeria/','https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9','regional',array['الجزائر','الجزائري','الجزائرية'],3),
  ('egypt','eg_masryalyoum','المصري اليوم','https://www.almasryalyoum.com/','https://www.almasryalyoum.com/rss/rssfeed','local',array['مصر','المصري','المصرية'],1),
  ('egypt','eg_bbc','BBC عربي — مصر','https://www.bbc.com/arabic/topics/c2lej05ep0lt','https://feeds.bbci.co.uk/arabic/rss.xml','international',array['مصر','المصري','المصرية'],2),
  ('egypt','eg_aljazeera','الجزيرة — مصر','https://www.aljazeera.net/where/egypt/','https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9','regional',array['مصر','المصري','المصرية'],3),
  ('yemen','ye_saba','وكالة سبأ — اليمن','https://www.saba.ye/ar','https://www.saba.ye/ar/rss.xml','official',array['اليمن','اليمني','اليمنية'],1),
  ('yemen','ye_bbc','BBC عربي — اليمن','https://www.bbc.com/arabic/topics/c2lej05ep0lt','https://feeds.bbci.co.uk/arabic/rss.xml','international',array['اليمن','اليمني','اليمنية'],2),
  ('yemen','ye_aljazeera','الجزيرة — اليمن','https://www.aljazeera.net/where/yemen/','https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9','regional',array['اليمن','اليمني','اليمنية'],3)
) as v(slug,source_key,source_name,source_url,feed_url,source_type,scope_keywords,priority) on v.slug=c.slug
on conflict (source_key) do update set country_id=excluded.country_id,source_name=excluded.source_name,source_url=excluded.source_url,feed_url=excluded.feed_url,source_type=excluded.source_type,scope_keywords=excluded.scope_keywords,priority=excluded.priority,is_active=true,updated_at=now();
