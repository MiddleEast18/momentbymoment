import {
  type Card, type Lang, type Tone, anchorName, bestCard, classify, distinctive, publicCard, rankCards,
  relatedCards, sanitizeInline, say, stripStock, suggestions, type Mind,
} from "./archive-logic.ts";
import {
  type Analysis, type Gemini, type Mat, UNDERSTAND_SYSTEM, REVIEW_SYSTEM, cleanAnalysis, draftSystem,
  draftUser, reviewUser, toBriefing, understandUser,
} from "./ai.ts";

export interface ChargeResult { allowed: boolean; charged: boolean; amount: number; remaining: number; unlimited: boolean; operations: string[] }
export interface Store {
  getUser(token: string): Promise<string | null>;
  rateLimit(hash: string, windowStart: string, limit: number): Promise<boolean | null>;
  balance(userId: string): Promise<{ balance: number; unlimited: boolean }>;
  textSearch(text: string): Promise<Card[]>;
  semanticSearch(text: string, vector: number[]): Promise<Card[]>;
  loadArticle(id: string): Promise<Card | null>;
  revisions(id: string): Promise<Card[]>;
  alreadyBriefed(userId: string, articleId: string): Promise<boolean>;
  charge(userId: string, ops: string[], articleId: string | null, commit: boolean): Promise<ChargeResult | null>;
  chargeChat(userId: string, requestId: string): Promise<ChargeResult | null>;
}
export interface Deps { store: Store; gemini: Gemini; hash(v: string): Promise<string>; origins: Set<string>; now?: () => number }

type Kind = "smalltalk" | "find_news" | "ask_about_news" | "about_active_card" | "another_card" | "related_card" | "out_of_scope" | "unclear";
type Sub = "summarize" | "analyze" | "entities" | "general";
type Plan = { kind: Kind; sub: Sub; standalone: string; summary: string; queries: string[]; lang: Lang; tone: Tone; clarify: string; by: "model" | "rules" };
type Turn = { role: "user" | "assistant"; content: string; article_ids?: string[]; search_query?: string; active_article_id?: string };

const KINDS = new Set<Kind>(["smalltalk", "find_news", "ask_about_news", "about_active_card", "another_card", "related_card", "out_of_scope", "unclear"]);
const UUID = /^[0-9a-f-]{16,80}$/i;
const CHAT_COST = 50;
const CHAT_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const analysisCache = new Map<string, { at: number; analysis: Analysis }>();
const CACHE_TTL = 6 * 3600 * 1000;
const REVIEW_VARIANTS = [
  "ابدأ بخلاصة الحدث ثم اربطها بسياقه ودلالته.",
  "ابدأ من سياق الخبر ثم وضّح ما تضيفه الوقائع إلى فهمه.",
  "اجعل العلاقة بين الأطراف محور القراءة، بقدر ما تسنده المواد.",
  "قدّم الدلالة أولًا ثم اربطها بالوقائع التي تحملها، من دون تنبؤ جازم.",
  "اختر ترتيبًا سرديًا طبيعيًا مختلفًا عن الإجابات السابقة، مع تجنب أي قالب ثابت.",
];

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

async function understand(deps: Deps, query: string, history: Turn[], active: Card | null, mind: Mind): Promise<Plan> {
  if (!deps.gemini.has("core")) throw new Error("core_understanding_missing");
  try {
    const r = await deps.gemini.json("core", { system: UNDERSTAND_SYSTEM, user: understandUser(query, turnsText(history), active), maxTokens: 1400 });
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

async function retrieve(deps: Deps, plan: Plan, mind: Mind, shown: Set<string>, many: boolean) {
  const qs = [...new Set([...plan.queries, mind.searchText].map((q) => q.trim()).filter((q) => q.length >= 2))].slice(0, 4);
  const pool: Card[] = [];
  for (const q of qs) merge(pool, await deps.store.textSearch(q));
  const best = new Map<string, { card: Card; score: number; pub: string }>();
  const rankAll = () => { for (const q of qs) for (const i of rankCards(q, pool, shown)) { const o = best.get(i.rank.id); if (!o || i.rank.score > o.score) best.set(i.rank.id, { card: i.card, score: i.rank.score, pub: i.rank.published }); } };
  rankAll();
  let method = "text";
  if (!best.size && deps.gemini.has("core") && qs.length) {
    try {
      const vec = await deps.gemini.embed(plan.standalone || qs[0]);
      merge(pool, await deps.store.semanticSearch(plan.standalone || qs[0], vec)); rankAll(); method = "semantic";
    } catch (e) { console.warn("semantic_skip", e instanceof Error ? e.message : "unknown"); }
  }
  let cards = [...best.values()].sort((a, b) => b.score - a.score || b.pub.localeCompare(a.pub)).map((x) => x.card);
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

type Composed = { reply: string; analysis: Analysis | null; refs: string[]; pipeline: "core+nexus" };
async function compose(deps: Deps, a: { kind: Kind; sub: Sub; question: string; summary: string; turns: string; mats: Mat[]; lang: Lang; tone: Tone; wantAnalysis: boolean; cacheKey: string }): Promise<Composed | null> {
  if (!deps.gemini.has("core") || !deps.gemini.has("nexus")) return null;
  const hit = a.cacheKey ? analysisCache.get(a.cacheKey) : undefined;
  const cached = hit && Date.now() - hit.at < CACHE_TTL ? hit.analysis : null;
  const needAnalysis = a.wantAnalysis && !cached;
  const valid = new Set(a.mats.map((m) => m.ref));
  const norm = (r: Record<string, unknown>) => ({
    reply: stripStock(sanitizeInline(r.reply, 2500)),
    analysis: needAnalysis ? cleanAnalysis(r.analysis, stripStock) : null,
    refs: (Array.isArray(r.used_refs) ? r.used_refs : []).map((x) => String(x)).filter((x) => valid.has(x)),
  });
  let draft: ReturnType<typeof norm> | null = null;
  let feedback = "";
  let last: ReturnType<typeof norm> | null = null;
  const style = REVIEW_VARIANTS[Math.floor(Math.random() * REVIEW_VARIANTS.length)];
  const approvedOf = (raw: Record<string, unknown>) => raw.approved === true || raw.approved === "true" || raw.approved === 1;
  const finish = (rev: ReturnType<typeof norm>, fromDraft: ReturnType<typeof norm>) => {
    const analysis = cached || (needAnalysis ? rev.analysis || fromDraft.analysis : null);
    if (a.cacheKey && analysis && !cached) {
      if (analysisCache.size > 300) analysisCache.delete(analysisCache.keys().next().value as string);
      analysisCache.set(a.cacheKey, { at: Date.now(), analysis });
    }
    return { reply: rev.reply, analysis, refs: rev.refs.length ? rev.refs : (fromDraft.refs.length ? fromDraft.refs : (valid.has("A1") ? ["A1"] : [])), pipeline: "core+nexus" as const };
  };
  for (let round = 1; round <= 3; round++) {
    try {
      draft = norm(await deps.gemini.json("nexus", { system: draftSystem(a.kind, a.sub, needAnalysis), user: draftUser(a.question, a.turns, a.mats, a.lang, a.tone, cached, feedback, a.summary), maxTokens: 3500 }));
    } catch (e) { console.warn("nexus_draft_failed", { round, reason: e instanceof Error ? e.message : "unknown" }); break; }
    if (!draft.reply) break;
    try {
      const raw = await deps.gemini.json("core", { system: `${REVIEW_SYSTEM}\n\nتوجيه تحريري متغير لهذا الرد: ${style} لا تحوّل التوجيه إلى عبارة جاهزة ولا تضف أي وقائع. هذه جولة المراجعة ${round} من 3.`, user: reviewUser(a.question, a.turns, a.mats, a.lang, a.tone, { reply: draft.reply, analysis: draft.analysis, used_refs: draft.refs }, a.summary), maxTokens: 4000 });
      const rev = norm(raw);
      feedback = sanitizeInline(raw.feedback, 1200);
      if (!rev.reply) break;
      last = rev;
      const accepted = approvedOf(raw) || (!feedback && raw.approved == null);
      if (accepted || round === 3) return finish(rev, draft);
    } catch (e) { console.warn("core_review_failed", { round, reason: e instanceof Error ? e.message : "unknown" }); break; }
  }
  return last && draft ? finish(last, draft) : null;
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

  try {
    if (action === "commit_chat") {
      if (!CHAT_REQUEST_ID.test(suppliedRequestId)) return json({ error: "معرّف طلب الأرشيف غير صالح." }, 400);
      const done = await deps.store.chargeChat(userId, suppliedRequestId);
      if (!done) return fail503("تعذر تأكيد خصم رد الأرشيف. أعد المحاولة؛ لن يتكرر الخصم.");
      if (!done.allowed) return insufficient(done);
      return json({ finalized: true, unlocks: unlocksOf(done) });
    }
    // ---------------- standalone actions
    if (action === "open") {
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
    const history = historyOf(body.history);
    const shown = idsOf(body, history);
    const previousQuery = rememberedQuery(body, history);
    let activeId = action === "briefing" ? sanitizeInline(body.article_id, 80) : rememberedArticle(body, history);
    const hasContext = history.length > 0 || !!activeId;
    const mind = action === "briefing" ? classify("حلل") : classify(query);
    const cannedPayload = (key: string, lang = mind.lang, tone = mind.tone, extra: Record<string, unknown> = {}) => ({ reply: say(lang, tone, key), briefing: null, articles: [], suggestions: [], lang, active_article_id: activeId || "", search_query: previousQuery, search: { candidate_count: 0, shown: 0, method: String(extra.method || "conversation") } });
    const freeCanned = (key: string, lang = mind.lang, tone = mind.tone, extra: Record<string, unknown> = {}) => json(cannedPayload(key, lang, tone, extra));

  if (action === "chat" && !hasContext) {
      if (mind.intent === "greeting") return freeCanned("greeting");
      if (mind.intent === "joke") return freeCanned("joke");
      if (mind.intent === "ambiguous") return freeCanned("vague");
    }

    const active = activeId ? await deps.store.loadArticle(activeId) : null;
    let plan: Plan;
    if (action === "briefing") {
      plan = { kind: "find_news", sub: "general", standalone: "حلّل هذا الخبر", summary: "", queries: [], lang: "ar", tone: "plain", clarify: "", by: "rules" };
    } else {
      try { plan = await understand(deps, query, history, active, mind); }
      catch (e) {
        const reason = e instanceof Error ? e.message : "unknown";
        return fail503(reason === "resource_exhausted"
          ? "محرك فهم الأرشيف مشغول الآن. أعد المحاولة لاحقًا. لم يتم خصم أي فتحة."
          : "تعذر فهم السؤال عبر محرك الأرشيف الآن. أعد المحاولة لاحقًا. لم يتم خصم أي فتحة.");
      }
    }
    const { lang, tone } = plan;

    if (plan.kind === "smalltalk") return freeCanned(mind.intent === "joke" ? "joke" : "greeting", lang, tone);
    if (plan.kind === "out_of_scope") return freeCanned("scope", lang, tone);
    if (plan.kind === "unclear") return plan.clarify
      ? json({ ...cannedPayload("vague", lang, tone), reply: plan.clarify })
      : freeCanned("vague", lang, tone);

    // ---- gather materials
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
    const bal = await deps.store.balance(userId);
    if (!bal.unlimited && bal.balance < CHAT_COST) return json({ error: `رصيد الفتحات لا يكفي لرد الأرشيف (المطلوب ${CHAT_COST}، المتبقي ${bal.balance}).`, code: "insufficient_unlocks", required: CHAT_COST, remaining: bal.balance }, 402);
    const cacheKey = cardKind ? `${pid}|${String(primary.headline).length}|${String(primary.summary).length}|${primary.update_count}|${primary.updated_at ?? ""}` : "";
    const out = await compose(deps, { kind, sub: plan.sub, question: plan.standalone || query, summary: plan.summary, turns: turnsText(history), mats, lang, tone, wantAnalysis: cardKind, cacheKey });

    if (!out) return fail503("لم يكتمل رد الأرشيف بعد المراجعة. لم يتم خصم أي فتحة.");

    // New clients persist the answer before commit_chat; legacy page builds still charge here after success.
    const cited = mats.filter((m) => out.refs.includes(m.ref)).map((m) => m.card);
    const citedWithPrimary = [primary, ...cited.filter((card) => String(card.id) !== String(primary.id))];
    const shownCards = cardKind || kind === "about_active_card" ? [primary] : citedWithPrimary.slice(0, 3);
    const nextActive = cardKind ? pid : (shownCards[0] ? String(shownCards[0].id) : activeId);
    const successPayload = {
      reply: out.reply,
      briefing: cardKind ? toBriefing(out.analysis) : null,
      analysis: cardKind ? out.analysis : null,
      articles: shownCards.map(publicCard),
      suggestions: suggestions(lang), lang, active_article_id: nextActive || "",
      search_query: cardKind && kind !== "another_card" && kind !== "related_card" ? (plan.queries[0] || mind.searchText || previousQuery) : previousQuery || plan.queries[0] || "",
      search: { candidate_count: candidates, shown: shownCards.length, method }, pipeline: out.pipeline,
    };
    if (clientChargeConfirm) return json({ ...successPayload, request_id: requestId, charge_pending: true });
    const done = await deps.store.chargeChat(userId, requestId);
    if (!done) return fail503("تعذر تأكيد تكلفة الرد. لم تُخصم أي فتحات.");
    if (!done.allowed) return insufficient(done);
    return json({ ...successPayload, unlocks: unlocksOf(done) });
  } catch (e) {
    console.error("archive_pipeline_failed", e instanceof Error ? e.message : "unknown");
    return json({ error: "حدث خطأ أثناء معالجة الأرشيف. لم يتم خصم أي فتحة." }, 502);
  }
}
