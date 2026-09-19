-- Wheel reward schema. The two functions are in the following migration so schema changes remain isolated.
create table if not exists public.wheel_configs (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  target_mean numeric not null, alpha numeric not null, reward_values integer[] not null,
  daily_spin_limit integer not null default 5, daily_budget integer not null default 1000,
  vault_cap integer not null default 10000, pity_start integer not null default 10,
  pity_guarantee integer not null default 20, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.wheel_daily_usage (
  user_id uuid references auth.users(id) on delete cascade, usage_date date,
  spin_count integer not null default 0, payout_used integer not null default 0,
  updated_at timestamptz not null default now(), primary key(user_id, usage_date)
);
create table if not exists public.wheel_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pity_misses integer not null default 0, vault_balance integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.wheel_spin_ledger (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  config_id uuid references public.wheel_configs(id), usage_date date not null, slot_index integer not null,
  reward_amount integer not null, daily_payout integer not null default 0, vault_payout integer not null default 0,
  pity_before integer not null default 0, pity_after integer not null default 0,
  created_at timestamptz not null default now(), unique(user_id, usage_date, slot_index)
);
revoke all on public.wheel_configs, public.wheel_daily_usage, public.wheel_user_state, public.wheel_spin_ledger from anon, authenticated;
create or replace function public.wheel_alpha_for_mean(p_target numeric, p_values integer[]) returns numeric language plpgsql immutable as $f$
declare lo numeric:=0; hi numeric:=20; mid numeric; mean numeric; i integer;
begin for i in 1..80 loop mid:=(lo+hi)/2; select sum(v*power(v::numeric,-mid))/sum(power(v::numeric,-mid)) into mean from unnest(p_values) x(v); if mean>p_target then lo:=mid; else hi:=mid; end if; end loop; return round(((lo+hi)/2)::numeric,12); end; $f$;
insert into public.wheel_configs(name,target_mean,alpha,reward_values) values ('default_8_slot_200_mean',200,public.wheel_alpha_for_mean(200,array[50,75,100,150,200,250,350,500]),array[50,75,100,150,200,250,350,500]) on conflict(name) do update set target_mean=excluded.target_mean,alpha=excluded.alpha,reward_values=excluded.reward_values,active=true;
