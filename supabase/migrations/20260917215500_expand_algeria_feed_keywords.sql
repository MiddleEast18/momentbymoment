-- Algerian local feeds publish headlines in French as well as Arabic.
update public.country_news_sources
set scope_keywords = array['الجزائر','الجزائري','الجزائرية','algeria','algérie','algérien','algérienne','alger'], updated_at=now()
where source_key in ('dz_tsa','dz_ennahar','dz_algerie360');
