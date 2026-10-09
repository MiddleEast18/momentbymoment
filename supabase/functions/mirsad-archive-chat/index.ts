import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  anchorName,
  analyzeCard,
  bestCard,
  briefingFor,
  classify,
  asksYesNo,
  composeReply,
  entitiesOf,
  jokeReply,
  missReply,
  publicCard,
  relatedCards,
  sameTopic,
  sanitizeInline,
  say,
  suggestions,
  summarizeCard,
  vagueReply,
  type Card,
  type Lang,
  type ReplyMode,
} from "./archive-logic.ts";

const U = Deno.env.get("SUPABASE_URL") || "";
const K = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const G = Deno.env.get("MARSAD_GEMINI_CORE_2026") || "";
const E = "gemini-embedding-001";
const D = 3072;
const ORIGINS = new Set(["https://marsad.website", "https://www.marsad.website"]);
const ENC = new TextEncoder();

type Turn = {
  role: "user" | "assistant";
  content: string;
  article_ids?: string[];
  search_query?: string;
  active_article_id?: string;
};

const headers = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ORIGINS.has(origin) ? origin : "https://marsad.website",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), {
  status,
  headers: { ...headers(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

function historyOf(value: unknown): Turn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const articleIds = Array.isArray(row.article_ids)
      ? row.article_ids.map((id) => sanitizeInline(id, 80)).filter(Boolean).slice(0, 12)
      : [];
    return {
      role: row.role === "assistant" ? "assistant" as const : "user" as const,
      content: sanitizeInline(row.content, 500),
      ...(articleIds.length ? { article_ids: articleIds } : {}),
      ...(sanitizeInline(row.search_query, 180) ? { search_query: sanitizeInline(row.search_query, 180) } : {}),
      ...(sanitizeInline(row.active_article_id, 80) ? { active_article_id: sanitizeInline(row.active_article_id, 80) } : {}),
    };
  }).filter((item) => item.content);
}

function idsOf(body: Record<string, unknown>, history: Turn[]) {
  const ids = new Set<string>();
  const push = (value: unknown) => {
    const id = sanitizeInline(value, 80);
    if (/^[0-9a-f-]{16,80}$/i.test(id)) ids.add(id);
  };
  if (Array.isArray(body.shown_ids)) body.shown_ids.slice(0, 40).forEach(push);
  history.forEach((turn) => (turn.article_ids || []).forEach(push));
  return ids;
}

function rememberedQuery(body: Record<string, unknown>, history: Turn[]) {
  const direct = sanitizeInline(body.search_query, 180);
  if (direct) return direct;
  for (const turn of [...history].reverse()) {
    if (turn.search_query) return turn.search_query;
  }
  return "";
}

function rememberedArticle(body: Record<string, unknown>, history: Turn[]) {
  const direct = sanitizeInline(body.active_article_id, 80);
  if (/^[0-9a-f-]{16,80}$/i.test(direct)) return direct;
  for (const turn of [...history].reverse()) {
    if (turn.active_article_id && /^[0-9a-f-]{16,80}$/i.test(turn.active_article_id)) return turn.active_article_id;
    const last = [...(turn.article_ids || [])].reverse().find((id) => /^[0-9a-f-]{16,80}$/i.test(id));
    if (last) return last;
  }
  return "";
}

function ipOf(request: Request) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "").slice(0, 80);
}

async function sha(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", ENC.encode(`${K}:${value}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function merge(pool: Card[], rows: unknown[]) {
  const seen = new Set(pool.map((card) => String(card.id || "")));
  for (const row of rows) {
    const card = row as Card;
    const id = String(card?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    pool.push(card);
    if (pool.length >= 18) break;
  }
}

async function textSearch(db: ReturnType<typeof createClient>, text: string) {
  const result = await db.rpc("mirsad_archive_chat_text_search", { p_search_text: text, p_limit: 14 });
  if (result.error) throw new Error("search_failed");
  return Array.isArray(result.data) ? result.data : [];
}

async function embed(text: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${E}:embedContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": G },
    body: JSON.stringify({
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: D,
      content: { parts: [{ text: text.slice(0, 500) }] },
    }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`gemini_${response.status}`);
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== D) throw new Error("invalid_embedding");
  return values.map(Number);
}

async function semanticSearch(db: ReturnType<typeof createClient>, text: string) {
  if (!G) return [];
  try {
    const vector = await embed(text);
    const result = await db.rpc("mirsad_archive_search", {
      p_embedding: `[${vector.join(",")}]`,
      p_search_text: text,
      p_limit: 8,
    });
    if (result.error) return [];
    return Array.isArray(result.data) ? result.data : [];
  } catch (error) {
    console.error("embed", error instanceof Error ? error.message : "unknown");
    return [];
  }
}

async function loadArticle(db: ReturnType<typeof createClient>, id: string) {
  if (!/^[0-9a-f-]{16,80}$/i.test(id)) return null;
  const result = await db.from("news_articles").select("id, source_name, source_url, headline, summary, category, importance_score, sentiment, layout_size, update_count, source_count, confidence_score, claim_digest, published_at, is_pending_verification").eq("id", id).eq("is_pending_verification", false).maybeSingle();
  if (result.error || !result.data) return null;
  if (!/^https?:\/\//i.test(String(result.data.source_url || ""))) return null;
  return result.data as Card;
}

function packet(lang: Lang, tone: "casual" | "plain" | "polite", reply: string, extra: Record<string, unknown> = {}) {
  return {
    reply,
    briefing: null,
    articles: [],
    suggestions: [],
    lang,
    active_article_id: extra.active_article_id || "",
    search_query: extra.search_query || "",
    search: { candidate_count: 0, shown: 0, method: extra.method || "conversation" },
  };
}

function withCard(lang: Lang, tone: "casual" | "plain" | "polite", card: Card, query: string, shown: number, method: string, mode: ReplyMode, seed: string, previous: string[], yesNo: boolean) {
  const article = publicCard(card);
  return {
    reply: composeReply({ card, lang, tone, query, mode, seed, yesNo, previous }),
    briefing: briefingFor(card, lang, query),
    articles: [article],
    suggestions: suggestions(lang),
    lang,
    active_article_id: article.id,
    search_query: sanitizeInline(query, 180),
    search: { candidate_count: shown, shown: 1, method },
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة." }, 405, origin);
  if (!origin || !ORIGINS.has(origin)) return json({ error: "مصدر الطلب غير مسموح." }, 403, origin);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "صيغة الطلب غير صالحة." }, 400, origin); }
  const query = sanitizeInline(body.query, 500);
  const history = historyOf(body.history);
  const address = ipOf(req);
  if (query.length < 2) return json({ error: "اكتب سؤالًا أطول قليلًا." }, 400, origin);
  if (!U || !K || !address) return json({ error: "خدمة البحث غير مهيأة بعد." }, 503, origin);

  const db = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const quota = await db.rpc("mirsad_archive_consume_rate_limit", {
      p_subject_hash: await sha(address),
      p_window_start: new Date(Math.floor(Date.now() / 300000) * 300000).toISOString(),
      p_limit: 12,
    });
    if (quota.error) return json({ error: "تعذر بدء البحث الآن." }, 503, origin);
    if (quota.data !== true) return json({ error: "وصلت إلى حد البحث المؤقت. حاول بعد قليل." }, 429, origin);

    const mind = classify(query);
    const shown = idsOf(body, history);
    const previousQuery = rememberedQuery(body, history);
    const activeId = rememberedArticle(body, history);
    const previousReplies = history.filter((turn) => turn.role === "assistant").map((turn) => turn.content);
    const seed = `${query}|${history.length}`;
    const yesNo = asksYesNo(query);

    if (mind.intent === "greeting") return json(packet(mind.lang, mind.tone, say(mind.lang, mind.tone, "greeting", seed, previousReplies), { method: "greeting" }), 200, origin);
    if (mind.intent === "joke") return json(packet(mind.lang, mind.tone, jokeReply(mind.lang, mind.tone, mind.searchText, seed, previousReplies), { method: "joke" }), 200, origin);
    if (mind.intent === "ambiguous") return json(packet(mind.lang, mind.tone, vagueReply(mind.lang, mind.tone, query, seed, previousReplies), { method: "clarify" }), 200, origin);

    if (mind.follow === "summarize" || mind.follow === "analyze" || mind.follow === "entities") {
      const card = await loadArticle(db, activeId);
      if (!card) return json(packet(mind.lang, mind.tone, say(mind.lang, mind.tone, "noCard", seed, previousReplies), { method: "card-context", active_article_id: "", search_query: previousQuery }), 200, origin);
      const followSeed = `${activeId}|${history.length}|${mind.follow}`;
      const reply = mind.follow === "summarize"
        ? summarizeCard(card, mind.lang, followSeed, previousReplies)
        : mind.follow === "analyze"
          ? analyzeCard(card, mind.lang, mind.tone, followSeed, previousReplies)
          : entitiesOf(card, mind.lang, followSeed, previousReplies);
      return json({
        reply,
        briefing: null,
        articles: [],
        suggestions: suggestions(mind.lang),
        lang: mind.lang,
        active_article_id: activeId,
        search_query: previousQuery,
        search: { candidate_count: 0, shown: 0, method: "current-card" },
      }, 200, origin);
    }

    if (mind.follow === "another" || mind.follow === "related") {
      const card = activeId ? await loadArticle(db, activeId) : null;
      const queryText = mind.follow === "related"
        ? (anchorName(card || {}, previousQuery) || previousQuery)
        : (previousQuery || (card ? sanitizeInline(card.headline, 180) : ""));
      if (!queryText) return json(packet(mind.lang, mind.tone, say(mind.lang, mind.tone, "noCard", seed, previousReplies), { method: "card-context" }), 200, origin);
      const pool: Card[] = [];
      merge(pool, await textSearch(db, queryText));
      if (mind.follow === "related") {
        const anchor = anchorName(card || {}, previousQuery);
        if (!anchor) return json(packet(mind.lang, mind.tone, say(mind.lang, mind.tone, "noRelated", seed, previousReplies), { method: "related", search_query: previousQuery, active_article_id: activeId }), 200, origin);
        let picked = relatedCards(anchor, pool, shown)[0]?.card || null;
        if (!picked) {
          merge(pool, await semanticSearch(db, anchor));
          picked = relatedCards(anchor, pool, shown)[0]?.card || null;
        }
        if (!picked) return json(packet(mind.lang, mind.tone, say(mind.lang, mind.tone, "noRelated", seed, previousReplies), { method: "related", search_query: previousQuery, active_article_id: activeId }), 200, origin);
        return json(withCard(mind.lang, mind.tone, picked, previousQuery || anchor, pool.length, "related", "related", `${seed}|${picked.id}`, previousReplies, false), 200, origin);
      }
      const meaning = previousQuery || queryText;
      let picked = bestCard(meaning, pool, shown, history.length);
      if (!picked) {
        merge(pool, await semanticSearch(db, meaning));
        picked = bestCard(meaning, pool, shown, history.length);
      }
      if (!picked) return json(packet(mind.lang, mind.tone, say(mind.lang, mind.tone, "noNext", seed, previousReplies), { method: "another", search_query: meaning, active_article_id: activeId }), 200, origin);
      return json(withCard(mind.lang, mind.tone, picked, meaning, pool.length, "another", "another", `${seed}|${picked.id}`, previousReplies, false), 200, origin);
    }

    const searchText = mind.searchText;
    const pool: Card[] = [];
    let method = "text";
    const choose = (exclude: Set<string>) => bestCard(searchText, pool, exclude, history.length);
    merge(pool, await textSearch(db, searchText));
    let picked = choose(shown);
    if (!picked) {
      const names = searchText.split(" ").filter((word) => word.length >= 4).slice(0, 2);
      for (const name of names) {
        merge(pool, await textSearch(db, name));
        picked = choose(shown);
        if (picked) break;
      }
    }
    if (!picked) {
      merge(pool, await semanticSearch(db, searchText));
      picked = choose(shown);
      if (picked) method = "semantic";
    }
    let mode: ReplyMode = previousQuery && sameTopic(searchText, previousQuery) && shown.size ? "another" : "fresh";
    if (!picked) {
      picked = choose(new Set());
      if (picked && shown.has(String(picked.id || ""))) mode = "revisit";
    }
    if (!picked) return json(packet(mind.lang, mind.tone, missReply(mind.lang, mind.tone, searchText, seed, previousReplies), { method, search_query: searchText }), 200, origin);
    return json(withCard(mind.lang, mind.tone, picked, searchText, pool.length, method, mode, `${seed}|${picked.id}|${mode}`, previousReplies, yesNo), 200, origin);
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    console.error("request", code);
    if (code === "gemini_429") return json({ error: "خدمة البحث مزدحمة مؤقتًا. أعد المحاولة بعد قليل." }, 429, origin);
    if (code === "search_failed") return json({ error: "تعذر البحث في الأخبار المتاحة." }, 503, origin);
    return json({ error: "حدث خطأ أثناء المعالجة. حاول مرة أخرى." }, 502, origin);
  }
});
