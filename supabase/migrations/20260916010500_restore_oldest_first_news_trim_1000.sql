create or replace function public.purge_old_news() returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  doomed uuid[];
begin
  with ranked as (
    select id, row_number() over (
      order by coalesce(published_at, ingested_at, created_at) desc nulls last,
               ingested_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
    from public.news_articles
  )
  select array_agg(id) into doomed from ranked where rn > 1000;
  if doomed is null or cardinality(doomed) = 0 then return; end if;
  update public.news_verification_queue set article_id = null where article_id = any(doomed);
  update public.source_item_ledger
  set main_article_id = null, status = 'main_rejected',
      ingest_decision = 'archived_by_oldest_first_trim', updated_at = now()
  where main_article_id = any(doomed);
  delete from public.news_articles where id = any(doomed);
end;
$$;

create or replace function public.mirsad_trim_news_to_400() returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  doomed uuid[];
  deleted_count integer := 0;
begin
  with ranked as (
    select id, row_number() over (
      order by coalesce(published_at, ingested_at, created_at) desc nulls last,
               ingested_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
    from public.news_articles
  )
  select array_agg(id) into doomed from ranked where rn > 1000;
  if doomed is null or cardinality(doomed) = 0 then return 0; end if;
  update public.news_verification_queue set article_id = null where article_id = any(doomed);
  update public.source_item_ledger
  set main_article_id = null, status = 'main_rejected',
      ingest_decision = 'archived_by_oldest_first_trim', updated_at = now()
  where main_article_id = any(doomed);
  delete from public.news_articles where id = any(doomed);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
