import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const PAYPAL_API = Deno.env.get('PAYPAL_API_BASE_URL') || 'https://api-m.paypal.com';
const PACKAGE_BY_AMOUNT: Record<string, { name: string; unlocks: number }> = {
  '1.00': { name: 'باقة المبتدئين', unlocks: 1000 }, '5.00': { name: 'الباقة الأساسية', unlocks: 5000 },
  '10.00': { name: 'الباقة المتقدمة', unlocks: 10000 }, '25.00': { name: 'الباقة الضخمة', unlocks: 25000 },
  '50.00': { name: 'الباقة النهائية', unlocks: 50000 },
};
const required = (name: string) => { const value = Deno.env.get(name); if (!value) throw new Error(`missing_${name}`); return value; };
async function paypalAccessToken() {
  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${btoa(`${required('PAYPAL_CLIENT_ID')}:${required('PAYPAL_CLIENT_SECRET')}`)}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: 'grant_type=client_credentials' });
  if (!response.ok) throw new Error(`paypal_token_${response.status}`); return (await response.json()).access_token as string;
}
async function verifyWebhook(token: string, req: Request, event: unknown) {
  const response = await fetch(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ auth_algo: req.headers.get('paypal-auth-algo'), cert_url: req.headers.get('paypal-cert-url'), transmission_id: req.headers.get('paypal-transmission-id'), transmission_sig: req.headers.get('paypal-transmission-sig'), transmission_time: req.headers.get('paypal-transmission-time'), webhook_id: required('PAYPAL_WEBHOOK_ID'), webhook_event: event }) });
  return response.ok && (await response.json()).verification_status === 'SUCCESS';
}
async function fetchOrder(token: string, orderId: string) { const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }); return response.ok ? await response.json() : null; }
const first = (...values: unknown[]) => values.find((value) => typeof value === 'string' && value.trim()) as string | undefined;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const event: any = JSON.parse(await req.text()); const token = await paypalAccessToken();
    if (!(await verifyWebhook(token, req, event))) return json({ error: 'invalid_webhook_signature' }, 400);
    if (!['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.SALE.COMPLETED'].includes(event.event_type)) return json({ ok: true, ignored: event.event_type });
    const resource = event.resource || {}; const orderId = first(resource.supplementary_data?.related_ids?.order_id, resource.parent_payment, resource.order_id) || '';
    const order = orderId ? await fetchOrder(token, orderId) : null; const unit = order?.purchase_units?.[0] || {};
    const amountValue = first(resource.amount?.value, resource.amount?.total, unit.amount?.value) || ''; const currency = first(resource.amount?.currency_code, resource.amount?.currency, unit.amount?.currency_code) || ''; const packageInfo = PACKAGE_BY_AMOUNT[Number(amountValue).toFixed(2)];
    if (!packageInfo || currency !== 'USD') return json({ ok: true, rejected: 'package_or_currency_mismatch' });
    const payerEmail = first(resource.payer?.email_address, order?.payer?.email_address) || ''; const transactionId = first(resource.id) || '';
    const admin = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'));
    const { data, error } = await admin.rpc('apply_paypal_payment', { p_event_id: event.id, p_transaction_id: transactionId, p_order_id: orderId, p_payment_link_id: first(resource.custom_id, unit.custom_id) || '', p_payer_email: payerEmail, p_package_name: packageInfo.name, p_unlock_amount: packageInfo.unlocks, p_amount: Number(amountValue).toFixed(2), p_currency: currency, p_payload: event });
    if (error) { console.error('paypal_credit_rpc_failed', error.message); return json({ error: 'credit_failed' }, 500); }
    return json({ ok: true, result: Array.isArray(data) ? data[0] : data });
  } catch (error) { console.error('paypal_webhook_error', error instanceof Error ? error.message : String(error)); return json({ error: 'webhook_not_ready_or_failed' }, 503); }
});
