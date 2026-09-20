-- Reduce first-signup welcome grant from 1000 to 300.
-- Does not alter existing balances. Does not touch ingest, translation,
-- consume_news_view, daily reward, wheel, or recovery.

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
    insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
    values (new.id, prior.remaining_unlocks, 'account_restore', new.id);
    insert into public.first_signup_rewards(user_id, reward_amount)
    values (new.id, 0) on conflict (user_id) do nothing;
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
    if prior.restored_at is null then
      update public.user_unlocks
         set unlock_balance = prior.remaining_unlocks, updated_at = now()
       where user_id = uid
       returning * into acct;
      update public.deleted_account_balances
         set restored_at = now()
       where email_hash = prior.email_hash and restored_at is null;
      insert into public.first_signup_rewards(user_id, reward_amount)
      values (uid, 0) on conflict (user_id) do nothing;
      return query select false, 0, acct.unlock_balance, acct.unlimited_unlocks, true;
      return;
    end if;
    insert into public.first_signup_rewards(user_id, reward_amount)
    values (uid, 0) on conflict (user_id) do nothing;
    return query select false, 0, acct.unlock_balance, acct.unlimited_unlocks, false;
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

revoke all on function public.handle_new_user_unlocks() from public, anon, authenticated;
revoke all on function public.claim_first_signup_reward() from public, anon;
grant execute on function public.claim_first_signup_reward() to authenticated;
grant execute on function public.claim_first_signup_reward() to service_role;
