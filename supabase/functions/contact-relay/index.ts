import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const AGENTMAIL_INBOX = "farid-9262@agentmail.to";
const TEAM_GMAIL = "faridfarok0@gmail.com";
const AGENTMAIL_API = "https://api.agentmail.to/v0";
const ALLOWED_ORIGIN = "https://middleeast18.github.io";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ALLOWED_TURNSTILE_HOSTS = new Set(["middleeast18.github.io"]);
const EXPECTED_ACTION = "contact";

function json(data: unknown, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store"
    }
  });
}

async function getTurnstileSecret(): Promise<string> {
  const fromEnv = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
  if (fromEnv) return fromEnv;
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return "";
  const response = await fetch(`${url}/rest/v1/rpc/get_app_secret`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ secret_name: "TURNSTILE_SECRET_KEY" })
  });
  if (!response.ok) return "";
  const value = await response.json().catch(() => null);
  return typeof value === "string" ? value : "";
}

async function verifyTurnstile(token: string, remoteip: string | null): Promise<{ ok: boolean; error?: string }> {
  const secret = await getTurnstileSecret();
  if (!secret) return { ok: false, error: "Turnstile verification is not configured yet." };
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteip) form.append("remoteip", remoteip.slice(0, 64));
  let response: Response;
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
  } catch {
    return { ok: false, error: "Turnstile verification unavailable" };
  }
  const result = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || !result?.success) return { ok: false, error: "Turnstile verification failed" };
  if (result?.action && result.action !== EXPECTED_ACTION) return { ok: false, error: "Turnstile verification failed" };
  if (result?.hostname && !ALLOWED_TURNSTILE_HOSTS.has(String(result.hostname))) {
    return { ok: false, error: "Turnstile verification failed" };
  }
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") {
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403, "null");
    return json({ ok: true });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403, "null");

  const apiKey = Deno.env.get("AGENTMAIL_API_KEY");
  if (!apiKey) return json({ error: "Contact relay is not configured yet." }, 503);

  let body: { name?: string; email?: string; subject?: string; message?: string; website?: string; turnstileToken?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  if (String(body.website || "").trim()) return json({ ok: true });

  const token = String(body.turnstileToken || "").trim();
  if (!token || token.length > 2048) return json({ error: "Turnstile token is required" }, 403);

  const forwarded = req.headers.get("x-forwarded-for") || "";
  const remoteip = req.headers.get("cf-connecting-ip") || forwarded.split(",")[0]?.trim() || null;
  const verification = await verifyTurnstile(token, remoteip);
  if (!verification.ok) {
    const status = verification.error?.includes("not configured") || verification.error?.includes("unavailable") ? 503 : 403;
    return json({ error: verification.error || "Turnstile verification failed" }, status);
  }

  const name = String(body.name || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().slice(0, 254);
  const subject = String(body.subject || "").trim().slice(0, 120);
  const message = String(body.message || "").trim().slice(0, 5000);
  if (!subject || !message) return json({ error: "subject and message are required" }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Invalid email" }, 400);

  const text = [name ? `الاسم: ${name}` : "", email ? `بريد المرسل: ${email}` : "", "", message, "", "— أُرسل من صفحة تواصل مِرصاد عبر AgentMail"].filter(Boolean).join("\n");

  const response = await fetch(`${AGENTMAIL_API}/inboxes/${encodeURIComponent(AGENTMAIL_INBOX)}/messages/send`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: [TEAM_GMAIL], subject: `[مِرصاد] ${subject}`, text, ...(email ? { reply_to: [email] } : {}) })
  });

  if (!response.ok) return json({ error: "Unable to relay message" }, 502);
  return json({ ok: true });
});
