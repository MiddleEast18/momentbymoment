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

  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let totalSeen = 0;
  let totalInserted = 0;
  const sourceStats: Record<string, unknown> = {};
  const seenUrls = new Set<string>();
  const seenHeadlines = new Set<string>();

  const fetched = await Promise.allSettled(
    (sources.data || []).map(async (source) => {
      const started = Date.now();
      let lastError = "";
      let status: number | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(source.feed_url, {
            headers: { "user-agent": "MirsadRapid/2.1" },
            signal: AbortSignal.timeout(9000),
          });
          status = response.status;
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const xml = await response.text();
          const liveRows = LIVE_FALLBACK_URLS[source.source_key] ? await fetchLiveFallback(source) : [];
          return { source, xml, liveRows, status, duration: Date.now() - started, error: "" };
        } catch (error) {
          lastError = String(error);
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      return { source, xml: "", liveRows: [], status, duration: Date.now() - started, error: lastError || "feed_fetch_failed" };
    }),
  );

  for (let i = 0; i < fetched.length; i += 1) {
    const result = fetched[i];
    const source = sources.data?.[i];
    if (!source) continue;

    let sourceSeen = 0;
    let sourceInserted = 0;
    let sourceDuplicates = 0;
    let newestMs = 0;

    if (result.status === "rejected") {
      const error = String(result.reason);
      errors.push(`${source.source_key}: ${error}`);
      await db.rpc("record_source_health", { p_source_key: source.source_key, p_ok: false, p_error: error });
      continue;
    }

    if (result.value.error) {
      errors.push(`${source.source_key}: ${result.value.error}`);
      await db.rpc("record_source_health", { p_source_key: source.source_key, p_ok: false, p_error: result.value.error });
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
      const cutoff = Date.now() - RECENT_MS;
      const parsedItems = items(result.value.xml).map((item, index) => {
        const ms = publishedMs(item) ?? (index < 5 ? Date.now() : null);
        return { item, publishedMs: ms, index };
      }).filter((row) => row.publishedMs && row.publishedMs >= cutoff)
        .sort((a, b) => (b.publishedMs || 0) - (a.publishedMs || 0))
        .slice(0, 20);

      const rows: any[] = [];
      for (const row of parsedItems) {
        const headline = cleanRichText(field(row.item, "title"));
        const url = itemUrl(row.item);
        if (!headline || !isArabic(headline) || !url || !/^https?:\/\//i.test(url)) continue;
        sourceSeen += 1;
        totalSeen += 1;
        newestMs = Math.max(newestMs, row.publishedMs || 0);
        const key = headlineKey(headline);
        if (seenUrls.has(url) || seenHeadlines.has(`${source.source_key}:${key}`)) {
          sourceDuplicates += 1;
          continue;
        }
        seenUrls.add(url);
        seenHeadlines.add(`${source.source_key}:${key}`);
        rows.push({
          source_key: source.source_key,
          source_name: source.name,
          source_url: url,
          headline,
          summary: cleanRichText(field(row.item, "description") || field(row.item, "summary") || headline),
          published_at: new Date(row.publishedMs || Date.now()).toISOString(),
          importance_score: importance(headline),
        });
      }

      for (const liveRow of result.value.liveRows || []) {
        const url = canonical(liveRow.source_url);
        const key = headlineKey(liveRow.headline || "");
        const ms = normalizePublishedMs(new Date(liveRow.published_at).getTime());
        if (!url || !key || !ms || ms < cutoff) continue;
        newestMs = Math.max(newestMs, ms);
        if (seenUrls.has(url) || seenHeadlines.has(`${source.source_key}:${key}`)) {
          sourceDuplicates += 1;
          continue;
        }
        seenUrls.add(url);
        seenHeadlines.add(`${source.source_key}:${key}`);
        sourceSeen += 1;
        totalSeen += 1;
        rows.push({ ...liveRow, source_url: url, published_at: new Date(ms).toISOString() });
      }

      if (rows.length) {
        const urls = rows.map((row) => row.source_url);
        const [alreadyInArticles, alreadyInRapid] = await Promise.all([
          urlsInTable("news_articles", urls),
          urlsInTable("rapid_news", urls),
        ]);
        const isLiveUrl = (url: string) => /\/live\/|mirsad_rapid=|\/news\/breaking/i.test(url);
        const toWrite = rows.filter((row) => {
          if (alreadyInArticles.has(row.source_url)) return false;
          if (alreadyInRapid.has(row.source_url) && !isLiveUrl(row.source_url)) return false;
          return true;
        });
        sourceDuplicates += rows.length - toWrite.length;
        if (toWrite.length) {
          const inserted = await db.from("rapid_news")
            .upsert(toWrite, { onConflict: "source_url" })
            .select("id");
          if (inserted.error) throw new Error(inserted.error.message);
          sourceInserted = inserted.data?.length || 0;
          totalInserted += sourceInserted;
        }
      }

      await db.rpc("record_source_health", { p_source_key: source.source_key, p_ok: true, p_error: null });
      await db.from("source_health").update({
        last_attempt_at: new Date().toISOString(),
        last_http_status: result.value.status,
        last_duration_ms: result.value.duration,
        last_item_at: newestMs ? new Date(newestMs).toISOString() : null,
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
        live_rows: (result.value.liveRows || []).length,
      };
    } catch (error) {
      const message = String(error).slice(0, 500);
      errors.push(`${source.source_key}: ${message}`);
      await db.rpc("record_source_health", { p_source_key: source.source_key, p_ok: false, p_error: message });
    }
  }

  const trim = await db.rpc("mirsad_trim_rapid_news_to_400");
  if (trim.error) errors.push(`trim: ${trim.error.message}`);

  return reply({
    ok: true,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    sources: (sources.data || []).length,
    items_seen: totalSeen,
    inserted: totalInserted,
    errors: errors.slice(0, 20),
    source_stats: sourceStats,
  });
});
