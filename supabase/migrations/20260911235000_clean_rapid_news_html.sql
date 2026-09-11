update public.rapid_news
set headline = regexp_replace(regexp_replace(regexp_replace(headline, '<br\s*/?>', E'\n', 'gi'), '</(p|div|li|h[1-6])>', E'\n', 'gi'), '<[^>]*>', '', 'g'),
    summary = regexp_replace(regexp_replace(regexp_replace(summary, '<br\s*/?>', E'\n', 'gi'), '</(p|div|li|h[1-6])>', E'\n', 'gi'), '<[^>]*>', '', 'g')
where id in (select id from public.rapid_news order by received_at desc limit 100);

update public.rapid_news
set headline = replace(replace(replace(replace(headline, '&nbsp;', ' '), '&amp;', '&'), '&quot;', chr(34)), '&apos;', chr(39)),
    summary = replace(replace(replace(replace(summary, '&nbsp;', ' '), '&amp;', '&'), '&quot;', chr(34)), '&apos;', chr(39))
where id in (select id from public.rapid_news order by received_at desc limit 100);
