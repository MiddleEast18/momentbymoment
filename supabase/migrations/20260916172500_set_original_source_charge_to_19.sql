create or replace function public.open_original_source(
  p_source_url text,
  p_request_id uuid,
  p_source_kind text,
  p_source_id uuid
)
returns table(
  opened boolean,
  charged boolean,
  remaining_unlocks integer,
  unlimited boolean,
  required_unlocks integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  uid uuid := auth.uid();
  acct public.user_unlocks;
  prior public.source_open_charges;
  charge constant integer := 19;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null or p_source_url is null or length(trim(p_source_url)) = 0 or length(p_source_url) > 2048
     or p_source_kind not in ('article', 'rapid') or p_source_id is null then
    raise exception 'invalid_source_request';
  end if;
  if p_source_url !~* '^https?://' then raise exception 'invalid_source_url'; end if;

  insert into public.user_unlocks(user_id) values(uid) on conflict (user_id) do nothing;
  select * into acct from public.user_unlocks where user_id = uid for update;

  select * into prior from public.source_open_charges
  where user_id = uid and source_kind = p_source_kind and source_id = p_source_id;
  if prior.id is not null then
    return query select true, false, coalesce(acct.unlock_balance, 0), coalesce(acct.unlimited_unlocks, false), charge;
    return;
  end if;

  if acct.unlimited_unlocks then
    insert into public.source_open_charges(user_id, request_id, source_url, source_kind, source_id, amount)
    values(uid, p_request_id, trim(p_source_url), p_source_kind, p_source_id, 0);
    return query select true, false, acct.unlock_balance, true, charge;
    return;
  end if;

  if acct.unlock_balance < charge then
    return query select false, false, acct.unlock_balance, false, charge;
    return;
  end if;

  update public.user_unlocks
  set unlock_balance = unlock_balance - charge, updated_at = now()
  where user_id = uid
  returning * into acct;

  insert into public.source_open_charges(user_id, request_id, source_url, source_kind, source_id, amount)
  values(uid, p_request_id, trim(p_source_url), p_source_kind, p_source_id, charge);
  insert into public.unlock_ledger(user_id, amount, event_type, reference_id)
  values(uid, -charge, 'source_open', p_source_id);

  return query select true, true, acct.unlock_balance, false, charge;
end;
$function$;
