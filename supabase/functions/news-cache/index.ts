import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CACHE_SECONDS = 15;
const STALE_SECONDS = 45;
const SELECT_COLUMNS = "id,source_name,source_url,headline,summary,category,importance_score,sentiment,layout_size,cluster_id,update_count,source_count,source_trust_score,confidence_score,is_pending_verification,claim_digest,published_at,created_at,updated_at";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, if-none-match",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function responseHeaders(etag?: string) {
  return {
    ...corsHeaders,
    "content-type": "application/json; charset=utf-8",
    "cache-control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
    ...(etag ? { etag } : {}),
  };
}

async function makeEtag(body: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `"${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24)}"`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: responseHeaders() });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response(JSON.stringify({ error: "Cache service unavailable" }), { status: 503, headers: responseHeaders() });

  const url = new URL(`${SUPABASE_URL}/rest/v1/news_articles`);
  url.searchParams.set("select", SELECT_COLUMNS);
  url.searchParams.set("is_pending_verification", "eq.false");
  url.searchParams.set("order", "published_at.desc.nullslast,updated_at.desc.nullslast,created_at.desc.nullslast");
  url.searchParams.set("limit", "400");

  try {
    const upstream = await fetch(url, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, accept: "application/json" },
    });
    if (!upstream.ok) return new Response(JSON.stringify({ error: `Upstream HTTP ${upstream.status}` }), { status: 502, headers: responseHeaders() });
    const body = await upstream.text();
    const etag = await makeEtag(body);
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: responseHeaders(etag) });
    return new Response(body, { status: 200, headers: responseHeaders(etag) });
  } catch {
    return new Response(JSON.stringify({ error: "Upstream unavailable" }), { status: 502, headers: responseHeaders() });
  }
});
