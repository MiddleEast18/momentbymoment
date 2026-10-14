import { type Lang, type Tone, sanitizeInline, stripStock } from "./archive-logic.ts";
import { type Analysis, type Entity, type Gemini, type Mat, type Stage, REVIEW_SYSTEM, cleanAnalysis, draftSystem, draftUser, reviewUser } from "./ai.ts";
import { type Candidate, cleanEntities, corpusOf, verifyCandidate } from "./verify.ts";

// Fixed rule: at most four draft->review rounds. Odd rounds draft on the NEXUS key and review on the CORE key;
// even rounds swap them. Each round re-feeds the previous draft plus concrete corrective notes.
export const MAX_ROUNDS = 4;
const CACHE_TTL = 6 * 3600 * 1000;
const FATAL = new Set(["missing_key", "deadline", "resource_exhausted", "network", "http_503", "http_529", "auth_400", "auth_401", "auth_403"]);
const cache = new Map<string, { at: number; analysis: Analysis; entities: Entity[] }>();

// Editorial angle follows the TASK the user asked for (not a random pick), so a summary, an analysis,
// an entity list and a related-card request are each steered differently instead of sharing one stock opening.
const GUIDE: Record<string, string[]> = {
  find_news: [
    "ابدأ بما يجيب طلب البحث مباشرة: ماذا حدث ومن الطرف الرئيسي، ثم أضف دلالة واحدة مسندة.",
    "ابدأ بأحدث واقعة تذكرها المواد ثم اربطها بسياقها القريب.",
  ],
  another_card: [
    "قدّم هذه البطاقة بوصفها إضافة جديدة، وابدأ بما يميزها عن البطاقة السابقة.",
    "ابدأ بالواقعة التي لم تظهر في البطاقات السابقة ثم اربطها بالموضوع نفسه.",
  ],
  related_card: [
    "ابدأ بوجه الارتباط بالبطاقة السابقة (الاسم أو الحدث المشترك) ثم قدّم ما تضيفه هذه البطاقة.",
    "وضّح أولًا ما يجمع الخبرين ثم ما يختلف فيه الجديد.",
  ],
  ask_about_news: [
    "أجب السؤال أولًا بخلاصة مباشرة ثم رتّب الوقائع الداعمة حسب أهميتها للسؤال.",
    "اربط بين الأخبار ذات الصلة وبيّن ما يجمعها أو يفرّق بينها، وقل صراحة إن لم تكفِ المواد.",
  ],
  summarize: [
    "لخّص أهم واقعتين فقط بصياغتك، دون نسخ العنوان أو الملخص.",
    "ابدأ بمن فعل ماذا ومتى، ثم أضف النتيجة أو الخطوة التالية إن وردت.",
  ],
  analyze: [
    "قدّم الدلالة أولًا ثم الوقائع التي تسندها، وكل استنتاج بصيغة قراءة لا خبر.",
    "اجعل العلاقة بين الأطراف محور القراءة بقدر ما تسنده المواد، من دون تنبؤ جازم.",
  ],
  entities: [
    "رتّب الجهات حسب حضورها في النص، وصف دور كل جهة بما ورد فقط.",
  ],
  general: [
    "أجب الجزء المطلوب من البطاقة النشطة مباشرة دون إعادة سرد ما قيل.",
    "ابدأ بالإجابة ثم أشر إلى الواقعة التي تسندها.",
  ],
};
const seedOf = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
export function guideKey(kind: string, sub: string) {
  if (kind === "about_active_card") return GUIDE[sub] ? sub : "general";
  return GUIDE[kind] ? kind : "ask_about_news";
}
export function styleFor(kind: string, sub: string, seed: string) {
  const list = GUIDE[guideKey(kind, sub)];
  return list[seedOf(`${kind}|${sub}|${seed}`) % list.length];
}

export type Composed = { reply: string; analysis: Analysis | null; entities: Entity[]; refs: string[]; rounds: number; pipeline: "core+nexus" };
export type ComposeArgs = {
  kind: string; sub: string; question: string; summary: string; turns: string; mats: Mat[]; lang: Lang; tone: Tone;
  wantAnalysis: boolean; cacheKey: string; previousReply?: string; deadlineAt: number;
};
export type ComposeResult = { ok: true; value: Composed } | { ok: false; reason: string; rounds: number };

const codeOf = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.message : "unknown");

export function resetComposeCache() { cache.clear(); }

export async function compose(gemini: Gemini, a: ComposeArgs): Promise<ComposeResult> {
  if (!gemini.has("core") && !gemini.has("nexus")) return { ok: false, reason: "missing_keys", rounds: 0 };
  // The cached analysis is written in one language; never serve it to a reader of the other.
  const ckey = a.cacheKey ? `${a.lang}|${a.cacheKey}` : "";
  const hit = ckey ? cache.get(ckey) : undefined;
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
  const approvedOf = (raw: Record<string, unknown>) => raw.approved === true || raw.approved === "true" || raw.approved === 1;
  const style = styleFor(a.kind, a.sub, a.question);
  const styleNote = `توجيه تحريري لهذا النوع من المهام: ${style} لا تحوّل التوجيه إلى عبارة جاهزة ولا تضف أي وقائع.`;
  let feedback = "", previous = "", reason = "unverified", rounds = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (a.deadlineAt - Date.now() < 12_000) { reason = "deadline"; break; }
    rounds = round;
    const draftSlot: Stage = round % 2 === 1 ? "nexus" : "core";
    const reviewSlot: Stage = round % 2 === 1 ? "core" : "nexus";

    // 3: specialised journalistic generation (summary + deep analysis + documented entities)
    let draft: Candidate;
    try {
      draft = norm(await gemini.json(draftSlot, {
        system: `${draftSystem(a.kind, a.sub, needAnalysis)}\n\n${styleNote}`,
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
        system: `${REVIEW_SYSTEM}\n\n${styleNote} هذه جولة المراجعة ${round} من ${MAX_ROUNDS}.`,
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
      refs: rev.refs.length ? rev.refs : (draft.refs.length ? draft.refs : (valid.has("A1") ? ["A1"] : [])),
    };

    // 5: extra deterministic check before the answer may move on
    const verdict = verifyCandidate(final, { mats: a.mats, lang: a.lang, previousReply: a.previousReply });
    const approved = approvedOf(raw) || (!reviewerNotes && raw.approved == null);
    if (approved && verdict.ok) {
      const analysis = cached?.analysis ?? final.analysis;
      const entities = cached?.entities ?? final.entities;
      if (ckey && needAnalysis && final.analysis) {
        if (cache.size > 300) cache.delete(cache.keys().next().value as string);
        cache.set(ckey, { at: Date.now(), analysis: final.analysis, entities: final.entities });
      }
      return { ok: true, value: { reply: final.reply, analysis, entities, refs: final.refs, rounds: round, pipeline: "core+nexus" } };
    }
    reason = approved ? "verification_failed" : "reviewer_rejected";
    // A rejection without notes would send the next round in blind; give it something actionable.
    const rejectNote = approved ? "" : "رفض المراجع المسودة دون ملاحظات؛ راجع كل جملة مقابل المواد واحذف ما لا تسنده.";
    feedback = [reviewerNotes || rejectNote, ...verdict.issues].filter(Boolean).join("\n").slice(0, 1200);
    previous = JSON.stringify(final).slice(0, 4000);
  }
  return { ok: false, reason, rounds };
}
