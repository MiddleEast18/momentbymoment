import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Content-Type": "application/json" };
const reply = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers });
const decode = (s: string) => s.replaceAll("<![CDATA[", "").replaceAll("]]>", "").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
const field = (b: string, n: string) => { const s = b.indexOf("<" + n), o = b.indexOf(">", s), e = b.indexOf("</" + n + ">", o); return s >= 0 && o >= 0 && e > o ? decode(b.slice(o + 1, e)) : ""; };
const items = (xml: string) => { const out: string[] = []; for (const tag of ["item", "entry"]) { let p = 0; while (true) { const s = xml.indexOf("<" + tag, p); if (s < 0) break; const o = xml.indexOf(">", s), e = xml.indexOf("</" + tag + ">", o); if (o < 0 || e < 0) break; out.push(xml.slice(s, e + tag.length + 3)); p = e + tag.length + 3; } } return out; };
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(x => x.length > 2);
const overlap = (a: string, b: string) => { const aa = new Set(words(a)), bb = new Set(words(b)); let n = 0; for (const x of aa) if (bb.has(x)) n++; return n / Math.max(1, Math.min(aa.size, bb.size)); };
const classify = (s: string) => { const groups: Record<string, string[]> = { Economy: ["اقتصاد", "اقتصادي", "مال", "سوق", "نفط", "دولار", "بنك", "تجارة", "أسهم", "بورصة", "أسعار"], Tech: ["تقنية", "تكنولوجيا", "ذكاء اصطناعي", "إنترنت", "رقمنة", "هاتف", "آيفون", "أبل", "جوجل", "مايكروسوفت", "روبوت", "برمجيات"], Sports: ["رياضة", "رياضي", "كرة", "دوري", "بطولة", "منتخب", "مباراة", "هدف", "لاعب", "أهلي", "الهلال", "النصر"], Society: ["مجتمع", "صحة", "تعليم", "بيئة", "ثقافة", "جامعة", "مدرسة", "طب", "مناخ", "فنون", "منوعات"] }; let best = "Politics", score = 0; for (const key of Object.keys(groups)) { const n = groups[key].filter(x => s.includes(x)).length; if (n > score) { score = n; best = key; } } return best; };
const importance = (s: string) => { let n = 35; for (const x of ["عاجل", "عاجلة", "هجوم", "حرب", "انفجار", "زلزال", "إطلاق نار", "قتلى", "وفيات", "اغتيال"]) if (s.includes(x)) n += 12; for (const x of ["رئيس", "حكومة", "انتخابات", "اتفاق", "تصعيد", "إيران", "إسرائيل", "أمريكا"]) if (s.includes(x)) n += 5; return Math.min(95, n); };
const sentiment = (s: string) => s.includes("حرب") || s.includes("هجوم") || s.includes("قتلى") || s.includes("أزمة") || s.includes("انفجار") ? "Negative" : s.includes("اتفاق") || s.includes("فوز") || s.includes("نمو") ? "Positive" : "Neutral";
const canonicalUrl = (raw: string) => { try { const u = new URL(raw); for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref|source)$/i.test(k)) u.searchParams.delete(k); u.hash = ""; return u.toString(); } catch { return raw.trim(); } };
const publishedAt = (item: string) => { for (const tag of ["pubDate", "published", "updated", "dc:date"]) { const v = field(item, tag); if (v) { const d = new Date(v); if (Number.isFinite(d.getTime())) return d.toISOString(); } } return new Date().toISOString(); };
const rawPayload = (sourceKey: string, item: string, title: string, link: string, summary: string) => ({ source_key: sourceKey, title, link, description: summary, published: field(item, "pubDate") || field(item, "published") || field(item, "updated") || field(item, "dc:date") || null, author: field(item, "author") || field(item, "dc:creator") || null, category: field(item, "category") || null, guid: field(item, "guid") || null });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  const run = await db.from("ingest_runs").insert({ status: "running" }).select("id").single();
  let seen = 0, written = 0, duplicates = 0, clusterUpdates = 0;
  const errors: string[] = [];
  const sources = await db.from("news_sources").select("source_key,name,feed_url,trust_weight,default_category").eq("is_active", true).eq("source_kind", "rss").not("feed_url", "is", null).limit(20);
  if (sources.error) return reply({ error: sources.error.message }, 500);
  const existing = await db.from("news_articles").select("source_url,headline,cluster_id,category").eq("is_pending_verification", false).order("updated_at", { ascending: false }).limit(400);
  const known = new Set((existing.data || []).map((x: any) => canonicalUrl(x.source_url)));

  for (const source of sources.data || []) {
    try {
      const r = await fetch(source.feed_url, { headers: { "user-agent": "MirsadRSS/2.0" }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xml = await r.text();
      for (const item of items(xml).slice(0, 30)) {
        const title = field(item, "title");
        const link = canonicalUrl(field(item, "link") || field(item, "guid"));
        if (!title || !link) continue;
        seen++;
        if (known.has(link)) { duplicates++; continue; }
        const summary = field(item, "description") || field(item, "summary") || title;
        const all = `${title} ${summary}`;
        const match = (existing.data || []).map((x: any) => ({ x, score: overlap(title, x.headline || "") })).sort((a: any, b: any) => b.score - a.score)[0];
        if (match && match.score >= 0.55 && match.x.cluster_id) {
          const merged = await db.rpc("merge_cluster_update", { p_cluster_id: match.x.cluster_id, p_summary: summary, p_agency_url: link, p_claim_digest: { main_claim: title }, p_source_trust_score: Number(source.trust_weight) });
          if (!merged.error) { clusterUpdates++; known.add(link); continue; }
          errors.push(`${source.source_key}: cluster merge ${merged.error.message}`);
        }
        const row = {
          source_name: source.name,
          source_url: link,
          agency_urls: [link],
          headline: title,
          summary,
          category: source.default_category || classify(all),
          importance_score: importance(all),
          sentiment: sentiment(all),
          cluster_id: crypto.randomUUID(),
          source_trust_score: Number(source.trust_weight),
          confidence_score: Math.min(100, Number(source.trust_weight) * 100),
          is_pending_verification: false,
          inherited_from_cache: false,
          llm_model_used: "rss-rule-based-v5",
          ai_hints: { ingested_by: "mirsad-ingest", source_key: source.source_key },
          claim_digest: { main_claim: title },
          raw_payload: rawPayload(source.source_key, item, title, link, summary),
          published_at: publishedAt(item),
        };
        const result = await db.from("news_articles").insert(row);
        if (!result.error) { written++; known.add(link); } else if (result.error.code === "23505") duplicates++; else errors.push(`${source.source_key}: ${result.error.message}`);
      }
    } catch (error) { errors.push(`${source.source_key}: ${String(error)}`); }
  }
  const cleanup = await db.rpc("mirsad_trim_news_to_400");
  if (cleanup.error) errors.push(`cleanup: ${cleanup.error.message}`);
  if (run.data?.id) await db.from("ingest_runs").update({ status: "completed", finished_at: new Date().toISOString(), items_seen: seen, items_written: written, notes: JSON.stringify({ duplicates, clusterUpdates, cleanupDeleted: cleanup.data ?? 0, errors: errors.slice(0, 10) }) }).eq("id", run.data.id);
  return reply({ ok: true, seen, written, duplicates, clusterUpdates, cleanupDeleted: cleanup.data ?? 0, errors: errors.slice(0, 10) });
});
