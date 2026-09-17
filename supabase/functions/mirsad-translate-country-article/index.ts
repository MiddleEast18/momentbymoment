import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const clean = (value: unknown, max: number) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!supabaseUrl || !serviceKey || !geminiKey) return json({ error: 'Translation service is not configured' }, 503);
  let body: { article_id?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const articleId = clean(body.article_id, 80);
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) return json({ error: 'Invalid article id' }, 400);
  const db = createClient(supabaseUrl, serviceKey);
  const { data: existing, error: existingError } = await db.from('country_article_translations').select('article_id,target_language,translated_headline,translated_summary,model').eq('article_id', articleId).eq('target_language', 'ar').maybeSingle();
  if (existingError) return json({ error: 'Translation cache lookup failed' }, 500);
  if (existing) return json({ translation: existing, cached: true });
  const { data: article, error: articleError } = await db.from('country_news_articles').select('id,headline,summary,language,is_published').eq('id', articleId).eq('is_published', true).maybeSingle();
  if (articleError || !article) return json({ error: 'Published article not found' }, 404);
  const headline = clean(article.headline, 500);
  const summary = clean(article.summary, 1200);
  const prompt = `Translate the following news headline and summary into Modern Standard Arabic. Preserve meaning and names. Do not add facts, commentary, markdown, or HTML. Return JSON only with exactly two string fields: translated_headline and translated_summary.\n\nHEADLINE:\n${headline}\n\nSUMMARY:\n${summary}`;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(geminiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 2000 } }), signal: AbortSignal.timeout(25_000) });
  if (!response.ok) { const providerError = await response.text(); console.error('[mirsad translation provider]', response.status, providerError.slice(0, 500)); return json({ error: 'Translation provider request failed', provider_status: response.status }, 502); }
  const payload = await response.json();
  const raw = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || '';
  let translated: { translated_headline?: string; translated_summary?: string };
  try { const start = raw.indexOf('{'); const end = raw.lastIndexOf('}'); translated = JSON.parse((start >= 0 && end > start ? raw.slice(start, end + 1) : raw).trim()); } catch { return json({ error: 'Translation response was invalid' }, 502); }
  const translatedHeadline = clean(translated.translated_headline, 700);
  const translatedSummary = clean(translated.translated_summary, 2200);
  if (!translatedHeadline) return json({ error: 'Translation was empty' }, 502);
  const row = { article_id: articleId, target_language: 'ar', translated_headline: translatedHeadline, translated_summary: translatedSummary, model: 'gemini-3.6-flash' };
  const { data: saved, error: saveError } = await db.from('country_article_translations').upsert(row, { onConflict: 'article_id,target_language' }).select('article_id,target_language,translated_headline,translated_summary,model').single();
  if (saveError) return json({ error: 'Translation cache save failed' }, 500);
  return json({ translation: saved, cached: false });
});
