import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': 'https://marsad.website',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const emailHash = async (email: string) => {
  const normalized = email.trim().toLowerCase();
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user?.email) return json({ error: 'Unauthorized' }, 401);
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: owner, error: ownerError } = await admin.from('mirsad_owner').select('user_id').eq('user_id', user.id).maybeSingle();
  if (ownerError) return json({ error: 'Unable to verify account role' }, 500);
  if (owner) return json({ error: 'Owner account cannot be deleted' }, 409);
  const { data: balance, error: balanceError } = await admin.from('user_unlocks').select('unlock_balance,unlimited_unlocks').eq('user_id', user.id).maybeSingle();
  if (balanceError) return json({ error: 'Unable to preserve account balance' }, 500);
  const hash = await emailHash(user.email);
  const remaining = Math.max(0, Number(balance?.unlock_balance || 0));
  const { error: preserveError } = await admin.from('deleted_account_balances').upsert(
    { email_hash: hash, remaining_unlocks: remaining, restored_at: null },
    { onConflict: 'email_hash' }
  );
  if (preserveError) return json({ error: 'Unable to preserve account balance' }, 500);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    await admin.from('deleted_account_balances').delete().eq('email_hash', hash).is('restored_at', null);
    return json({ error: 'Unable to delete account' }, 500);
  }
  return json({ ok: true });
});
