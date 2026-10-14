import {
  type Card, type Lang, type Tone, anchorName, bestCard, classify, distinctive, fold, publicCard, rankCards,
  relatedCards, sanitizeInline, say, suggestions, type Mind,
} from "./archive-logic.ts";
import { type Gemini, type Mat, UNDERSTAND_SYSTEM, toBriefing, understandUser } from "./ai.ts";
import { compose } from "./compose.ts";
import { type EvidenceStore, gatherEvidence } from "./evidence.ts";
import { fallbackReply } from "./verify.ts";

export interface ChargeResult { allowed: boolean; charged: boolean; amount: number; remaining: number; unlimited: boolean; operations: string[] }
export interface PassageHit { article_id: string; passage_index: number; passage_text: string; score: number }
export interface Memory { context_summary: string; approved_reply: string; active_article_id: string | null; search_query: string }
export interface Store extends EvidenceStore {
  getUser(token: string): Promise<string | null>;
  rateLimit(hash: string, windowStart: string, limit: number): Promise<boolean | null>;
  balance(userId: string): Promise<{ balance: number; unlimited: boolean }>;
  textSearch(text: string): Promise<Card[]>;
  semanticSearch(text: string, vector: number[]): Promise<Card[]>;
  searchPassages(text: string, vector: number[] | null): Promise<PassageHit[]>;
  loadArticle(id: string): Promise<Card | null>;
  revisions(id: string): Promise<Card[]>;
  alreadyBriefed(userId: string, articleId: string): Promise<boolean>;
  getMemory(userId: string): Promise<Memory | null>;
  saveMemory(userId: string, memory: Memory): Promise<void>;
  charge(userId: string, ops: string[], articleId: string | null, commit: boolean): Promise<ChargeResult | null>;
  chargeChat(userId: string, requestId: string): Promise<ChargeResult | null>;
}
export interface Deps { store: Store; gemini: Gemini; hash(v: string): Promise<string>; origins: Set<string>; now?: () => number }

type Kind = "smalltalk" | "find_news" | "ask_about_news" | "about_active_card" | "another_card" | "related_card" | "out_of_scope" | "unclear";
type Sub = "summarize" | "analyze" | "entities" | "general";
type Plan = { kind: Kind; sub: Sub; standalone: string; summary: string; queries: string[]; lang: Lang; tone: Tone; clarify: string; by: "model" | "rules" };
type TaskType = "summarize" | "analyze" | "entities" | "related" | "another";
type Turn = { role: "user" | "assistant"; content: string; article_ids?: string[]; search_query?: string; active_article_id?: string };

const KINDS = new Set<Kind>(["smalltalk", "find_news", "ask_about_news", "about_active_card", "another_card", "related_card", "out_of_scope", "unclear"]);
const UUID = /^[0-9a-f-]{16,80}$/i;
const CHAT_COST = 50;
const CHAT_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The platform kills long requests; every model call is bounded by this budget so we answer (or fall back) first.
const BUDGET_MS = 85_000;

const cors = (origin: string | null, origins: Set<string>) => ({
  "Access-Control-Allow-Origin": origin && origins.has(origin) ? origin : "https://marsad.website",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
});

function historyOf(value: unknown): Turn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const ids = Array.isArray(row.article_ids) ? row.article_ids.map((i) => sanitizeInline(i, 80)).filter(Boolean).slice(0, 12) : [];
    const sq = sanitizeInline(row.search_query, 180), aid = sanitizeInline(row.active_article_id, 80);
    return { role: row.role === "assistant" ? "assistant" as const : "user" as const, content: sanitizeInline(row.content, 500),
      ...(ids.length ? { article_ids: ids } : {}), ...(sq ? { search_query: sq } : {}), ...(aid ? { active_article_id: aid } : {}) };
  }).filter((t) => t.content);
}
function idsOf(body: Record<string, unknown>, history: Turn[]) {
  const ids = new Set<string>();
  const push = (v: unknown) => { const id = sanitizeInline(v, 80); if (UUID.test(id)) ids.add(id); };
  if (Array.isArray(body.shown_ids)) body.shown_ids.slice(0, 40).forEach(push);
  history.forEach((t) => (t.article_ids || []).forEach(push));
  return ids;
}
function rememberedQuery(body: Record<string, unknown>, history: Turn[]) {
  const d = sanitizeInline(body.search_query, 180);
  if (d) return d;
  for (const t of [...history].reverse()) if (t.search_query) return t.search_query;
  return "";
}
function rememberedArticle(body: Record<string, unknown>, history: Turn[]) {
  const d = sanitizeInline(body.active_article_id, 80);
  if (UUID.test(d)) return d;
  for (const t of [...history].reverse()) {
    if (t.active_article_id && UUID.test(t.active_article_id)) return t.active_article_id;
    const last = [...(t.article_ids || [])].reverse().find((i) => UUID.test(i));
    if (last) return last;
  }
  return "";
}
const turnsText = (h: Turn[]) => h.slice(-6).map((t) => `${t.role === "user" ? "المستخدم" : "المساعد"}: ${t.content.slice(0, 400)}`).join("\n");
function merge(pool: Card[], rows: unknown[], cap = 18) {
  const seen = new Set(pool.map((c) => String(c.id || "")));
  for (const r of rows) { const c = r as Card; const id = String(c?.id || ""); if (!id || seen.has(id)) continue; seen.add(id); pool.push(c); if (pool.length >= cap) break; }
}

function rulesPlan(mind: Mind, query: string): Plan {
  const base = { sub: "general" as Sub, standalone: query, summary: "", queries: mind.searchText ? [mind.searchText] : [], lang: mind.lang, tone: mind.tone, clarify: "", by: "rules" as const };
  if (mind.intent === "greeting" || mind.intent === "joke") return { ...base, kind: "smalltalk" };
  if (mind.intent === "ambiguous") return { ...base, kind: "unclear" };
  if (mind.follow === "another") return { ...base, kind: "another_card" };
  if (mind.follow === "related") return { ...base, kind: "related_card" };
  if (mind.follow) return { ...base, kind: "about_active_card", sub: mind.follow as Sub };
  return { ...base, kind: mind.intent === "question" && /(لماذا|ليش|كيف|why|how)/i.test(query) ? "ask_about_news" : "find_news" };
}

export function planForTask(task: unknown, query: string, mind: Mind, previousQuery: string): Plan | null {
  const taskType = typeof task === "string" ? task as TaskType : "" as TaskType;
  const mapping: Record<TaskType, { kind: Kind; sub: Sub }> = {
    summarize: { kind: "about_active_card", sub: "summarize" },
    analyze: { kind: "about_active_card", sub: "analyze" },
    entities: { kind: "about_active_card", sub: "entities" },
    related: { kind: "related_card", sub: "general" },
    another: { kind: "another_card", sub: "general" },
  };
  if (!Object.hasOwn(mapping, taskType)) return null;
  const target = mapping[taskType];
  const anchor = previousQuery || mind.searchText;
  return {
    ...target, standalone: sanitizeInline(query, 300), summary: "",
    queries: anchor ? [anchor] : [], lang: mind.lang, tone: mind.tone, clarify: "", by: "rules",
  };
}

async function understand(deps: Deps, query: string, history: Turn[], active: Card | null, mind: Mind): Promise<Plan> {
  if (!deps.gemini.has("core")) throw new Error("core_understanding_missing");
  try {
    const r = await deps.gemini.json("core", { system: UNDERSTAND_SYSTEM, user: understandUser(query, turnsText(history), active), maxTokens: 900, deadlineAt: Date.now() + 12_000 });
    const kind = String(r.kind || "").trim() as Kind;
    if (!KINDS.has(kind)) throw new Error("core_understanding_invalid_kind");
    const standalone = sanitizeInline(r.standalone_question || r.standaloneQuestion || r.question, 300) || query;
    const summary = sanitizeInline(r.context_summary || r.contextSummary, 400);
    const sub = (["summarize", "analyze", "entities", "general"].includes(String(r.sub)) ? String(r.sub) : "general") as Sub;
    const queries = (Array.isArray(r.search_queries) ? r.search_queries : []).map((q) => sanitizeInline(q, 60)).filter((q) => q.length >= 2).slice(0, 3);
    const lang: Lang = r.lang === "en" ? "en" : r.lang === "ar" ? "ar" : mind.lang;
    const tone: Tone = r.tone === "casual" || r.tone === "polite" || r.tone === "plain" ? r.tone : mind.tone;
    return { kind, sub, standalone, summary, queries: queries.length ? queries : [standalone.slice(0, 60)], lang, tone, clarify: sanitizeInline(r.clarify, 200), by: "model" };
  } catch (e) {
    console.warn("core_understanding_failed", e instanceof Error ? e.message : "unknown");
    throw e;
  }
}

// Stage 1: hybrid retrieval. Titles/summaries (text, then semantic) first; when they find nothing,
// the stored full-article passages are searched (text + semantic, fused in SQL).
async function retrieve(deps: Deps, plan: Plan, mind: Mind, shown: Set<string>, many: boolean) {
  const qs = [...new Set([...plan.queries, mind.searchText].map((q) => q.trim()).filter((q) => q.length >= 2))].slice(0, 4);
  const pool: Card[] = [];
  for (const q of qs) merge(pool, await deps.store.textSearch(q));
  const best = new Map<string, { card: Card; score: number; pub: string }>();
  const rankAll = () => { for (const q of qs) for (const i of rankCards(q, pool, shown)) { const o = best.get(i.rank.id); if (!o || i.rank.score > o.score) best.set(i.rank.id, { card: i.card, score: i.rank.score, pub: i.rank.published }); } };
  rankAll();
  let method = "text";
  let vector: number[] | null = null;
  const queryVector = async () => {
    if (vector || !deps.gemini.has("core") || !qs.length) return vector;
    try { vector = await deps.gemini.embed(plan.standalone || qs[0], "query"); } catch (e) { console.warn("semantic_skip", e instanceof Error ? e.message : "unknown"); }
    return vector;
  };
  if (!best.size) {
    const v = await queryVector();
    if (v) { merge(pool, await deps.store.semanticSearch(plan.standalone || qs[0], v)); rankAll(); method = "semantic"; }
  }
  let cards = [...best.values()].sort((a, b) => b.score - a.score || b.pub.localeCompare(a.pub)).map((x) => x.card);
  if (!cards.length && qs.length) {
    try {
      const hits = await deps.store.searchPassages(qs.join(" "), await queryVector());
      const toks = distinctive(qs.join(" "));
      const primary = [...toks].sort((a, b) => b.length - a.length)[0] || "";
      const ids: string[] = [];
      for (const h of hits) {
        const f = fold(h.passage_text);
        const matched = toks.filter((t) => f.includes(t)).length;
        if (primary && f.includes(primary) && matched >= Math.min(2, toks.length) && !shown.has(h.article_id) && !ids.includes(h.article_id)) ids.push(h.article_id);
      }
      const loaded = (await Promise.all(ids.slice(0, 5).map((id) => deps.store.loadArticle(id)))).filter((c): c is Card => !!c);
      if (loaded.length) { cards = loaded; method = "body"; merge(pool, loaded); }
    } catch (e) { console.warn("body_search_skip", e instanceof Error ? e.message : "unknown"); }
  }
  if (!cards.length && many) {
    const toks = distinctive(qs.join(" ")).filter((t) => t.length >= 4);
    cards = pool.filter((c) => !shown.has(String(c.id))).map((c) => {
      const blob = `${c.headline} ${c.summary}`.toLowerCase();
      return { c, n: toks.filter((t) => blob.includes(t)).length };
    }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => x.c);
    if (cards.length) method = "loose";
  }
  return { cards: cards.slice(0, 5), method, count: pool.length };
}

export async function handleChat(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  const H = cors(origin, deps.origins);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...H, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة." }, 405);
  if (!origin || !deps.origins.has(origin)) return json({ error: "مصدر الطلب غير مسموح." }, 403);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "صيغة الطلب غير صالحة." }, 400); }

  const startedAt = Date.now();
  const deadlineAt = startedAt + BUDGET_MS;
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const userId = token ? await deps.store.getUser(token).catch(() => null) : null;
  if (!userId) return json({ error: "سجّل الدخول لاستخدام الأرشيف.", code: "login_required" }, 401);

  const action = ["open", "briefing", "search", "commit_chat"].includes(String(body.action)) ? String(body.action) : "chat";
  const query = sanitizeInline(body.query, 500);
  if (action !== "open" && action !== "briefing" && action !== "commit_chat" && query.length < 2) return json({ error: "اكتب سؤالًا أطول قليلًا." }, 400);
  const suppliedRequestId = sanitizeInline(body.request_id, 80);
  const clientChargeConfirm = CHAT_REQUEST_ID.test(suppliedRequestId);
  const requestId = clientChargeConfirm ? suppliedRequestId : crypto.randomUUID();

  if (action !== "commit_chat") {
    const now = deps.now ? deps.now() : Date.now();
    const quota = await deps.store.rateLimit(await deps.hash(userId), new Date(Math.floor(now / 300000) * 300000).toISOString(), 12).catch(() => null);
    if (quota === null) return json({ error: "تعذر بدء البحث الآن." }, 503);
    if (quota !== true) return json({ error: "وصلت إلى حد البحث المؤقت. حاول بعد قليل." }, 429);
  }

  const insufficient = (c: ChargeResult) => json({ error: `رصيد الفتحات لا يكفي لهذه العملية (المطلوب ${c.amount}، المتبقي ${c.remaining}).`, code: "insufficient_unlocks", required: c.amount, remaining: c.remaining }, 402);
  const unlocksOf = (c: ChargeResult) => ({ charged: c.charged ? c.amount : 0, remaining: c.remaining, unlimited: c.unlimited, operations: c.operations });

  // Plans a billable step: dedupes the briefing, pre-checks, and returns a committer.
  const bill = async (ops: string[], articleId: string | null) => {
    let list = [...ops];
    if (articleId && list.includes("archive_briefing") && await deps.store.alreadyBriefed(userId, articleId).catch(() => false)) list = list.filter((o) => o !== "archive_briefing");
    const pre = await deps.store.charge(userId, list, articleId, false);
    return { list, pre, commit: () => deps.store.charge(userId, list, articleId, true) };
  };
  const fail503 = (msg = "خدمة الأرشيف غير متاحة مؤقتًا. لم تُخصم أي فتحات.") => json({ error: msg }, 503);
  const chargedPayload = async (payload: Record<string, unknown>, ops: string[], articleId: string | null = null) => {
    const b = await bill(ops, articleId);
    if (!b.pre) return fail503();
    if (!b.pre.allowed) return insufficient(b.pre);
    const done = await b.commit();
    if (!done?.allowed) return done ? insufficient(done) : fail503();
    return json({ ...payload, unlocks: unlocksOf(done) });
  };

  let stage = "start";
  try {
    if (action === "commit_chat") {
      stage = "commit_chat";
      if (!CHAT_REQUEST_ID.test(suppliedRequestId)) return json({ error: "معرّف طلب الأرشيف غير صالح." }, 400);
      const done = await deps.store.chargeChat(userId, suppliedRequestId);
      if (!done) return fail503("تعذر تأكيد خصم رد الأرشيف. أعد المحاولة؛ لن يتكرر الخصم.");
      if (!done.allowed) return insufficient(done);
      return json({ finalized: true, unlocks: unlocksOf(done) });
    }
    // ---------------- standalone actions
    if (action === "open") {
      stage = "open";
      const id = sanitizeInline(body.article_id, 80);
      const card = UUID.test(id) ? await deps.store.loadArticle(id) : null;
      if (!card) return json({ error: "الخبر غير متاح." }, 404);
      const b = await bill(["archive_open"], id);
      if (!b.pre) return fail503();
      if (!b.pre.allowed) return insufficient(b.pre);
      const done = await b.commit();
      if (!done?.allowed) return done ? insufficient(done) : fail503();
      return json({ reply: "", briefing: null, articles: [publicCard(card)], suggestions: suggestions("ar"), lang: "ar", active_article_id: id, search_query: "", search: { candidate_count: 1, shown: 1, method: "open" }, unlocks: unlocksOf(done) });
    }
    if (action === "search") {
      stage = "search";
      const mind = classify(query);
      if (!mind.searchText) return chargedPayload({ reply: say(mind.lang, mind.tone, "vague"), briefing: null, articles: [], suggestions: [], lang: mind.lang, active_article_id: "", search_query: "", search: { candidate_count: 0, shown: 0, method: "clarify" } }, ["archive_other"]);
      const r = await retrieve(deps, rulesPlan(mind, query), mind, new Set(), true);
      if (!r.cards.length) return chargedPayload({ reply: say(mind.lang, mind.tone, "none"), briefing: null, articles: [], suggestions: [], lang: mind.lang, active_article_id: "", search_query: mind.searchText, search: { candidate_count: r.count, shown: 0, method: r.method } }, ["archive_search"]);
      const b = await bill(["archive_search"], null);
      if (!b.pre) return fail503();
      if (!b.pre.allowed) return insufficient(b.pre);
      const done = await b.commit();
      if (!done?.allowed) return done ? insufficient(done) : fail503();
      return json({ reply: "", briefing: null, articles: r.cards.slice(0, 5).map(publicCard), suggestions: suggestions(mind.lang), lang: mind.lang, active_article_id: "", search_query: mind.searchText, search: { candidate_count: r.count, shown: Math.min(5, r.cards.length), method: r.method }, unlocks: unlocksOf(done) });
    }

    // ---------------- chat + briefing share the dialogue pipeline
    stage = "context";
    const history = historyOf(body.history);
    const shown = idsOf(body, history);
    let previousQuery = rememberedQuery(body, history);
    let activeId = action === "briefing" ? sanitizeInline(body.article_id, 80) : rememberedArticle(body, history);
    const mind = action === "briefing" ? classify("حلل") : classify(query);
    const explicitTaskPlan = action === "chat" ? planForTask(body.task_type, query, mind, previousQuery) : null;
    // The browser session may have lost its context; a follow-up phrase ("لخّص") can then lean on the last approved reply.
    if (action === "chat" && !activeId && mind.follow) {
      const memory = await deps.store.getMemory(userId).catch(() => null);
      if (memory?.active_article_id && UUID.test(memory.active_article_id)) {
        activeId = memory.active_article_id;
        if (!previousQuery) previousQuery = sanitizeInline(memory.search_query, 180);
        if (!history.length && memory.approved_reply) history.push({ role: "assistant", content: sanitizeInline(memory.approved_reply, 500), active_article_id: activeId });
      }
    }
    const hasContext = history.length > 0 || !!activeId;
    const cannedPayload = (key: string, lang = mind.lang, tone = mind.tone, extra: Record<string, unknown> = {}) => ({ reply: say(lang, tone, key), briefing: null, articles: [], suggestions: [], lang, active_article_id: activeId || "", search_query: previousQuery, search: { candidate_count: 0, shown: 0, method: String(extra.method || "conversation") } });
    const freeCanned = (key: string, lang = mind.lang, tone = mind.tone, extra: Record<string, unknown> = {}) => json(cannedPayload(key, lang, tone, extra));

    if (action === "chat" && !hasContext && !explicitTaskPlan) {
      if (mind.intent === "greeting") return freeCanned("greeting");
      if (mind.intent === "joke") return freeCanned("joke");
      if (mind.intent === "ambiguous") return freeCanned("vague");
    }

    const active = activeId ? await deps.store.loadArticle(activeId) : null;
    let plan: Plan;
    stage = "understand";
    if (action === "briefing") {
      plan = { kind: "find_news", sub: "general", standalone: "حلّل هذا الخبر", summary: "", queries: [], lang: "ar", tone: "plain", clarify: "", by: "rules" };
    } else if (explicitTaskPlan) {
      plan = explicitTaskPlan;
    } else {
      try { plan = await understand(deps, query, history, active, mind); }
      catch (e) {
        const reason = e instanceof Error ? e.message : "unknown";
        console.warn("core_understanding_fallback", { request_id: requestId, reason });
        plan = rulesPlan(mind, query);
      }
    }
    const { lang, tone } = plan;

    if (plan.kind === "smalltalk") return freeCanned(mind.intent === "joke" ? "joke" : "greeting", lang, tone);
    if (plan.kind === "out_of_scope") return freeCanned("scope", lang, tone);
    if (plan.kind === "unclear") return plan.clarify
      ? json({ ...cannedPayload("vague", lang, tone), reply: plan.clarify })
      : freeCanned("vague", lang, tone);

    // ---- gather materials
    stage = "retrieve";
    let primary: Card | null = null, others: Card[] = [], method = "conversation", candidates = 0;
    const kind = plan.kind;
    if (action === "briefing") {
      primary = active;
      if (!primary) return json({ error: "الخبر غير متاح." }, 404);
      const anchor = anchorName(primary, "");
      if (anchor) others = relatedCards(anchor, await deps.store.textSearch(anchor), new Set([activeId])).slice(0, 3).map((x) => x.card);
      method = "briefing";
    } else if (kind === "about_active_card") {
      if (!active) return freeCanned("noCard", lang, tone, { method: "card-context" });
      primary = active;
      if (plan.sub !== "summarize" && plan.sub !== "entities") {
        const anchor = anchorName(active, previousQuery);
        if (anchor) others = relatedCards(anchor, await deps.store.textSearch(anchor), new Set([activeId])).slice(0, 2).map((x) => x.card);
      }
      method = "current-card";
    } else if (kind === "another_card" || kind === "related_card") {
      const pool: Card[] = [];
      if (kind === "related_card") {
        const anchor = anchorName(active || {}, previousQuery);
        if (!anchor) return freeCanned("noRelated", lang, tone, { method: "related" });
        merge(pool, await deps.store.textSearch(anchor));
        primary = relatedCards(anchor, pool, shown)[0]?.card || null;
        if (!primary && deps.gemini.has("core")) { try { merge(pool, await deps.store.semanticSearch(anchor, await deps.gemini.embed(anchor))); primary = relatedCards(anchor, pool, shown)[0]?.card || null; } catch { /* skip */ } }
        if (!primary) return freeCanned("noRelated", lang, tone, { method: "related" });
      } else {
        const meaning = previousQuery || (active ? sanitizeInline(active.headline, 180) : plan.queries[0] || "");
        if (!meaning) return freeCanned("noCard", lang, tone, { method: "card-context" });
        merge(pool, await deps.store.textSearch(meaning));
        primary = bestCard(meaning, pool, shown);
        if (!primary && deps.gemini.has("core")) { try { merge(pool, await deps.store.semanticSearch(meaning, await deps.gemini.embed(meaning))); primary = bestCard(meaning, pool, shown); } catch { /* skip */ } }
        if (!primary) return freeCanned("noNext", lang, tone, { method: "another" });
      }
      candidates = pool.length; method = kind === "related_card" ? "related" : "another";
    } else {
      let r: { cards: Card[]; method: string; count: number };
      try {
        r = await retrieve(deps, plan, mind, new Set(), kind === "ask_about_news");
      } catch (e) {
        console.warn("retrieve_failed", e instanceof Error ? e.message : "unknown");
        return fail503("تعذر جلب أخبار الأرشيف الآن. لم يتم خصم أي فتحة.");
      }
      candidates = r.count; method = r.method;
      if (!r.cards.length) return freeCanned("none", lang, tone, { method });
      primary = r.cards[0]; others = r.cards.slice(1, kind === "ask_about_news" ? 5 : 3);
    }
    if (!primary?.id) return fail503("تعذر تجهيز خبر الأرشيف. لم يتم خصم أي فتحة.");
    const cardKind = kind === "find_news" || kind === "another_card" || kind === "related_card" || action === "briefing";
    const pid = String(primary.id);
    const revisions = await deps.store.revisions(pid).catch(() => []);
    const mats: Mat[] = [{ ref: "A1", card: primary, role: "primary", revisions }, ...others.map((c, i) => ({ ref: `A${i + 2}`, card: c, role: "other" as const }))];

    // Read-only preflight: reserve nothing before a reviewer-approved final answer exists.
    stage = "balance";
    const bal = await deps.store.balance(userId);
    if (!bal.unlimited && bal.balance < CHAT_COST) return json({ error: `رصيد الفتحات لا يكفي لرد الأرشيف (المطلوب ${CHAT_COST}، المتبقي ${bal.balance}).`, code: "insufficient_unlocks", required: CHAT_COST, remaining: bal.balance }, 402);

    // Stage 2: read each card's full article (stored independently of ingestion), select the passages that answer the question.
    stage = "evidence";
    const terms = distinctive(`${plan.standalone || query} ${plan.queries.join(" ")}`);
    const evidence = await gatherEvidence(deps.store, deps.gemini, mats, terms).catch((e) => { console.warn("evidence_failed", e instanceof Error ? e.message : "unknown"); return { read: 0, bodyKey: "nb" }; });
    const cacheKey = cardKind ? `${pid}|${String(primary.headline).length}|${String(primary.summary).length}|${primary.update_count}|${primary.updated_at ?? ""}|${evidence.bodyKey}` : "";
    const previousReply = [...history].reverse().find((t) => t.role === "assistant")?.content || "";

    // Stages 3-5: generation, critical review, extra check - up to four rounds alternating the two keys.
    stage = "compose";
    const out = await compose(deps.gemini, { kind, sub: plan.sub, question: plan.standalone || query, summary: plan.summary, turns: turnsText(history), mats, lang, tone, wantAnalysis: cardKind, cacheKey, previousReply, deadlineAt });

    if (!out.ok) {
      // Nothing passed review + verification: alternate reply, no memory update, and NO charge.
      console.warn("archive_reply_unverified", { request_id: requestId, reason: out.reason, rounds: out.rounds, evidence_read: evidence.read });
      return json({
        reply: fallbackReply(lang, requestId), briefing: null, analysis: null, entities: [], articles: [publicCard(primary)],
        suggestions: suggestions(lang), lang, active_article_id: pid, search_query: previousQuery || plan.queries[0] || "",
        search: { candidate_count: candidates, shown: 1, method }, pipeline: "fallback", fallback: true,
        verification: { passed: false, reason: out.reason, rounds: out.rounds }, request_id: requestId,
        unlocks: { charged: 0, remaining: bal.balance, unlimited: bal.unlimited, operations: [] },
      });
    }
    const result = out.value;

    const cited = mats.filter((m) => result.refs.includes(m.ref)).map((m) => m.card);
    const citedWithPrimary = [primary, ...cited.filter((card) => String(card.id) !== String(primary.id))];
    const shownCards = cardKind || kind === "about_active_card" ? [primary] : citedWithPrimary.slice(0, 3);
    const nextActive = cardKind ? pid : (shownCards[0] ? String(shownCards[0].id) : activeId);
    const nextQuery = cardKind && kind !== "another_card" && kind !== "related_card" ? (plan.queries[0] || mind.searchText || previousQuery) : previousQuery || plan.queries[0] || "";
    const successPayload = {
      reply: result.reply,
      briefing: cardKind ? toBriefing(result.analysis, result.entities) : null,
      analysis: cardKind ? result.analysis : null,
      entities: cardKind ? result.entities : [],
      articles: shownCards.map(publicCard),
      suggestions: suggestions(lang), lang, active_article_id: nextActive || "",
      search_query: nextQuery,
      search: { candidate_count: candidates, shown: shownCards.length, method, article_text_read: evidence.read }, pipeline: result.pipeline,
      verification: { passed: true, rounds: result.rounds },
    };

    // Stage 6: only an approved reply updates the conversation memory (best effort, never blocks the answer).
    stage = "memory";
    if (nextActive && UUID.test(nextActive)) {
      await deps.store.saveMemory(userId, { context_summary: sanitizeInline(plan.summary || plan.standalone || query, 400), approved_reply: result.reply.slice(0, 2500), active_article_id: nextActive, search_query: sanitizeInline(nextQuery, 180) })
        .catch((e) => console.warn("memory_save_failed", e instanceof Error ? e.message : "unknown"));
    }

    // Stage 7: safe single deduction. New clients persist the answer first, then call commit_chat with the same request_id
    // (the SQL function charges 50 at most once per request_id); legacy builds are charged here once, after approval.
    stage = "charge";
    if (clientChargeConfirm) return json({ ...successPayload, request_id: requestId, charge_pending: true });
    const done = await deps.store.chargeChat(userId, requestId);
    if (!done) return fail503("تعذر تأكيد تكلفة الرد. لم تُخصم أي فتحات.");
    if (!done.allowed) return insufficient(done);
    return json({ ...successPayload, unlocks: unlocksOf(done) });
  } catch (e) {
    console.error("archive_pipeline_failed", { request_id: requestId, stage, reason: e instanceof Error ? e.message : "unknown" });
    return json({ error: "حدث خطأ أثناء معالجة الأرشيف. لم يتم خصم أي فتحة.", code: "archive_pipeline_failed", request_id: requestId }, 502);
  }
}
