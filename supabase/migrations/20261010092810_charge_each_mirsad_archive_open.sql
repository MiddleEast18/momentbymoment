-- Every explicit open in the archive costs its configured amount, including a repeat open.
-- This only changes archive_article_opens/charge_archive_operations behavior; no live-news path is touched.
CREATE OR REPLACE FUNCTION public.charge_archive_operations(
  p_user_id uuid,
  p_operations text[],
  p_article_id uuid DEFAULT NULL::uuid,
  p_commit boolean DEFAULT true
)
RETURNS TABLE(
  allowed boolean,
  charged boolean,
  charged_amount integer,
  remaining_unlocks integer,
  unlimited boolean,
  operations text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  acct public.user_unlocks;
  op text;
  ops text[] := array[]::text[];
  prices jsonb := '{"archive_search":2,"archive_open":2,"archive_briefing":3,"archive_dialogue":3,"archive_followup":2,"archive_other":1}'::jsonb;
  cost integer := 0;
  price integer;
begin
  if p_user_id is null then
    return query select false, false, 0, 0, false, ops;
    return;
  end if;

  if p_article_id is not null and not exists (
    select 1 from public.news_articles n where n.id = p_article_id and n.is_pending_verification = false
  ) then
    p_article_id := null;
  end if;

  if p_operations is not null then
    foreach op in array p_operations loop
      if op is null or not (prices ? op) then
        raise exception 'unknown_archive_operation';
      end if;
      if op = any (ops) then
        continue;
      end if;
      if op = 'archive_open' and p_article_id is null then
        raise exception 'invalid_archive_article';
      end if;
      ops := ops || op;
      cost := cost + (prices ->> op)::integer;
    end loop;
  end if;

  insert into public.user_unlocks(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = p_user_id for update;

  if acct.unlimited_unlocks then
    if p_commit and p_article_id is not null and 'archive_open' = any (p_operations) then
      insert into public.archive_article_opens(user_id, article_id)
      values (p_user_id, p_article_id)
      on conflict do nothing;
    end if;
    return query select true, false, 0, acct.unlock_balance, true, ops;
    return;
  end if;

  if cost = 0 then
    return query select true, false, 0, acct.unlock_balance, false, ops;
    return;
  end if;

  if acct.unlock_balance < cost then
    return query select false, false, cost, acct.unlock_balance, false, ops;
    return;
  end if;

  if not p_commit then
    return query select true, false, cost, acct.unlock_balance, false, ops;
    return;
  end if;

  update public.user_unlocks
     set unlock_balance = unlock_balance - cost,
         updated_at = now()
   where user_id = p_user_id
   returning * into acct;

  foreach op in array ops loop
    price := (prices ->> op)::integer;
    insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
    values (
      p_user_id,
      -price,
      op,
      case when op in ('archive_open', 'archive_briefing', 'archive_dialogue', 'archive_followup') then p_article_id else null end
    );
  end loop;

  if 'archive_open' = any (ops) and p_article_id is not null then
    insert into public.archive_article_opens(user_id, article_id)
    values (p_user_id, p_article_id)
    on conflict do nothing;
  end if;

  return query select true, true, cost, acct.unlock_balance, false, ops;
end;
$function$;
