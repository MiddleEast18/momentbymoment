-- Replace mixed international/regional country-news sources with local outlets.
-- Keep exactly three active local sources per country and preserve existing articles.
with desired(slug, source_key, source_name, source_url, feed_url, scope_keywords, priority) as (
  values
    ('algeria','dz_tsa','TSA Algérie','https://www.tsa-algerie.com/','https://www.tsa-algerie.com/feed/',array['الجزائر','الجزائري','الجزائرية','Algeria']::text[],1),
    ('algeria','dz_ennahar','النهار الجزائرية','https://www.ennaharonline.com/','https://www.ennaharonline.com/feed/',array['الجزائر','الجزائري','الجزائرية']::text[],2),
    ('algeria','dz_algerie360','الجزائر 360','https://www.algerie360.com/','https://www.algerie360.com/feed/',array['الجزائر','الجزائري','الجزائرية']::text[],3),
    ('egypt','eg_masryalyoum','المصري اليوم','https://www.almasryalyoum.com/','https://www.almasryalyoum.com/rss/rssfeed',array['مصر','المصري','المصرية']::text[],1),
    ('egypt','eg_vetogate','فيتو','https://www.vetogate.com/','https://www.vetogate.com/rss',array['مصر','المصري','المصرية']::text[],2),
    ('egypt','eg_youm7','اليوم السابع','https://www.youm7.com/','https://www.youm7.com/rss/SectionRss?SectionID=65',array['مصر','المصري','المصرية']::text[],3),
    ('yemen','ye_saba','وكالة سبأ — اليمن','https://www.saba.ye/ar','https://www.saba.ye/ar/rss.xml',array['اليمن','اليمني','اليمنية']::text[],1),
    ('yemen','ye_yemenpress','يمن برس','https://yemen-press.net/','https://yemen-press.net/rss',array['اليمن','اليمني','اليمنية']::text[],2),
    ('yemen','ye_yemenat','يمنات','https://yemenat.net/','https://yemenat.net/feed/',array['اليمن','اليمني','اليمنية']::text[],3)
)
insert into public.country_news_sources(country_id, source_key, source_name, source_url, feed_url, source_type, scope_keywords, priority, is_active, updated_at)
select c.id, d.source_key, d.source_name, d.source_url, d.feed_url, 'local', d.scope_keywords, d.priority, true, now()
from desired d join public.arab_countries c on c.slug=d.slug
on conflict (source_key) do update set
  country_id=excluded.country_id, source_name=excluded.source_name, source_url=excluded.source_url,
  feed_url=excluded.feed_url, source_type='local', scope_keywords=excluded.scope_keywords,
  priority=excluded.priority, is_active=true, updated_at=now();

delete from public.country_news_sources
where source_key in ('dz_france24','dz_aljazeera','eg_bbc','eg_aljazeera','ye_bbc','ye_aljazeera');
