create table if not exists public.deleted_account_balances (
  email_hash text primary key,
  remaining_unlocks integer not null check (remaining_unlocks >= 0),
  restored_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.deleted_account_balances enable row level security;
revoke all on public.deleted_account_balances from public, anon, authenticated;

create or replace function public.should_show_signup_onboarding()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.id = auth.uid()
      and p.onboarding_completed = false
      and u.created_at >= now() - interval '24 hours'
      and (
        exists (
          select 1 from public.deleted_account_balances d
          where d.email_hash = encode(digest(lower(trim(u.email)), 'sha256'), 'hex')
            and d.restored_at is null
        )
        or not exists (
          select 1 from public.first_signup_rewards r where r.user_id = u.id
        )
      )
  );
$function$;

revoke all on function public.should_show_signup_onboarding() from public, anon;
grant execute on function public.should_show_signup_onboarding() to authenticated;

drop function if exists public.claim_first_signup_reward();
create function public.claim_first_signup_reward()
returns table(claimed boolean, reward_amount integer, remaining_unlocks integer, unlimited boolean, restored boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  uid uuid := auth.uid();
  acct public.user_unlocks;
  prior public.deleted_account_balances;
  inserted_count integer;
  reward constant integer := 1000;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  insert into public.user_unlocks(user_id) values(uid) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = uid for update;

  select * into prior
  from public.deleted_account_balances d
  join auth.users u on u.id = uid
  where d.email_hash = encode(digest(lower(trim(u.email)), 'sha256'), 'hex')
    and d.restored_at is null
  for update;

  if prior.email_hash is not null then
    update public.user_unlocks
    set unlock_balance = prior.remaining_unlocks, updated_at = now()
    where user_id = uid
    returning * into acct;
    update public.deleted_account_balances
    set restored_at = now()
    where email_hash = prior.email_hash and restored_at is null;
    insert into public.first_signup_rewards(user_id, reward_amount)
    values(uid, 0) on conflict (user_id) do nothing;
    return query select false, 0, acct.unlock_balance, acct.unlimited_unlocks, true;
    return;
  end if;

  if not public.should_show_signup_onboarding() then
    return query select false, reward, acct.unlock_balance, acct.unlimited_unlocks, false;
    return;
  end if;

  insert into public.first_signup_rewards(user_id, reward_amount)
  values(uid, reward) on conflict (user_id) do nothing;
  get diagnostics inserted_count = row_count;
  return query select inserted_count = 1, reward, acct.unlock_balance, acct.unlimited_unlocks, false;
end;
$function$;

revoke all on function public.claim_first_signup_reward() from public, anon;
grant execute on function public.claim_first_signup_reward() to authenticated;
