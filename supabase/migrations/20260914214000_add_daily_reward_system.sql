create table if not exists public.daily_reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  claim_date date not null,
  reward_amount integer not null check (reward_amount > 0),
  streak_day integer not null default 1 check (streak_day between 1 and 7),
  created_at timestamptz not null default now(),
  unique (user_id, claim_date)
);

alter table public.daily_reward_claims enable row level security;
drop policy if exists daily_reward_claims_select_own on public.daily_reward_claims;
create policy daily_reward_claims_select_own on public.daily_reward_claims for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.daily_reward_claims from anon, authenticated;
grant select on public.daily_reward_claims to authenticated;

alter table public.unlock_ledger drop constraint if exists unlock_ledger_event_type_check;
alter table public.unlock_ledger add constraint unlock_ledger_event_type_check check (event_type = any (array['welcome','referral_reward','purchase','article_unlock','view_more_cycle','view_all_access','rapid_news_open','daily_reward','admin_adjustment']));

create or replace function public.claim_daily_reward()
returns table(claimed boolean, reward_amount integer, streak_day integer, remaining_unlocks integer, unlimited boolean, next_claim_at timestamptz)
language plpgsql security definer set search_path to public
as $function$
declare uid uuid:=auth.uid(); today date:=(now() at time zone 'UTC')::date; previous_claim public.daily_reward_claims; account public.user_unlocks; amount integer; streak integer;
begin
 if uid is null then raise exception 'not_authenticated'; end if;
 insert into public.user_unlocks(user_id) values(uid) on conflict(user_id) do nothing;
 select * into account from public.user_unlocks where user_id=uid for update;
 if exists (select 1 from public.daily_reward_claims where user_id=uid and claim_date=today) then return query select false,0,0,account.unlock_balance,account.unlimited_unlocks,(today+1)::timestamptz; return; end if;
 select * into previous_claim from public.daily_reward_claims where user_id=uid order by claim_date desc limit 1;
 if previous_claim.claim_date=today-1 then streak:=case when previous_claim.streak_day>=7 then 1 else previous_claim.streak_day+1 end; else streak:=1; end if;
 amount:=case streak when 1 then 5 when 2 then 5 when 3 then 10 when 4 then 10 when 5 then 15 when 6 then 15 else 30 end;
 update public.user_unlocks set unlock_balance=unlock_balance+amount,updated_at=now() where user_id=uid returning * into account;
 insert into public.daily_reward_claims(user_id,claim_date,reward_amount,streak_day) values(uid,today,amount,streak);
 insert into public.unlock_ledger(user_id,amount,event_type,reference_id) values(uid,amount,'daily_reward',null);
 return query select true,amount,streak,account.unlock_balance,account.unlimited_unlocks,(today+1)::timestamptz;
end;
$function$;

create or replace function public.get_daily_reward_status()
returns table(can_claim boolean,today_reward integer,streak_day integer,current_balance integer,unlimited boolean,next_claim_at timestamptz)
language plpgsql security definer set search_path to public
as $function$
declare uid uuid:=auth.uid(); today date:=(now() at time zone 'UTC')::date; account public.user_unlocks; last_claim public.daily_reward_claims; next_streak integer; amount integer;
begin
 if uid is null then raise exception 'not_authenticated'; end if;
 insert into public.user_unlocks(user_id) values(uid) on conflict(user_id) do nothing;
 select * into account from public.user_unlocks where user_id=uid;
 select * into last_claim from public.daily_reward_claims where user_id=uid order by claim_date desc limit 1;
 if last_claim.claim_date=today then return query select false,0,last_claim.streak_day,account.unlock_balance,account.unlimited_unlocks,(today+1)::timestamptz; return; end if;
 next_streak:=case when last_claim.claim_date=today-1 then case when last_claim.streak_day>=7 then 1 else last_claim.streak_day+1 end else 1 end;
 amount:=case next_streak when 1 then 5 when 2 then 5 when 3 then 10 when 4 then 10 when 5 then 15 when 6 then 15 else 30 end;
 return query select true,amount,next_streak,account.unlock_balance,account.unlimited_unlocks,now();
end;
$function$;

revoke all on function public.claim_daily_reward() from public, anon;
grant execute on function public.claim_daily_reward() to authenticated;
revoke all on function public.get_daily_reward_status() from public, anon;
grant execute on function public.get_daily_reward_status() to authenticated;
