-- =====================================================================
-- مِرصاد (Mirsad) — Improved schema
-- Hot live table + archive + verification queue + source health + RLS.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_trgm;

do $$
begin
  create type public.news_category as enum ('Politics', 'Economy', 'Tech', 'Society', 'Sports');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.news_sentiment as enum ('Negative', 'Positive', 'Neutral');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.news_layout_size as enum ('small', 'medium', 'large');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.news_review_state as enum ('auto', 'pending', 'approved', 'rejected', 'archived');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.news_source_kind as enum ('rss', 'api', 'manual');
exception when duplicate_object then null;
end $$;

create table if not exists public.news_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  name text not null,
  domain text,
  source_kind public.news_source_kind not null default 'rss',
  trust_weight numeric(5,2) not null default 1.00,
  language_code text not null default 'ar',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.news_articles (
  id uuid primary key default gen_random_uuid(),

  source_name text not null,
  source_url text not null unique,
  agency_urls text[] not null default '{}'::text[],

  headline text not null,
  summary text not null,

  category public.news_category not null,
  importance_score smallint not null check (importance_score between 1 and 100),
  sentiment public.news_sentiment not null default 'Neutral',

  layout_size public.news_layout_size generated always as (
    case
      when importance_score > 85 then 'large'
      when importance_score >= 60 then 'medium'
      else 'small'
    end
  ) stored,

  cluster_id uuid not null default gen_random_uuid(),
  update_count integer not null default 0,
  source_count integer not null default 1,
  source_trust_score numeric(5,2) not null default 0.00,
  confidence_score numeric(5,2) not null default 0.00,

  is_pending_verification boolean not null default false,
  verification_notes text,
  verified_by text,
  verified_at timestamptz,

  inherited_from_cache boolean not null default false,
  llm_model_used text,
  ai_hints jsonb not null default '{}'::jsonb,
  claim_digest jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,

  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.news_articles is
  'Live hot table. Verified public items stay here for 48 hours, then move to news_archive.';
comment on column public.news_articles.cluster_id is
  'Shared cluster key for one evolving event; updates mutate one parent row instead of creating duplicates.';

create table if not exists public.news_archive (
  id uuid primary key,
  source_name text not null,
  source_url text not null,
  agency_urls text[] not null default '{}'::text[],
  headline text not null,
  summary text not null,
  category public.news_category not null,
  importance_score smallint not null,
  sentiment public.news_sentiment not null,
  layout_size public.news_layout_size not null,
  cluster_id uuid not null,
  update_count integer not null default 0,
  source_count integer not null default 1,
  source_trust_score numeric(5,2) not null default 0.00,
  confidence_score numeric(5,2) not null default 0.00,
  is_pending_verification boolean not null default false,
  verification_notes text,
  verified_by text,
  verified_at timestamptz,
  inherited_from_cache boolean not null default false,
  llm_model_used text,
  ai_hints jsonb not null default '{}'::jsonb,
  claim_digest jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  published_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz not null default now()
);

create table if not exists public.news_verification_queue (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.news_articles(id) on delete cascade,
  cluster_id uuid not null,
  source_name text not null,
  source_url text not null,
  headline text not null,
  summary text not null,
  verification_notes text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(article_id)
);

create table if not exists public.source_health (
  source_key text primary key,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error text,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_news_articles_published_at on public.news_articles (published_at desc);
create index if not exists idx_news_articles_cluster_id on public.news_articles (cluster_id);
create index if not exists idx_news_articles_category on public.news_articles (category);
create index if not exists idx_news_articles_pending on public.news_articles (is_pending_verification) where is_pending_verification = true;
create index if not exists idx_news_articles_importance on public.news_articles (importance_score desc, published_at desc);
create index if not exists idx_news_articles_headline_trgm on public.news_articles using gin (headline gin_trgm_ops);
create index if not exists idx_news_articles_summary_trgm on public.news_articles using gin (summary gin_trgm_ops);
create index if not exists idx_news_archive_published_at on public.news_archive (published_at desc);
create index if not exists idx_news_archive_cluster_id on public.news_archive (cluster_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.merge_cluster_update(
  p_cluster_id uuid,
  p_summary text,
  p_agency_url text default null,
  p_claim_digest jsonb default '{}'::jsonb,
  p_source_trust_score numeric default null
)
returns public.news_articles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result public.news_articles;
begin
  update public.news_articles
  set
    summary = p_summary,
    update_count = update_count + 1,
    source_count = source_count + 1,
    agency_urls = case
      when p_agency_url is not null and not (p_agency_url = any(agency_urls))
        then array_append(agency_urls, p_agency_url)
      else agency_urls
    end,
    claim_digest = case
      when p_claim_digest <> '{}'::jsonb then p_claim_digest
      else claim_digest
    end,
    source_trust_score = case
      when p_source_trust_score is not null then greatest(source_trust_score, p_source_trust_score)
      else source_trust_score
    end,
    confidence_score = least(100, greatest(confidence_score, coalesce(p_source_trust_score, confidence_score))),
    published_at = now()
  where cluster_id = p_cluster_id
  returning * into result;

  if not found then
    raise exception 'cluster % not found', p_cluster_id;
  end if;

  return result;
end;
$$;

create or replace function public.purge_old_news()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.news_archive (
    id, source_name, source_url, agency_urls, headline, summary, category,
    importance_score, sentiment, layout_size, cluster_id, update_count,
    source_count, source_trust_score, confidence_score, is_pending_verification,
    verification_notes, verified_by, verified_at, inherited_from_cache,
    llm_model_used, ai_hints, claim_digest, raw_payload, published_at,
    created_at, updated_at, archived_at
  )
  select
    id, source_name, source_url, agency_urls, headline, summary, category,
    importance_score, sentiment, layout_size, cluster_id, update_count,
    source_count, source_trust_score, confidence_score, is_pending_verification,
    verification_notes, verified_by, verified_at, inherited_from_cache,
    llm_model_used, ai_hints, claim_digest, raw_payload, published_at,
    created_at, updated_at, now()
  from public.news_articles
  where published_at < now() - interval '48 hours'
  on conflict (id) do nothing;

  delete from public.news_articles
  where published_at < now() - interval '48 hours';
end;
$$;

create or replace function public.record_source_health(
  p_source_key text,
  p_ok boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.source_health (
    source_key, last_success_at, last_failure_at, consecutive_failures, last_error, next_retry_at
  )
  values (
    p_source_key,
    case when p_ok then now() else null end,
    case when p_ok then null else now() end,
    case when p_ok then 0 else 1 end,
    p_error,
    case when p_ok then null else now() + interval '15 minutes' end
  )
  on conflict (source_key) do update
    set last_success_at = case when p_ok then now() else source_health.last_success_at end,
        last_failure_at = case when p_ok then source_health.last_failure_at else now() end,
        consecutive_failures = case when p_ok then 0 else source_health.consecutive_failures + 1 end,
        last_error = p_error,
        next_retry_at = case when p_ok then null else now() + (interval '5 minutes' * greatest(1, least(12, source_health.consecutive_failures + 1))) end,
        updated_at = now();
end;
$$;

create or replace view public.admin_ops_queue as
select
  id,
  source_name,
  source_url,
  headline,
  summary,
  cluster_id,
  verification_notes,
  raw_payload,
  created_at
from public.news_articles
where is_pending_verification = true
order by created_at asc;

alter table public.news_articles enable row level security;
alter table public.news_archive enable row level security;
alter table public.news_verification_queue enable row level security;
alter table public.news_sources enable row level security;
alter table public.source_health enable row level security;

drop policy if exists "public_read_live" on public.news_articles;
create policy "public_read_live"
  on public.news_articles
  for select
  to anon, authenticated
  using (is_pending_verification = false);

drop policy if exists "news_admin_read_live" on public.news_articles;
create policy "news_admin_read_live"
  on public.news_articles
  for select
  to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'news_admin');

drop policy if exists "news_admin_update_live" on public.news_articles;
create policy "news_admin_update_live"
  on public.news_articles
  for update
  to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'news_admin')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'news_admin');

drop policy if exists "public_read_archive" on public.news_archive;
create policy "public_read_archive"
  on public.news_archive
  for select
  to anon, authenticated
  using (true);

drop policy if exists "news_admin_manage_queue" on public.news_verification_queue;
create policy "news_admin_manage_queue"
  on public.news_verification_queue
  for all
  to authenticated
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'news_admin')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'news_admin');

drop policy if exists "service_role_manage_everything_articles" on public.news_articles;
create policy "service_role_manage_everything_articles"
  on public.news_articles
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_manage_everything_archive" on public.news_archive;
create policy "service_role_manage_everything_archive"
  on public.news_archive
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_manage_queue" on public.news_verification_queue;
create policy "service_role_manage_queue"
  on public.news_verification_queue
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_manage_sources" on public.news_sources;
create policy "service_role_manage_sources"
  on public.news_sources
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service_role_manage_health" on public.source_health;
create policy "service_role_manage_health"
  on public.source_health
  for all
  to service_role
  using (true)
  with check (true);

alter table public.news_articles replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.news_articles;
exception when duplicate_object then null;
exception when undefined_object then null;
end $$;

select cron.schedule(
  'mirsad-purge-old-news',
  '0 21 * * *',
  $$select public.purge_old_news();$$
);
