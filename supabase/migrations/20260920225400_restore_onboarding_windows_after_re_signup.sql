-- Show deduction-rules + remaining-balance dialogs after delete-then-re-signup.
-- Trigger restores numeric balance and marks restored_at, but does NOT write
-- first_signup_rewards (that acknowledgement is what the UI uses as a gate).
-- claim_first_signup_reward never overwrites the restored balance.

create or replace function public.should_show_signup_onboarding()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.id = auth.uid()
      and p.onboarding_completed = false
      and u.created_at >= now() - interval '24 hours'
      and not exists (
        select 1 from public.first_signup_rewards r where r.user_id = u.id
      )
  );
$function$;

revoke all on function public.should_show_signup_onboarding() from public, anon;
grant execute on function public.should_show_signup_onboarding() to authenticated;

create or replace function public.handle_new_user_unlocks()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare prior public.deleted_account_balances;
begin
  select * into prior
    from public.deleted_account_balances
   where email_hash = encode(extensions.digest(convert_to(lower(trim(new.email)), 'UTF8'), 'sha256'::text), 'hex')
     and restored_at is null
     for update;
  if prior.email_hash is not null then
    insert into public.user_unlocks(user_id, unlock_balance, unlimited_unlocks)
    values (new.id, prior.remaining_unlocks, false)
    on conflict (user_id) do update set unlock_balance = excluded.unlock_balance, updated_at = now();
    if prior.remaining_unlocks <> 0 then
      insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
      values (new.id, prior.remaining_unlocks, 'account_restore', new.id);
    end if;
    update public.deleted_account_balances
       set restored_at = now()
     where email_hash = prior.email_hash and restored_at is null;
  else
    insert into public.user_unlocks(user_id, unlock_balance, unlimited_unlocks)
    values (new.id, 300, false)
    on conflict (user_id) do nothing;
    insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
    values (new.id, 300, 'welcome', new.id)
    on conflict (user_id) where event_type = 'welcome' do nothing;
  end if;
  return new;
end;
$function$;

create or replace function public.claim_first_signup_reward()
returns table(claimed boolean, reward_amount integer, remaining_unlocks integer, unlimited boolean, restored boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
  acct public.user_unlocks;
  prior public.deleted_account_balances;
  inserted_count integer;
  reward constant integer := 300;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  insert into public.user_unlocks(user_id) values (uid) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = uid for update;

  select d.* into prior
    from public.deleted_account_balances d
    join auth.users u on u.id = uid
   where d.email_hash = encode(extensions.digest(convert_to(lower(trim(u.email)), 'UTF8'), 'sha256'::text), 'hex')
   for update;

  if prior.email_hash is not null then
    insert into public.first_signup_rewards(user_id, reward_amount)
    values (uid, 0) on conflict (user_id) do nothing;
    get diagnostics inserted_count = row_count;
    return query select false, 0, acct.unlock_balance, acct.unlimited_unlocks, inserted_count = 1;
    return;
  end if;

  if not public.should_show_signup_onboarding() then
    return query select false, reward, acct.unlock_balance, acct.unlimited_unlocks, false;
    return;
  end if;

  insert into public.first_signup_rewards(user_id, reward_amount)
  values (uid, reward) on conflict (user_id) do nothing;
  get diagnostics inserted_count = row_count;
  return query select inserted_count = 1, reward, acct.unlock_balance, acct.unlimited_unlocks, false;
end;
$function$;

revoke all on function public.claim_first_signup_reward() from public, anon;
grant execute on function public.claim_first_signup_reward() to authenticated;
