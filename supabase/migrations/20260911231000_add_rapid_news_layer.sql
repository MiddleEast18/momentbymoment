create table if not exists public.rapid_news (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_name text not null,
  source_url text not null,
  headline text not null,
  summary text not null default '',
  published_at timestamptz,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_url)
);

create index if not exists rapid_news_received_at_idx
  on public.rapid_news (received_at desc);
create index if not exists rapid_news_published_at_idx
  on public.rapid_news (published_at desc nulls last);

create table if not exists public.rapid_news_seen (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rapid_news enable row level security;
alter table public.rapid_news_seen enable row level security;

drop policy if exists rapid_news_read_anon on public.rapid_news;
create policy rapid_news_read_anon on public.rapid_news
  for select to anon, authenticated using (received_at >= now() - interval '7 days');

drop policy if exists rapid_news_seen_self on public.rapid_news_seen;
create policy rapid_news_seen_self on public.rapid_news_seen
  for select to authenticated using (user_id = auth.uid());

drop policy if exists rapid_news_seen_insert_self on public.rapid_news_seen;
create policy rapid_news_seen_insert_self on public.rapid_news_seen
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists rapid_news_seen_update_self on public.rapid_news_seen;
create policy rapid_news_seen_update_self on public.rapid_news_seen
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke insert, update, delete on public.rapid_news from public, anon, authenticated;
revoke insert, update, delete on public.rapid_news_seen from anon;

grant select on public.rapid_news to anon, authenticated;
grant select, insert, update on public.rapid_news_seen to authenticated;

drop function if exists public.rapid_news_unread_count();
create or replace function public.rapid_news_unread_count()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.rapid_news n
  where auth.uid() is not null
    and n.received_at > coalesce(
      (select last_seen_at from public.rapid_news_seen where user_id = auth.uid()),
      'epoch'::timestamptz
    )
    and n.received_at >= now() - interval '7 days';
$$;

revoke all on function public.rapid_news_unread_count() from public, anon;
grant execute on function public.rapid_news_unread_count() to authenticated;

drop function if exists public.rapid_news_mark_seen();
create or replace function public.rapid_news_mark_seen()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  seen_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.rapid_news_seen(user_id, last_seen_at, updated_at)
  values (auth.uid(), seen_at, seen_at)
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at;
  return seen_at;
end;
$$;

revoke all on function public.rapid_news_mark_seen() from public, anon;
grant execute on function public.rapid_news_mark_seen() to authenticated;

-- Remove only the independent layer's expired items; the normal news store is untouched.
select cron.schedule(
  'mirsad-rapid-news-purge',
  '17 * * * *',
  $$delete from public.rapid_news where received_at < now() - interval '7 days';$$
)
where not exists (select 1 from cron.job where jobname = 'mirsad-rapid-news-purge' limit 1);

select cron.schedule(
  'mirsad-rapid-news-ingest',
  '* * * * *',
  $$select net.http_post(
    url := 'https://dndlkenyfymlrjnslyzb.supabase.co/functions/v1/mirsad-rapid-ingest',
    headers := jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuZGxrZW55ZnltbHJqbnNseXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDczMDEsImV4cCI6MjEwNDUyMzMwMX0.jBNL9JBF8OvwfieTl-HoAVL4leihYeAUkAQ-JaXy0y4','Authorization','Bearer ' || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRuZGxrZW55ZnltbHJqbnNseXpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDczMDEsImV4cCI6MjEwNDUyMzMwMX0.jBNL9JBF8OvwfieTl-HoAVL4leihYeAUkAQ-JaXy0y4'),
    body := '{}'::jsonb
  );$$
)
where not exists (select 1 from cron.job where jobname = 'mirsad-rapid-news-ingest' limit 1);

alter table public.rapid_news replica identity full;
alter publication supabase_realtime add table public.rapid_news;
