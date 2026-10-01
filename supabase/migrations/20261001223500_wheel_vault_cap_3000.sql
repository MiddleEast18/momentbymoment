update public.wheel_configs
set vault_cap = 3000
where active = true
  and vault_cap = 150;
