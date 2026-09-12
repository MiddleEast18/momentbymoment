import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Content-Type": "application/json" };
const reply = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers });
const decode = (s: string) => s.replaceAll("<![CDATA[", "").replaceAll("]]>", "").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
const field = (b: string, n: string) => { const s = b.indexOf("<" + n), o = b.indexOf(">", s), e = b.indexOf("</" + n + ">", o); return s >= 0 && o >= 0 && e > o ? decode(b.slice(o + 1, e)) : ""; };
const items = (xml: string) => { const out: string[] = []; for (const tag of ["item", "entry"]) { let p = 0; while (true) { const s = xml.indexOf("<" + tag, p); if (s < 0) break; const o = xml.indexOf(">", s), e = xml.indexOf("</" + tag + ">", o); if (o < 0 || e < 0) break; out.push(xml.slice(s, e + tag.length + 3)); p = e + tag.length + 3; } } return out; };
const STOP = new Set(["في","من","الى","إلى","على","عن","مع","هذا","هذه","هناك","بعد","قبل","وقد","خبر","اخبار","تقرير","مصدر","اليوم","أمس","الآن","بحسب"]);
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u064B-\u065F\u0670\u0610-\u061A\u06D6-\u06ED]/g, "").replace(/[أإآا]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(x => x.length > 2 && !STOP.has(x));
const unique = (xs: string[]) => [...new Set(xs)];
const EVENT_ANCHORS = ["حرب","هجوم","انفجار","زلزال","انتخابات","اتفاق","عقوبات","احتجاج","مفاوضات","تصعيد","هدنه","اغتيال","قتلى","وفيات","نفط","بنك","استثمار"];
const PLACE_ANCHORS = ["ايران","اسرائيل","لبنان","سوريا","العراق","اليمن","السعوديه","الاردن","غزه","فلسطين","امريكا","روسيا","اوكرانيا","الصين","اوروبا","المانيا","بريطانيا","فرنسا","تركيا","السودان","ليبيا"];
const signature = (s: string) => { const normalized = s.toLowerCase().normalize("NFKD").replace(/[\u064B-\u065F\u0670\u0610-\u061A\u06D6-\u06ED]/g, "").replace(/[أإآا]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ة/g, "ه"); return { tokens: unique(words(s)).slice(0, 36), anchors: EVENT_ANCHORS.filter(x => normalized.includes(x)), places: PLACE_ANCHORS.filter(x => normalized.includes(x)), numbers: unique((s.match(/\b\d+(?:[\.,]\d+)?\b/g) || []).map(x => x.replace(",", "."))) }; };
const compatibility = (a: any, b: any) => { const share = (x: string[], y: string[]) => !x.length || !y.length || x.some(v => y.includes(v)); if (a.numbers.length && b.numbers.length && !share(a.numbers, b.numbers)) return 0.35; if (a.places.length && b.places.length && !share(a.places, b.places)) return 0.45; if (a.anchors.length && b.anchors.length && !share(a.anchors, b.anchors)) return 0.55; return 1; };
const overlap = (a: string, b: string) => { const aa = new Set(words(a)), bb = new Set(words(b)); let n = 0; for (const x of aa) if (bb.has(x)) n++; return n / Math.max(1, Math.min(aa.size, bb.size)); };
const eventSimilarity = (a: string, b: string) => { const aa = signature(a), bb = signature(b); const sa = new Set(aa.tokens), sb = new Set(bb.tokens); let n = 0; for (const x of sa) if (sb.has(x)) n++; const jaccard = n / Math.max(1, new Set([...sa, ...sb]).size); return (overlap(a, b) * 0.55 + jaccard * 0.45) * compatibility(aa, bb); };
const classify = (s: string) => { const groups: Record<string, string[]> = { Economy: ["اقتصاد", "اقتصادي", "مال", "سوق", "نفط", "دولار", "بنك", "تجارة", "أسهم", "بورصة", "أسعار"], Tech: ["تقنية", "تكنولوجيا", "ذكاء اصطناعي", "إنترنت", "رقمنة", "هاتف", "آيفون", "أبل", "جوجل", "مايكروسوفت", "روبوت", "برمجيات"], Sports: ["رياضة", "رياضي", "كرة", "دوري", "بطولة", "منتخب", "مباراة", "هدف", "لاعب", "أهلي", "الهلال", "النصر"], Society: ["مجتمع", "صحة", "تعليم", "بيئة", "ثقافة", "جامعة", "مدرسة", "طب", "مناخ", "فنون", "منوعات"] }; let best = "Politics", score = 0; for (const key of Object.keys(groups)) { const n = groups[key].filter(x => s.includes(x)).length; if (n > score) { score = n; best = key; } } return best; };
const importance = (s: string, published = "") => { const t = s.toLowerCase(); let n = 30; for (const [rx, add] of [[/عاجل|طارئ|فوري|مباشر/,18],[/قتيل|قتلى|وفيات|جرحى|ضحايا|خسائر|تدمير/,16],[/حرب|هجوم|انفجار|قصف|صاروخ|اغتيال|تصعيد|اشتباك/,14],[/رئيس|حكومه|انتخابات|اتفاق|عقوبات|قرار|برلمان/,10],[/نفط|دولار|بنك|اسعار|استثمار|اقتصاد|تجاره/,8]] as const) if (rx.test(t)) n += add; if (/\b\d+(?:[\.,]\d+)?\b/.test(t)) n += 4; const age = Date.now() - new Date(published || Date.now()).getTime(); if (Number.isFinite(age) && age >= 0 && age < 3 * 60 * 60 * 1000) n += 6; return Math.max(1, Math.min(95, n)); };
const confidence = (trust: number, text: string) => Math.max(0, Math.min(100, trust * 100 + (signature(text).numbers.length ? 3 : 0) + (words(text).length >= 8 ? 2 : 0)));
const sentiment = (s: string) => s.includes("حرب") || s.includes("هجوم") || s.includes("قتلى") || s.includes("أزمة") || s.includes("انفجار") ? "Negative" : s.includes("اتفاق") || s.includes("فوز") || s.includes("نمو") ? "Positive" : "Neutral";
const canonicalUrl = (raw: string) => { try { const u = new URL(raw); for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref|source)$/i.test(k)) u.searchParams.delete(k); u.hash = ""; return u.toString(); } catch { return raw.trim(); } };
const publishedAt = (item: string) => { for (const tag of ["pubDate", "published", "updated", "dc:date"]) { const v = field(item, tag); if (!v) continue; const d = new Date(v); if (Number.isFinite(d.getTime())) return d.toISOString(); const m = v.match(/(?:،\s*)?(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(ص|م)/); if (m) { const months: Record<string, number> = { يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, سبتمبر: 9, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12 }; let hour = Number(m[4]) % 12; if (m[6] === "م") hour += 12; const parsed = new Date(`${m[3]}-${String(months[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${m[5]}:00+03:00`); if (Number.isFinite(parsed.getTime())) return parsed.toISOString(); } } return new Date().toISOString(); };
const rawPayload = (sourceKey: string, item: string, title: string, link: string, summary: string) => ({ source_key: sourceKey, title, link, description: summary, published: field(item, "pubDate") || field(item, "published") || field(item, "updated") || field(item, "dc:date") || null, author: field(item, "author") || field(item, "dc:creator") || null, category: field(item, "category") || null, guid: field(item, "guid") || null });

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const fetchFeed = async (source: any) => {
  let lastError = "";
  let status: number | null = null;
  const started = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(source.feed_url, { headers: { "user-agent": "MirsadRSS/2.0" }, signal: AbortSignal.timeout(10000) });
      status = response.status;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { source, xml: await response.text(), status, duration: Date.now() - started, error: "" };
    } catch (error) {
      lastError = String(error);
      if (attempt === 0) await wait(250);
    }
  }
  return { source, xml: "", status, duration: Date.now() - started, error: lastError || "feed_fetch_failed" };
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  const run = await db.from("ingest_runs").insert({ status: "running" }).select("id").single();
  let seen = 0, written = 0, duplicates = 0, clusterUpdates = 0;
  const errors: string[] = [];
  const sources = await db.from("news_sources").select("source_key,name,feed_url,trust_weight,default_category").eq("is_active", true).eq("source_kind", "rss").not("feed_url", "is", null).limit(20);
  if (sources.error) return reply({ error: sources.error.message }, 500);
  const existing = await db.from("news_articles").select("id,source_url,headline,summary,cluster_id,category,published_at").eq("is_pending_verification", false).order("updated_at", { ascending: false }).limit(400);
  const known = new Map((existing.data || []).map((x: any) => [canonicalUrl(x.source_url), x]));

  const fetchedSources = await Promise.all((sources.data || []).map(fetchFeed));
  for (const fetched of fetchedSources) {
    const source = fetched.source;
    let sourceSeen = 0, sourceWritten = 0, sourceUpdated = 0, sourceDuplicates = 0;
    if (fetched.error) {
      await db.rpc("record_source_health", { p_source_key: source.source_key, p_ok: false, p_error: fetched.error });
      await db.from("source_health").update({ last_attempt_at: new Date().toISOString(), last_http_status: fetched.status, last_duration_ms: fetched.duration, last_items_seen: 0, last_items_written: 0, last_items_updated: 0, last_duplicates: 0 }).eq("source_key", source.source_key);
      errors.push(`${source.source_key}: ${fetched.error}`);
      continue;
    }
    try {
      const xml = fetched.xml;
      const sourceItems = items(xml).slice(0, 30);
      for (const item of sourceItems) {
        const title = field(item, "title");
        const link = canonicalUrl(field(item, "link") || field(item, "guid"));
        if (!title || !link) continue;
        seen++;
        sourceSeen++;
        const existingRow = known.get(link);
        if (existingRow) {
          const incomingSummary = field(item, "description") || field(item, "summary") || title;
          const normalized = (value: string) => value.replace(/\\s+/g, " ").trim();
          const changed = normalized(title) !== normalized(existingRow.headline || "") ||
            normalized(incomingSummary) !== normalized(existingRow.summary || "");
          if (changed && existingRow.id) {
            const updated = await db.rpc("mirsad_apply_source_update", {
              p_article_id: existingRow.id,
              p_headline: title,
              p_summary: incomingSummary,
              p_published_at: publishedAt(item),
            });
            if (!updated.error) {
              existingRow.headline = title;
              existingRow.summary = incomingSummary;
              existingRow.published_at = publishedAt(item);
              sourceUpdated++;
              continue;
            }
            errors.push(source.source_key + ": source update " + updated.error.message);
          }
          duplicates++;
          sourceDuplicates++;
          continue;
        }
        const summary = field(item, "description") || field(item, "summary") || title;
        const all = `${title} ${summary}`;
        const category = source.default_category || classify(all);
        const match = (existing.data || []).filter((x: any) => !x.category || x.category === category).map((x: any) => ({ x, score: eventSimilarity(all, `${x.headline || ""} ${x.summary || ""}`) })).sort((a: any, b: any) => b.score - a.score)[0];
        if (match && match.score >= 0.66 && match.x.cluster_id) {
          const merged = await db.rpc("merge_cluster_update", { p_cluster_id: match.x.cluster_id, p_summary: summary, p_agency_url: link, p_claim_digest: { main_claim: title }, p_source_trust_score: Number(source.trust_weight) });
          if (!merged.error) { clusterUpdates++; sourceUpdated++; known.add(link); continue; }
          errors.push(`${source.source_key}: cluster merge ${merged.error.message}`);
        }
        const row = {
          source_name: source.name,
          source_url: link,
          agency_urls: [link],
          headline: title,
          summary,
          category,
          importance_score: importance(all, publishedAt(item)),
          sentiment: sentiment(all),
          cluster_id: crypto.randomUUID(),
          source_trust_score: Number(source.trust_weight),
          confidence_score: confidence(Number(source.trust_weight), all),
          is_pending_verification: false,
          inherited_from_cache: false,
          llm_model_used: "rss-rule-based-v5",
          ai_hints: { ingested_by: "mirsad-ingest", source_key: source.source_key, source_count: 1, source_diversity: 1, event_signature: signature(all), analysis_version: "event-v2" },
          claim_digest: { main_claim: title },
          raw_payload: rawPayload(source.source_key, item, title, link, summary),
          published_at: publishedAt(item),
        };
        const result = await db.from("news_articles").insert(row);
        if (!result.error) { written++; sourceWritten++; known.set(link, { id: null, source_url: link, headline: title, summary, cluster_id: row.cluster_id, category, published_at: row.published_at }); existing.data?.push({ source_url: link, headline: title, summary, cluster_id: row.cluster_id, category }); } else if (result.error.code === "23505") { duplicates++; sourceDuplicates++; } else errors.push(`${source.source_key}: ${result.error.message}`);
      }
      await db.rpc("record_source_health", { p_source_key: source.source_key, p_ok: true, p_error: null });
      await db.from("source_health").update({ last_attempt_at: new Date().toISOString(), last_http_status: fetched.status, last_duration_ms: fetched.duration, last_item_at: sourceItems.map((item: string) => publishedAt(item)).sort().at(-1) || null, last_items_seen: sourceSeen, last_items_written: sourceWritten, last_items_updated: sourceUpdated, last_duplicates: sourceDuplicates, consecutive_empty_runs: sourceSeen === 0 ? 1 : 0 }).eq("source_key", source.source_key);
    } catch (error) {
      await db.rpc("record_source_health", { p_source_key: source.source_key, p_ok: false, p_error: String(error) });
      errors.push(`${source.source_key}: ${String(error)}`);
    }
  }
  const cleanup = await db.rpc("mirsad_trim_news_to_400");
  if (cleanup.error) errors.push(`cleanup: ${cleanup.error.message}`);
  if (run.data?.id) await db.from("ingest_runs").update({ status: errors.length ? "partial" : "completed", finished_at: new Date().toISOString(), items_seen: seen, items_written: written, notes: JSON.stringify({ duplicates, clusterUpdates, cleanupDeleted: cleanup.data ?? 0, errors: errors.slice(0, 10) }) }).eq("id", run.data.id);
  return reply({ ok: true, seen, written, duplicates, clusterUpdates, cleanupDeleted: cleanup.data ?? 0, errors: errors.slice(0, 10) });
});
