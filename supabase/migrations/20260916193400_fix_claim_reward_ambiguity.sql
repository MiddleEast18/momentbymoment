drop function if exists public.claim_first_signup_reward();
create function public.claim_first_signup_reward()
returns table(claimed boolean,reward_amount integer,remaining_unlocks integer,unlimited boolean,restored boolean)
language plpgsql security definer set search_path=public,pg_temp
as $function$
declare uid uuid:=auth.uid(); acct public.user_unlocks; prior public.first_signup_rewards; inserted_count integer;
begin
 if uid is null then raise exception 'not_authenticated'; end if;
 insert into public.user_unlocks(user_id) values(uid) on conflict(user_id) do nothing;
 select ua.* into acct from public.user_unlocks ua where ua.user_id=uid for update;
 select f.* into prior from public.first_signup_rewards f where f.user_id=uid and f.reward_amount=0 limit 1;
 if prior.user_id is not null then return query select false,0,acct.unlock_balance,acct.unlimited_unlocks,true; return; end if;
 if not public.should_show_signup_onboarding() then return query select false,1000,acct.unlock_balance,acct.unlimited_unlocks,false; return; end if;
 insert into public.first_signup_rewards(user_id,reward_amount) values(uid,1000) on conflict(user_id) do nothing;
 get diagnostics inserted_count=row_count;
 return query select inserted_count=1,1000,acct.unlock_balance,acct.unlimited_unlocks,false;
end;
$function$;
revoke all on function public.claim_first_signup_reward() from public,anon;
grant execute on function public.claim_first_signup_reward() to authenticated;
