insert into public.source_item_ledger (
  source_key, item_key, source_url, guid, first_seen_at, last_seen_at,
  published_at, status, main_article_id, updated_at, headline, summary,
  ingest_decision
)
select s.source_key, n.source_url, n.source_url, n.source_url,
       n.ingested_at, n.ingested_at, n.published_at, 'main_ingested',
       n.id, now(), n.headline, coalesce(n.summary, n.headline),
       'backfilled_from_existing_card'
from public.news_articles n
join public.news_sources s on lower(trim(s.name)) = lower(trim(n.source_name))
left join public.source_item_ledger l
  on l.source_key = s.source_key and l.item_key = n.source_url
where n.is_pending_verification = false and l.source_key is null
on conflict (source_key, item_key) do update
set main_article_id = excluded.main_article_id,
    status = 'main_ingested',
    updated_at = now(),
    ingest_decision = 'synced_from_existing_card';

select public.mirsad_sync_ledger_main_status();
