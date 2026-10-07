import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GEMINI_KEY = Deno.env.get("MARSAD_GEMINI_CORE_2026") || "";
const MODEL = "gemini-embedding-001";
const DIMENSIONS = 3072;
const BATCH_SIZE = 8;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function embedBatch(rows: Array<Record<string, unknown>>): Promise<number[][]> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({
      requests: rows.map((row) => ({
        model: `models/${MODEL}`,
        content: {
          parts: [{
            text: [row.headline, row.summary, row.source_name, row.category]
              .filter(Boolean)
              .join("\n")
              .slice(0, 6000),
          }],
        },
        embedContentConfig: {
          taskType: "RETRIEVAL_DOCUMENT",
          outputDimensionality: DIMENSIONS,
        },
      })),
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`gemini_${response.status}`);
  const embeddings = data?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== rows.length) throw new Error("invalid_batch_embedding");
  return embeddings.map((item: Record<string, unknown>) => {
    const values = item?.values;
    if (!Array.isArray(values) || values.length !== DIMENSIONS || values.some((value: unknown) => !Number.isFinite(Number(value)))) {
      throw new Error("invalid_embedding");
    }
    return values.map(Number);
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة." }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !GEMINI_KEY) return json({ error: "خدمة الفهرسة غير مهيأة." }, 503);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const claim = await db.rpc("mirsad_archive_indexer_try_claim", { p_lease_seconds: 120 });
  if (claim.error) return json({ error: "تعذر حجز دورة الفهرسة." }, 503);
  if (claim.data !== true) return json({ status: "busy" }, 202);

  let indexed = 0;
  let failed = 0;
  let errorMessage = "";
  try {
    const pending = await db.rpc("mirsad_archive_pending_embeddings", { p_limit: BATCH_SIZE });
    if (pending.error) throw new Error("pending_rows_failed");
    const rows = (Array.isArray(pending.data) ? pending.data : []) as Record<string, unknown>[];
    if (!rows.length) {
      await db.rpc("mirsad_archive_indexer_finish", { p_indexed: 0, p_failed: 0, p_error: null });
      return json({ status: "idle", indexed: 0, failed: 0, has_more: false });
    }

    const vectors = await embedBatch(rows);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const stored = await db.rpc("mirsad_archive_store_embedding", {
        p_article_id: row.article_id,
        p_content_fingerprint: row.content_fingerprint,
        p_embedding: `[${vectors[i].join(",")}]`,
        p_model: MODEL,
      });
      if (stored.error || stored.data !== true) failed += 1;
      else indexed += 1;
    }
    if (failed > 0) errorMessage = "one_or_more_embeddings_not_stored";
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "index_batch_failed";
    failed = 1;
  }

  const finished = await db.rpc("mirsad_archive_indexer_finish", {
    p_indexed: indexed,
    p_failed: failed,
    p_error: errorMessage || null,
  });
  if (finished.error) return json({ error: "تعذر حفظ حالة الفهرسة." }, 503);

  const remaining = await db.rpc("mirsad_archive_pending_embeddings", { p_limit: 1 });
  return json({
    status: errorMessage ? "partial" : "ok",
    indexed,
    failed,
    has_more: Boolean(remaining.data?.length),
  });
});
