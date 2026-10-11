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
}
export interface Deps { store: Store; gemini: Gemini; hash(v: string): Promise<string>; origins: Set<string>; now?: () => number }

type Kind = "smalltalk" | "find_news" | "ask_about_news" | "about_active_card" | "another_card" | "related_card" | "out_of_scope" | "unclear";
type Sub = "summarize" | "analyze" | "entities" | "general";
type Plan = { kind: Kind; sub: Sub; standalone: string; queries: string[]; lang: Lang; tone: Tone; clarify: string; by: "model" | "rules" };
type Turn = { role: "user" | "assistant"; content: string; article_ids?: string[]; search_query?: string; active_article_id?: string };

const KINDS = new Set<Kind>(["smalltalk", "find_news", "ask_about_news", "about_active_card", "another_card", "related_card", "out_of_scope", "unclear"]);
const UUID = /^[0-9a-f-]{16,80}$/i;
const MIN_COST = 2;
const analysisCache = new Map<string, { at: number; analysis: Analysis }>();
const CACHE_TTL = 6 * 3600 * 1000;

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
  const base = { sub: "general" as Sub, standalone: query, queries: mind.searchText ? [mind.searchText] : [], lang: mind.lang, tone: mind.tone, clarify: "", by: "rules" as const };
  if (mind.intent === "greeting" || mind.intent === "joke") return { ...base, kind: "smalltalk" };
  if (mind.intent === "ambiguous") return { ...base, kind: "unclear" };
  if (mind.follow === "another") return { ...base, kind: "another_card" };
  if (mind.follow === "related") return { ...base, kind: "related_card" };
  if (mind.follow) return { ...base, kind: "about_active_card", sub: mind.follow as Sub };
  return { ...base, kind: mind.intent === "question" && /(لماذا|ليش|كيف|why|how)/i.test(query) ? "ask_about_news" : "find_news" };
}

async function understand(deps: Deps, query: string, history: Turn[], active: Card | null, mind: Mind): Promise<Plan> {
  const rules = rulesPlan(mind, query);
  if (!deps.gemini.has("core")) return rules;
  try {
    const r = await deps.gemini.json("core", { system: UNDERSTAND_SYSTEM, user: understandUser(query, turnsText(history), active), maxTokens: 700, temperature: 0.1 });
    const kind = String(r.kind || "") as Kind;
    if (!KINDS.has(kind)) return rules;
    const sub = (["summarize", "analyze", "entities", "general"].includes(String(r.sub)) ? String(r.sub) : "general") as Sub;
    const queries = (Array.isArray(r.search_queries) ? r.search_queries : []).map((q) => sanitizeInline(q, 60)).filter((q) => q.length >= 2).slice(0, 3);
    const lang: Lang = r.lang === "en" ? "en" : r.lang === "ar" ? "ar" : mind.lang;
    const tone: Tone = r.tone === "casual" || r.tone === "polite" || r.tone === "plain" ? r.tone : mind.tone;
    return { kind, sub, standalone: sanitizeInline(r.standalone_question, 300) || query, queries: queries.length ? queries : rules.queries, lang, tone, clarify: sanitizeInline(r.clarify, 200), by: "model" };
  } catch (e) {
    console.warn("understand_fallback", e instanceof Error ? e.message : "unknown");
    return rules;
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

type Composed = { reply: string; analysis: Analysis | null; refs: string[]; pipeline: "core+nexus" | "core-only" };
async function compose(deps: Deps, a: { kind: Kind; sub: Sub; question: string; turns: string; mats: Mat[]; lang: Lang; tone: Tone; wantAnalysis: boolean; cacheKey: string }): Promise<Composed | null> {
  if (!deps.gemini.has("core")) return null;
  const hit = a.cacheKey ? analysisCache.get(a.cacheKey) : undefined;
  const cached = hit && Date.now() - hit.at < CACHE_TTL ? hit.analysis : null;
  const needAnalysis = a.wantAnalysis && !cached;
  const valid = new Set(a.mats.map((m) => m.ref));
  const norm = (r: Record<string, unknown>) => ({
    reply: stripStock(sanitizeInline(r.reply, 2500)),
    analysis: needAnalysis ? cleanAnalysis(r.analysis, stripStock) : null,
    refs: (Array.isArray(r.used_refs) ? r.used_refs : []).map((x) => String(x)).filter((x) => valid.has(x)),
  });
  let draft;
  try {
    draft = norm(await deps.gemini.json("core", { system: draftSystem(a.kind, a.sub, needAnalysis), user: draftUser(a.question, a.turns, a.mats, a.lang, a.tone, cached), maxTokens: 3500, temperature: 0.35 }));
  } catch (e) { console.warn("core_failed", e instanceof Error ? e.message : "unknown"); return null; }
  if (!draft.reply) return null;
  let final = draft, pipeline: Composed["pipeline"] = "core-only";
  if (deps.gemini.has("nexus")) {
    try {
      const rev = norm(await deps.gemini.json("nexus", { system: REVIEW_SYSTEM, user: reviewUser(a.question, a.turns, a.mats, a.lang, a.tone, { reply: draft.reply, analysis: draft.analysis, used_refs: draft.refs }), maxTokens: 4000, temperature: 0.2 }));
      if (rev.reply) { final = { reply: rev.reply, analysis: needAnalysis ? (rev.analysis || draft.analysis) : null, refs: rev.refs.length ? rev.refs : draft.refs }; pipeline = "core+nexus"; }
    } catch (e) { console.warn("nexus_failed", e instanceof Error ? e.message : "unknown"); }
  } else console.warn("nexus_key_missing");
  const analysis = cached || final.analysis;
  if (a.cacheKey && analysis && !cached && pipeline === "core+nexus") {
    if (analysisCache.size > 300) analysisCache.delete(analysisCache.keys().next().value as string);
    analysisCache.set(a.cacheKey, { at: Date.now(), analysis });
  }
  return { reply: final.reply, analysis, refs: final.refs, pipeline };
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

  const action = ["open", "briefing", "search"].includes(String(body.action)) ? String(body.action) : "chat";
  const query = sanitizeInline(body.query, 500);
  if (action !== "open" && action !== "briefing" && query.length < 2) return json({ error: "اكتب سؤالًا أطول قليلًا." }, 400);

  const now = deps.now ? deps.now() : Date.now();
  const quota = await deps.store.rateLimit(await deps.hash(userId), new Date(Math.floor(now / 300000) * 300000).toISOString(), 12).catch(() => null);
  if (quota === null) return json({ error: "تعذر بدء البحث الآن." }, 503);
  if (quota !== true) return json({ error: "وصلت إلى حد البحث المؤقت. حاول بعد قليل." }, 429);

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
    const billedCanned = (key: string, ops: string[], lang = mind.lang, tone = mind.tone, extra: Record<string, unknown> = {}, articleId: string | null = null) => chargedPayload(cannedPayload(key, lang, tone, extra), ops, articleId);

    if (action === "chat" && !hasContext) {
      if (mind.intent === "greeting") return billedCanned("greeting", ["archive_other"]);
      if (mind.intent === "joke") return billedCanned("joke", ["archive_other"]);
      if (mind.intent === "ambiguous") return billedCanned("vague", ["archive_other"]);
    }

    const active = activeId ? await deps.store.loadArticle(activeId) : null;
    const plan: Plan = action === "briefing"
      ? { kind: "find_news", sub: "general", standalone: "حلّل هذا الخبر", queries: [], lang: "ar", tone: "plain", clarify: "", by: "rules" }
      : await understand(deps, query, history, active, mind);
    const { lang, tone } = plan;

    if (plan.kind === "smalltalk") return billedCanned(mind.intent === "joke" ? "joke" : "greeting", ["archive_other"], lang, tone);
    if (plan.kind === "out_of_scope") return billedCanned("scope", ["archive_other"], lang, tone);
    if (plan.kind === "unclear") return plan.clarify
      ? chargedPayload({ reply: plan.clarify, briefing: null, articles: [], suggestions: [], lang, active_article_id: activeId || "", search_query: previousQuery, search: { candidate_count: 0, shown: 0, method: "clarify" } }, ["archive_other"])
      : billedCanned("vague", ["archive_other"], lang, tone);

    const bal = await deps.store.balance(userId);
    if (!bal.unlimited && bal.balance < MIN_COST) return json({ error: `رصيد الفتحات لا يكفي لهذه العملية (المطلوب ${MIN_COST}، المتبقي ${bal.balance}).`, code: "insufficient_unlocks", required: MIN_COST, remaining: bal.balance }, 402);

    // ---- gather materials
    let primary: Card | null = null, others: Card[] = [], ops: string[] = [], method = "conversation", candidates = 0;
    const kind = plan.kind;
    if (action === "briefing") {
      primary = active;
      if (!primary) return json({ error: "الخبر غير متاح." }, 404);
      const anchor = anchorName(primary, "");
      if (anchor) others = relatedCards(anchor, await deps.store.textSearch(anchor), new Set([activeId])).slice(0, 3).map((x) => x.card);
      ops = ["archive_open", "archive_briefing"]; method = "briefing";
    } else if (kind === "about_active_card") {
      if (!active) return billedCanned("noCard", ["archive_followup"], lang, tone, { method: "card-context" }, activeId || null);
      primary = active;
      if (plan.sub !== "summarize" && plan.sub !== "entities") {
        const anchor = anchorName(active, previousQuery);
        if (anchor) others = relatedCards(anchor, await deps.store.textSearch(anchor), new Set([activeId])).slice(0, 2).map((x) => x.card);
      }
      ops = ["archive_followup"]; method = "current-card";
    } else if (kind === "another_card" || kind === "related_card") {
      const pool: Card[] = [];
      if (kind === "related_card") {
        const anchor = anchorName(active || {}, previousQuery);
        if (!anchor) return billedCanned("noRelated", ["archive_followup"], lang, tone, { method: "related" }, activeId || null);
        merge(pool, await deps.store.textSearch(anchor));
        primary = relatedCards(anchor, pool, shown)[0]?.card || null;
        if (!primary && deps.gemini.has("core")) { try { merge(pool, await deps.store.semanticSearch(anchor, await deps.gemini.embed(anchor))); primary = relatedCards(anchor, pool, shown)[0]?.card || null; } catch { /* skip */ } }
        if (!primary) return billedCanned("noRelated", ["archive_followup"], lang, tone, { method: "related" }, activeId || null);
      } else {
        const meaning = previousQuery || (active ? sanitizeInline(active.headline, 180) : plan.queries[0] || "");
        if (!meaning) return billedCanned("noCard", ["archive_followup"], lang, tone, { method: "card-context" }, activeId || null);
        merge(pool, await deps.store.textSearch(meaning));
        primary = bestCard(meaning, pool, shown);
        if (!primary && deps.gemini.has("core")) { try { merge(pool, await deps.store.semanticSearch(meaning, await deps.gemini.embed(meaning))); primary = bestCard(meaning, pool, shown); } catch { /* skip */ } }
        if (!primary) return billedCanned("noNext", ["archive_followup"], lang, tone, { method: "another" }, activeId || null);
      }
      candidates = pool.length; method = kind === "related_card" ? "related" : "another";
      ops = ["archive_followup", "archive_open", "archive_briefing"];
    } else {
      const r = await retrieve(deps, plan, mind, new Set(), kind === "ask_about_news"); candidates = r.count; method = r.method;
      if (!r.cards.length) return billedCanned("none", kind === "ask_about_news" ? ["archive_dialogue"] : ["archive_search"], lang, tone, { method });
      primary = r.cards[0]; others = r.cards.slice(1, kind === "ask_about_news" ? 5 : 3);
      ops = kind === "find_news" ? ["archive_search", "archive_open", "archive_briefing"] : ["archive_dialogue"];
    }
    const cardKind = kind === "find_news" || kind === "another_card" || kind === "related_card" || action === "briefing";
    const pid = String(primary.id);
    const billId = kind === "ask_about_news" ? pid : (kind === "about_active_card" ? activeId : pid);
    const revisions = await deps.store.revisions(pid).catch(() => []);
    const mats: Mat[] = [{ ref: "A1", card: primary, role: "primary", revisions }, ...others.map((c, i) => ({ ref: `A${i + 2}`, card: c, role: "other" as const }))];

    // ---- pre-check balance, then run the two-model pipeline, then commit
    const b = await bill(ops, billId);
    if (!b.pre) return fail503();
    if (!b.pre.allowed) return insufficient(b.pre);
    const cacheKey = cardKind ? `${pid}|${String(primary.headline).length}|${String(primary.summary).length}|${primary.update_count}|${primary.updated_at ?? ""}` : "";
    const out = await compose(deps, { kind, sub: plan.sub, question: plan.standalone || query, turns: turnsText(history), mats, lang, tone, wantAnalysis: cardKind, cacheKey });

    let finalOps = b.list;
    if (!out) {
      // Smart layer unavailable: card kinds degrade to plain retrieval; conversational kinds cannot be answered.
      if (!cardKind || action === "briefing") return fail503("الشرح الذكي غير متاح مؤقتًا. لم تُخصم أي فتحات.");
      finalOps = b.list.filter((o) => o !== "archive_briefing");
      const d = await deps.store.charge(userId, finalOps, billId, false);
      if (!d?.allowed) return d ? insufficient(d) : fail503();
    }
    const done = await deps.store.charge(userId, finalOps, billId, true);
    if (!done) return fail503();
    if (!done.allowed) return insufficient(done);

    const cited = out ? mats.filter((m) => out.refs.includes(m.ref)).map((m) => m.card) : [];
    const shownCards = cardKind || kind === "about_active_card" ? (kind === "about_active_card" ? [] : [primary]) : cited.slice(0, 3);
    const nextActive = cardKind ? pid : (shownCards[0] ? String(shownCards[0].id) : activeId);
    return json({
      reply: out ? out.reply : say(lang, tone, "degraded"),
      briefing: out && cardKind ? toBriefing(out.analysis) : null,
      analysis: out && cardKind ? out.analysis : null,
      articles: shownCards.map(publicCard),
      suggestions: suggestions(lang), lang, active_article_id: nextActive || "",
      search_query: cardKind && kind !== "another_card" && kind !== "related_card" ? (plan.queries[0] || mind.searchText || previousQuery) : previousQuery || plan.queries[0] || "",
      search: { candidate_count: candidates, shown: shownCards.length, method },
      pipeline: out ? out.pipeline : "degraded", unlocks: unlocksOf(done),
    });
  } catch (e) {
    console.error("request", e instanceof Error ? e.message : "unknown");
    return json({ error: "حدث خطأ أثناء المعالجة. حاول مرة أخرى. لم تُخصم أي فتحات إن لم تصلك إجابة." }, 502);
  }
}
