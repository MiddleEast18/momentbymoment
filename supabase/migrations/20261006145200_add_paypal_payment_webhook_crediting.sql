create table if not exists public.paypal_payments (
  id uuid primary key default gen_random_uuid(),
  paypal_event_id text not null unique,
  paypal_transaction_id text unique,
  paypal_order_id text,
  payment_link_id text,
  payer_email text,
  user_id uuid references auth.users(id) on delete set null,
  package_name text not null,
  unlock_amount integer not null check (unlock_amount > 0),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency = 'USD'),
  status text not null default 'pending' check (status in ('pending','credited','unmatched','rejected')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  credited_at timestamptz
);
create index if not exists paypal_payments_user_id_idx on public.paypal_payments(user_id);
create index if not exists paypal_payments_status_idx on public.paypal_payments(status);
alter table public.paypal_payments enable row level security;
revoke all on table public.paypal_payments from anon, authenticated, public;

drop function if exists public.apply_paypal_payment(text,text,text,text,text,text,integer,numeric,text,jsonb);
create or replace function public.apply_paypal_payment(p_event_id text,p_transaction_id text,p_order_id text,p_payment_link_id text,p_payer_email text,p_package_name text,p_unlock_amount integer,p_amount numeric,p_currency text,p_payload jsonb default '{}'::jsonb)
returns table(payment_id uuid,status text,user_id uuid,credited_amount integer,duplicate boolean)
language plpgsql security definer set search_path = public, pg_temp as $function$
declare payment public.paypal_payments; matched_user uuid; expected_package text; expected_unlocks integer; expected_amount numeric(12,2); new_balance integer;
begin
  if coalesce(trim(p_event_id),'')='' then raise exception 'paypal_event_id_required'; end if;
  if p_currency is distinct from 'USD' then raise exception 'unsupported_currency'; end if;
  select * into payment from public.paypal_payments where paypal_event_id=p_event_id for update;
  if found then return query select payment.id,payment.status,payment.user_id,payment.unlock_amount,true; return; end if;
  select v.package_name,v.unlock_amount,v.amount into expected_package,expected_unlocks,expected_amount from (values ('باقة المبتدئين',1000,1.00::numeric),('الباقة الأساسية',5000,5.00::numeric),('الباقة المتقدمة',10000,10.00::numeric),('الباقة الضخمة',25000,25.00::numeric),('الباقة النهائية',50000,50.00::numeric)) as v(package_name,unlock_amount,amount) where v.package_name=p_package_name and v.unlock_amount=p_unlock_amount and v.amount=p_amount;
  if expected_package is null then
    insert into public.paypal_payments(paypal_event_id,payment_link_id,payer_email,package_name,unlock_amount,amount,currency,status,payload) values (p_event_id,nullif(p_payment_link_id,''),nullif(lower(trim(p_payer_email)),''),coalesce(p_package_name,'unknown'),coalesce(p_unlock_amount,0),coalesce(p_amount,0),p_currency,'rejected',coalesce(p_payload,'{}'::jsonb)) returning * into payment;
    return query select payment.id,payment.status,payment.user_id,payment.unlock_amount,false; return;
  end if;
  if nullif(trim(p_transaction_id),'') is not null and exists(select 1 from public.paypal_payments where paypal_transaction_id=p_transaction_id) then select * into payment from public.paypal_payments where paypal_transaction_id=p_transaction_id limit 1; return query select payment.id,payment.status,payment.user_id,payment.unlock_amount,true; return; end if;
  select u.id into matched_user from auth.users u where lower(trim(u.email))=lower(trim(p_payer_email)) order by u.created_at desc limit 1;
  insert into public.paypal_payments(paypal_event_id,paypal_transaction_id,paypal_order_id,payment_link_id,payer_email,user_id,package_name,unlock_amount,amount,currency,status,payload) values (p_event_id,nullif(p_transaction_id,''),nullif(p_order_id,''),nullif(p_payment_link_id,''),nullif(lower(trim(p_payer_email)),''),matched_user,expected_package,expected_unlocks,expected_amount,'USD',case when matched_user is null then 'unmatched' else 'pending' end,coalesce(p_payload,'{}'::jsonb)) returning * into payment;
  if matched_user is null then return query select payment.id,payment.status,payment.user_id,payment.unlock_amount,false; return; end if;
  insert into public.user_unlocks(user_id,unlock_balance) values(matched_user,0) on conflict(user_id) do nothing;
  update public.user_unlocks u set unlock_balance=u.unlock_balance+expected_unlocks,updated_at=now() where u.user_id=matched_user returning u.unlock_balance into new_balance;
  insert into public.unlock_ledger(user_id,amount,event_type,reference_id) values(matched_user,expected_unlocks,'purchase',payment.id);
  update public.paypal_payments set status='credited',credited_at=now() where id=payment.id;
  return query select payment.id,'credited'::text,matched_user,expected_unlocks,false;
end;
$function$;
revoke all on function public.apply_paypal_payment(text,text,text,text,text,text,integer,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_paypal_payment(text,text,text,text,text,text,integer,numeric,text,jsonb) to service_role;
