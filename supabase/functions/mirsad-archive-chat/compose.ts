import { type Lang, type Tone, sanitizeInline, stripStock } from "./archive-logic.ts";
import { type Analysis, type Entity, type Gemini, type Mat, type Stage, REVIEW_SYSTEM, cleanAnalysis, draftSystem, draftUser, reviewUser } from "./ai.ts";
import { type Candidate, cleanEntities, corpusOf, verifyCandidate } from "./verify.ts";

// Keep task ownership stable: NEXUS drafts; CORE independently reviews. Never swap roles on a retry.
export const MAX_ROUNDS = 3;
const CACHE_TTL = 6 * 3600 * 1000;
const FATAL = new Set(["missing_key", "key_temporarily_rejected", "deadline", "resource_exhausted", "network", "http_503", "http_529", "auth_400", "auth_401", "auth_403"]);
const cache = new Map<string, { at: number; analysis: Analysis; entities: Entity[] }>();
const VARIANTS = [
  "ابدأ بخلاصة الحدث ثم اربطها بسياقه ودلالته.",
  "ابدأ من سياق الخبر ثم وضّح ما تضيفه الوقائع إلى فهمه.",
  "اجعل العلاقة بين الأطراف محور القراءة، بقدر ما تسنده المواد.",
  "قدّم الدلالة أولًا ثم اربطها بالوقائع التي تحملها، من دون تنبؤ جازم.",
  "اختر ترتيبًا سرديًا طبيعيًا مختلفًا عن الإجابات السابقة، مع تجنب أي قالب ثابت.",
];

export type Composed = { reply: string; analysis: Analysis | null; entities: Entity[]; refs: string[]; rounds: number; pipeline: "core+nexus" };
export type ComposeArgs = {
  kind: string; sub: string; question: string; summary: string; turns: string; mats: Mat[]; lang: Lang; tone: Tone;
  wantAnalysis: boolean; cacheKey: string; previousReply?: string; deadlineAt: number;
};
export type ComposeResult = { ok: true; value: Composed } | { ok: false; reason: string; rounds: number };

const codeOf = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.message : "unknown");

export function resetComposeCache() { cache.clear(); }

export async function compose(gemini: Gemini, a: ComposeArgs): Promise<ComposeResult> {
  if (!gemini.has("core") || !gemini.has("nexus") || !gemini.hasIndependentKeys()) return { ok: false, reason: "missing_independent_keys", rounds: 0 };
  const hit = a.cacheKey ? cache.get(a.cacheKey) : undefined;
  const cached = hit && Date.now() - hit.at < CACHE_TTL ? hit : null;
  const needAnalysis = a.wantAnalysis && !cached;
  const valid = new Set(a.mats.map((m) => m.ref));
  const corpus = corpusOf(a.mats);
  const norm = (r: Record<string, unknown>): Candidate => ({
    reply: stripStock(sanitizeInline(r.reply, 2500)),
    analysis: needAnalysis ? cleanAnalysis(r.analysis, stripStock) : null,
    entities: needAnalysis ? cleanEntities(r.entities, stripStock, corpus) : [],
    refs: (Array.isArray(r.used_refs) ? r.used_refs : []).map((x) => String(x).split(".")[0]).filter((x) => valid.has(x)),
  });
  const style = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
  let feedback = "", previous = "", reason = "unverified", rounds = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (a.deadlineAt - Date.now() < 12_000) { reason = "deadline"; break; }
    rounds = round;
    const draftSlot: Stage = "nexus";
    const reviewSlot: Stage = "core";

    // 3: specialised journalistic generation (summary + deep analysis + documented entities)
    let draft: Candidate;
    try {
      draft = norm(await gemini.json(draftSlot, {
        system: draftSystem(a.kind, a.sub, needAnalysis),
        user: draftUser(a.question, a.turns, a.mats, a.lang, a.tone, cached ? { analysis: cached.analysis, entities: cached.entities } : null, feedback, a.summary, previous),
        maxTokens: 3500, deadlineAt: a.deadlineAt,
      }));
    } catch (e) {
      reason = codeOf(e);
      console.warn("compose_draft_failed", { round, slot: draftSlot, reason });
      if (FATAL.has(reason) || reason.startsWith("auth_")) break;
      continue;
    }
    if (!draft.reply) { feedback = "المسودة السابقة كانت فارغة؛ اكتب ردًا كاملًا يجيب السؤال."; reason = "empty_draft"; continue; }

    // 4: critical review (claims vs evidence, fabrication, contradiction, repetition)
    let raw: Record<string, unknown>;
    try {
      raw = await gemini.json(reviewSlot, {
        system: `${REVIEW_SYSTEM}\n\nتوجيه تحريري متغير لهذا الرد: ${style} لا تحوّل التوجيه إلى عبارة جاهزة ولا تضف أي وقائع. هذه جولة المراجعة ${round} من ${MAX_ROUNDS}.`,
        user: reviewUser(a.question, a.turns, a.mats, a.lang, a.tone, { reply: draft.reply, analysis: draft.analysis, entities: draft.entities, used_refs: draft.refs }, a.summary),
        maxTokens: 4000, deadlineAt: a.deadlineAt,
      });
    } catch (e) {
      reason = codeOf(e);
      console.warn("compose_review_failed", { round, slot: reviewSlot, reason });
      previous = JSON.stringify(draft).slice(0, 4000);
      if (FATAL.has(reason) || reason.startsWith("auth_")) break;
      continue;
    }
    const rev = norm(raw);
    const reviewerNotes = sanitizeInline(raw.feedback, 1200);
    if (!rev.reply) { feedback = reviewerNotes || "المراجعة لم تُخرج ردًا نهائيًا."; previous = JSON.stringify(draft).slice(0, 4000); reason = "empty_review"; continue; }
    const final: Candidate = {
      reply: rev.reply,
      analysis: needAnalysis ? rev.analysis || draft.analysis : null,
      entities: needAnalysis ? (rev.entities.length ? rev.entities : draft.entities) : [],
      refs: rev.refs.length ? rev.refs : draft.refs,
    };

    // 5: extra deterministic check before the answer may move on
    const verdict = verifyCandidate(final, { mats: a.mats, lang: a.lang, previousReply: a.previousReply });
    const approved = raw.approved === true;
    if (approved && verdict.ok) {
      const analysis = cached?.analysis ?? final.analysis;
      const entities = cached?.entities ?? final.entities;
      if (a.cacheKey && needAnalysis && final.analysis) {
        if (cache.size > 300) cache.delete(cache.keys().next().value as string);
        cache.set(a.cacheKey, { at: Date.now(), analysis: final.analysis, entities: final.entities });
      }
      return { ok: true, value: { reply: final.reply, analysis, entities, refs: final.refs, rounds: round, pipeline: "core+nexus" } };
    }
    reason = approved ? "verification_failed" : "reviewer_rejected";
    feedback = [reviewerNotes, ...(approved ? [] : ["لا تعتمد الرد ما لم تُرجع approved=true صراحةً بعد مراجعة الأدلة."]), ...verdict.issues].filter(Boolean).join("\n").slice(0, 1200);
    previous = JSON.stringify(final).slice(0, 4000);
  }
  return { ok: false, reason, rounds };
}
