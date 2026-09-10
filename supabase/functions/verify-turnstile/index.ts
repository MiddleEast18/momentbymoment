import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGIN = "https://middleeast18.github.io";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";

  if (req.method === "OPTIONS") {
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403);
    return json({ ok: true });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403);

  const secret = await getTurnstileSecret();
  if (!secret) return json({ error: "Turnstile verification is not configured yet." }, 503);

  let body: { token?: string; remoteip?: string; expectedAction?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const token = String(body.token || "").trim();
  if (!token || token.length > 2048) return json({ error: "Invalid Turnstile token" }, 400);

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (body.remoteip) form.append("remoteip", String(body.remoteip).slice(0, 64));

  let response: Response;
  try {
    response = await fetch(VERIFY_URL, { method: "POST", body: form });
  } catch {
    return json({ error: "Turnstile verification unavailable" }, 502);
  }

  const result = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) return json({ error: "Turnstile verification failed" }, 502);

  if (!result?.success) {
    return json({
      success: false,
      error_codes: Array.isArray(result?.["error-codes"]) ? result["error-codes"].slice(0, 8) : []
    }, 403);
  }

  if (body.expectedAction && result?.action && result.action !== body.expectedAction) {
    return json({ success: false, error_codes: ["action-mismatch"] }, 403);
  }

  return json({
    success: true,
    action: result?.action || null,
    hostname: result?.hostname || null,
    cdata: result?.cdata || null
  });
});
