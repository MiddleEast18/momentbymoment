-- Drop stale rapid items that were inserted before the 48h freshness filter,
-- plus leftovers from deactivated sources. Keep the 400-row cap ordered by
-- actual publication time so old DW/BBC items cannot crowd the live layer.

delete from public.rapid_news
where published_at is not null
  and published_at < now() - interval '48 hours';

delete from public.rapid_news r
where not exists (
  select 1
  from public.news_sources s
  where s.source_key = r.source_key
    and s.is_active = true
);

create or replace function public.mirsad_trim_rapid_news_to_400()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.rapid_news
  where published_at is not null
    and published_at < now() - interval '48 hours';

  delete from public.rapid_news r
  where not exists (
    select 1
    from public.news_sources s
    where s.source_key = r.source_key
      and s.is_active = true
  );

  with keep as (
    select id
    from public.rapid_news
    order by coalesce(published_at, received_at) desc nulls last,
             received_at desc,
             id desc
    limit 400
  ),
  deleted as (
    delete from public.rapid_news r
    where not exists (select 1 from keep k where k.id = r.id)
    returning 1
  )
  select count(*) into deleted_count from deleted;
  return deleted_count;
end;
$$;
