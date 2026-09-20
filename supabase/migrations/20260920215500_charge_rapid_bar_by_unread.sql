-- Charge opening the English rapid-news bar by unread item count.
-- Marking items seen is now part of open_rapid_news; clients cannot zero unread for free.

create or replace function public.open_rapid_news()
returns table(allowed boolean, charged boolean, unread_count integer, remaining_unlocks integer, unlimited boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
  acct public.user_unlocks;
  seen public.rapid_news_seen;
  unread integer;
  seen_at timestamptz := clock_timestamp();
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  insert into public.user_unlocks(user_id) values (uid) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = uid for update;

  insert into public.rapid_news_seen(user_id, last_seen_at, updated_at)
  values (uid, 'epoch'::timestamptz, 'epoch'::timestamptz)
  on conflict (user_id) do nothing;
  select * into seen from public.rapid_news_seen where user_id = uid for update;

  select count(*)::integer into unread
  from public.rapid_news
  where received_at > seen.last_seen_at
    and received_at >= now() - interval '7 days';

  if unread = 0 then
    update public.rapid_news_seen
       set last_seen_at = seen_at, updated_at = seen_at
     where user_id = uid;
    return query select true, false, 0, acct.unlock_balance, acct.unlimited_unlocks;
    return;
  end if;

  if acct.unlimited_unlocks then
    update public.rapid_news_seen
       set last_seen_at = seen_at, updated_at = seen_at
     where user_id = uid;
    return query select true, false, unread, acct.unlock_balance, true;
    return;
  end if;

  if acct.unlock_balance < unread then
    return query select false, false, unread, acct.unlock_balance, false;
    return;
  end if;

  update public.user_unlocks
     set unlock_balance = unlock_balance - unread, updated_at = seen_at
   where user_id = uid
   returning * into acct;

  insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
  values (uid, -unread, 'rapid_news_open', uid);

  update public.rapid_news_seen
     set last_seen_at = seen_at, updated_at = seen_at
   where user_id = uid;

  return query select true, true, unread, acct.unlock_balance, false;
end;
$function$;

revoke all on function public.open_rapid_news() from public, anon;
grant execute on function public.open_rapid_news() to authenticated;
revoke all on function public.rapid_news_mark_seen() from public, anon, authenticated;
