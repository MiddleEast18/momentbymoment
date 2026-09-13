import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MIRSAD_API_URL = "https://nasdabcwexcdgpwjoslo.supabase.co/functions/v1/article-analysis-api";
const MIRSAD_API_KEY = Deno.env.get("MIRSAD_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!MIRSAD_API_KEY) return json({ ok: false, error: "MIRSAD_API_KEY is not configured" }, 503);

  try {
    if (req.method === "GET") {
      const externalId = String(new URL(req.url).searchParams.get("external_id") ?? "").trim();
      if (!externalId) return json({ ok: false, error: "external_id is required" }, 400);
      const response = await fetch(`${MIRSAD_API_URL}?external_id=${encodeURIComponent(externalId)}`, {
        headers: { accept: "application/json", authorization: `Bearer ${MIRSAD_API_KEY}` },
      });
      const result = await response.json().catch(() => ({}));
      return json(result, response.ok ? 200 : 502);
    }

    const body = await req.json().catch(() => ({}));
    const article = body?.article ?? body;
    const externalId = String(article?.external_id ?? article?.id ?? "").trim();
    const headline = String(article?.headline ?? "").trim();
    const sourceUrl = String(article?.source_url ?? "").trim();
    const content = String(article?.content ?? article?.body ?? article?.summary ?? "").trim();

    // The independent Mirsad API fetches source_url when the submitted text is short.
    // Therefore source_url is required, while content may be a short RSS excerpt.
    if (!externalId || !headline || !sourceUrl) {
      return json({ ok: false, error: "external_id, headline and source_url are required" }, 400);
    }

    const response = await fetch(MIRSAD_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MIRSAD_API_KEY}`,
      },
      body: JSON.stringify({
        external_id: externalId,
        headline,
        content,
        source_url: sourceUrl,
        source_name: String(article?.source_name ?? "").trim(),
        summary: String(article?.summary ?? content).trim(),
        category: article?.category ?? null,
        published_at: article?.published_at ?? null,
      }),
    });

    const result = await response.json().catch(() => ({}));
    return json(result, response.ok ? 200 : 502);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}
