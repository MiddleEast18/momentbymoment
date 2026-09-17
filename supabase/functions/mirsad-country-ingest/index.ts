import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type FeedItem = { title: string; link: string; guid: string; summary: string; published: string };
type Source = { id: string; country_id: string; source_key: string; source_name: string; feed_url: string; source_type: string; scope_keywords: string[]; priority: number };
type ExistingArticle = { id: string; source_id: string; source_url: string; headline: string; summary: string; cluster_id: string | null; update_count: number; published_at: string | null };

const stripHtml = (value: string) => value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const decode = (value: string) => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&#x([0-9a-f]+);|&#([0-9]+);|&(?:amp|quot|apos|lt|gt|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/gi, (match, hex, decimal) => { if (hex) return String.fromCodePoint(parseInt(hex, 16)); if (decimal) return String.fromCodePoint(parseInt(decimal, 10)); return ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&rsquo;': '’', '&lsquo;': '‘', '&rdquo;': '”', '&ldquo;': '“', '&ndash;': '–', '&mdash;': '—', '&hellip;': '…' } as Record<string, string>)[match.toLowerCase()] || match; });
const normalize = (value: string) => decode(stripHtml(value)).toLocaleLowerCase('ar').replace(/[ًٌٍَُِّْـ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tag = (item: string, name: string) => { const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return match ? decode(match[1]) : ''; };
const attr = (item: string, name: string) => { const match = item.match(new RegExp(`${name}=["']([^"']+)["']`, 'i')); return match ? decode(match[1]) : ''; };
const parseItems = (xml: string): FeedItem[] => {
  const chunks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi)].map((match) => match[0]);
  return chunks.map((item) => ({ title: stripHtml(tag(item, 'title')), link: stripHtml(tag(item, 'link')) || attr(item, 'href'), guid: stripHtml(tag(item, 'guid')) || stripHtml(tag(item, 'id')) || stripHtml(tag(item, 'link')), summary: stripHtml(tag(item, 'description') || tag(item, 'summary') || tag(item, 'content')), published: stripHtml(tag(item, 'pubDate') || tag(item, 'published') || tag(item, 'updated')) })).filter((item) => item.title && item.link);
};
const hash = async (value: string) => { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join(''); };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const parseDate = (value: string) => { const time = Date.parse(value); return Number.isNaN(time) ? null : new Date(time).toISOString(); };
const importance = (title: string, published: string | null) => { const ageHours = published ? Math.max(0, (Date.now() - Date.parse(published)) / 3_600_000) : 72; const urgent = /(عاجل|هام|هجوم|زلزال|انفجار|حرب|وفاة|انتخابات|قرار)/i.test(title) ? 18 : 0; return Math.max(1, Math.min(100, Math.round(62 + urgent - Math.min(ageHours, 72) * 0.25))); };
const confidence = (source: Source) => source.source_type === 'official' ? 88 : source.source_type === 'international' ? 84 : source.source_type === 'local' ? 78 : 74;
const sameCluster = (a: string, b: string) => { const left = new Set(a.split(' ').filter((token) => token.length > 2)); const right = new Set(b.split(' ').filter((token) => token.length > 2)); if (!left.size || !right.size) return false; const intersection = [...left].filter((token) => right.has(token)).length; return intersection / Math.min(left.size, right.size) >= 0.72; };

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Missing Supabase runtime configuration' }, 500);
  const db = createClient(url, key); const started = Date.now();
  const result = { ok: true, sources: 0, seen: 0, written: 0, updated: 0, duplicates: 0, skipped: 0, cleaned: 0, errors: [] as string[] };
  const { data: sources, error: sourceError } = await db.from('country_news_sources').select('id,country_id,source_key,source_name,feed_url,source_type,scope_keywords,priority').eq('is_active', true).order('priority').limit(30);
  if (sourceError) return json({ ok: false, error: sourceError.message }, 500); result.sources = sources?.length || 0;
  const { data: existing } = await db.from('country_news_articles').select('id,source_id,source_url,headline,summary,cluster_id,update_count,published_at').gte('fetched_at', new Date(Date.now() - 45 * 86_400_000).toISOString()).limit(1000);
  const byKey = new Map<string, ExistingArticle>(); for (const article of (existing || []) as ExistingArticle[]) byKey.set(`${article.source_id}|${article.source_url}`, article);
  for (const source of (sources || []) as Source[]) {
    try {
      const response = await fetch(source.feed_url, { headers: { 'user-agent': 'MirsadCountryNews/2.0', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1' }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`); const items = parseItems(await response.text()).slice(0, 50);
      for (const item of items) {
        result.seen += 1; const title = stripHtml(item.title).slice(0, 500); const summary = stripHtml(item.summary).slice(0, 2_000); const haystack = `${title} ${summary}`.toLocaleLowerCase('ar');
        if (!(source.scope_keywords || []).some((keyword) => haystack.includes(String(keyword).toLocaleLowerCase('ar')))) { result.skipped += 1; continue; }
        const published = parseDate(item.published); const sourceItemKey = await hash(`${source.source_key}|${item.guid || item.link}`); const existingArticle = byKey.get(`${source.id}|${item.link}`); let clusterId = existingArticle?.cluster_id || null; let updateCount = existingArticle?.update_count || 0;
        if (!clusterId) { const similar = [...byKey.values()].find((candidate) => candidate.source_id !== source.id && sameCluster(normalize(candidate.headline), normalize(title))); clusterId = similar?.cluster_id || crypto.randomUUID(); updateCount = similar ? (similar.update_count || 0) + 1 : 0; }
        const row = { country_id: source.country_id, source_id: source.id, source_item_key: sourceItemKey, source_url: item.link, headline: title, summary, category: 'Politics', language: 'ar', published_at: published, fetched_at: new Date().toISOString(), importance_score: importance(title, published), confidence_score: confidence(source), cluster_id: clusterId, update_count: updateCount, is_published: true, updated_at: new Date().toISOString() };
        const { error } = await db.from('country_news_articles').upsert(row, { onConflict: 'source_id,source_item_key' }); if (error) throw new Error(error.message);
        if (existingArticle) result.updated += 1; else result.written += 1; byKey.set(`${source.id}|${item.link}`, { id: existingArticle?.id || '', source_id: source.id, source_url: item.link, headline: title, summary, cluster_id: clusterId, update_count: updateCount, published_at: published });
      }
      await db.from('country_news_sources').update({ last_success_at: new Date().toISOString(), last_error_at: null, last_error_message: null, updated_at: new Date().toISOString() }).eq('id', source.id);
    } catch (error) { result.errors.push(`${source.source_key}: ${String(error)}`); await db.from('country_news_sources').update({ last_error_at: new Date().toISOString(), last_error_message: String(error).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', source.id); }
  }
  const { count: deleted } = await db.from('country_news_articles').delete({ count: 'exact' }).lt('fetched_at', new Date(Date.now() - 45 * 86_400_000).toISOString()); result.cleaned = deleted || 0;
  return json({ ...result, duplicates: result.updated, duration_ms: Date.now() - started, errors: result.errors.slice(0, 10) });
});
