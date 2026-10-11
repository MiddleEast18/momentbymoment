alter table public.unlock_ledger drop constraint if exists unlock_ledger_event_type_check;
alter table public.unlock_ledger add constraint unlock_ledger_event_type_check check (event_type = any (array['welcome','referral_reward','purchase','article_unlock','view_more_cycle','view_all_access','rapid_news_open','daily_reward','admin_adjustment','source_open','archive_chat']));

create table if not exists public.archive_chat_charges (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  core_amount integer not null default 50 check (core_amount = 50),
  reviewer_amount integer not null default 50 check (reviewer_amount = 50),
  charged_amount integer not null default 100 check (charged_amount = 100),
  created_at timestamptz not null default now()
);
alter table public.archive_chat_charges enable row level security;
revoke all on public.archive_chat_charges from public, anon, authenticated;

create or replace function public.consume_archive_chat_charge(p_user_id uuid, p_request_id uuid)
returns table(charged boolean, remaining_unlocks integer, unlimited boolean, required_unlocks integer)
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  acct public.user_unlocks;
  charge constant integer := 100;
begin
  if p_user_id is null or p_request_id is null then raise exception 'invalid_archive_chat_charge'; end if;
  insert into public.user_unlocks(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = p_user_id for update;
  if exists (select 1 from public.archive_chat_charges where request_id = p_request_id and user_id = p_user_id) then
    return query select false, coalesce(acct.unlock_balance, 0), coalesce(acct.unlimited_unlocks, false), charge;
    return;
  end if;
  if acct.unlimited_unlocks then
    insert into public.archive_chat_charges(request_id, user_id) values (p_request_id, p_user_id);
    return query select false, acct.unlock_balance, true, charge;
    return;
  end if;
  if coalesce(acct.unlock_balance, 0) < charge then
    return query select false, coalesce(acct.unlock_balance, 0), false, charge;
    return;
  end if;
  update public.user_unlocks
     set unlock_balance = unlock_balance - charge, updated_at = now()
   where user_id = p_user_id
   returning * into acct;
  insert into public.archive_chat_charges(request_id, user_id) values (p_request_id, p_user_id);
  insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
  values (p_user_id, -charge, 'archive_chat', p_request_id);
  return query select true, acct.unlock_balance, false, charge;
end;
$function$;
revoke all on function public.consume_archive_chat_charge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_archive_chat_charge(uuid, uuid) to service_role;
