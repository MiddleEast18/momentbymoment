create table if not exists public.source_open_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  source_url text not null check (length(source_url) between 1 and 2048),
  amount integer not null default 20 check (amount = 20),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

alter table public.source_open_charges enable row level security;
revoke all on public.source_open_charges from public, anon, authenticated;

alter table public.unlock_ledger drop constraint if exists unlock_ledger_event_type_check;
alter table public.unlock_ledger add constraint unlock_ledger_event_type_check check (
  event_type = any (array[
    'welcome','referral_reward','purchase','article_unlock','source_open',
    'view_more_cycle','view_all_access','rapid_news_open','daily_reward','admin_adjustment'
  ])
);

create or replace function public.open_original_source(
  p_source_url text,
  p_request_id uuid
)
returns table(
  opened boolean,
  charged boolean,
  remaining_unlocks integer,
  unlimited boolean,
  required_unlocks integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  uid uuid := auth.uid();
  acct public.user_unlocks;
  prior public.source_open_charges;
  charge constant integer := 20;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null or p_source_url is null or length(trim(p_source_url)) = 0 or length(p_source_url) > 2048 then
    raise exception 'invalid_source_request';
  end if;
  if p_source_url !~* '^https?://' then raise exception 'invalid_source_url'; end if;

  select * into prior
  from public.source_open_charges
  where user_id = uid and request_id = p_request_id;
  if prior.id is not null then
    select * into acct from public.user_unlocks where user_id = uid;
    return query select true, true, coalesce(acct.unlock_balance, 0), coalesce(acct.unlimited_unlocks, false), charge;
    return;
  end if;

  insert into public.user_unlocks(user_id) values(uid) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = uid for update;

  if acct.unlimited_unlocks then
    return query select true, false, acct.unlock_balance, true, charge;
    return;
  end if;

  if acct.unlock_balance < charge then
    return query select false, false, acct.unlock_balance, false, charge;
    return;
  end if;

  update public.user_unlocks
  set unlock_balance = unlock_balance - charge, updated_at = now()
  where user_id = uid
  returning * into acct;

  insert into public.source_open_charges(user_id, request_id, source_url, amount)
  values(uid, p_request_id, trim(p_source_url), charge);
  insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
  values(uid, -charge, 'source_open', p_request_id);

  return query select true, true, acct.unlock_balance, false, charge;
end;
$function$;

revoke all on function public.open_original_source(text, uuid) from public, anon;
grant execute on function public.open_original_source(text, uuid) to authenticated;
