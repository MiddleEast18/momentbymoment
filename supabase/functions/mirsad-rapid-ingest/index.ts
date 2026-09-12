import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const decode = (s: string) => s.replaceAll("<![CDATA[", "").replaceAll("]]>", "").replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim();
const field = (b: string, n: string) => { const s = b.indexOf("<" + n); const o = b.indexOf(">", s); const e = b.indexOf("</" + n + ">", o); return s >= 0 && o >= 0 && e > o ? decode(b.slice(o + 1, e)) : ""; };
const items = (xml: string) => { const out: string[] = []; for (const tag of ["item", "entry"]) { let p = 0; while (true) { const s = xml.indexOf("<" + tag, p); if (s < 0) break; const o = xml.indexOf(">", s); const e = xml.indexOf("</" + tag + ">", o); if (o < 0 || e < 0) break; out.push(xml.slice(s, e + tag.length + 3)); p = e + tag.length + 3; } } return out; };
const canonical = (raw: string) => { try { const u = new URL(raw); for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref|source)$/i.test(k)) u.searchParams.delete(k); u.hash = ""; return u.toString(); } catch { return raw.trim(); } };
const published = (item: string) => { for (const tag of ["pubDate", "published", "updated", "dc:date"]) { const v = field(item, tag); if (!v) continue; const d = new Date(v); if (Number.isFinite(d.getTime())) return d.toISOString(); const m = v.match(/(?:،\s*)?(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(ص|م)/); if (m) { const months: Record<string, number> = { يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, سبتمبر: 9, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12 }; let hour = Number(m[4]) % 12; if (m[6] === "م") hour += 12; const parsed = new Date(`${m[3]}-${String(months[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${m[5]}:00+03:00`); if (Number.isFinite(parsed.getTime())) return parsed.toISOString(); } } return null; };
const isArabic = (s: string) => { const arabic = (s.match(/[ء-ي]/g) || []).length; const letters = (s.match(/[\p{L}]/gu) || []).length; return arabic >= 2 && arabic / Math.max(1, letters) >= 0.2; };
const importance = (s: string) => Math.min(100, 35 + (/(عاجل|عاجلة|هجوم|حرب|انفجار|زلزال|قتلى|وفيات|اغتيال)/.test(s) ? 25 : 0) + (/(رئيس|حكومة|انتخابات|اتفاق|تصعيد|إيران|إسرائيل|أمريكا)/.test(s) ? 10 : 0));
const cleanRichText = (value: string) => String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  const sources = await db.from("news_sources")
    .select("source_key,name,feed_url")
    .eq("is_active", true)
    .eq("source_kind", "rss")
    .not("feed_url", "is", null);

  if (sources.error) return reply({ error: sources.error.message }, 500);

  const [existingRapid, normal] = await Promise.all([
    db.from("rapid_news")
      .select("source_url")
      .gte("received_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .limit(2000),
    db.from("news_articles")
      .select("source_url")
      .eq("is_pending_verification", false)
      .limit(400),
  ]);

  if (existingRapid.error || normal.error) {
    return reply({ error: existingRapid.error?.message || normal.error?.message }, 500);
  }

  const seen = new Set([
    ...(existingRapid.data || []).map((x) => canonical(x.source_url)),
    ...(normal.data || []).map((x) => canonical(x.source_url)),
  ]);

  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let totalSeen = 0;
  let totalInserted = 0;
  const sourceStats: Record<string, unknown> = {};

  // Every active source is fetched independently and concurrently.
  const fetched = await Promise.allSettled(
    (sources.data || []).map(async (source) => {
      const started = Date.now();
      let lastError = "";
      let status: number | null = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(source.feed_url, {
            headers: { "user-agent": "MirsadRapid/2.0" },
            signal: AbortSignal.timeout(9000),
          });
          status = response.status;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return {
            source,
            xml: await response.text(),
            status,
            duration: Date.now() - started,
            error: "",
          };
        } catch (error) {
          lastError = String(error);
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }

      return {
        source,
        xml: "",
        status,
        duration: Date.now() - started,
        error: lastError || "feed_fetch_failed",
      };
    }),
  );

  for (let i = 0; i < fetched.length; i += 1) {
    const result = fetched[i];
    const source = sources.data?.[i];
    if (!source) continue;

    let sourceSeen = 0;
    let sourceInserted = 0;
    let sourceDuplicates = 0;

    if (result.status === "rejected") {
      const error = String(result.reason);
      errors.push(`${source.source_key}: ${error}`);
      await db.rpc("record_source_health", {
        p_source_key: source.source_key,
        p_ok: false,
        p_error: error,
      });
      continue;
    }

    if (result.value.error) {
      errors.push(`${source.source_key}: ${result.value.error}`);
      await db.rpc("record_source_health", {
        p_source_key: source.source_key,
        p_ok: false,
        p_error: result.value.error,
      });
      await db.from("source_health").update({
        last_attempt_at: new Date().toISOString(),
        last_http_status: result.value.status,
        last_duration_ms: result.value.duration,
        last_items_seen: 0,
        last_items_written: 0,
        last_items_updated: 0,
        last_duplicates: 0,
      }).eq("source_key", source.source_key);
      continue;
    }

    try {
      // Read the whole available feed. A safety cap prevents pathological feeds
      // from exhausting an execution while preserving far more than the old 30-item window.
      const sourceItems = items(result.value.xml).slice(0, 200);
      const rows = [];

      for (const item of sourceItems) {
        const headline = field(item, "title");
        const url = canonical(field(item, "link") || field(item, "guid"));
        if (!headline || !isArabic(headline) || !url) continue;

        sourceSeen += 1;
        totalSeen += 1;

        if (seen.has(url)) {
          sourceDuplicates += 1;
          continue;
        }

        const row = {
          source_key: source.source_key,
          source_name: source.name,
          source_url: url,
          headline: cleanRichText(headline),
          summary: cleanRichText(field(item, "description") || field(item, "summary") || headline),
          published_at: published(item),
          importance_score: importance(headline),
        };

        rows.push(row);
        // Reserve immediately so the same URL cannot be queued twice during this run.
        seen.add(url);
      }

      if (rows.length) {
        const resultInsert = await db.from("rapid_news").insert(rows).select("id");
        if (resultInsert.error) {
          // A concurrent run can legitimately race on the unique URL.
          if (resultInsert.error.code !== "23505") {
            throw new Error(resultInsert.error.message);
          }
        } else {
          sourceInserted = resultInsert.data?.length || rows.length;
          totalInserted += sourceInserted;
        }
      }

      await db.rpc("record_source_health", {
        p_source_key: source.source_key,
        p_ok: true,
        p_error: null,
      });
      await db.from("source_health").update({
        last_attempt_at: new Date().toISOString(),
        last_http_status: result.value.status,
        last_duration_ms: result.value.duration,
        last_items_seen: sourceSeen,
        last_items_written: sourceInserted,
        last_items_updated: 0,
        last_duplicates: sourceDuplicates,
      }).eq("source_key", source.source_key);

      sourceStats[source.source_key] = {
        status: result.value.status,
        duration_ms: result.value.duration,
        items_seen: sourceSeen,
        inserted: sourceInserted,
        duplicates: sourceDuplicates,
      };
    } catch (error) {
      const message = String(error).slice(0, 500);
      errors.push(`${source.source_key}: ${message}`);
      await db.rpc("record_source_health", {
        p_source_key: source.source_key,
        p_ok: false,
        p_error: message,
      });
    }
  }

  // Keep the independent layer bounded at 400 rows.
  const trim = await db.rpc("mirsad_trim_rapid_news_to_400");
  if (trim.error) errors.push(`trim: ${trim.error.message}`);

  const finishedAt = new Date().toISOString();
  return reply({
    ok: true,
    started_at: startedAt,
    finished_at: finishedAt,
    sources: (sources.data || []).length,
    items_seen: totalSeen,
    inserted: totalInserted,
    errors: errors.slice(0, 20),
    source_stats: sourceStats,
  });
});
