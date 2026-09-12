import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const RECENT_MS = 48 * 60 * 60 * 1000;
const MONTHS: Record<string, number> = {
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6,
  يوليو: 7, أغسطس: 8, سبتمبر: 9, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
};

const decodeEntities = (s: string) => s
  .replace(/&(nbsp|#160);/gi, " ")
  .replace(/&(amp|quot|apos|lt|gt);/gi, (_m, name: string) => {
    const map: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
    return map[name.toLowerCase()] || _m;
  });

const decode = (s: string) => decodeEntities(s.replaceAll("<![CDATA[", "").replaceAll("]]>", "")).trim();

const field = (block: string, name: string) => {
  const start = block.search(new RegExp(`<${name}(?:\\s[^>]*)?>`, "i"));
  if (start < 0) return "";
  const openEnd = block.indexOf(">", start);
  const close = block.search(new RegExp(`</${name}>`, "i"));
  return openEnd >= 0 && close > openEnd ? decode(block.slice(openEnd + 1, close)) : "";
};

// Match whole <item>/<entry> tags only. DW RDF uses <items>, and a prefix search
// was treating the channel list as an article titled "DW".
const items = (xml: string) => {
  const out: string[] = [];
  for (const tag of ["item", "entry"]) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml))) out.push(match[0]);
  }
  return out;
};

const canonical = (raw: string) => {
  const value = decode(String(raw || "")).trim();
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|at_|fbclid|gclid|ref$|source$|maca|ocid|ns_|ito|cmpid|ncid)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
};

const itemUrl = (item: string) => {
  const text = field(item, "link") || field(item, "id") || field(item, "guid");
  if (/^https?:\/\//i.test(text)) return canonical(text);
  const href = item.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i)?.[1] || "";
  return canonical(href || text);
};

const normalizePublishedMs = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const now = Date.now();
  if (ms <= now + 2 * 60 * 1000) return ms;
  // Al Jazeera live JSON-LD often stamps Doha local time with a trailing Z.
  const shifted = ms - 3 * 60 * 60 * 1000;
  if (shifted <= now + 2 * 60 * 1000) return shifted;
  return now;
};

const publishedMs = (item: string) => {
  for (const tag of ["pubDate", "published", "updated", "dc:date"]) {
    const value = field(item, tag);
    if (!value) continue;
    const native = new Date(value).getTime();
    if (Number.isFinite(native)) {
      const normalized = normalizePublishedMs(native);
      if (normalized) return normalized;
    }
    const arabic = value.match(/(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(ص|م)/);
    if (arabic) {
      let hour = Number(arabic[4]) % 12;
      if (arabic[6] === "م") hour += 12;
      const parsed = new Date(`${arabic[3]}-${String(MONTHS[arabic[2]]).padStart(2, "0")}-${arabic[1].padStart(2, "0")}T${String(hour).padStart(2, "0")}:${arabic[5]}:00+03:00`).getTime();
      const normalized = normalizePublishedMs(parsed);
      if (normalized) return normalized;
    }
  }
  return null;
};

const isArabic = (s: string) => {
  const arabic = (s.match(/[ء-ي]/g) || []).length;
  const letters = (s.match(/[\p{L}]/gu) || []).length;
  return arabic >= 2 && arabic / Math.max(1, letters) >= 0.2;
};

const importance = (s: string) => Math.min(
  100,
  35
    + (/(عاجل|عاجلة|هجوم|حرب|انفجار|زلزال|قتلى|وفيات|اغتيال)/.test(s) ? 25 : 0)
    + (/(رئيس|حكومة|انتخابات|اتفاق|تصعيد|إيران|إسرائيل|أمريكا)/.test(s) ? 10 : 0),
);

const itemKey = (item: string, url: string) => field(item, "guid") || url;
const feedHash = (text: string) => { let h = 2166136261; for (let i=0;i<text.length;i++) { h ^= text.charCodeAt(i); h = Math.imul(h,16777619); } return (h>>>0).toString(16); };
const cleanRichText = (value: string) => decodeEntities(String(value || "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
  .replace(/<[^>]*>/g, ""))
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const headlineKey = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

const stableKey = (value: string) => {
  const normalized = headlineKey(value);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const LIVE_FALLBACK_URLS: Record<string, string> = {
  aljazeera: "https://www.aljazeera.net/news/breaking",
};

const extractJsonLdObjects = (html: string) => {
  const out: any[] = [];
  const re = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try {
      const parsed = JSON.parse(match[1].replace(/^\s*<!--/, "").replace(/-->\s*$/, "").trim());
      const stack = Array.isArray(parsed) ? parsed : [parsed];
      while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== "object") continue;
        out.push(value);
        if (Array.isArray(value["@graph"])) stack.push(...value["@graph"]);
        if (Array.isArray(value.blogPost)) stack.push(...value.blogPost);
      }
    } catch {
      // Ignore malformed/unrelated JSON-LD blocks.
    }
  }
  return out;
};

const findLiveArticleUrl = (html: string, headline: string) => {
  const index = html.indexOf(headline);
  if (index < 0) return "";
  const windowStart = Math.max(0, index - 3000);
  const slice = html.slice(windowStart, Math.min(html.length, index + 1200));
  const links = [...slice.matchAll(/href=["'](https?:\/\/www\.aljazeera\.net\/[^"']+)["']/gi)].map((m) => m[1]);
  return links.reverse().find((url) => /aljazeera\.net\/(news|politics|sport|ebusiness)\//i.test(url)) || "";
};

const fetchLiveFallback = async (source: any) => {
  const fallbackUrl = LIVE_FALLBACK_URLS[source.source_key];
  if (!fallbackUrl) return [];
  try {
    const response = await fetch(fallbackUrl, {
      headers: { "user-agent": "MirsadRapidLive/1.1" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const html = await response.text();
    const cutoff = Date.now() - RECENT_MS;
    const rows: any[] = [];
    const seenHeadlines = new Set<string>();
    for (const obj of extractJsonLdObjects(html)) {
      const type = String(obj?.["@type"] || "");
      const isPost = /BlogPosting|NewsArticle|Article/i.test(type) || obj?.headline && obj?.dateModified;
      if (!isPost) continue;
      const headline = cleanRichText(String(obj?.headline || obj?.articleBody || "").trim());
      const dateValue = String(obj?.dateModified || obj?.datePublished || "").trim();
      const ms = normalizePublishedMs(new Date(dateValue).getTime());
      const key = headlineKey(headline);
      if (!headline || !isArabic(headline) || !ms || ms < cutoff || seenHeadlines.has(key)) continue;
      seenHeadlines.add(key);
      const directUrl = String(obj?.url || obj?.["@id"] || "").trim();
      const url = canonical(
        (/^https?:\/\//i.test(directUrl) && !/aljazeera\.net\/news\/breaking\/?$/i.test(directUrl)
          ? directUrl
          : findLiveArticleUrl(html, headline))
        || `${fallbackUrl}?mirsad_rapid=${stableKey(headline + "|" + dateValue)}`,
      );
      if (!directUrl || !/^https?:\/\//i.test(directUrl)) continue;
      rows.push({
        source_key: source.source_key,
        source_name: source.name,
        source_url: url,
        headline,
        summary: cleanRichText(String(obj?.articleBody || headline)),
        published_at: new Date(ms).toISOString(),
        importance_score: importance(headline) + (/عاجل|مباشر|فوري/.test(headline) ? 15 : 0),
      });
    }
    return rows;
  } catch {
    return [];
  }
};

const urlsInTable = async (table: "rapid_news" | "news_articles", urls: string[]) => {
  const found = new Set<string>();
  for (let i = 0; i < urls.length; i += 100) {
    const chunk = urls.slice(i, i + 100);
    if (!chunk.length) continue;
    const query = table === "news_articles"
      ? db.from(table).select("source_url").in("source_url", chunk).eq("is_pending_verification", false)
      : db.from(table).select("source_url").in("source_url", chunk);
    const result = await query;
    for (const row of result.data || []) found.add(canonical(row.source_url));
  }
  return found;
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  const sources = await db.from("news_sources")
    .select("source_key,name,feed_url")
    .eq("is_active", true)
    .eq("source_kind", "rss")
    .not("feed_url", "is", null);
  if (sources.error) return reply({ error: sources.error.message }, 500);

  const feedStates = await db.from("source_feed_state").select("source_key,etag,last_modified,last_feed_hash");
  const stateMap = new Map((feedStates.data || []).map((row: any) => [row.source_key, row]));
  const sourceNames = new Map((sources.data || []).map((row: any) => [row.source_key, row.name]));

  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let itemsSeen = 0;
  let captured = 0;
  const stats: Record<string, any> = {};

  // Phase 1: observe every source independently and concurrently.
  const fetched = await Promise.allSettled((sources.data || []).map(async (source) => {
    const state = stateMap.get(source.source_key);
    const started = Date.now();
    let status: number | null = null;
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const headers: Record<string, string> = {
          "user-agent": "MirsadRapid/5.0",
          "accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
        };
        if (state?.etag) headers["if-none-match"] = state.etag;
        if (state?.last_modified) headers["if-modified-since"] = state.last_modified;

        const response = await fetch(source.feed_url, {
          headers,
          signal: AbortSignal.timeout(10000),
        });
        status = response.status;

        if (status === 304) {
          return {
            source, xml: "", liveRows: [], status,
            duration: Date.now() - started, error: "", unchanged: true,
            etag: state?.etag || null, lastModified: state?.last_modified || null,
          };
        }

        if (!response.ok) throw new Error(`HTTP ${status}`);
        const xml = await response.text();
        const liveRows = LIVE_FALLBACK_URLS[source.source_key]
          ? await fetchLiveFallback(source)
          : [];

        return {
          source, xml, liveRows, status,
          duration: Date.now() - started, error: "", unchanged: false,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
        };
      } catch (error) {
        lastError = String(error);
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    return {
      source, xml: "", liveRows: [], status,
      duration: Date.now() - started,
      error: lastError || "feed_fetch_failed",
      unchanged: false, etag: null, lastModified: null,
    };
  }));

  for (let i = 0; i < fetched.length; i += 1) {
    const result = fetched[i];
    const source = sources.data?.[i];
    if (!source || result.status === "rejected") continue;

    if (result.value.error) {
      const message = `${source.source_key}: ${result.value.error}`;
      errors.push(message);
      await db.rpc("record_source_health", {
        p_source_key: source.source_key, p_ok: false, p_error: result.value.error,
      });
      continue;
    }

    try {
      const nowIso = new Date().toISOString();

      if (result.value.unchanged) {
        await db.from("source_feed_state").upsert({
          source_key: source.source_key,
          etag: result.value.etag,
          last_modified: result.value.lastModified,
          last_checked_at: nowIso,
          updated_at: nowIso,
        }, { onConflict: "source_key" });

        stats[source.source_key] = {
          status: 304,
          duration_ms: result.value.duration,
          items_seen: 0,
          captured: 0,
          mode: "unchanged",
        };
        continue;
      }

      const cutoff = Date.now() - RECENT_MS;
      const observations: any[] = [];
      const localKeys = new Set<string>();
      const parsed = items(result.value.xml).slice(0, 100);

      for (const item of parsed) {
        const headline = cleanRichText(field(item, "title"));
        const url = /^https?:\/\//i.test(field(item, "link"))
          ? canonical(field(item, "link"))
          : itemUrl(item);
        const ms = published(item);
        if (!headline || !isArabic(headline) || !url) continue;
        if (ms) {
          const age = Date.now() - new Date(ms).getTime();
          if (age > RECENT_MS) continue;
        }

        const key = itemKey(item, url);
        if (localKeys.has(key)) continue;
        localKeys.add(key);
        observations.push({
          source_key: source.source_key,
          item_key: key,
          source_url: url,
          guid: field(item, "guid") || "",
          headline,
          summary: cleanRichText(field(item, "description") || field(item, "summary") || headline),
          published_at: ms,
        });
      }

      for (const live of result.value.liveRows || []) {
        const url = canonical(live.source_url);
        const ms = live.published_at;
        if (!url || !isArabic(live.headline || "")) continue;
        if (ms && Date.now() - new Date(ms).getTime() > RECENT_MS) continue;
        const key = live.source_url;
        if (localKeys.has(key)) continue;
        localKeys.add(key);
        observations.push({
          source_key: source.source_key,
          item_key: key,
          source_url: url,
          guid: "",
          headline: cleanRichText(live.headline),
          summary: cleanRichText(live.summary || live.headline),
          published_at: ms || null,
        });
      }

      itemsSeen += observations.length;

      // The ledger is the source of truth: observing an item never makes it captured.
      if (observations.length) {
        const obs = await db.from("source_item_ledger").upsert(observations, { onConflict: "source_key,item_key", ignoreDuplicates: false });
        if (obs.error) throw new Error(obs.error.message);
      }

      await db.from("source_feed_state").upsert({
        source_key: source.source_key,
        etag: result.value.etag,
        last_modified: result.value.lastModified,
        last_feed_hash: feedHash(result.value.xml),
        last_checked_at: nowIso,
        last_changed_at: nowIso,
        updated_at: nowIso,
      }, { onConflict: "source_key" });

      await db.rpc("record_source_health", {
        p_source_key: source.source_key, p_ok: true, p_error: null,
      });
      await db.from("source_health").update({
        last_attempt_at: nowIso,
        last_http_status: result.value.status,
        last_duration_ms: result.value.duration,
        last_items_seen: observations.length,
        last_items_written: 0,
        last_items_updated: 0,
        last_duplicates: 0,
      }).eq("source_key", source.source_key);

      stats[source.source_key] = {
        status: result.value.status,
        duration_ms: result.value.duration,
        items_seen: observations.length,
        captured: 0,
        live_rows: (result.value.liveRows || []).length,
        mode: "observe_only",
      };
    } catch (error) {
      const message = String(error).slice(0, 500);
      errors.push(`${source.source_key}: ${message}`);
      await db.rpc("record_source_health", {
        p_source_key: source.source_key, p_ok: false, p_error: message,
      });
    }
  }

  // Reconcile what already made it into the main store before any capture decision.
  const sync = await db.rpc("mirsad_sync_ledger_main_status");
  if (sync.error) errors.push("ledger_sync: " + sync.error.message);

  // Only items first observed at least one hour ago and still absent from the main store
  // are eligible for the captured-news safety net.
  const cutoffIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const maxAgeIso = new Date(Date.now() - RECENT_MS).toISOString();
  const due = await db.from("source_item_ledger")
    .select("source_key,source_url,headline,summary,published_at,first_seen_at,item_key")
    .eq("status", "observed")
    .lte("first_seen_at", cutoffIso)
    .gte("first_seen_at", maxAgeIso)
    .limit(400);

  if (due.error) {
    errors.push("due_query: " + due.error.message);
  } else if (due.data?.length) {
    const urls = due.data.map((row: any) => canonical(row.source_url));
    const existing = await db.from("news_articles")
      .select("source_url")
      .in("source_url", urls)
      .eq("is_pending_verification", false);
    if (existing.error) {
      errors.push("main_check: " + existing.error.message);
    } else {
      const mainUrls = new Set((existing.data || []).map((row: any) => canonical(row.source_url)));
      const rows = due.data.filter((row: any) => !mainUrls.has(canonical(row.source_url)));

      if (rows.length) {
        const inserted = await db.from("rapid_news").upsert(
          rows.map((row: any) => ({
            source_key: row.source_key,
            source_name: sourceNames.get(row.source_key) || row.source_key,
            source_url: canonical(row.source_url),
            headline: cleanRichText(row.headline),
            summary: cleanRichText(row.summary),
            published_at: row.published_at,
            importance_score: importance(row.headline),
          })),
          { onConflict: "source_url", ignoreDuplicates: true },
        ).select("id");

        if (inserted.error) {
          errors.push("rapid_insert: " + inserted.error.message);
        } else {
          captured = inserted.data?.length || 0;
          for (const row of rows) {
            await db.from("source_item_ledger").update({
              status: "captured",
              captured_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq("source_key", row.source_key).eq("item_key", row.item_key);
          }
        }
      }
    }
  }

  const trim = await db.rpc("mirsad_trim_rapid_news_to_400");
  if (trim.error) errors.push("trim: " + trim.error.message);

  return reply({
    ok: errors.length === 0,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    sources: sources.data?.length || 0,
    items_seen: itemsSeen,
    captured,
    errors: errors.slice(0, 20),
    source_stats: stats,
  });
});