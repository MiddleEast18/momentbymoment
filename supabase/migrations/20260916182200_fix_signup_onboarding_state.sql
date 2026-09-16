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
      and not exists (
        select 1 from public.first_signup_rewards r where r.user_id = u.id
      )
  );
$function$;

revoke all on function public.should_show_signup_onboarding() from public, anon;
grant execute on function public.should_show_signup_onboarding() to authenticated;

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

  if not public.should_show_signup_onboarding() then
    return query select false, reward, acct.unlock_balance, acct.unlimited_unlocks;
    return;
  end if;

  insert into public.first_signup_rewards(user_id, reward_amount)
  values(uid, reward)
  on conflict (user_id) do nothing;
  get diagnostics inserted_count = row_count;

  return query select inserted_count = 1, reward, acct.unlock_balance, acct.unlimited_unlocks;
end;
$function$;

revoke all on function public.claim_first_signup_reward() from public, anon;
grant execute on function public.claim_first_signup_reward() to authenticated;
