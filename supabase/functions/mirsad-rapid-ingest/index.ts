import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const decode = (s: string) => s.replaceAll("<![CDATA[", "").replaceAll("]]>", "").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
const field = (b: string, n: string) => { const s = b.indexOf("<" + n); const o = b.indexOf(">", s); const e = b.indexOf("</" + n + ">", o); return s >= 0 && o >= 0 && e > o ? decode(b.slice(o + 1, e)) : ""; };
const items = (xml: string) => { const out: string[] = []; for (const tag of ["item", "entry"]) { let p = 0; while (true) { const s = xml.indexOf("<" + tag, p); if (s < 0) break; const o = xml.indexOf(">", s); const e = xml.indexOf("</" + tag + ">", o); if (o < 0 || e < 0) break; out.push(xml.slice(s, e + tag.length + 3)); p = e + tag.length + 3; } } return out; };
const canonical = (raw: string) => { try { const u = new URL(raw); for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref|source)$/i.test(k)) u.searchParams.delete(k); u.hash = ""; return u.toString(); } catch { return raw.trim(); } };
const published = (item: string) => { for (const tag of ["pubDate", "published", "updated", "dc:date"]) { const v = field(item, tag); const d = new Date(v); if (v && Number.isFinite(d.getTime())) return d.toISOString(); } return null; };
const isArabic = (s: string) => { const arabic = (s.match(/[ء-ي]/g) || []).length; const letters = (s.match(/[\p{L}]/gu) || []).length; return arabic >= 2 && arabic / Math.max(1, letters) >= 0.2; };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const sources = await db.from("news_sources").select("source_key,name,feed_url").eq("is_active", true).eq("source_kind", "rss").not("feed_url", "is", null).limit(20);
  if (sources.error) return reply({ error: sources.error.message }, 500);
  const existingRapid = await db.from("rapid_news").select("source_url").gte("received_at", new Date(Date.now() - 7 * 86400000).toISOString()).limit(2000);
  const normal = await db.from("news_articles").select("source_url").eq("is_pending_verification", false).limit(400);
  if (existingRapid.error || normal.error) return reply({ error: existingRapid.error?.message || normal.error?.message }, 500);
  const seen = new Set([...(existingRapid.data || []).map((x) => canonical(x.source_url)), ...(normal.data || []).map((x) => canonical(x.source_url))]);
  const inserted: string[] = [], errors: string[] = [];
  for (const source of sources.data || []) {
    try {
      const response = await fetch(source.feed_url, { headers: { "user-agent": "MirsadRapid/1.3" }, signal: AbortSignal.timeout(9000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      for (const item of items(xml).slice(0, 30)) {
        const headline = field(item, "title");
        const url = canonical(field(item, "link") || field(item, "guid"));
        if (!headline || !isArabic(headline) || !url || seen.has(url)) continue;
        const result = await db.from("rapid_news").insert({ source_key: source.source_key, source_name: source.name, source_url: url, headline, summary: field(item, "description") || field(item, "summary") || headline, published_at: published(item) }).select("id").single();
        if (!result.error || result.error.code === "23505") { seen.add(url); if (!result.error) inserted.push(result.data.id); }
        else errors.push(`${source.source_key}: ${result.error.message}`);
      }
    } catch (error) { errors.push(`${source.source_key}: ${String(error).slice(0, 500)}`); }
  }
  return reply({ ok: true, inserted: inserted.length, errors });
});
