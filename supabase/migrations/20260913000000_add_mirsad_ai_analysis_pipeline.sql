create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.news_articles(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  attempts integer not null default 0,
  priority smallint not null default 0,
  provider text,
  model text,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists analysis_jobs_one_active_per_article
on public.analysis_jobs(article_id)
where status in ('queued','processing');

create index if not exists analysis_jobs_queue_idx
on public.analysis_jobs(priority desc, created_at asc)
where status = 'queued';

create table if not exists public.article_analysis (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.news_articles(id) on delete cascade,
  job_id uuid references public.analysis_jobs(id) on delete set null,
  provider text not null,
  model text not null,
  status text not null check (status in ('completed','partial','failed')),
  analysis jsonb not null default '{}'::jsonb,
  prompt_version text not null,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(article_id, prompt_version)
);

create index if not exists article_analysis_article_idx on public.article_analysis(article_id);

alter table public.analysis_jobs enable row level security;
alter table public.article_analysis enable row level security;
revoke all on table public.analysis_jobs from anon, authenticated;
revoke all on table public.article_analysis from anon, authenticated;
grant all on table public.analysis_jobs to service_role;
grant all on table public.article_analysis to service_role;

create or replace function public.enqueue_article_analysis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.analysis_jobs(article_id, priority, payload)
  values (
    new.id,
    greatest(0, least(100, coalesce(new.importance_score, 0))),
    jsonb_build_object('source_name',new.source_name,'headline',new.headline,'summary',new.summary,'category',new.category,'published_at',new.published_at)
  )
  on conflict (article_id) where status in ('queued','processing') do nothing;
  return new;
end;
$$;

revoke all on function public.enqueue_article_analysis() from public, anon, authenticated;
grant execute on function public.enqueue_article_analysis() to service_role;

drop trigger if exists trg_enqueue_article_analysis on public.news_articles;
create trigger trg_enqueue_article_analysis
after insert on public.news_articles
for each row execute function public.enqueue_article_analysis();

create or replace function public.claim_analysis_job(p_job_id uuid default null)
returns setof public.analysis_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.analysis_jobs;
begin
  if p_job_id is not null then
    update public.analysis_jobs
    set status='processing', attempts=attempts+1, started_at=now(), updated_at=now()
    where id=p_job_id and status='queued'
    returning * into claimed;
  else
    with next_job as (
      select id from public.analysis_jobs
      where status='queued'
      order by priority desc, created_at asc
      for update skip locked
      limit 1
    )
    update public.analysis_jobs j
    set status='processing', attempts=j.attempts+1, started_at=now(), updated_at=now()
    from next_job n
    where j.id=n.id
    returning j.* into claimed;
  end if;
  if claimed.id is not null then return next claimed; end if;
  return;
end;
$$;

revoke all on function public.claim_analysis_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_analysis_job(uuid) to service_role;

insert into public.analysis_jobs(article_id, priority, payload)
select a.id,
       greatest(0, least(100, coalesce(a.importance_score, 0))),
       jsonb_build_object('source_name',a.source_name,'headline',a.headline,'summary',a.summary,'category',a.category,'published_at',a.published_at)
from public.news_articles a
where not exists (
  select 1 from public.article_analysis aa
  where aa.article_id=a.id and aa.prompt_version='v1-gemini-flash-lite'
)
on conflict (article_id) where status in ('queued','processing') do nothing;
