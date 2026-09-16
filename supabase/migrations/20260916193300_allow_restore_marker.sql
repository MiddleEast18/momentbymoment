alter table public.first_signup_rewards drop constraint if exists first_signup_rewards_reward_amount_check;
alter table public.first_signup_rewards add constraint first_signup_rewards_reward_amount_check check (reward_amount >= 0 and reward_amount <= 1000);
