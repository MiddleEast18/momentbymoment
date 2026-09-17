-- Normalize legacy RSS entities that were stored before the decoder was expanded.
update public.country_news_articles
set headline = replace(replace(replace(replace(replace(replace(replace(replace(headline, '&rsquo;', '’'), '&lsquo;', '‘'), '&rdquo;', '”'), '&ldquo;', '“'), '&hellip;', '…'), '&#8230;', '…'), '&amp;', '&'), '&nbsp;', ' '),
    summary = replace(replace(replace(replace(replace(replace(replace(replace(summary, '&rsquo;', '’'), '&lsquo;', '‘'), '&rdquo;', '”'), '&ldquo;', '“'), '&hellip;', '…'), '&#8230;', '…'), '&amp;', '&'), '&nbsp;', ' '),
    updated_at = now()
where headline ~ '&(rsquo|lsquo|rdquo|ldquo|hellip|amp|nbsp);|&#8230;'
   or summary ~ '&(rsquo|lsquo|rdquo|ldquo|hellip|amp|nbsp);|&#8230;';
