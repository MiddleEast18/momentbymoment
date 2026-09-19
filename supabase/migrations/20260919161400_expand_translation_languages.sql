alter table public.country_article_translations drop constraint if exists country_article_translations_target_language_check;
alter table public.country_article_translations
  add constraint country_article_translations_target_language_check
  check (target_language in ('ar','en','ja','fr','de','es','it','tr','nl'));
