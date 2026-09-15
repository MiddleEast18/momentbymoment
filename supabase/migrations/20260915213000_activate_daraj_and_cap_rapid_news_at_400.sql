update public.news_sources
set is_active = true,
    updated_at = now()
where source_key = 'daraj';
