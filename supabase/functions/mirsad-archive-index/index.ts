import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GEMINI_KEY = Deno.env.get("MARSAD_GEMINI_CORE_2026") || "";
const MODEL = "gemini-embedding-001";
const DIMENSIONS = 768;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function embedDocument(text: string): Promise<number[]> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: DIMENSIONS,
      content: { parts: [{ text }] },
    }),
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw new Error(`gemini_${response.status}`);
  const result = await response.json();
  const values = result?.embedding?.values;
  if (!Array.isArray(values) || values.length !== DIMENSIONS || values.some((value: unknown) => !Number.isFinite(Number(value)))) {
    throw new Error("invalid_embedding");
  }
  return values.map(Number);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "الطريقة غير مدعومة." }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !GEMINI_KEY) return json({ error: "خدمة الفهرسة غير مهيأة." }, 503);

  const bearer = req.headers.get("authorization") || "";
  const token = bearer.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "يلزم تسجيل الدخول بحساب إداري." }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user || authData.user.app_metadata?.role !== "news_admin") {
    return json({ error: "هذه العملية مخصصة للمشرفين فقط." }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* optional empty JSON body */ }
  const limit = Math.max(1, Math.min(10, Math.floor(Number(body.limit) || 5)));
  const { data: rows, error } = await admin.rpc("mirsad_archive_pending_embeddings", { p_limit: limit });
  if (error) return json({ error: "تعذر تحميل مجموعة الفهرسة." }, 503);

  let indexed = 0;
  const failures: string[] = [];
  for (const row of rows || []) {
    try {
      const content = [row.headline, row.summary, row.source_name, row.category].filter(Boolean).join("\n").slice(0, 6000);
      const vector = await embedDocument(content);
      const result = await admin.rpc("mirsad_archive_store_embedding", {
        p_article_id: row.article_id,
        p_content_fingerprint: row.content_fingerprint,
        p_embedding: `[${vector.join(",")}]`,
        p_model: MODEL,
      });
      if (result.error) throw new Error("vector_store_failed");
      indexed += 1;
    } catch (error) {
      failures.push(`${row.article_id}:${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  const remaining = await admin.rpc("mirsad_archive_pending_embeddings", { p_limit: 1 });
  return json({ indexed, failed: failures.length, has_more: Boolean(remaining.data?.length), failures: failures.slice(0, 3) }, 200);
});
