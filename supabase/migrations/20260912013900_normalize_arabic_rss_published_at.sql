create or replace function public.normalize_news_published_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v text;
  m text[];
  month_num integer;
  hour_num integer;
begin
  v := coalesce(new.raw_payload ->> 'published', '');
  m := regexp_match(v, '^(?:.*،\s*)?([0-9]{1,2})\s+(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s+([0-9]{4})\s+([0-9]{1,2}):([0-9]{2})\s+(ص|م)$');
  if m is not null then
    month_num := case m[2]
      when 'يناير' then 1 when 'فبراير' then 2 when 'مارس' then 3
      when 'أبريل' then 4 when 'مايو' then 5 when 'يونيو' then 6
      when 'يوليو' then 7 when 'أغسطس' then 8 when 'سبتمبر' then 9
      when 'أكتوبر' then 10 when 'نوفمبر' then 11 when 'ديسمبر' then 12
    end;
    hour_num := mod(m[4]::integer, 12) + case when m[6] = 'م' then 12 else 0 end;
    new.published_at := make_timestamptz(m[3]::integer, month_num, m[1]::integer, hour_num, m[5]::integer, 0, 'Asia/Riyadh');
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_news_published_at on public.news_articles;
create trigger normalize_news_published_at
before insert or update of raw_payload, published_at on public.news_articles
for each row execute function public.normalize_news_published_at();
