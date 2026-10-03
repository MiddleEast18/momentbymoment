-- Developer-only recipient discovery for the system-mail UI.
create or replace function public.list_system_reward_recipients()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email, u.created_at, u.last_sign_in_at
  from auth.users u
  where public.is_system_developer()
  order by u.created_at desc;
$$;
revoke all on function public.list_system_reward_recipients() from public;
grant execute on function public.list_system_reward_recipients() to authenticated;
