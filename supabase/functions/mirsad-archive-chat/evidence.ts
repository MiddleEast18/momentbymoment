import { type Card, fold } from "./archive-logic.ts";
import type { Gemini, Mat, Passage } from "./ai.ts";

// Full-article reading for archive replies. Fully independent of ingestion: it only reads
// news_articles.source_url and writes to archive_reply_bodies / archive_reply_passages.
export interface BodyRow { article_id: string; source_url: string; body_text: string; fetch_status: string; content_hash: string; fetched_at: string }
export interface PassageRow { article_id: string; passage_index: number; passage_text: string }
export interface EvidenceStore {
  loadBody(id: string): Promise<BodyRow | null>;
  saveBody(row: Omit<BodyRow, "fetched_at">): Promise<void>;
  loadPassages(id: string): Promise<PassageRow[]>;
  replacePassages(id: string, rows: { passage_index: number; passage_text: string; embedding: number[] | null }[]): Promise<void>;
  setPassageEmbedding(id: string, index: number, vector: number[]): Promise<void>;
}

const UA = "Mozilla/5.0 (compatible; MirsadArchiveReader/1.0; +https://marsad.website)";
const MAX_HTML = 1_500_000;
const MAX_TEXT = 24_000;
const MAX_PASSAGES = 14;
const DAY = 86_400_000;
const NOISE = /(اشترك في|النشرة البريدية|جميع الحقوق|حقوق النشر|اقرأ أيضا|اقرأ أيضًا|شارك الخبر|سياسة الخصوصية|ملفات تعريف الارتباط|cookies?\b|subscribe|newsletter|all rights reserved|read more|follow us|advertisement)/i;
const BLOCK = /<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|template)\b[\s\S]*?<\/\1>/gi;

export function publicUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.includes(":") || h.startsWith("[")) return null;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost") || h.endsWith(".internal")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return null;
  }
  return u;
}

async function readLimited(res: Response, max: number): Promise<string> {
  const label = /charset=([\w-]+)/i.exec(res.headers.get("content-type") || "")?.[1] || "utf-8";
  let dec: TextDecoder;
  try { dec = new TextDecoder(label); } catch { dec = new TextDecoder("utf-8"); }
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, max);
  let out = "", size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    out += dec.decode(value, { stream: true });
    if (size >= max) { await reader.cancel().catch(() => {}); break; }
  }
  return out + dec.decode();
}

export async function fetchHtml(raw: string, fetchFn: typeof fetch = fetch, ms = 6000): Promise<string> {
  let url = publicUrl(raw);
  if (!url) throw new Error("blocked_url");
  for (let hop = 0; hop < 4; hop++) {
    const res: Response = await fetchFn(url.href, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "ar,en;q=0.8" }, signal: AbortSignal.timeout(ms) });
    if (res.status >= 300 && res.status < 400) {
      const loc: string | null = res.headers.get("location");
      let next: URL | null = null;
      try { next = loc ? publicUrl(new URL(loc, url).href) : null; } catch { next = null; }
      if (!next) throw new Error("blocked_redirect");
      url = next;
      continue;
    }
    if (!res.ok) throw new Error(`http_${res.status}`);
    if (!/html|xml|text\/plain/i.test(res.headers.get("content-type") || "")) throw new Error("not_html");
    return await readLimited(res, MAX_HTML);
  }
  throw new Error("too_many_redirects");
}

const cp = (n: number) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ");
const decode = (s: string) => s.replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => cp(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n) => cp(parseInt(n, 16)));
const squash = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

function jsonLdBody(html: string): string {
  const found: string[] = [];
  const walk = (v: unknown, depth = 0) => {
    if (depth > 6) return;
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.articleBody === "string") found.push(o.articleBody);
      Object.values(o).forEach((x) => walk(x, depth + 1));
    }
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { /* ignore malformed block */ }
  }
  return found.sort((a, b) => b.length - a.length)[0] || "";
}

export function extractArticleText(html: string): string {
  const ld = squash(jsonLdBody(html)).replace(/\s*\n\s*/g, "\n\n");
  if (ld.length >= 400) return ld.slice(0, MAX_TEXT);
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, " ").replace(BLOCK, " ");
  const scope = /<article\b[\s\S]*?<\/article>/i.exec(cleaned)?.[0] || /<main\b[\s\S]*?<\/main>/i.exec(cleaned)?.[0] || cleaned;
  const seen = new Set<string>();
  const paras: string[] = [];
  for (const m of scope.matchAll(/<(p|h2|h3|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = squash(m[2]).replace(/\s+/g, " ");
    if (t.length < (m[1].toLowerCase() === "p" ? 40 : 25) || NOISE.test(t) || seen.has(t)) continue;
    seen.add(t);
    paras.push(t);
  }
  return paras.join("\n\n").slice(0, MAX_TEXT);
}

export function splitPassages(text: string, target = 900): string[] {
  const out: string[] = [];
  let cur = "";
  const push = () => { const t = cur.trim(); if (t.length >= 40) out.push(t); cur = ""; };
  for (const para of text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    const pieces = para.length > target ? para.split(/(?<=[.!؟?۔])\s+/) : [para];
    for (const piece of pieces) {
      if (cur && cur.length + piece.length + 1 > target) push();
      cur = cur ? `${cur} ${piece}` : piece;
    }
    if (cur.length >= target * 0.6) push();
  }
  push();
  return out.slice(0, MAX_PASSAGES);
}

export async function sha256(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const stale = (row: BodyRow, card: Card, now: number) => {
  const fetched = Date.parse(row.fetched_at);
  if (!Number.isFinite(fetched)) return true;
  const age = now - fetched;
  if (row.fetch_status === "ok") return age > 14 * DAY || Date.parse(String(card.updated_at || "")) > fetched + 3_600_000;
  if (row.fetch_status === "failed") return age > 3 * 3_600_000;
  if (row.fetch_status === "empty") return age > DAY;
  return age > 7 * DAY;
};

function defer(task: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const safe = task.catch(() => {});
  if (rt?.waitUntil) rt.waitUntil(safe);
}

export type BodyResult = { status: string; hash: string; passages: PassageRow[] };

export async function ensureBody(store: EvidenceStore, gemini: Gemini, card: Card, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<BodyResult> {
  const id = String(card.id || "");
  const url = String(card.source_url || "");
  const row = await store.loadBody(id).catch(() => null);
  if (row && !stale(row, card, now)) {
    return { status: row.fetch_status, hash: row.content_hash, passages: row.fetch_status === "ok" ? await store.loadPassages(id).catch(() => []) : [] };
  }
  let status = "skipped", text = "";
  if (publicUrl(url)) {
    try {
      text = extractArticleText(await fetchHtml(url, fetchFn));
      status = text.length >= 300 ? "ok" : "empty";
    } catch (e) {
      status = "failed";
      console.warn("body_fetch_failed", { id, reason: e instanceof Error ? e.message : "unknown" });
    }
  }
  const hash = status === "ok" ? await sha256(text) : "";
  await store.saveBody({ article_id: id, source_url: url, body_text: status === "ok" ? text : "", fetch_status: status, content_hash: hash }).catch((e) => console.warn("body_save_failed", e instanceof Error ? e.message : "unknown"));
  if (status !== "ok") return { status, hash, passages: [] };
  let passages = row && row.content_hash === hash ? await store.loadPassages(id).catch(() => []) : [];
  if (!passages.length) {
    passages = splitPassages(text).map((t, i) => ({ article_id: id, passage_index: i, passage_text: t }));
    await store.replacePassages(id, passages.map((p) => ({ passage_index: p.passage_index, passage_text: p.passage_text, embedding: null }))).catch((e) => console.warn("passages_save_failed", e instanceof Error ? e.message : "unknown"));
    defer((async () => {
      for (const p of passages) {
        try { await store.setPassageEmbedding(id, p.passage_index, await gemini.embed(p.passage_text, "document")); } catch { break; }
      }
    })());
  }
  return { status, hash, passages };
}

// Stage 2: choose the passages most relevant to the question and keep their reading order.
export function pickPassages(ref: string, passages: PassageRow[], terms: string[], k: number): Passage[] {
  const scored = passages.map((p) => {
    const f = fold(p.passage_text);
    return { p, hit: terms.filter((t) => f.includes(t)).length };
  });
  const relevant = scored.filter((s) => s.hit > 0).sort((a, b) => b.hit - a.hit || a.p.passage_index - b.p.passage_index);
  const chosen = (relevant.length ? relevant : scored).slice(0, relevant.length ? k : Math.min(2, k)).sort((a, b) => a.p.passage_index - b.p.passage_index);
  return chosen.map(({ p }) => ({ ref: `${ref}.P${p.passage_index + 1}`, text: p.passage_text.slice(0, 900) }));
}

export async function gatherEvidence(store: EvidenceStore, gemini: Gemini, mats: Mat[], terms: string[], opts: { fetchFn?: typeof fetch; budgetMs?: number; now?: number } = {}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.all(mats.slice(0, 4).map((m) => ensureBody(store, gemini, m.card, opts.fetchFn, opts.now).catch(() => null)));
  const results = await Promise.race([work, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), opts.budgetMs ?? 9000); })]);
  if (timer) clearTimeout(timer);
  let read = 0, bodyKey = "nb";
  results?.forEach((r, i) => {
    if (!r || !r.passages.length) return;
    read++;
    if (i === 0) bodyKey = r.hash.slice(0, 12) || "nb";
    mats[i].passages = pickPassages(mats[i].ref, r.passages, terms, i === 0 ? 4 : 2);
  });
  return { read, bodyKey };
}
