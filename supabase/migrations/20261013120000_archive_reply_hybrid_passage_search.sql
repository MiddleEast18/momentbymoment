-- Archive reply system only. Additive: no ingestion/billing object is touched.
create table if not exists public.archive_reply_bodies (
  article_id uuid primary key references public.news_articles(id) on delete cascade,
  source_url text not null, body_text text not null, fetch_status text not null,
  content_hash text not null, fetched_at timestamptz not null default now(),
  constraint archive_reply_bodies_status_chk check (fetch_status in ('ok','empty','failed','skipped'))
);
create table if not exists public.archive_reply_passages (
  article_id uuid not null references public.news_articles(id) on delete cascade,
  passage_index smallint not null, passage_text text not null,
  embedding extensions.vector(3072), updated_at timestamptz not null default now(),
  primary key (article_id, passage_index)
);
create index if not exists archive_reply_passages_article_idx on public.archive_reply_passages (article_id);
create table if not exists public.archive_reply_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  context_summary text not null, approved_reply text not null,
  active_article_id uuid, search_query text not null, updated_at timestamptz not null default now()
);
alter table public.archive_reply_bodies enable row level security;
alter table public.archive_reply_passages enable row level security;
alter table public.archive_reply_memory enable row level security;

create or replace function public.archive_reply_search_passages(
  p_embedding extensions.vector default null, p_search_text text default '', p_limit integer default 8)
returns table(article_id uuid, passage_index smallint, passage_text text, score double precision)
language sql stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  with q as (
    select public.mirsad_archive_normalize_arabic(coalesce(p_search_text, '')) as qtext
  ), toks as (
    -- token containment (not whole-word tsquery) so Arabic clitics such as و/ب/ل/ال do not hide a match
    select distinct case when t like 'ال%' and length(t) >= 5 then substr(t, 3) else t end as tok
    from q, unnest(regexp_split_to_array(q.qtext, '\s+')) as t
    where length(t) >= 3
  ), need as (
    select least(2, count(*))::int as n from toks
  ), base as (
    select p.article_id, p.passage_index, p.passage_text, p.embedding,
           public.mirsad_archive_normalize_arabic(p.passage_text) as ntext
    from public.archive_reply_passages p
    join public.news_articles n on n.id = p.article_id
     and n.is_pending_verification is false and n.source_url ~* '^https?://'
  ), scored as (
    select b.article_id, b.passage_index,
           (select count(*) from toks where position(toks.tok in b.ntext) > 0) as hits
    from base b
  ), lexical as (
    select s.article_id, s.passage_index,
           row_number() over (order by s.hits desc, s.article_id, s.passage_index) as rn
    from scored s cross join need
    where s.hits > 0 and s.hits >= need.n
    order by s.hits desc, s.article_id, s.passage_index
    limit 60
  ), semantic as (
    select b.article_id, b.passage_index,
           row_number() over (order by b.embedding <=> p_embedding, b.article_id, b.passage_index) as rn
    from base b
    where p_embedding is not null and b.embedding is not null
    order by b.embedding <=> p_embedding, b.article_id, b.passage_index
    limit 60
  ), fused as (
    select r.article_id, r.passage_index, sum(1.0 / (60.0 + r.rn))::double precision as score
    from (select * from lexical union all select * from semantic) r
    group by r.article_id, r.passage_index
  )
  select b.article_id, b.passage_index, b.passage_text, f.score
  from fused f join base b on b.article_id = f.article_id and b.passage_index = f.passage_index
  order by f.score desc, b.article_id, b.passage_index
  limit least(greatest(coalesce(p_limit, 8), 1), 12);
$$;
revoke all on function public.archive_reply_search_passages(extensions.vector, text, integer) from public, anon, authenticated;
grant execute on function public.archive_reply_search_passages(extensions.vector, text, integer) to service_role;
