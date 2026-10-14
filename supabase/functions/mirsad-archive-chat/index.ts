import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { makeGemini } from "./ai.ts";
import { handleChat } from "./core.ts";
import { makeStore } from "./store.ts";

const U = Deno.env.get("SUPABASE_URL") || "";
const K = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Exact secret names, as stored in Supabase.
const CORE = Deno.env.get("MARSAD_GEMINI_CORE_2026") || "";
const NEXUS = Deno.env.get("MRSAD_COGNITIVE_DIALOGUE_NEXUS_2026") || "";
const EXAMPLE = Deno.env.get("MRSAD_GM2_26") || "";
console.log("archive-chat boot", { core_key: !!CORE, nexus_key: !!NEXUS, example_key: !!EXAMPLE, distinct_keys: !!CORE && !!NEXUS && CORE !== NEXUS });

const ORIGINS = new Set(["https://marsad.website", "https://www.marsad.website"]);
const ENC = new TextEncoder();
const db = U && K ? createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const gemini = makeGemini({ core: CORE, nexus: NEXUS, example: EXAMPLE });

Deno.serve((req: Request) => {
  if (!db) {
    return new Response(JSON.stringify({ error: "خدمة البحث غير مهيأة بعد." }), { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
  return handleChat(req, {
    store: makeStore(db), gemini, origins: ORIGINS,
    hash: async (v: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", ENC.encode(`${K}:${v}`)))].map((b) => b.toString(16).padStart(2, "0")).join(""),
  });
});
