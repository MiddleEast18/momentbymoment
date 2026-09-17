import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripHtml = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const tag = (item: string, name: string) => { const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return match ? decode(stripHtml(match[1])) : ''; };
const attr = (item: string, name: string) => { const match = item.match(new RegExp(`${name}=["']([^"']+)["']`, 'i')); return match ? decode(match[1]) : ''; };
const parseItems = (xml: string) => {
  const chunks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi)].map((match) => match[0]);
  return chunks.map((item) => {
    const title = tag(item, 'title');
    const link = tag(item, 'link') || attr(item, 'href');
    const guid = tag(item, 'guid') || tag(item, 'id') || link;
    const summary = tag(item, 'description') || tag(item, 'summary') || tag(item, 'content');
    const published = tag(item, 'pubDate') || tag(item, 'published') || tag(item, 'updated');
    return { title, link, guid, summary, published };
  }).filter((item) => item.title && item.link);
};
const hash = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(url, key);
  const started = Date.now();
  const { data: sources, error: sourceError } = await db.from('country_news_sources').select('id,country_id,source_key,source_name,feed_url,scope_keywords').eq('is_active', true).order('priority').limit(9);
  if (sourceError) return json({ error: sourceError.message }, 500);
  const result = { sources: sources?.length || 0, seen: 0, written: 0, skipped: 0, errors: [] as string[] };
  for (const source of sources || []) {
    try {
      const response = await fetch(source.feed_url, { headers: { 'user-agent': 'MirsadCountryNews/1.0', accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items = parseItems(await response.text()).slice(0, 40);
      let written = 0;
      for (const item of items) {
        result.seen += 1;
        const haystack = `${item.title} ${item.summary}`.toLocaleLowerCase('ar');
        const matches = (source.scope_keywords || []).some((keyword: string) => haystack.includes(String(keyword).toLocaleLowerCase('ar')));
        if (!matches) { result.skipped += 1; continue; }
        const sourceItemKey = await hash(`${source.source_key}|${item.guid || item.link}`);
        const published = item.published && !Number.isNaN(Date.parse(item.published)) ? new Date(item.published).toISOString() : null;
        const { error } = await db.from('country_news_articles').upsert({ country_id: source.country_id, source_id: source.id, source_item_key: sourceItemKey, source_url: item.link, headline: item.title.slice(0, 500), summary: item.summary.slice(0, 2000), published_at: published, fetched_at: new Date().toISOString(), confidence_score: source.source_name.includes('BBC') || source.source_name.includes('فرانس') ? 85 : 75, updated_at: new Date().toISOString() }, { onConflict: 'source_id,source_item_key' });
        if (error) throw new Error(error.message);
        written += 1;
      }
      result.written += written;
      await db.from('country_news_sources').update({ last_success_at: new Date().toISOString(), last_error_at: null, last_error_message: null, updated_at: new Date().toISOString() }).eq('id', source.id);
    } catch (error) {
      const message = `${source.source_key}: ${String(error)}`;
      result.errors.push(message);
      await db.from('country_news_sources').update({ last_error_at: new Date().toISOString(), last_error_message: String(error).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', source.id);
    }
  }
  return json({ ok: true, duration_ms: Date.now() - started, ...result, errors: result.errors.slice(0, 10) });
});
