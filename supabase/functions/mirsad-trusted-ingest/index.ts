import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
const SOURCE_KEY = "guardian_middleeast_trusted";
const SOURCE_NAME = "The Guardian — Middle East";
const FEED_URL = "https://www.theguardian.com/world/middleeast/rss";
const MAX_ITEMS = 40;
const headers = { "Content-Type": "application/json" };

const decode = (value: string) => value
  .replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const field = (block: string, name: string) => {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decode(match[1]) : "";
};

const canonical = (raw: string) => {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return ""; }
};

const published = (raw: string) => {
  const date = new Date(raw).getTime();
  if (!Number.isFinite(date)) return new Date().toISOString();
  const now = Date.now();
  return new Date(Math.min(date, now)).toISOString();
};

const category = (headline: string, url: string) => {
  const text = `${headline} ${url}`.toLowerCase();
  if (/اقتصاد|مال|سوق|نفط|دولار|بنك|business|economy/.test(text)) return "Economy";
  if (/تقنية|تكنولوجيا|ذكاء اصطناعي|tech|technology/.test(text)) return "Tech";
  if (/رياضة|sport/.test(text)) return "Sports";
  if (/مجتمع|صحة|ثقافة|society|health|culture/.test(text)) return "Society";
  return "Politics";
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
  const started = Date.now();
  try {
    const response = await fetch(FEED_URL, { headers: { "user-agent": "MirsadTrustedNews/1.0 (+https://marsad.website/)" } });
    if (!response.ok) throw new Error(`feed_http_${response.status}`);
    const xml = await response.text();
    const blocks = [...xml.matchAll(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)].map((match) => match[0]);
    const rows = blocks.map((block) => {
      const headline = field(block, "title");
      const sourceUrl = canonical(field(block, "link") || field(block, "guid"));
      const parsed = sourceUrl ? new URL(sourceUrl) : null;
      if (!headline || !sourceUrl || !parsed || !/(^|\.)theguardian\.com$/i.test(parsed.hostname)) return null;
      return {
        source_key: SOURCE_KEY, source_name: SOURCE_NAME, source_url: sourceUrl, headline,
        summary: field(block, "description") || headline, category: category(headline, sourceUrl),
        confidence_score: 96, published_at: published(field(block, "pubDate") || field(block, "dc:date")),
        verified_source: true, updated_at: new Date().toISOString(), raw_payload: { feed: FEED_URL },
      };
    }).filter(Boolean).slice(0, MAX_ITEMS);
    if (rows.length) {
      const result = await db.from("trusted_news_articles").upsert(rows, { onConflict: "source_url", ignoreDuplicates: false });
      if (result.error) throw result.error;
    }
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    await db.from("trusted_news_articles").delete().lt("published_at", cutoff);
    return new Response(JSON.stringify({ ok: true, source_key: SOURCE_KEY, fetched: blocks.length, upserted: rows.length, duration_ms: Date.now() - started }), { headers });
  } catch (error) {
    console.error("[mirsad trusted ingest]", error);
    return new Response(JSON.stringify({ ok: false, source_key: SOURCE_KEY, error: String(error?.message || error), duration_ms: Date.now() - started }), { status: 502, headers });
  }
});
