create or replace function public.rapid_news_trim_to_100()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.rapid_news
  where id in (
    select id
    from public.rapid_news
    order by received_at desc, id desc
    offset 100
  );
  return null;
end;
$$;

revoke all on function public.rapid_news_trim_to_100() from public, anon, authenticated;

drop trigger if exists rapid_news_cap_after_insert on public.rapid_news;
create trigger rapid_news_cap_after_insert
after insert on public.rapid_news
for each statement
execute function public.rapid_news_trim_to_100();

-- Enforce the invariant immediately if this migration is applied to a non-empty table.
delete from public.rapid_news
where id in (
  select id
  from public.rapid_news
  order by received_at desc, id desc
  offset 100
);
