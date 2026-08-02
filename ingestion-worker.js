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
  CLUSTER_SIMILARITY_THRESHOLD: 0.72,

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
  'the','and','for','with','from','that','this','have','has','had','new','news','arabic','arabia'
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

function extractAiHints(headline, body, sourceName) {
  const text = `${headline || ''} ${body || ''}`;
  const tokens = tokenize(text);
  const numberCount = countNumbers(text);
  const keywordHead = tokenize(headline || '').slice(0, 10);

  return {
    sourceName,
    tokens: unique(tokens).slice(0, 24),
    keywords: unique(keywordHead.length ? keywordHead : tokens).slice(0, 12),
    keyNumbers: numberCount,
    hasNames: /[A-Z\u0600-\u06FF]/.test(headline || ''),
    titleLength: (headline || '').length,
    bodyLength: (body || '').length,
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

  const headScore = overlapScore(candidateTokens, cluster.headlineTokens || []);
  const bodyScores = cluster.texts.map((t) => jaccard(candidateTokens, tokenize(t)));
  const bestBody = bodyScores.length ? Math.max(...bodyScores) : 0;
  const recencyBoost = Math.max(0, 1 - (Date.now() - cluster.lastSeenAt) / CONFIG.MAX_CLUSTER_AGE_MS) * 0.08;
  const sourceBoost = Math.min(0.08, (cluster.sources?.size || 0) * 0.02);

  return Math.min(1, headScore * 0.45 + bestBody * 0.45 + recencyBoost + sourceBoost);
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
      });

      if (recentRecords.length > 300) recentRecords.shift();

      const cluster = activeClusters.get(row.cluster_id) || {
        texts: [],
        headlineTokens: [],
        sources: new Set(),
        lastSeenAt: 0,
      };
      cluster.texts.push(row.summary || row.headline || '');
      cluster.headlineTokens = unique([...(cluster.headlineTokens || []), ...tokenize(row.headline)]);
      cluster.sources.add(row.source_name || row.source_url || 'unknown');
      cluster.lastSeenAt = Math.max(cluster.lastSeenAt, new Date(row.published_at || Date.now()).getTime());
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

  for (const record of recentRecords) {
    const score = overlapScore(itemTokens, record.tokens || tokenize(record.headline || ''));
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
