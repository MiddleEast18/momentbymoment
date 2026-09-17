-- Correct local RSS endpoints and replace feeds that return no items or block automated readers.
update public.country_news_sources
set feed_url='https://www.saba.ye/ar/rsscatfeed1.htm', updated_at=now()
where source_key='ye_saba';

insert into public.country_news_sources(country_id, source_key, source_name, source_url, feed_url, source_type, scope_keywords, priority, is_active, updated_at)
select c.id, 'ye_alsahwa', 'الصحوة نت', 'https://www.alsahwa-yemen.net/', 'https://www.alsahwa-yemen.net/rss', 'local', array['اليمن','اليمني','اليمنية']::text[], 2, true, now()
from public.arab_countries c
where c.slug='yemen'
on conflict (source_key) do update set
  source_name=excluded.source_name, source_url=excluded.source_url, feed_url=excluded.feed_url,
  source_type='local', scope_keywords=excluded.scope_keywords, priority=excluded.priority,
  is_active=true, updated_at=now();
update public.country_news_sources set is_active=false, updated_at=now() where source_key='ye_yemenpress';

insert into public.country_news_sources(country_id, source_key, source_name, source_url, feed_url, source_type, scope_keywords, priority, is_active, updated_at)
select c.id, 'eg_dailynewsegypt', 'Daily News Egypt', 'https://www.dailynewsegypt.com/', 'https://www.dailynewsegypt.com/feed/', 'local', array['Egypt','Egyptian','مصر','المصري','المصرية']::text[], 1, true, now()
from public.arab_countries c
where c.slug='egypt'
on conflict (source_key) do update set
  source_name=excluded.source_name, source_url=excluded.source_url, feed_url=excluded.feed_url,
  source_type='local', scope_keywords=excluded.scope_keywords, priority=excluded.priority,
  is_active=true, updated_at=now();
update public.country_news_sources set is_active=false, updated_at=now() where source_key='eg_masryalyoum';
update public.country_news_sources set priority=2 where source_key='eg_vetogate';
update public.country_news_sources set priority=3 where source_key='eg_youm7';
