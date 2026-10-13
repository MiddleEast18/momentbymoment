import { type Lang, fold, publishedLabel, sanitizeInline } from "./archive-logic.ts";
import type { Analysis, Entity, Mat } from "./ai.ts";

export type Candidate = { reply: string; analysis: Analysis | null; entities: Entity[]; refs: string[] };
export type Verdict = { ok: boolean; issues: string[] };

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export const latinDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => String((AR_DIGITS.indexOf(d) + 1 || FA_DIGITS.indexOf(d) + 1) - 1));
const flatNumbers = (s: string) => latinDigits(s).replace(/(?<=\d)[,٬](?=\d)/g, "");
const numbersIn = (s: string) => (flatNumbers(s).match(/\d+(?:\.\d+)?/g) || []).filter((n) => n.replace(/\D/g, "").length >= 2);
const tokenSet = (s: string) => new Set(fold(s).split(" ").filter((t) => t.length >= 3));
const stem = (t: string) => (t.startsWith("ال") && t.length >= 5 ? t.slice(2) : t);

export function jaccard(a: string, b: string) {
  const x = tokenSet(a), y = tokenSet(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}
const sentencesOf = (s: string) => s.split(/(?<=[.!؟?۔])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length >= 12);

// Everything the model is allowed to treat as fact: titles, summaries, revisions, selected article passages.
export function corpusOf(mats: Mat[]) {
  const parts: string[] = [];
  for (const m of mats) {
    const c = m.card;
    parts.push(String(c.headline || ""), String(c.summary || ""), String(c.source_name || ""),
      publishedLabel(c.published_at, "ar"), publishedLabel(c.published_at, "en"));
    const d = c.claim_digest;
    if (typeof d === "string") parts.push(d);
    else if (d && typeof d === "object" && "main_claim" in d) parts.push(String((d as { main_claim?: unknown }).main_claim || ""));
    for (const r of m.revisions || []) parts.push(String(r.headline || ""), String(r.summary || ""), publishedLabel(r.published_at || r.captured_at, "ar"));
    for (const p of m.passages || []) parts.push(p.text);
  }
  return parts.join("\n");
}

export function cleanEntities(raw: unknown, strip: (s: string) => string, corpus: string): Entity[] {
  if (!Array.isArray(raw)) return [];
  const folded = fold(corpus);
  const out: Entity[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 12)) {
    const r = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const name = strip(sanitizeInline(r.name, 80));
    const role = strip(sanitizeInline(r.role, 220));
    const ref = sanitizeInline(r.ref, 12);
    const key = fold(name);
    if (!name || !key || seen.has(key)) continue;
    const toks = key.split(" ").map(stem).filter((t) => t.length >= 2);
    const grounded = folded.includes(key) || (toks.length > 0 && toks.every((t) => folded.includes(t)));
    if (!grounded) continue;
    seen.add(key);
    out.push({ name, role, ref });
    if (out.length >= 8) break;
  }
  return out;
}

// Stage 5: deterministic extra check, independent of the two model keys.
export function verifyCandidate(c: Candidate, ctx: { mats: Mat[]; lang: Lang; previousReply?: string }): Verdict {
  const issues: string[] = [];
  const reply = c.reply.trim();
  if (reply.length < 25) issues.push("الرد قصير أو فارغ؛ أجب عن قصد السؤال بجملتين على الأقل.");

  const corpus = flatNumbers(corpusOf(ctx.mats));
  const outputs = [reply, ...(c.analysis ? Object.values(c.analysis) : []), ...c.entities.map((e) => e.role)].join("\n");
  const unknown = [...new Set(numbersIn(outputs))].filter((n) => !corpus.includes(n));
  if (unknown.length) issues.push(`أرقام أو تواريخ غير واردة في المواد: ${unknown.slice(0, 4).join("، ")}؛ احذفها أو استبدلها بما في المواد.`);

  const primary = ctx.mats[0]?.card;
  if (primary && jaccard(reply, `${primary.headline} ${primary.summary}`) >= 0.8) issues.push("الرد ينسخ عنوان البطاقة وملخصها؛ أضف ما لا يظهر فيهما.");

  const parts = sentencesOf(reply);
  outer: for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (jaccard(parts[i], parts[j]) >= 0.85) { issues.push("جملتان في الرد تكرران المعنى نفسه."); break outer; }
  }

  if (c.analysis) {
    const fields = Object.values(c.analysis).filter(Boolean);
    let dup = fields.some((v) => jaccard(v, reply) >= 0.8);
    for (let i = 0; i < fields.length && !dup; i++) for (let j = i + 1; j < fields.length; j++) if (jaccard(fields[i], fields[j]) >= 0.8) { dup = true; break; }
    if (dup) issues.push("تكرار بين الرد والتحليل أو بين حقول التحليل؛ اترك الحقل المكرر فارغًا.");
  }
  if (ctx.previousReply && jaccard(reply, ctx.previousReply) >= 0.85) issues.push("الرد يعيد الرد السابق تقريبًا؛ أجب الجزء الجديد فقط.");

  const letters = reply.match(/\p{L}/gu) || [];
  if (letters.length >= 20) {
    const arabic = (reply.match(/[\u0600-\u06FF]/g) || []).length / letters.length;
    if (ctx.lang === "ar" && arabic < 0.4) issues.push("لغة الرد لا تطابق لغة المستخدم (العربية).");
    if (ctx.lang === "en" && arabic > 0.5) issues.push("The reply language must match the user's (English).");
  }
  return { ok: issues.length === 0, issues };
}

// Variable alternate reply used only when no draft survives review + verification. Never billed.
const FB_AR = [
  "تعذّر التحقق من رد مفصّل على سؤالك الآن، فاكتفيت بأقرب بطاقة من الأرشيف. أعد صياغة السؤال أو جرّبه بعد قليل. لم تُخصم أي فتحة.",
  "لم يكتمل التحقق من الرد هذه المرة، وهذه أقرب بطاقة مطابقة. جرّب السؤال نفسه بعد قليل أو حدّد الجهة أو المكان بوضوح أكبر. لم تُخصم أي فتحة.",
  "لم أستطع اعتماد رد مدقَّق الآن حتى لا أقدّم معلومة غير مسنودة؛ البطاقة أدناه هي الأقرب لطلبك. لم تُخصم أي فتحة.",
  "التحقق من الرد لم يكتمل، لذلك أعرض لك البطاقة الأقرب دون تحليل إضافي. أعد المحاولة بعد لحظات. لم تُخصم أي فتحة.",
];
const FB_EN = [
  "I couldn't verify a detailed answer right now, so here is the closest archive card. Rephrase or try again shortly. No unlocks were charged.",
  "Verification didn't complete this time; this is the closest matching card. Try again in a moment or name the party or place more precisely. No unlocks were charged.",
  "I couldn't approve a checked answer without risking unsupported claims; the card below is the closest match. No unlocks were charged.",
];
export function fallbackReply(lang: Lang, seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const list = lang === "en" ? FB_EN : FB_AR;
  return list[h % list.length];
}
