/**
 * ingestion-worker.js — improved for Mirsad
 * Block 1: source ingestion + token-saving cache
 * Block 2: de-duplication / clustering
 *
 * This worker never writes to Supabase directly. It only enriches and
 * forwards items to n8n. The downstream workflow stays the only write path.
 */

'use strict';

const Parser = require('rss-parser');
const cron = require('node-cron');
const crypto = require('node:crypto');

const fetchFn = globalThis.fetch
  ? globalThis.fetch.bind(globalThis)
  : async (...args) => {
      const mod = await import('node-fetch');
      return mod.default(...args);
    };

const CONFIG = {
  N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL || '',
  N8N_WEBHOOK_SECRET: process.env.N8N_WEBHOOK_SECRET || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',

  ACTIVE_INTERVAL_MS: 60_000,
  IDLE_INTERVAL_MS: 15 * 60_000,
  IDLE_WINDOW: { startHour: 2, endHour: 6 },
  IDLE_TIMEZONE_OFFSET_HOURS: Number(process.env.IDLE_TIMEZONE_OFFSET_HOURS || 3),

  CACHE_WINDOW_MS: 2 * 60 * 60_000,
  KEYWORD_MATCH_THRESHOLD: 0.90,
  CLUSTER_SIMILARITY_THRESHOLD: 0.70,
  HIGH_CONFIDENCE_MATCH_THRESHOLD: 0.86,

  SOURCE_TIMEOUT_MS: 15_000,
  MAX_CLUSTER_AGE_MS: 2 * 60 * 60_000,
  CACHE_SYNC_LIMIT: 60,

  SOURCES: [
    { key: 'skynewsarabia', name: 'Sky News Arabia', type: 'rss', url: 'https://www.skynewsarabia.com/rss', trust: 0.92 },
    { key: 'bbcarabic', name: 'BBC Arabic', type: 'rss', url: 'https://feeds.bbci.co.uk/arabic/rss.xml', trust: 0.95 },
    { key: 'newsapi', name: 'NewsAPI', type: 'api', url: 'https://newsapi.org/v2/top-headlines?category=general&language=ar', envKey: 'NEWSAPI_KEY', trust: 0.78 },
    { key: 'gnews', name: 'GNews', type: 'api', url: 'https://gnews.io/api/v4/top-headlines?lang=ar', envKey: 'GNEWS_KEY', trust: 0.72 },
  ],
};

const rss = new Parser();
const recentRecords = [];
const activeClusters = new Map();
const sourceHealth = new Map();
const seenUrls = new Set();

const STOP_WORDS = new Set([
  'في','من','الى','إلى','على','عن','مع','و','او','أو','هذا','هذه','هناك','بعد','قبل','كما','لكن','وقد','قد','تم','كان','كانت',
  'the','and','for','with','from','that','this','have','has','had','new','news','arabic','arabia',
  'خبر','أخبار','تقرير','تقارير','مصدر','مصادر','اليوم','أمس','الآن','بحسب','حول','ضمن','خلال'
]);

function stripDiacritics(text = '') {
  return text
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670\u0610-\u061A\u06D6-\u06ED]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenize(text = '') {
  const clean = stripDiacritics(text);
  if (!clean) return [];
  return clean
    .split(/\s+/)
    .filter(Boolean)
    .filter((tok) => tok.length > 1)
    .filter((tok) => !STOP_WORDS.has(tok));
}

function unique(arr) {
  return [...new Set(arr)];
}

function overlapScore(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const tok of a) if (b.has(tok)) overlap++;
  return overlap / Math.max(a.size, b.size);
}

function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const tok of a) if (b.has(tok)) inter++;
  return inter / new Set([...a, ...b]).size;
}

function countNumbers(text = '') {
  const matches = text.match(/\b\d+([\.,]\d+)?\b/g);
  return matches ? matches.length : 0;
}

const EVENT_ANCHORS = ['حرب','هجوم','انفجار','زلزال','انتخابات','اتفاق','عقوبات','احتجاج','مفاوضات','تصعيد','وقف اطلاق النار','هدنه','اغتيال','قتلى','وفيات','نفط','بنك','استثمار'];
const PLACE_ANCHORS = ['ايران','اسرائيل','لبنان','سوريا','العراق','اليمن','السعوديه','الاردن','غزه','فلسطين','امريكا','روسيا','اوكرانيا','الصين','اوروبا','المانيا','بريطانيا','فرنسا','تركيا','السودان','ليبيا'];

function extractEventSignature(headline = '', body = '') {
  const text = `${headline} ${body}`;
  const normalized = stripDiacritics(text);
  const numbers = unique((text.match(/\b\d+(?:[\.,]\d+)?\b/g) || []).map((value) => value.replace(',', '.')));
  return {
    anchors: EVENT_ANCHORS.filter((word) => normalized.includes(word)),
    places: PLACE_ANCHORS.filter((word) => normalized.includes(word)),
    numbers,
    tokens: unique(tokenize(text)).slice(0, 36),
  };
}

function signatureCompatibility(a = {}, b = {}) {
  const comparable = (left = [], right = []) => left.length && right.length ? left.some((value) => right.includes(value)) : true;
  if (a.numbers?.length && b.numbers?.length && !comparable(a.numbers, b.numbers)) return 0.35;
  if (a.places?.length && b.places?.length && !comparable(a.places, b.places)) return 0.45;
  if (a.anchors?.length && b.anchors?.length && !comparable(a.anchors, b.anchors)) return 0.55;
  return 1;
}

function mergeSignatures(a = {}, b = {}) {
  return {
    anchors: unique([...(a.anchors || []), ...(b.anchors || [])]).slice(0, 8),
    places: unique([...(a.places || []), ...(b.places || [])]).slice(0, 8),
    numbers: unique([...(a.numbers || []), ...(b.numbers || [])]).slice(0, 12),
    tokens: unique([...(a.tokens || []), ...(b.tokens || [])]).slice(0, 36),
  };
}

function analyzeEvent(headline = '', body = '', publishedAt = '') {
  const text = stripDiacritics(`${headline} ${body}`);
  const signature = extractEventSignature(headline, body);
  let score = 30;
  const signals = [];
  const add = (amount, label, condition) => { if (condition) { score += amount; signals.push(label); } };
  add(18, 'urgent', /عاجل|طارئ|فوري|مباشر/.test(text));
  add(16, 'casualties_or_damage', /قتيل|قتلى|وفيات|جرحى|ضحايا|خسائر|دمر|تدمير/.test(text));
  add(14, 'security_escalation', /حرب|هجوم|انفجار|قصف|صاروخ|اغتيال|تصعيد|اشتباك/.test(text));
  add(10, 'political_decision', /رئيس|حكومه|انتخابات|اتفاق|عقوبات|قرار|برلمان/.test(text));
  add(8, 'economic_impact', /نفط|دولار|بنك|اسعار|استثمار|اقتصاد|تجاره/.test(text));
  add(4, 'quantified_claim', signature.numbers.length > 0);
  const ageMs = Date.now() - new Date(publishedAt || Date.now()).getTime();
  add(6, 'fresh', Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 3 * 60 * 60_000);
  return { importanceScore: Math.max(1, Math.min(95, score)), signature, signals };
}

function extractAiHints(headline, body, sourceName) {
  const text = `${headline || ''} ${body || ''}`;
  const tokens = tokenize(text);
  const numberCount = countNumbers(text);
  const keywordHead = tokenize(headline || '').slice(0, 10);
  const analysis = analyzeEvent(headline, body);

  return {
    sourceName,
    tokens: unique(tokens).slice(0, 24),
    keywords: unique(keywordHead.length ? keywordHead : tokens).slice(0, 12),
    keyNumbers: numberCount,
    hasNames: /[A-Z\u0600-\u06FF]/.test(headline || ''),
    titleLength: (headline || '').length,
    bodyLength: (body || '').length,
    eventSignature: analysis.signature,
    eventSignals: analysis.signals,
    analysisVersion: 'event-v2',
  };
}

function createId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
}

function isIdleWindow(now = new Date()) {
  const localHour = (now.getUTCHours() + CONFIG.IDLE_TIMEZONE_OFFSET_HOURS) % 24;
  return localHour >= CONFIG.IDLE_WINDOW.startHour && localHour < CONFIG.IDLE_WINDOW.endHour;
}

function currentPollIntervalMs() {
  return isIdleWindow() ? CONFIG.IDLE_INTERVAL_MS : CONFIG.ACTIVE_INTERVAL_MS;
}

function sourceCooldownMs(failures = 0) {
  return Math.min(30 * 60_000, 5 * 60_000 * Math.max(1, failures + 1));
}

function pruneCaches(now = Date.now()) {
  while (recentRecords.length && now - recentRecords[0].resolvedAt > CONFIG.CACHE_WINDOW_MS) {
    recentRecords.shift();
  }
  for (const [clusterId, cluster] of activeClusters) {
    if (now - cluster.lastSeenAt > CONFIG.MAX_CLUSTER_AGE_MS) {
      activeClusters.delete(clusterId);
    }
  }
}

function clusterSimilarity(candidateText, cluster) {
  const candidateTokens = tokenize(candidateText);
  if (!candidateTokens.length) return 0;

  const headScore = jaccard(candidateTokens, cluster.headlineTokens || []);
  const bodyScores = cluster.texts.map((t) => jaccard(candidateTokens, tokenize(t)));
  const bestBody = bodyScores.length ? Math.max(...bodyScores) : 0;
  const candidateSignature = extractEventSignature(candidateText, '');
  const signatures = cluster.signatures?.length ? cluster.signatures : [cluster.signature || {}];
  const compatibility = Math.max(...signatures.map((signature) => signatureCompatibility(candidateSignature, signature)));
  const recencyBoost = Math.max(0, 1 - (Date.now() - cluster.lastSeenAt) / CONFIG.MAX_CLUSTER_AGE_MS) * 0.08;
  const sourceBoost = Math.min(0.04, Math.max(0, (cluster.sources?.size || 0) - 1) * 0.02);

  return Math.min(1, (headScore * 0.42 + bestBody * 0.42 + recencyBoost + sourceBoost) * compatibility);
}

async function withTimeout(factory, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timeout`)), timeoutMs);
  try {
    return await factory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSource(source) {
  const health = sourceHealth.get(source.key) || { failures: 0, nextRetryAt: 0 };

  if (health.nextRetryAt && Date.now() < health.nextRetryAt) {
    return [];
  }

  try {
    if (source.type === 'rss') {
      const feed = await withTimeout(
        (signal) => rss.parseURL(source.url, { signal }),
        CONFIG.SOURCE_TIMEOUT_MS,
        source.name
      );

      return (feed.items || [])
        .map((item) => ({
          sourceKey: source.key,
          sourceName: source.name,
          sourceTrust: source.trust,
          sourceType: source.type,
          sourceUrl: item.link || item.guid || '',
          headline: item.title || '',
          body: item.contentSnippet || item.content || item.title || '',
          publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
        }))
        .filter((item) => item.sourceUrl && item.headline);
    }

    if (source.type === 'api') {
      const apiKey = process.env[source.envKey] || '';
      if (!apiKey) return [];

      const url = `${source.url}&apiKey=${encodeURIComponent(apiKey)}`;
      const res = await withTimeout(
        (signal) => fetchFn(url, { signal }),
        CONFIG.SOURCE_TIMEOUT_MS,
        source.name
      );

      if (!res.ok) throw new Error(`${source.name} HTTP ${res.status}`);
      const data = await res.json();
      return (data.articles || [])
        .map((article) => ({
          sourceKey: source.key,
          sourceName: source.name,
          sourceTrust: source.trust,
          sourceType: source.type,
          sourceUrl: article.url || '',
          headline: article.title || '',
          body: article.description || article.content || article.title || '',
          publishedAt: article.publishedAt || new Date().toISOString(),
        }))
        .filter((item) => item.sourceUrl && item.headline);
    }
  } catch (error) {
    const failures = (health.failures || 0) + 1;
    sourceHealth.set(source.key, {
      failures,
      nextRetryAt: Date.now() + sourceCooldownMs(failures),
      lastError: error.message,
    });
    console.error(`[source:${source.name}] ${error.message}`);
    return [];
  }

  return [];
}

function updateSourceSuccess(sourceKey) {
  sourceHealth.set(sourceKey, { failures: 0, nextRetryAt: 0, lastError: null });
}

async function syncRecentResolvedRows() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return;

  try {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/news_articles?select=headline,summary,category,importance_score,layout_size,sentiment,cluster_id,published_at,source_name,source_url,source_count,source_trust_score,confidence_score&is_pending_verification=eq.false&order=published_at.desc&limit=${CONFIG.CACHE_SYNC_LIMIT}`;
    const res = await fetchFn(url, {
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) return;
    const rows = await res.json();

    for (const row of rows) {
      recentRecords.push({
        headline: row.headline,
        summary: row.summary,
        category: row.category,
        importanceScore: row.importance_score,
        layoutSize: row.layout_size,
        sentiment: row.sentiment,
        clusterId: row.cluster_id,
        confidenceScore: row.confidence_score,
        resolvedAt: new Date(row.published_at || Date.now()).getTime(),
        tokens: tokenize(row.headline),
        signature: extractEventSignature(row.headline, row.summary || ''),
      });

      if (recentRecords.length > 300) recentRecords.shift();

      const cluster = activeClusters.get(row.cluster_id) || {
        texts: [],
        headlineTokens: [],
        sources: new Set(),
        lastSeenAt: 0,
        signature: { anchors: [], places: [], numbers: [], tokens: [] },
        signatures: [],
      };
      cluster.texts.push(row.summary || row.headline || '');
      cluster.headlineTokens = unique([...(cluster.headlineTokens || []), ...tokenize(row.headline)]);
      cluster.sources.add(row.source_name || row.source_url || 'unknown');
      cluster.lastSeenAt = Math.max(cluster.lastSeenAt, new Date(row.published_at || Date.now()).getTime());
      const rowSignature = extractEventSignature(row.headline, row.summary || '');
      cluster.signature = mergeSignatures(cluster.signature, rowSignature);
      cluster.signatures = [...(cluster.signatures || []), rowSignature].slice(-12);
      activeClusters.set(row.cluster_id, cluster);
    }
  } catch (error) {
    console.warn('[cache-sync] failed:', error.message);
  }
}

async function postToN8n(payload) {
  if (!CONFIG.N8N_WEBHOOK_URL || !CONFIG.N8N_WEBHOOK_SECRET) {
    throw new Error('Missing N8N_WEBHOOK_URL or N8N_WEBHOOK_SECRET');
  }

  const res = await fetchFn(CONFIG.N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mirsad-Secret': CONFIG.N8N_WEBHOOK_SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`n8n webhook failed ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json().catch(() => ({}));
}

function chooseCacheMatch(item) {
  let best = null;
  let bestScore = 0;
  const itemTokens = tokenize(item.headline);
  const itemSignature = extractEventSignature(item.headline, item.body);

  for (const record of recentRecords) {
    const score = overlapScore(itemTokens, record.tokens || tokenize(record.headline || '')) * signatureCompatibility(itemSignature, record.signature || {});
    if (score > bestScore) {
      bestScore = score;
      best = record;
    }
  }

  return { best, bestScore };
}

function chooseCluster(item) {
  let matchedClusterId = null;
  let matchedScore = 0;

  for (const [clusterId, cluster] of activeClusters) {
    const score = clusterSimilarity(`${item.headline} ${item.body}`, cluster);
    if (score > matchedScore) {
      matchedScore = score;
      matchedClusterId = clusterId;
    }
  }

  return { matchedClusterId, matchedScore };
}

async function processItem(item) {
  if (seenUrls.has(item.sourceUrl)) return;
  seenUrls.add(item.sourceUrl);

  pruneCaches();

  const aiHints = extractAiHints(item.headline, item.body, item.sourceName);
  const analysis = analyzeEvent(item.headline, item.body, item.publishedAt);

  const { best, bestScore } = chooseCacheMatch(item);
  if (best && bestScore >= CONFIG.KEYWORD_MATCH_THRESHOLD) {
    const clusterId = best.clusterId || createId();
    console.log(`[cache-hit] ${item.headline.slice(0, 72)} (${Math.round(bestScore * 100)}%)`);

    await postToN8n({
      mode: 'inherit_from_cache',
      clusterId,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      headline: item.headline,
      body: item.body,
      publishedAt: item.publishedAt,
      sourceTrust: item.sourceTrust,
      aiHints,
        inheritedFrom: {
        category: best.category,
        importanceScore: best.importanceScore,
        layoutSize: best.layoutSize,
        sentiment: best.sentiment,
        confidenceScore: best.confidenceScore ?? 75,
          clusterId,
        },
        eventAnalysis: analysis,
      });
    return;
  }

  const { matchedClusterId, matchedScore } = chooseCluster(item);

  if (matchedClusterId && matchedScore >= CONFIG.CLUSTER_SIMILARITY_THRESHOLD) {
    const cluster = activeClusters.get(matchedClusterId);
    if (cluster) {
      cluster.texts.push(item.body);
      cluster.headlineTokens = unique([...(cluster.headlineTokens || []), ...tokenize(item.headline)]);
      cluster.sources.add(item.sourceName);
      cluster.lastSeenAt = Date.now();
      cluster.signature = mergeSignatures(cluster.signature, analysis.signature);
      cluster.signatures = [...(cluster.signatures || []), analysis.signature].slice(-12);
    }

    console.log(`[cluster-update] ${item.headline.slice(0, 72)} -> ${matchedClusterId} (${matchedScore.toFixed(2)})`);

    await postToN8n({
      mode: 'cluster_update',
      clusterId: matchedClusterId,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      headline: item.headline,
      body: item.body,
      publishedAt: item.publishedAt,
      aggregatedClusterTexts: cluster ? cluster.texts : [item.body],
      sourceTrust: item.sourceTrust,
      aiHints,
      eventAnalysis: analysis,
      clusterScore: matchedScore,
    });
    return;
  }

  const clusterId = createId();
  activeClusters.set(clusterId, {
    texts: [item.body],
    headlineTokens: tokenize(item.headline),
    sources: new Set([item.sourceName]),
    lastSeenAt: Date.now(),
    signature: analysis.signature,
    signatures: [analysis.signature],
  });

  console.log(`[new-article] ${item.headline.slice(0, 72)} -> ${clusterId}`);

  await postToN8n({
    mode: 'new_article',
    clusterId,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    headline: item.headline,
    body: item.body,
    publishedAt: item.publishedAt,
    aggregatedClusterTexts: [item.body],
    sourceTrust: item.sourceTrust,
    aiHints,
    eventAnalysis: analysis,
    clusterScore: matchedScore,
  });
}

async function pollOnce() {
  const enabledSources = CONFIG.SOURCES.filter((source) => {
    const health = sourceHealth.get(source.key);
    return !(health && health.failures >= 4 && health.nextRetryAt && Date.now() < health.nextRetryAt);
  });

  const results = await Promise.allSettled(enabledSources.map(fetchSource));
  const items = [];

  for (const result of results) {
    if (result.status === 'fulfilled') items.push(...result.value);
  }

  for (const source of enabledSources) updateSourceSuccess(source.key);

  items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  for (const item of items) {
    await processItem(item);
  }

  await syncRecentResolvedRows();
}

let timer = null;

function scheduleNextPoll() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await pollOnce();
    } catch (error) {
      console.error('[poll] failed:', error.message);
    }
    scheduleNextPoll();
  }, currentPollIntervalMs());
}

cron.schedule('* * * * *', () => {
  const desired = currentPollIntervalMs();
  if (timer && timer._idleTimeout !== desired) {
    scheduleNextPoll();
  }
});

(async function main() {
  console.log('[ingestion] Mirsad worker booting…');
  await syncRecentResolvedRows();
  await pollOnce();
  scheduleNextPoll();
})().catch((error) => {
  console.error('[ingestion] fatal:', error);
  process.exitCode = 1;
});

module.exports = {
  stripDiacritics,
  tokenize,
  overlapScore,
  jaccard,
  clusterSimilarity,
  isIdleWindow,
};
