(() => {
  'use strict';

  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const CHAT_URL = `${SUPABASE_URL}/functions/v1/mirsad-archive-chat`;
  const CATEGORY_LABELS = { Politics: 'سياسة', Economy: 'اقتصاد', Tech: 'تقنية', Society: 'مجتمع', Sports: 'رياضة' };
  const CATEGORY_COLORS = { Politics: '#8b7bc7', Economy: '#c9a227', Tech: '#4f9dde', Society: '#b8794a', Sports: '#4fa8a0' };
  const form = document.getElementById('archiveForm');
  const input = document.getElementById('archivePrompt');
  const sendButton = document.getElementById('archiveSend');
  const conversation = document.getElementById('conversation');
  const welcome = document.getElementById('welcomeState');
  const messageTemplate = document.getElementById('archiveMessageTemplate');
  const userTemplate = document.getElementById('archiveUserMessageTemplate');
  const cardTemplate = document.getElementById('archiveCardTemplate');
  const history = [];
  let busy = false;

  function normalize(value) {
    return window.MirsadText?.normalize ? window.MirsadText.normalize(value) : String(value ?? '').replace(/<[^>]*>/g, '').trim();
  }

  function appendMessage(role, text, articles = [], error = false) {
    const template = role === 'user' ? userTemplate : messageTemplate;
    const node = template.content.firstElementChild.cloneNode(true);
    const textNode = node.querySelector('.archive-message__text');
    textNode.textContent = normalize(text);
    if (error) textNode.classList.add('archive-error');

    if (role !== 'user' && articles.length) {
      const resultList = node.querySelector('.archive-message__results');
      resultList.hidden = false;
      for (const article of articles.slice(0, 6)) resultList.appendChild(renderCard(article));
    }
    conversation.appendChild(node);
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return node;
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch { return ''; }
  }

  const relativeTime = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
  function formatTime(value) {
    const timestamp = new Date(value || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 'وقت غير محدد';
    const minutes = Math.round((timestamp - Date.now()) / 60000);
    if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return relativeTime.format(hours, 'hour');
    return relativeTime.format(Math.round(hours / 24), 'day');
  }

  function importanceTier(score) {
    return Math.min(5, Math.max(1, Math.ceil(Number(score || 0) / 20)));
  }

  function renderCard(article) {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    const href = safeHttpUrl(article.source_url);
    if (href) card.href = href;
    else {
      card.removeAttribute('href');
      card.removeAttribute('target');
      card.setAttribute('aria-disabled', 'true');
    }

    card.className = ['card', article.layout_size === 'large' ? 'card-large' : article.layout_size === 'medium' ? 'card-medium' : '', 'archive-result-card'].filter(Boolean).join(' ');
    card.dataset.id = String(article.id || '');
    card.dataset.sentiment = article.sentiment || 'Neutral';
    card.dataset.tier = String(importanceTier(article.importance_score));
    card.querySelector('.card__category').textContent = normalize(CATEGORY_LABELS[article.category] || article.category || 'عام');
    card.querySelector('.card__dot').style.background = CATEGORY_COLORS[article.category] || '#888';
    card.querySelector('.card__source').textContent = normalize(article.source_name || 'مصدر');
    card.querySelector('.card__headline').textContent = normalize(article.headline || '');
    card.querySelector('.card__summary').textContent = normalize(article.summary || '');
    card.querySelector('.card__confidence').textContent = `ثقة ${Math.round(Number(article.confidence_score ?? 0))}%`;
    const evidence = [];
    if (article.claim_digest) {
      const claim = typeof article.claim_digest === 'string' ? article.claim_digest : article.claim_digest.main_claim;
      if (claim) evidence.push(normalize(claim));
    }
    if (!evidence.length && Number(article.source_count || 0) > 1) evidence.push(`مجمّع من ${article.source_count} مصادر`);
    card.querySelector('.card__evidence').textContent = evidence.join(' · ');
    const updateBadge = card.querySelector('.card__update-badge');
    updateBadge.hidden = Number(article.update_count || 0) <= 0;
    if (!updateBadge.hidden) updateBadge.textContent = `+${article.update_count} تحديث`;
    card.querySelector('.card__verification-badge').hidden = true;
    const time = card.querySelector('.card__time');
    time.textContent = formatTime(article.published_at);
    time.dateTime = article.published_at || '';
    card.setAttribute('aria-label', `فتح المصدر: ${normalize(article.headline || '')}`);
    return card;
  }

  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
    sendButton.classList.toggle('is-loading', value);
    sendButton.setAttribute('aria-busy', value ? 'true' : 'false');
    input.disabled = value;
  }

  async function search(query) {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
      body: JSON.stringify({ query, history: history.slice(-7, -1) }),
      signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || 'تعذر تنفيذ البحث الآن. حاول مرة أخرى بعد قليل.');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function submitQuestion(rawQuestion) {
    const query = String(rawQuestion || '').trim().slice(0, 500);
    if (!query || busy) return;
    welcome.hidden = true;
    appendMessage('user', query);
    history.push({ role: 'user', content: query });
    input.value = '';
    input.style.height = 'auto';
    setBusy(true);
    const placeholder = appendMessage('assistant', 'أبحث في الأخبار المنشورة المحفوظة…');
    try {
      const result = await search(query);
      const answer = normalize(result.reply || 'اكتمل البحث في الأخبار.');
      placeholder.querySelector('.archive-message__text').textContent = answer;
      const cards = Array.isArray(result.articles) ? result.articles : [];
      if (cards.length) {
        const results = placeholder.querySelector('.archive-message__results');
        results.hidden = false;
        for (const article of cards.slice(0, 6)) results.appendChild(renderCard(article));
      }
      history.push({ role: 'assistant', content: answer, article_ids: cards.map((item) => String(item.id || '')).filter(Boolean) });
      if (history.length > 12) history.splice(0, history.length - 12);
    } catch (error) {
      placeholder.querySelector('.archive-message__text').textContent = error.message || 'تعذر البحث الآن.';
      placeholder.querySelector('.archive-message__text').classList.add('archive-error');
    } finally {
      setBusy(false);
      input.focus({ preventScroll: true });
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitQuestion(input.value);
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.querySelectorAll('.archive-suggestion').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.textContent.trim();
      form.requestSubmit();
    });
  });
})();
