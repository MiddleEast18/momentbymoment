update public.source_item_ledger set main_article_id = null, updated_at = now() where source_key = 'daraj';
delete from public.rapid_news where source_key = 'daraj';
delete from public.source_item_ledger where source_key = 'daraj';
delete from public.source_feed_state where source_key = 'daraj';
delete from public.source_health where source_key = 'daraj';
delete from public.news_articles where source_url ilike '%daraj.media%' or source_name ilike '%daraj%';
delete from public.news_sources where source_key = 'daraj';
