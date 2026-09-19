(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const TRANSLATE_FUNCTION = `${SUPABASE_URL}/functions/v1/mirsad-translate-country-article`;
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const formatTime = (value) => { if (!value) return 'وقت النشر غير متاح'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'وقت النشر غير متاح' : new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(date); };
  const setStatus = (text) => { const el = document.getElementById('countryStatus'); if (el) el.textContent = text; };
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug') || '';
  const FOREIGN_SOURCE_KEYS = new Set(['dz_tsa', 'dz_algerie360', 'eg_dailynewsegypt']);
  const mostlyLatin = (value) => { const text = String(value || ''); const latin = (text.match(/[A-Za-zÀ-ÿŒœ]/g) || []).length; const arabic = (text.match(/[\u0600-\u06ff]/g) || []).length; return latin > 12 && latin > arabic; };
  const foreignLanguage = (language, sourceKey, headline, summary) => !String(language || 'ar').toLowerCase().startsWith('ar') || FOREIGN_SOURCE_KEYS.has(sourceKey) || mostlyLatin(headline) || mostlyLatin(summary);
  const locale = () => String(document.documentElement.dataset.mirsadLocale || 'ar').toLowerCase().split('-')[0];
  const localeName = { ar: 'العربية', en: 'English', ja: '日本語', fr: 'Français', de: 'Deutsch', es: 'Español', it: 'Italiano', tr: 'Türkçe', nl: 'Nederlands' };
  const translationButton = (article) => { const target = locale(); const sourceLanguage = String(article.language || 'ar').toLowerCase().split('-')[0]; return target !== sourceLanguage || foreignLanguage(article.language, article.country_news_sources?.source_key, article.headline, article.summary) ? `<button class="country-translate" type="button" data-article-id="${esc(article.id)}" aria-label="ترجمة عنوان وملخص الخبر إلى ${esc(localeName[target] || 'العربية')}" data-target-language="${esc(target)}">ترجمة إلى ${esc(localeName[target] || 'العربية')}</button>` : ''; };
  const showTranslation = (button) => {
    const card = button.closest('.country-article');
    card.querySelector('h2').textContent = button.dataset.translatedHeadline || '';
    const summary = card.querySelector('p'); if (summary) summary.textContent = button.dataset.translatedSummary || '';
    button.textContent = 'عرض النص الأصلي'; button.setAttribute('aria-label', 'عرض النص الأصلي للخبر'); button.classList.add('is-translated'); button.dataset.state = 'translated';
  };
  const showOriginal = (button) => {
    const card = button.closest('.country-article');
    card.querySelector('h2').textContent = button.dataset.originalHeadline || '';
    const summary = card.querySelector('p'); if (summary) summary.textContent = button.dataset.originalSummary || '';
    button.textContent = 'عرض الترجمة'; button.setAttribute('aria-label', 'عرض الترجمة العربية للخبر'); button.classList.remove('is-translated'); button.dataset.state = 'original';
  };
  const translateArticle = async (button) => {
    if (button.dataset.state === 'translated') { showOriginal(button); return; }
    if (button.dataset.state === 'original' && button.dataset.translatedHeadline) { showTranslation(button); return; }
    const articleId = button.dataset.articleId;
    const card = button.closest('.country-article');
    button.dataset.originalHeadline = card.querySelector('h2')?.textContent || '';
    button.dataset.originalSummary = card.querySelector('p')?.textContent || '';
    button.disabled = true; button.textContent = 'جارٍ الترجمة…';
    try {
      const targetLanguage = String(button.dataset.targetLanguage || locale()).toLowerCase().split('-')[0];
      const result = await fetch(TRANSLATE_FUNCTION, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, body: JSON.stringify({ article_id: articleId, target_language: targetLanguage }) }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Translation failed'); return data; });
      if (!result?.translation) throw new Error('Translation result was empty');
      button.dataset.translatedHeadline = result.translation.translated_headline || '';
      button.dataset.translatedSummary = result.translation.translated_summary || '';
      showTranslation(button);
      button.disabled = false;
    } catch (error) { console.error('[mirsad translation]', error); button.disabled = false; button.textContent = 'إعادة المحاولة'; }
  };

  async function loadCountry() {
    if (!client || !slug) { setStatus('رابط الدولة غير صالح.'); return; }
    const { data: country, error: countryError } = await client.from('arab_countries').select('id,name_ar,name_en,slug,flag_code').eq('slug', slug).eq('is_active', true).maybeSingle();
    if (countryError || !country) { setStatus('تعذر العثور على الدولة.'); return; }
    document.title = `أخبار ${country.name_ar} — مِرصاد`;
    document.getElementById('countryTitle').textContent = `أخبار ${country.name_ar}`;
    document.getElementById('countrySubtitle').textContent = `${country.name_en} — تغطية محلية من ثلاثة مصادر منتقاة`;
    const [{ data: sources, error: sourceError }, { data: articles, error: articleError }] = await Promise.all([
      client.from('country_news_sources').select('source_name,source_type,priority,source_url').eq('country_id', country.id).eq('is_active', true).order('priority').limit(3),
      client.from('country_news_articles').select('id,source_id,source_url,headline,summary,category,published_at,importance_score,confidence_score,language,country_news_sources(source_key,source_name,source_url)').eq('country_id', country.id).eq('is_published', true).order('published_at', { ascending: false, nullsFirst: false }).limit(100)
    ]);
    if (sourceError || articleError) { console.error('[mirsad country]', sourceError || articleError); setStatus('تعذر تحميل أخبار الدولة حاليًا.'); return; }
    document.getElementById('sourceList').innerHTML = (sources || []).map((source) => `<a class="source-chip" href="${esc(source.source_url)}" target="_blank" rel="noopener noreferrer">${esc(source.source_name)}</a>`).join('');
    const grid = document.getElementById('articleGrid');
    if (!articles?.length) { grid.innerHTML = ''; document.getElementById('emptyState').hidden = false; setStatus('لا توجد بطاقات منشورة لهذه الدولة حاليًا.'); return; }
    grid.innerHTML = articles.map((article) => {
      const source = Array.isArray(article.country_news_sources) ? article.country_news_sources[0] : article.country_news_sources;
      const isForeign = foreignLanguage(article.language, source?.source_key, article.headline, article.summary);
      return `<article class="country-article" data-article-id="${esc(article.id)}"><div class="country-article__meta"><span>${esc(source?.source_name || 'مصدر غير محدد')}</span><span>${isForeign ? 'لغة أجنبية' : 'لغة عربية'}</span></div><h2>${esc(article.headline)}</h2><p>${esc(article.summary)}</p>${translationButton({ ...article, country_news_sources: source })}<div class="country-translation-note" aria-live="polite">${isForeign ? 'الترجمة عند الطلب' : ''}</div><time class="country-article__time" datetime="${esc(article.published_at || '')}">${esc(formatTime(article.published_at))}</time></article>`;
    }).join('');
    grid.querySelectorAll('.country-translate').forEach((button) => button.addEventListener('click', () => translateArticle(button)));
    setStatus(`${articles.length} خبرًا منشورًا`);
  }
  loadCountry();
})();
