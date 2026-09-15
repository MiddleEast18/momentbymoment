create or replace function public.purge_old_news() returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  return;
end;
$$;

create or replace function public.mirsad_trim_news_to_400() returns integer
language plpgsql
set search_path = public
as $$
begin
  return 0;
end;
$$;
