import { fetchHtml, publicUrl } from "./evidence.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("stored article fetch accepts public web URLs and rejects local targets", () => {
  assert(publicUrl("https://news.example/story") instanceof URL);
  assert(publicUrl("http://127.0.0.1/admin") === null);
  assert(publicUrl("http://10.0.0.5/private") === null);
  assert(publicUrl("file:///etc/passwd") === null);
});

Deno.test("article reader refuses a redirect from a public URL to loopback", async () => {
  let calls = 0;
  const fetchFn: typeof fetch = async () => {
    calls++;
    return new Response("", { status: 302, headers: { location: "http://127.0.0.1/private" } });
  };
  let message = "";
  try { await fetchHtml("https://news.example/story", fetchFn); } catch (error) { message = error instanceof Error ? error.message : ""; }
  assert(message === "blocked_redirect");
  assert(calls === 1, "the blocked redirect target must never be fetched");
});
