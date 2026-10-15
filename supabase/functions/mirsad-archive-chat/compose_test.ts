import { compose, MAX_ROUNDS, type ComposeArgs } from "./compose.ts";
import { type Gemini, type JsonOpts, type Mat, type Stage } from "./ai.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

const reply = "ربطت الحكومة بدء تنفيذ الخطة باستكمال المشاورات مع البلديات، ما يجعل المضي فيها متوقفًا على تلك الخطوة. ولا تذكر المادة موعدًا للتنفيذ.";
const mats: Mat[] = [{ ref: "A1", role: "primary", card: {
  headline: "الحكومة تعلن خطة نقل جديدة",
  summary: "أعلنت الحكومة خطة للنقل، وربطت التنفيذ بمشاورات البلديات.",
  source_name: "مصدر اختباري",
} }];

class FakeGemini implements Gemini {
  calls: Stage[] = [];
  constructor(private review: Record<string, unknown>, private independent = true) {}
  has(_stage: Stage) { return true; }
  hasIndependentKeys() { return this.independent; }
  async json(stage: Stage, _opts: JsonOpts): Promise<Record<string, unknown>> {
    this.calls.push(stage);
    if (stage === "nexus") return { reply, analysis: null, entities: [], used_refs: ["A1"] };
    return { reply, analysis: null, entities: [], used_refs: ["A1"], ...this.review };
  }
  async embed(_text: string) { return []; }
}

function args(): ComposeArgs {
  return { kind: "about_active_card", sub: "summarize", question: "لخّص الخبر", summary: "", turns: "", mats,
    lang: "ar", tone: "plain", wantAnalysis: false, cacheKey: "", deadlineAt: Date.now() + 60_000 };
}

Deno.test("CORE approval must be an explicit boolean true and roles never swap", async () => {
  const gemini = new FakeGemini({});
  const result = await compose(gemini, args());
  assert(!result.ok, "missing approved should never yield a publishable answer");
  assert(result.reason === "reviewer_rejected");
  assert(result.rounds === MAX_ROUNDS);
  assert(gemini.calls.join(",") === Array(MAX_ROUNDS).fill("nexus,core").join(","));
});

Deno.test("a reviewed reply with an explicit approval and source ref is accepted", async () => {
  const gemini = new FakeGemini({ approved: true });
  const result = await compose(gemini, args());
  assert(result.ok);
  assert(result.value.pipeline === "core+nexus");
  assert(result.value.refs.length === 1 && result.value.refs[0] === "A1");
  assert(gemini.calls.join(",") === "nexus,core");
});

Deno.test("an answer with no source reference fails deterministic verification", async () => {
  const gemini = new FakeGemini({ approved: true, used_refs: [] });
  // The draft also omits the reference so the old implicit A1 fallback cannot mask it.
  const json = gemini.json.bind(gemini);
  gemini.json = async (stage, opts) => {
    const result = await json(stage, opts);
    return { ...result, used_refs: [] };
  };
  const result = await compose(gemini, args());
  assert(!result.ok);
  assert(result.reason === "verification_failed");
});

Deno.test("composition refuses to claim independent review when keys are not distinct", async () => {
  const gemini = new FakeGemini({ approved: true }, false);
  const result = await compose(gemini, args());
  assert(!result.ok && result.reason === "missing_independent_keys");
  assert(gemini.calls.length === 0);
});


Deno.test("compose reports draft, review, and verification phases without changing approval flow", async () => {
  const seen: string[] = [];
  const gemini = new FakeGemini({ approved: true });
  const a = { ...args(), onStage: (stage: "draft" | "review" | "verify", round: number) => seen.push(`${stage}:${round}`) };
  const result = await compose(gemini, a);
  assert(result.ok);
  assert(seen.join(",") === "draft:1,review:1,verify:1", `unexpected phase order: ${seen.join(",")}`);
});
