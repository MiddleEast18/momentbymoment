alter table public.country_article_translations drop constraint if exists country_article_translations_target_language_check;
alter table public.country_article_translations
  add constraint country_article_translations_target_language_check
  check (target_language ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2}|-[0-9]{3})?$' and length(target_language) <= 20);
