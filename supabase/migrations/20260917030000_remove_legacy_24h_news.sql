-- Remove retired 24-hour news storage after the country-news migration.
-- RESTRICT is intentional: fail closed if an unexpected dependency exists.
drop table if exists public.trusted_news_articles restrict;
drop table if exists public.news_24h_articles restrict;
