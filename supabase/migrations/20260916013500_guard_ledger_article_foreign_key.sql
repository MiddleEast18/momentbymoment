create or replace function public.guard_source_item_ledger_article_fk()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.main_article_id is not null
     and not exists (select 1 from public.news_articles where id = new.main_article_id) then
    new.main_article_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_source_item_ledger_article_fk
  on public.source_item_ledger;

create trigger trg_guard_source_item_ledger_article_fk
before insert or update of main_article_id
on public.source_item_ledger
for each row execute function public.guard_source_item_ledger_article_fk();

update public.source_item_ledger l
set main_article_id = null, updated_at = now()
where l.main_article_id is not null
  and not exists (
    select 1 from public.news_articles n where n.id = l.main_article_id
  );
