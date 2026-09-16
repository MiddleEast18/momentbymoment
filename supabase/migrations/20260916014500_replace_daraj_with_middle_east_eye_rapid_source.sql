insert into public.news_sources (
  source_key, name, domain, source_kind, trust_weight,
  language_code, feed_url, is_active, default_category
) values (
  'middleeasteye', 'Middle East Eye', 'middleeasteye.net', 'manual',
  0.85, 'en', 'https://www.middleeasteye.net/rss', true, 'Politics'
)
on conflict (source_key) do update set
  name = excluded.name,
  domain = excluded.domain,
  source_kind = 'manual',
  language_code = 'en',
  feed_url = excluded.feed_url,
  is_active = true,
  updated_at = now();

update public.news_sources
set is_active = false, updated_at = now()
where source_key = 'daraj';
