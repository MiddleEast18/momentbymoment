-- Archive dialogue only: one atomic 50-unlock charge after an approved answer.
-- Keep historical 100-unlock rows valid; new rows record a single 50-unlock charge.
alter table public.archive_chat_charges
  alter column charged_amount set default 50;

alter table public.archive_chat_charges
  alter column reviewer_amount set default 0;

alter table public.archive_chat_charges
  drop constraint if exists archive_chat_charges_charged_amount_check,
  drop constraint if exists archive_chat_charges_reviewer_amount_check;

alter table public.archive_chat_charges
  add constraint archive_chat_charges_charged_amount_check check (charged_amount in (0, 50, 100)),
  add constraint archive_chat_charges_reviewer_amount_check check (reviewer_amount in (0, 50));

drop function if exists public.consume_archive_chat_charge(uuid, uuid);

create function public.consume_archive_chat_charge(p_user_id uuid, p_request_id uuid)
returns table(allowed boolean, charged boolean, charged_amount integer, remaining_unlocks integer, unlimited boolean, required_unlocks integer)
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  acct public.user_unlocks;
  charge constant integer := 50;
begin
  if p_user_id is null or p_request_id is null then raise exception 'invalid_archive_chat_charge'; end if;
  insert into public.user_unlocks(user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = p_user_id for update;

  if exists (select 1 from public.archive_chat_charges where request_id = p_request_id and user_id = p_user_id) then
    return query select true, false, 0, coalesce(acct.unlock_balance, 0), coalesce(acct.unlimited_unlocks, false), charge;
    return;
  end if;
  if exists (select 1 from public.archive_chat_charges where request_id = p_request_id) then
    raise exception 'archive_chat_request_id_conflict';
  end if;
  if coalesce(acct.unlimited_unlocks, false) then
    return query select true, false, 0, coalesce(acct.unlock_balance, 0), true, charge;
    return;
  end if;
  if coalesce(acct.unlock_balance, 0) < charge then
    return query select false, false, 0, coalesce(acct.unlock_balance, 0), false, charge;
    return;
  end if;

  update public.user_unlocks
     set unlock_balance = unlock_balance - charge, updated_at = now()
   where user_id = p_user_id
   returning * into acct;
  insert into public.archive_chat_charges(request_id, user_id, core_amount, reviewer_amount, charged_amount)
  values (p_request_id, p_user_id, 50, 0, charge);
  insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
  values (p_user_id, -charge, 'archive_chat', p_request_id);
  return query select true, true, charge, acct.unlock_balance, false, charge;
end;
$function$;

revoke all on function public.consume_archive_chat_charge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_archive_chat_charge(uuid, uuid) to service_role;
