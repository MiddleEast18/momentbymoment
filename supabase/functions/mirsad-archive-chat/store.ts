import type { Card } from "./archive-logic.ts";
import type { ChargeResult, Memory, PassageHit, Store } from "./core.ts";
import type { BodyRow, PassageRow } from "./evidence.ts";

const vec = (v: number[]) => `[${v.join(",")}]`;

// deno-lint-ignore no-explicit-any
export function makeStore(db: any): Store {
  const UUID = /^[0-9a-f-]{16,80}$/i;
  return {
    async getUser(token) {
      const { data, error } = await db.auth.getUser(token);
      return error || !data?.user?.id ? null : String(data.user.id);
    },
    async rateLimit(hash, windowStart, limit) {
      const r = await db.rpc("mirsad_archive_consume_rate_limit", { p_subject_hash: hash, p_window_start: windowStart, p_limit: limit });
      return r.error ? null : r.data === true;
    },
    async balance(userId) {
      const r = await db.from("user_unlocks").select("unlock_balance, unlimited_unlocks").eq("user_id", userId).maybeSingle();
      return { balance: Number(r.data?.unlock_balance || 0), unlimited: !!r.data?.unlimited_unlocks };
    },
    async textSearch(text) {
      const r = await db.rpc("mirsad_archive_chat_text_search", { p_search_text: text, p_limit: 6 });
      if (r.error) throw new Error("search_failed");
      return Array.isArray(r.data) ? r.data : [];
    },
    async semanticSearch(text, vector) {
      const r = await db.rpc("mirsad_archive_search", { p_embedding: vec(vector), p_search_text: text, p_limit: 4 });
      return r.error || !Array.isArray(r.data) ? [] : r.data;
    },
    async searchPassages(text, vector) {
      const r = await db.rpc("archive_reply_search_passages", { p_embedding: vector ? vec(vector) : null, p_search_text: text, p_limit: 8 });
      if (r.error || !Array.isArray(r.data)) return [];
      return (r.data as Record<string, unknown>[]).map((x) => ({ article_id: String(x.article_id), passage_index: Number(x.passage_index), passage_text: String(x.passage_text || ""), score: Number(x.score || 0) })) as PassageHit[];
    },
    async loadArticle(id) {
      if (!UUID.test(id)) return null;
      const r = await db.from("news_articles").select("id, source_name, source_url, headline, summary, category, importance_score, sentiment, layout_size, update_count, source_count, confidence_score, claim_digest, published_at, updated_at, is_pending_verification").eq("id", id).eq("is_pending_verification", false).maybeSingle();
      if (r.error || !r.data || !/^https?:\/\//i.test(String(r.data.source_url || ""))) return null;
      return r.data as Card;
    },
    async revisions(id) {
      const r = await db.from("news_article_revisions").select("revision_number, revision_type, headline, summary, published_at, captured_at").eq("article_id", id).order("revision_number", { ascending: true }).limit(8);
      return r.error || !Array.isArray(r.data) ? [] : r.data;
    },
    async alreadyBriefed(userId, articleId) {
      const r = await db.from("unlock_ledger").select("id").eq("user_id", userId).eq("event_type", "archive_briefing").eq("reference_id", articleId).limit(1);
      return !r.error && Array.isArray(r.data) && r.data.length > 0;
    },
    async charge(userId, ops, articleId, commit) {
      const r = await db.rpc("charge_archive_operations", { p_user_id: userId, p_operations: ops, p_article_id: articleId, p_commit: commit });
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (r.error || !row) return null;
      return { allowed: !!row.allowed, charged: !!row.charged, amount: Number(row.charged_amount || 0), remaining: Number(row.remaining_unlocks || 0), unlimited: !!row.unlimited, operations: row.operations || [] } as ChargeResult;
    },
    async chargeChat(userId, requestId) {
      const r = await db.rpc("consume_archive_chat_charge", { p_user_id: userId, p_request_id: requestId });
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (r.error || !row) return null;
      return { allowed: !!row.allowed, charged: !!row.charged, amount: Number(row.charged_amount || row.required_unlocks || 0), remaining: Number(row.remaining_unlocks || 0), unlimited: !!row.unlimited, operations: ["archive_chat"] } as ChargeResult;
    },
    // ---- independent article-text store (archive_reply_*): never touches ingestion tables
    async loadBody(id) {
      const r = await db.from("archive_reply_bodies").select("article_id, source_url, body_text, fetch_status, content_hash, fetched_at").eq("article_id", id).maybeSingle();
      return r.error ? null : (r.data as BodyRow | null);
    },
    async saveBody(row) {
      const r = await db.from("archive_reply_bodies").upsert({ ...row, fetched_at: new Date().toISOString() }, { onConflict: "article_id" });
      if (r.error) throw new Error("body_save_failed");
    },
    async loadPassages(id) {
      const r = await db.from("archive_reply_passages").select("article_id, passage_index, passage_text").eq("article_id", id).order("passage_index", { ascending: true });
      return r.error || !Array.isArray(r.data) ? [] : (r.data as PassageRow[]);
    },
    async replacePassages(id, rows) {
      const del = await db.from("archive_reply_passages").delete().eq("article_id", id);
      if (del.error) throw new Error("passages_delete_failed");
      if (!rows.length) return;
      const now = new Date().toISOString();
      const ins = await db.from("archive_reply_passages").insert(rows.map((r) => ({ article_id: id, passage_index: r.passage_index, passage_text: r.passage_text, embedding: r.embedding ? vec(r.embedding) : null, updated_at: now })));
      if (ins.error) throw new Error("passages_insert_failed");
    },
    async setPassageEmbedding(id, index, vector) {
      const r = await db.from("archive_reply_passages").update({ embedding: vec(vector), updated_at: new Date().toISOString() }).eq("article_id", id).eq("passage_index", index);
      if (r.error) throw new Error("embedding_save_failed");
    },
    async getMemory(userId) {
      const r = await db.from("archive_reply_memory").select("context_summary, approved_reply, active_article_id, search_query").eq("user_id", userId).maybeSingle();
      return r.error || !r.data ? null : (r.data as Memory);
    },
    async saveMemory(userId, m) {
      const r = await db.from("archive_reply_memory").upsert({ user_id: userId, context_summary: m.context_summary, approved_reply: m.approved_reply, active_article_id: m.active_article_id, search_query: m.search_query, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (r.error) throw new Error("memory_save_failed");
    },
  };
}
