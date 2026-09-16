create table if not exists public.main_article_source_opens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id uuid not null references public.news_articles(id) on delete cascade,
  source_url text not null check (length(source_url) between 1 and 2048),
  charged_amount integer not null check (charged_amount in (0, 19, 20)),
  created_at timestamptz not null default now(),
  unique (user_id, article_id)
);

create table if not exists public.rapid_news_source_opens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rapid_news_id uuid not null references public.rapid_news(id) on delete cascade,
  source_url text not null check (length(source_url) between 1 and 2048),
  charged_amount integer not null check (charged_amount in (0, 20)),
  created_at timestamptz not null default now(),
  unique (user_id, rapid_news_id)
);

alter table public.main_article_source_opens enable row level security;
alter table public.rapid_news_source_opens enable row level security;
revoke all on public.main_article_source_opens from public, anon, authenticated;
revoke all on public.rapid_news_source_opens from public, anon, authenticated;

insert into public.main_article_source_opens(user_id, article_id, source_url, charged_amount, created_at)
select user_id, source_id, source_url, amount, created_at
from public.source_open_charges
where source_kind = 'article' and source_id is not null
on conflict (user_id, article_id) do nothing;

insert into public.rapid_news_source_opens(user_id, rapid_news_id, source_url, charged_amount, created_at)
select user_id, source_id, source_url, case when amount = 0 then 0 else 20 end, created_at
from public.source_open_charges
where source_kind = 'rapid' and source_id is not null
on conflict (user_id, rapid_news_id) do nothing;

create or replace function public.open_main_article_source(
  p_source_url text,
  p_request_id uuid,
  p_article_id uuid
)
returns table(opened boolean, charged boolean, remaining_unlocks integer, unlimited boolean, required_unlocks integer)
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare uid uuid := auth.uid(); acct public.user_unlocks; prior public.main_article_source_opens; charge constant integer := 19;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null or p_article_id is null or p_source_url is null or length(trim(p_source_url)) = 0 or length(p_source_url) > 2048 then raise exception 'invalid_source_request'; end if;
  if p_source_url !~* '^https?://' then raise exception 'invalid_source_url'; end if;
  if not exists (select 1 from public.news_articles where id = p_article_id) then raise exception 'article_unavailable'; end if;
  insert into public.user_unlocks(user_id) values(uid) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = uid for update;
  select * into prior from public.main_article_source_opens where user_id = uid and article_id = p_article_id;
  if prior.id is not null then return query select true, false, coalesce(acct.unlock_balance, 0), coalesce(acct.unlimited_unlocks, false), charge; return; end if;
  if acct.unlimited_unlocks then
    insert into public.main_article_source_opens(user_id, article_id, source_url, charged_amount) values(uid, p_article_id, trim(p_source_url), 0);
    return query select true, false, acct.unlock_balance, true, charge; return;
  end if;
  if acct.unlock_balance < charge then return query select false, false, acct.unlock_balance, false, charge; return; end if;
  update public.user_unlocks set unlock_balance = unlock_balance - charge, updated_at = now() where user_id = uid returning * into acct;
  insert into public.main_article_source_opens(user_id, article_id, source_url, charged_amount) values(uid, p_article_id, trim(p_source_url), charge);
  insert into public.unlock_ledger(user_id, amount, event_type, reference_id) values(uid, -charge, 'source_open', p_article_id);
  return query select true, true, acct.unlock_balance, false, charge;
end;
$function$;

create or replace function public.open_rapid_news_source(
  p_source_url text,
  p_request_id uuid,
  p_rapid_news_id uuid
)
returns table(opened boolean, charged boolean, remaining_unlocks integer, unlimited boolean, required_unlocks integer)
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare uid uuid := auth.uid(); acct public.user_unlocks; prior public.rapid_news_source_opens; charge constant integer := 20;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null or p_rapid_news_id is null or p_source_url is null or length(trim(p_source_url)) = 0 or length(p_source_url) > 2048 then raise exception 'invalid_source_request'; end if;
  if p_source_url !~* '^https?://' then raise exception 'invalid_source_url'; end if;
  if not exists (select 1 from public.rapid_news where id = p_rapid_news_id) then raise exception 'rapid_news_unavailable'; end if;
  insert into public.user_unlocks(user_id) values(uid) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = uid for update;
  select * into prior from public.rapid_news_source_opens where user_id = uid and rapid_news_id = p_rapid_news_id;
  if prior.id is not null then return query select true, false, coalesce(acct.unlock_balance, 0), coalesce(acct.unlimited_unlocks, false), charge; return; end if;
  if acct.unlimited_unlocks then
    insert into public.rapid_news_source_opens(user_id, rapid_news_id, source_url, charged_amount) values(uid, p_rapid_news_id, trim(p_source_url), 0);
    return query select true, false, acct.unlock_balance, true, charge; return;
  end if;
  if acct.unlock_balance < charge then return query select false, false, acct.unlock_balance, false, charge; return; end if;
  update public.user_unlocks set unlock_balance = unlock_balance - charge, updated_at = now() where user_id = uid returning * into acct;
  insert into public.rapid_news_source_opens(user_id, rapid_news_id, source_url, charged_amount) values(uid, p_rapid_news_id, trim(p_source_url), charge);
  insert into public.unlock_ledger(user_id, amount, event_type, reference_id) values(uid, -charge, 'source_open', p_rapid_news_id);
  return query select true, true, acct.unlock_balance, false, charge;
end;
$function$;

revoke all on function public.open_main_article_source(text, uuid, uuid) from public, anon;
grant execute on function public.open_main_article_source(text, uuid, uuid) to authenticated;
revoke all on function public.open_rapid_news_source(text, uuid, uuid) from public, anon;
grant execute on function public.open_rapid_news_source(text, uuid, uuid) to authenticated;
