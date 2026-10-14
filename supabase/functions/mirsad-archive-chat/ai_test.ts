import { GeminiError, makeGemini, type JsonOpts } from "./ai.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("NEXUS JSON generation never falls back to the CORE key", async () => {
  const sentKeys: string[] = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    sentKeys.push(new Headers(init?.headers).get("x-goog-api-key") || "");
    return new Response(JSON.stringify({ error: { message: "API key not valid" } }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  };
  const gemini = makeGemini({ core: "core-test-secret", nexus: "nexus-test-secret" }, fetchFn);
  assert(gemini.has("core") && gemini.has("nexus") && gemini.hasIndependentKeys());
  const options: JsonOpts = { system: "test", user: "test", maxTokens: 20 };
  let caught: unknown;
  try { await gemini.json("nexus", options); } catch (error) { caught = error; }
  assert(caught instanceof GeminiError && caught.code === "auth_400");
  assert(sentKeys.length === 1, "the role must not call a second key after rejection");
  assert(sentKeys[0] === "nexus-test-secret", "NEXUS must use only its configured secret");
  let cooled: unknown;
  try { await gemini.json("nexus", options); } catch (error) { cooled = error; }
  assert(cooled instanceof GeminiError && cooled.code === "key_temporarily_rejected");
  assert(sentKeys.length === 1, "a rejected role key must be cooled down without trying the other role");
});

Deno.test("identical secrets are not reported as independent dialogue keys", () => {
  const gemini = makeGemini({ core: "same-test-secret", nexus: "same-test-secret" }, fetch);
  assert(!gemini.hasIndependentKeys());
  assert(gemini.has("core") && gemini.has("nexus"));
});
