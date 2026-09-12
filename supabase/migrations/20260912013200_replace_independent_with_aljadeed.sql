begin;

update public.news_sources
set source_key = 'youm7',
    name = 'Youm7',
    feed_url = 'https://www.youm7.com/rss/SectionRss?SectionID=65'
where source_key in ('independentarabia', 'aljadeed');

update public.source_health
set source_key = 'youm7'
where source_key in ('independentarabia', 'aljadeed');

commit;
