alter table public.source_open_charges
drop constraint if exists source_open_charges_amount_check;

alter table public.source_open_charges
add constraint source_open_charges_amount_check
check (amount in (0, 19, 20));
