create unique index if not exists unlock_ledger_one_welcome_per_user
on public.unlock_ledger (user_id)
where event_type = 'welcome';

create or replace function public.handle_new_user_unlocks()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.user_unlocks(user_id, unlock_balance, unlimited_unlocks)
  values (new.id, 1000, false)
  on conflict (user_id) do nothing;

  insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
  values (new.id, 1000, 'welcome', new.id)
  on conflict (user_id) where event_type = 'welcome' do nothing;

  return new;
end;
$function$;

drop trigger if exists on_auth_user_created_unlocks on auth.users;
create trigger on_auth_user_created_unlocks
after insert on auth.users
for each row execute function public.handle_new_user_unlocks();

revoke insert, update, delete on public.user_unlocks from public, anon, authenticated;
revoke insert, update, delete on public.unlock_ledger from public, anon, authenticated;
