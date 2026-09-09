import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mirsad-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const supabase = createClient(supabaseUrl, serviceRoleKey);

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
function authorized(req: Request) {
  const configuredSecret = Deno.env.get("MIRSAD_INGEST_SECRET") || Deno.env.get("N8N_WEBHOOK_SECRET") || "";
  const suppliedSecret = req.headers.get("x-mirsad-secret") || "";
  const auth = req.headers.get("Authorization") || "";
  const apikey = req.headers.get("apikey") || "";
  if (configuredSecret && suppliedSecret === configuredSecret) return true;
  return Boolean(anonKey && (auth === `Bearer ${anonKey}` || apikey === anonKey));
}
function clean(value: string, max = 1200) { return value.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim().slice(0, max); }
function tag(block: string, name: string) { const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i")); return match ? clean(match[1]) : ""; }
function categoryFor(text: string) { const value = text.toLowerCase(); if (/اقتصاد|مال|سوق|نفط|دولار|بنك|تجارة/.test(value)) return "Economy"; if (/تقنية|ذكاء اصطناعي|تكنولوجيا|إنترنت|رقمنة/.test(value)) return "Tech"; if (/رياضة|كرة|دوري|بطولة|منتخب/.test(value)) return "Sports"; if (/مجتمع|صحة|تعليم|بيئة|ثقافة/.test(value)) return "Society"; return "Politics"; }
function importanceFor(text: string) { return /عاجل|هجوم|حرب|زلزال|رئيس|حكومة|انتخابات|اتفاق/.test(text) ? 78 : 55; }
async function fetchFeed(source: { source_key: string; name: string; feed_url: string; trust_weight: number }) {
  const response = await fetch(source.feed_url, { headers: { "user-agent": "MirsadRSS/1.0" } });
  if (!response.ok) throw new Error(`${source.source_key}: HTTP ${response.status}`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 20);
  return items.map((match) => { const block = match[1]; const headline = tag(block, "title"); const link = tag(block, "link") || tag(block, "guid"); const summary = tag(block, "description") || headline; const dateValue = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated"); const publishedAt = dateValue && !Number.isNaN(Date.parse(dateValue)) ? new Date(dateValue).toISOString() : new Date().toISOString(); return { source_name: source.name, source_url: link, headline, summary, category: categoryFor(`${headline} ${summary}`), importance_score: importanceFor(headline), source_trust_score: Number(source.trust_weight), confidence_score: Math.round(Number(source.trust_weight) * 100), published_at: publishedAt }; }).filter((item) => item.headline && item.source_url);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const startedAt = new Date().toISOString();
  const { data: run } = await supabase.from("ingest_runs").insert({ status: "running", started_at: startedAt }).select("id").single();
  let seen = 0; let written = 0; const errors: string[] = [];
  try {
    const { data: sources, error: sourceError } = await supabase.from("news_sources").select("source_key,name,feed_url,trust_weight").eq("is_active", true).eq("source_kind", "rss").not("feed_url", "is", null).limit(20);
    if (sourceError) throw sourceError;
    for (const source of sources || []) {
      try {
        const articles = await fetchFeed(source); seen += articles.length;
        for (const article of articles) { const row = { ...article, agency_urls: [article.source_url], cluster_id: crypto.randomUUID(), sentiment: "Neutral", is_pending_verification: false, inherited_from_cache: false, llm_model_used: "rss-rule-based", ai_hints: { ingested_by: "mirsad-ingest", source_key: source.source_key }, raw_payload: { source_key: source.source_key } }; const { error } = await supabase.from("news_articles").upsert(row, { onConflict: "source_url", ignoreDuplicates: true }); if (!error) written += 1; else errors.push(`${source.source_key}: ${error.message}`); }
        await supabase.from("source_health").upsert({ source_key: source.source_key, last_success_at: new Date().toISOString(), consecutive_failures: 0, last_error: null, next_retry_at: null }, { onConflict: "source_key" });
      } catch (error) { errors.push(`${source.source_key}: ${error instanceof Error ? error.message : String(error)}`); await supabase.from("source_health").upsert({ source_key: source.source_key, last_failure_at: new Date().toISOString(), last_error: error instanceof Error ? error.message : String(error) }, { onConflict: "source_key" }); }
    }
    if (run?.id) await supabase.from("ingest_runs").update({ status: "completed", finished_at: new Date().toISOString(), items_seen: seen, items_written: written, notes: errors.slice(0, 10).join(" | ") || "RSS sync completed" }).eq("id", run.id);
    return json({ ok: true, seen, written, errors: errors.slice(0, 10) });
  } catch (error) { if (run?.id) await supabase.from("ingest_runs").update({ status: "failed", finished_at: new Date().toISOString(), items_seen: seen, items_written: written, notes: error instanceof Error ? error.message : String(error) }).eq("id", run.id); return json({ ok: false, error: error instanceof Error ? error.message : String(error), seen, written }, 500); }
});
