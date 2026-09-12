import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Content-Type": "application/json",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

const decodeEntities = (value: string) =>
  String(value || "")
    .replace(/&(nbsp|#160);/gi, " ")
    .replace(/&(amp|quot|apos|lt|gt);/gi, (_m, name: string) => {
      const map: Record<string, string> = {
        amp: "&",
        quot: '"',
        apos: "'",
        lt: "<",
        gt: ">",
      };
      return map[name.toLowerCase()] || _m;
    });

const cleanText = (value: string) =>
  decodeEntities(String(value || ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const headlineKey = (value: string) =>
  cleanText(value)
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0610-\u061A\u06D6-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

const canonical = (raw: string) => {
  try {
    const url = new URL(String(raw || "").trim());
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$|source$|maca|ocid|ns_|ito|cmpid|ncid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return String(raw || "").trim();
  }
};

const isArabic = (value: string) => {
  const arabic = (value.match(/[ء-ي]/g) || []).length;
  const letters = (value.match(/[\p{L}]/gu) || []).length;
  return arabic >= 2 && arabic / Math.max(1, letters) >= 0.2;
};

const publishedAt = (value: string) => {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return new Date().toISOString();
  const now = Date.now();
  return new Date(Math.min(ms, now + 2 * 60 * 1000)).toISOString();
};

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  let mode = "auto";
  try {
    const body = await req.json();
    if (body?.mode === "manual") mode = "manual";
  } catch {
    // Empty body is the scheduled automatic mode.
  }

  if (mode !== "auto") {
    return reply({ error: "manual_mode_reserved" }, 403);
  }

  const quota = await db.rpc("reserve_currents_request", { p_mode: "auto" });
  if (quota.error) return reply({ error: quota.error.message }, 500);
  const q = quota.data?.[0];
  if (!q?.allowed) {
    return reply({
      ok: true,
      skipped: "daily_quota_reserved",
      usage: q || null,
    });
  }

  const apiKey = Deno.env.get("CURRENTS_API_KEY") || "";
  if (!apiKey) return reply({ error: "currents_api_key_missing" }, 500);

  const endpoint =
    "https://api.currentsapi.services/v1/latest-news?language=ar&page_size=20";

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": "MirsadCurrents/1.0",
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    return reply({
      ok: false,
      error: "currents_fetch_failed",
      detail: String(error),
      quota: q,
    }, 502);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return reply({
      ok: false,
      error: "currents_http_error",
      status: response.status,
      body: body.slice(0, 500),
      quota: q,
    }, response.status === 429 ? 429 : 502);
  }

  const payload = await response.json();
  if (payload?.status !== "ok" || !Array.isArray(payload.news)) {
    return reply({
      ok: false,
      error: "currents_invalid_response",
      quota: q,
    }, 502);
  }

  const candidates = payload.news
    .map((item: any) => ({
      provider_id: String(item.id || ""),
      title: cleanText(item.title),
      description: cleanText(item.description),
      url: canonical(item.url),
      author: cleanText(item.author || ""),
      image: String(item.image || ""),
      language: String(item.language || ""),
      categories: Array.isArray(item.category) ? item.category : [],
      published: publishedAt(String(item.published || "")),
    }))
    .filter((item: any) =>
      item.title &&
      item.url &&
      /^https?:\/\//i.test(item.url) &&
      isArabic(item.title) &&
      item.language.toLowerCase().startsWith("ar"),
    )
    .slice(0, 20);

  if (!candidates.length) {
    return reply({
      ok: true,
      inserted: 0,
      duplicates: 0,
      candidates: 0,
      quota: q,
      duration_ms: Date.now() - startedAt,
    });
  }

  const existing = await db
    .from("news_articles")
    .select("id,source_url,agency_urls,headline,summary,cluster_id,category")
    .eq("is_pending_verification", false)
    .order("updated_at", { ascending: false })
    .limit(400);

  if (existing.error) return reply({ error: existing.error.message }, 500);

  const existingUrls = new Set<string>();
  const existingHeadlines = new Set<string>();
  for (const row of existing.data || []) {
    existingUrls.add(canonical(row.source_url));
    for (const agency of row.agency_urls || []) existingUrls.add(canonical(agency));
    existingHeadlines.add(headlineKey(row.headline));
  }

  let inserted = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (const item of candidates) {
    const url = canonical(item.url);
    const key = headlineKey(item.title);

    if (existingUrls.has(url) || existingHeadlines.has(key)) {
      duplicates++;
      continue;
    }

    const sourceName = `Currents • ${domainOf(url) || "news source"}`;
    const fullText = `${item.title} ${item.description}`;
    const categoryResult = await db.rpc("mirsad_classify_category", {
      p_text: fullText,
      p_url: url,
    });

    const category = categoryResult.data || "Politics";
    const result = await db.from("news_articles").insert({
      source_name: sourceName,
      source_url: url,
      agency_urls: [url],
      headline: item.title,
      summary: item.description || item.title,
      category,
      importance_score: 35,
      sentiment: "Neutral",
      cluster_id: crypto.randomUUID(),
      source_trust_score: 0.80,
      confidence_score: 80,
      is_pending_verification: false,
      verification_notes: null,
      verified_by: null,
      verified_at: null,
      inherited_from_cache: false,
      llm_model_used: "currents-discovery-v1",
      ai_hints: {
        ingested_by: "mirsad-currents",
        provider: "Currents API",
        provider_id: item.provider_id,
        source_domain: domainOf(url),
        categories: item.categories,
      },
      claim_digest: { main_claim: item.title },
      raw_payload: item,
      published_at: item.published,
    });

    if (!result.error) {
      inserted++;
      existingUrls.add(url);
      existingHeadlines.add(key);
    } else if (result.error.code === "23505") {
      duplicates++;
    } else {
      errors.push(result.error.message);
    }
  }

  await db.rpc("mirsad_sync_ledger_main_status");
  await db.rpc("mirsad_trim_news_to_400");

  return reply({
    ok: errors.length === 0,
    inserted,
    duplicates,
    candidates: candidates.length,
    quota: q,
    duration_ms: Date.now() - startedAt,
    errors: errors.slice(0, 10),
  });
});
