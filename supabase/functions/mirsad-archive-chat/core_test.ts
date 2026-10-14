import { classify } from "./archive-logic.ts";
import { isCardKind, planForTask } from "./core.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("task buttons map deterministically without the CORE understanding call", () => {
  const mind = classify("لخّص");
  const summarize = planForTask("summarize", "لخّص", mind, "أخبار خطة النقل");
  assert(summarize?.kind === "about_active_card" && summarize.sub === "summarize");
  assert(summarize.queries[0] === "أخبار خطة النقل");
  assert(summarize.by === "rules");

  const entities = planForTask("entities", "الجهات المذكورة", classify("الجهات المذكورة"), "أخبار خطة النقل");
  assert(entities?.kind === "about_active_card" && entities.sub === "entities");
  assert(planForTask("related", "بطاقة مرتبطة", mind, "حدث سابق")?.kind === "related_card");
  assert(planForTask("another", "بطاقة أخرى", mind, "حدث سابق")?.kind === "another_card");
  assert(isCardKind("about_active_card", "chat"), "active-card tasks must keep analysis payloads enabled");
});

Deno.test("unrecognized task values cannot exploit object prototype properties", () => {
  const mind = classify("اختبار");
  assert(planForTask("toString", "سؤال", mind, "") === null);
  assert(planForTask({ type: "analyze" }, "سؤال", mind, "") === null);
});
