import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const clean = (value: unknown, max: number) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const validLanguage = (value: string) => /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?$/.test(value) && value.length <= 20;
const languageScript: Record<string, string> = { ar: 'Arabic', en: 'Latin English', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', ru: 'Cyrillic Russian', hi: 'Devanagari Hindi', bn: 'Bengali', fa: 'Persian', ur: 'Urdu', he: 'Hebrew', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', sw: 'Swahili', am: 'Amharic', ta: 'Tamil', te: 'Telugu', mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi' };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const geminiKey = Deno.env.get('GOOGLE_GEMINI_KEY2') || Deno.env.get('GEMINI_API_KEY');
  if (!supabaseUrl || !serviceKey || !geminiKey) return json({ error: 'Translation service is not configured' }, 503);
  let body: { article_id?: string; target_language?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const articleId = clean(body.article_id, 80);
  const targetLanguage = clean(body.target_language || 'ar', 20);
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) return json({ error: 'Invalid article id' }, 400);
  if (!validLanguage(targetLanguage)) return json({ error: 'Invalid BCP-47 target language' }, 400);
  const db = createClient(supabaseUrl, serviceKey);
  const { data: existing, error: existingError } = await db.from('country_article_translations').select('article_id,target_language,translated_headline,translated_summary,model').eq('article_id', articleId).eq('target_language', targetLanguage).maybeSingle();
  if (existingError) return json({ error: 'Translation cache lookup failed' }, 500);
  if (existing) return json({ translation: existing, cached: true });
  const { data: article, error: articleError } = await db.from('country_news_articles').select('id,headline,summary,language,is_published').eq('id', articleId).eq('is_published', true).maybeSingle();
  if (articleError || !article) return json({ error: 'Published article not found' }, 404);
  const headline = clean(article.headline, 500);
  const summary = clean(article.summary, 1200);
  const scriptHint = languageScript[targetLanguage.split('-')[0]] || 'the standard script used by this language';
  const prompt = `Translate this news headline and summary into the language identified by BCP-47 code ${targetLanguage}, using ${scriptHint}. Preserve names, places, numbers, and neutral news tone. Do not add facts, commentary, markdown, or HTML. If the language code is uncommon, still use its standard literary form. Return JSON only with exactly two string fields: translated_headline and translated_summary.\n\nHEADLINE:\n${headline}\n\nSUMMARY:\n${summary}`;
  const providerUrls = [
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`,
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
  ];
  let translatedHeadline = '';
  let translatedSummary = '';
  let providerStatus = 502;
  for (let attempt = 0; attempt < 2 && !translatedHeadline; attempt += 1) {
    try {
      const response = await fetch(providerUrls[attempt], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 1200 } }), signal: AbortSignal.timeout(25_000) });
      providerStatus = response.status;
      if (!response.ok) { if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350)); continue; }
      const payload = await response.json();
      const raw = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || '';
      try {
        const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
        const translated = JSON.parse((start >= 0 && end > start ? raw.slice(start, end + 1) : raw).trim()) as { translated_headline?: string; translated_summary?: string };
        translatedHeadline = clean(translated.translated_headline, 700);
        translatedSummary = clean(translated.translated_summary, 2200);
      } catch { translatedHeadline = ''; translatedSummary = ''; }
    } catch { providerStatus = 504; }
    if (!translatedHeadline && attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (!translatedHeadline) return json({ error: 'Translation provider request failed', provider_status: providerStatus }, 502);
  const row = { article_id: articleId, target_language: targetLanguage, translated_headline: translatedHeadline, translated_summary: translatedSummary, model: 'gemini-2.5-flash-lite' };
  const { data: saved, error: saveError } = await db.from('country_article_translations').upsert(row, { onConflict: 'article_id,target_language' }).select('article_id,target_language,translated_headline,translated_summary,model').single();
  if (saveError) return json({ error: 'Translation cache save failed' }, 500);
  return json({ translation: saved, cached: false });
});
