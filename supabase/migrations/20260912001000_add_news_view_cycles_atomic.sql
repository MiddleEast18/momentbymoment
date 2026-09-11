create table if not exists public.news_view_cycles (
  user_id uuid not null references auth.users(id) on delete cascade,
  view_kind text not null check (view_kind in ('more', 'all')),
  last_discount_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, view_kind)
);

alter table public.news_view_cycles enable row level security;
revoke all on public.news_view_cycles from public, anon, authenticated;

drop function if exists public.consume_news_view(text);
create or replace function public.consume_news_view(p_view_kind text)
returns table(allowed boolean, charged boolean, remaining_unlocks integer, unlimited boolean, new_count bigint, threshold integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  acct public.user_unlocks;
  cycle public.news_view_cycles;
  needed integer;
  threshold_value integer;
  count_new bigint;
  now_at timestamptz := clock_timestamp();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_view_kind not in ('more', 'all') then raise exception 'invalid_view_kind'; end if;

  needed := case when p_view_kind = 'more' then 5 else 100 end;
  threshold_value := case when p_view_kind = 'more' then 10 else 100 end;

  insert into public.user_unlocks(user_id) values(uid) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = uid for update;

  insert into public.news_view_cycles(user_id, view_kind)
  values(uid, p_view_kind)
  on conflict (user_id, view_kind) do nothing;
  select * into cycle from public.news_view_cycles
  where user_id = uid and view_kind = p_view_kind for update;

  if cycle.last_discount_at is null then
    count_new := threshold_value;
  else
    select count(*) into count_new
    from (
      select source_url, max(arrived_at) as arrived_at
      from (
        select source_url, created_at as arrived_at
        from public.news_articles
        where created_at > cycle.last_discount_at and is_pending_verification = false
        union all
        select source_url, received_at as arrived_at
        from public.rapid_news
        where received_at > cycle.last_discount_at
      ) incoming
      group by source_url
    ) unique_incoming;
  end if;

  if acct.unlimited_unlocks then
    return query select true, false, acct.unlock_balance, true, count_new, threshold_value;
    return;
  end if;
  if count_new < threshold_value then
    return query select true, false, acct.unlock_balance, false, count_new, threshold_value;
    return;
  end if;
  if acct.unlock_balance < needed then
    return query select false, false, acct.unlock_balance, false, count_new, threshold_value;
    return;
  end if;

  update public.user_unlocks
  set unlock_balance = unlock_balance - needed, updated_at = now_at
  where user_id = uid
  returning * into acct;

  update public.news_view_cycles
  set last_discount_at = now_at, updated_at = now_at
  where user_id = uid and view_kind = p_view_kind;

  insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
  values(uid, -needed, 'view_more_cycle', null);

  return query select true, true, acct.unlock_balance, false, 0::bigint, threshold_value;
end;
$$;

revoke all on function public.consume_news_view(text) from public, anon;
grant execute on function public.consume_news_view(text) to authenticated;

alter table public.unlock_ledger drop constraint if exists unlock_ledger_event_type_check;
alter table public.unlock_ledger add constraint unlock_ledger_event_type_check
  check (event_type = any (array['welcome','referral_reward','purchase','article_unlock','view_more_cycle','admin_adjustment']));
