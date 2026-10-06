alter table public.user_unlocks add column if not exists paid_unlock_balance integer not null default 0 check (paid_unlock_balance >= 0);
alter table public.paypal_payments add column if not exists is_discounted boolean not null default false;

create or replace function public.debit_paid_unlock_balance()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare debit integer;
begin
  if new.amount < 0 then
    debit := least(coalesce((select paid_unlock_balance from public.user_unlocks where user_id = new.user_id for update), 0), abs(new.amount));
    if debit > 0 then update public.user_unlocks set paid_unlock_balance = paid_unlock_balance - debit, updated_at = now() where user_id = new.user_id; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists unlock_ledger_debit_paid_balance on public.unlock_ledger;
create trigger unlock_ledger_debit_paid_balance after insert on public.unlock_ledger for each row execute function public.debit_paid_unlock_balance();
revoke all on function public.debit_paid_unlock_balance() from public, anon, authenticated;

create or replace function public.get_recharge_offer_status()
returns table(eligible boolean, first_purchase_id uuid, first_purchase_at timestamptz, paid_remaining integer, paid_consumed integer, discount_used boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); first_payment public.paypal_payments; paid_left integer; used boolean;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into first_payment from public.paypal_payments where user_id = uid and status = 'credited' and is_discounted = false and unlock_amount = 1000 order by created_at asc limit 1;
  select coalesce(u.paid_unlock_balance, 0), exists(select 1 from public.paypal_payments p where p.user_id = uid and p.status = 'credited' and p.is_discounted = true) into paid_left, used from public.user_unlocks u where u.user_id = uid;
  return query select (first_payment.id is not null and paid_left = 0 and not used), first_payment.id, first_payment.created_at, paid_left, greatest(0, 1000 - paid_left), used;
end;
$$;
revoke all on function public.get_recharge_offer_status() from public, anon;
grant execute on function public.get_recharge_offer_status() to authenticated;

create or replace function public.apply_paypal_payment(p_event_id text,p_transaction_id text,p_order_id text,p_payment_link_id text,p_payer_email text,p_package_name text,p_unlock_amount integer,p_amount numeric,p_currency text,p_payload jsonb default '{}'::jsonb)
returns table(payment_id uuid,status text,user_id uuid,credited_amount integer,duplicate boolean)
language plpgsql security definer set search_path = public, pg_temp as $function$
declare payment public.paypal_payments; matched_user uuid; expected_package text; expected_unlocks integer; expected_amount numeric(12,2); expected_discount_amount numeric(12,2); discounted boolean; new_balance integer; paid_left integer; prior_discount boolean;
begin
  if coalesce(trim(p_event_id),'')='' then raise exception 'paypal_event_id_required'; end if;
  if p_currency is distinct from 'USD' then raise exception 'unsupported_currency'; end if;
  select * into payment from public.paypal_payments where paypal_event_id=p_event_id for update;
  if found then return query select payment.id,payment.status,payment.user_id,payment.unlock_amount,true; return; end if;
  select v.package_name,v.unlock_amount,v.amount,v.discount_amount into expected_package,expected_unlocks,expected_amount,expected_discount_amount from (values ('باقة المبتدئين',1000,1.00::numeric,0.85::numeric),('الباقة الأساسية',5000,5.00::numeric,4.25::numeric),('الباقة المتقدمة',10000,10.00::numeric,8.50::numeric),('الباقة الضخمة',25000,25.00::numeric,21.25::numeric),('الباقة النهائية',50000,50.00::numeric,42.50::numeric)) as v(package_name,unlock_amount,amount,discount_amount) where v.package_name=p_package_name and (v.amount=p_amount or v.discount_amount=p_amount);
  if expected_package is null then
    insert into public.paypal_payments(paypal_event_id,payment_link_id,payer_email,package_name,unlock_amount,amount,currency,status,payload,is_discounted) values(p_event_id,nullif(p_payment_link_id,''),nullif(lower(trim(p_payer_email)),''),coalesce(p_package_name,'unknown'),coalesce(p_unlock_amount,0),coalesce(p_amount,0),p_currency,'rejected',coalesce(p_payload,'{}'::jsonb),false) returning * into payment;
    return query select payment.id,payment.status,payment.user_id,payment.unlock_amount,false; return;
  end if;
  discounted := (p_amount = expected_discount_amount);
  if nullif(trim(p_transaction_id),'') is not null and exists(select 1 from public.paypal_payments where paypal_transaction_id=p_transaction_id) then select * into payment from public.paypal_payments where paypal_transaction_id=p_transaction_id limit 1; return query select payment.id,payment.status,payment.user_id,payment.unlock_amount,true; return; end if;
  select u.id into matched_user from auth.users u where lower(trim(u.email))=lower(trim(p_payer_email)) order by u.created_at desc limit 1;
  if matched_user is not null then
    perform pg_advisory_xact_lock(hashtextextended(matched_user::text || ':recharge-discount', 0));
    select coalesce(u.paid_unlock_balance,0) into paid_left from public.user_unlocks u where u.user_id=matched_user;
    select exists(select 1 from public.paypal_payments p where p.user_id=matched_user and p.status='credited' and p.is_discounted=true) into prior_discount;
  end if;
  if discounted and (matched_user is null or paid_left <> 0 or prior_discount or not exists(select 1 from public.paypal_payments p where p.user_id=matched_user and p.status='credited' and p.is_discounted=false and p.unlock_amount=1000)) then
    insert into public.paypal_payments(paypal_event_id,paypal_transaction_id,paypal_order_id,payment_link_id,payer_email,user_id,package_name,unlock_amount,amount,currency,status,payload,is_discounted) values(p_event_id,nullif(p_transaction_id,''),nullif(p_order_id,''),nullif(p_payment_link_id,''),nullif(lower(trim(p_payer_email)),''),matched_user,expected_package,expected_unlocks,expected_discount_amount,'USD','rejected',coalesce(p_payload,'{}'::jsonb),true) returning * into payment;
    return query select payment.id,payment.status,payment.user_id,payment.unlock_amount,false; return;
  end if;
  insert into public.paypal_payments(paypal_event_id,paypal_transaction_id,paypal_order_id,payment_link_id,payer_email,user_id,package_name,unlock_amount,amount,currency,status,payload,is_discounted) values(p_event_id,nullif(p_transaction_id,''),nullif(p_order_id,''),nullif(p_payment_link_id,''),nullif(lower(trim(p_payer_email)),''),matched_user,expected_package,expected_unlocks,case when discounted then expected_discount_amount else expected_amount end,'USD',case when matched_user is null then 'unmatched' else 'pending' end,coalesce(p_payload,'{}'::jsonb),discounted) returning * into payment;
  if matched_user is null then return query select payment.id,payment.status,payment.user_id,payment.unlock_amount,false; return; end if;
  insert into public.user_unlocks(user_id,unlock_balance,paid_unlock_balance) values(matched_user,0,0) on conflict(user_id) do nothing;
  update public.user_unlocks u set unlock_balance=u.unlock_balance+expected_unlocks, paid_unlock_balance=u.paid_unlock_balance+expected_unlocks, updated_at=now() where u.user_id=matched_user returning u.unlock_balance into new_balance;
  insert into public.unlock_ledger(user_id,amount,event_type,reference_id) values(matched_user,expected_unlocks,'purchase',payment.id);
  update public.paypal_payments set status='credited',credited_at=now() where id=payment.id;
  return query select payment.id,'credited'::text,matched_user,expected_unlocks,false;
end;
$function$;
revoke all on function public.apply_paypal_payment(text,text,text,text,text,text,integer,numeric,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_paypal_payment(text,text,text,text,text,text,integer,numeric,text,jsonb) to service_role;
