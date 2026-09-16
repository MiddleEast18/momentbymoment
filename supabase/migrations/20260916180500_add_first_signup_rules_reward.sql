create table if not exists public.first_signup_rewards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reward_amount integer not null default 1000 check (reward_amount = 1000),
  claimed_at timestamptz not null default now()
);

alter table public.first_signup_rewards enable row level security;
revoke all on public.first_signup_rewards from public, anon, authenticated;

create or replace function public.claim_first_signup_reward()
returns table(claimed boolean, reward_amount integer, remaining_unlocks integer, unlimited boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  uid uuid := auth.uid();
  acct public.user_unlocks;
  inserted_count integer;
  reward constant integer := 1000;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  insert into public.user_unlocks(user_id) values(uid) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = uid for update;

  if not exists (
    select 1 from public.profiles
    where id = uid and created_at >= now() - interval '15 minutes'
  ) then
    return query select false, reward, acct.unlock_balance, acct.unlimited_unlocks;
    return;
  end if;

  insert into public.first_signup_rewards(user_id, reward_amount)
  values(uid, reward)
  on conflict (user_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    return query select false, reward, acct.unlock_balance, acct.unlimited_unlocks;
    return;
  end if;

  update public.user_unlocks
  set unlock_balance = unlock_balance + reward, updated_at = now()
  where user_id = uid
  returning * into acct;

  insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
  values(uid, reward, 'welcome', uid);

  return query select true, reward, acct.unlock_balance, acct.unlimited_unlocks;
end;
$function$;

revoke all on function public.claim_first_signup_reward() from public, anon;
grant execute on function public.claim_first_signup_reward() to authenticated;
