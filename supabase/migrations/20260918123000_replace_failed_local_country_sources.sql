-- Replace only the four failing local country-news feeds with tested local alternatives.
-- Keep source_key and priority stable so the country ingest and existing article history remain isolated.
update public.country_news_sources
set source_name = 'Egypt Independent',
    source_url = 'https://www.egyptindependent.com/',
    feed_url = 'https://www.egyptindependent.com/feed/',
    source_type = 'local',
    scope_keywords = array['مصر','المصري','المصرية','Egypt','Egyptian','Cairo'],
    is_active = true,
    updated_at = now()
where source_key = 'eg_vetogate';

update public.country_news_sources
set source_name = 'Egyptian Streets',
    source_url = 'https://egyptianstreets.com/',
    feed_url = 'https://egyptianstreets.com/feed/',
    source_type = 'local',
    scope_keywords = array['مصر','المصري','المصرية','Egypt','Egyptian','Cairo'],
    is_active = true,
    updated_at = now()
where source_key = 'eg_youm7';

update public.country_news_sources
set source_name = 'قناة اليمن اليوم',
    source_url = 'https://www.yementdy.com/',
    feed_url = 'https://www.yementdy.com/rss-1.xml',
    source_type = 'local',
    scope_keywords = array['اليمن','اليمني','اليمنية','Yemen','Yemeni'],
    is_active = true,
    updated_at = now()
where source_key = 'ye_saba';

update public.country_news_sources
set source_name = 'قناة المهرية',
    source_url = 'https://almahriah.net/',
    feed_url = 'https://almahriah.net/rss/news?category=local',
    source_type = 'local',
    scope_keywords = array['اليمن','اليمني','اليمنية','Yemen','Yemeni'],
    is_active = true,
    updated_at = now()
where source_key = 'ye_yemenat';

-- Safety assertion: the replacement must preserve three active local sources per country.
do $$
declare
  bad_count integer;
begin
  select count(*) into bad_count
  from (
    select c.slug
    from public.arab_countries c
    left join public.country_news_sources s on s.country_id = c.id and s.is_active and s.source_type = 'local'
    where c.slug in ('algeria','egypt','yemen')
    group by c.slug
    having count(s.id) <> 3
  ) invalid;
  if bad_count <> 0 then
    raise exception 'country local source count assertion failed';
  end if;
end $$;
