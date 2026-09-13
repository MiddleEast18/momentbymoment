import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MIRSAD_API_URL = "https://nasdabcwexcdgpwjoslo.supabase.co/functions/v1/article-analysis-api";
const MIRSAD_API_KEY = Deno.env.get("MIRSAD_API_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing Supabase environment variables");

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ok:false,error:"Method not allowed"},405);
  if (!MIRSAD_API_KEY) return json({ok:false,error:"MIRSAD_API_KEY is not configured"},503);

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const externalId = String(url.searchParams.get("external_id") ?? "").trim();
      if (!externalId) return json({ok:false,error:"external_id is required"},400);

      const response = await fetch(
        MIRSAD_API_URL + "?external_id=" + encodeURIComponent(externalId),
        { headers: { accept:"application/json", authorization:"Bearer " + MIRSAD_API_KEY } }
      );
      const result = await response.json().catch(() => ({}));
      return json(result, response.ok ? 200 : 502);
    }

    const body = await req.json();
    const article = body?.article ?? body;
    const externalId = String(article?.external_id ?? article?.id ?? "").trim();
    const headline = String(article?.headline ?? "").trim();
    const content = String(article?.content ?? article?.body ?? article?.summary ?? "").trim();

    if (!externalId || !headline || !content) {
      return json({ok:false,error:"external_id, headline and content are required"},400);
    }

    const response = await fetch(MIRSAD_API_URL, {
      method:"POST",
      headers:{
        "content-type":"application/json",
        authorization:"Bearer " + MIRSAD_API_KEY
      },
      body:JSON.stringify({
        external_id:externalId,
        headline,
        content,
        source_name:String(article?.source_name ?? "").trim(),
        source_url:String(article?.source_url ?? "").trim(),
        category:article?.category ?? null,
        published_at:article?.published_at ?? null
      })
    });

    const result = await response.json().catch(() => ({}));
    return json(result, response.ok ? 200 : 502);
  } catch (error) {
    return json({ok:false,error:error instanceof Error ? error.message : String(error)},500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers:{...corsHeaders,"content-type":"application/json; charset=utf-8"}
  });
}