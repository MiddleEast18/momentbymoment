export type Lang = "ar" | "en";
export type Tone = "casual" | "plain" | "polite";
export type Intent = "question" | "search" | "analysis" | "joke" | "greeting" | "ambiguous" | "followup";
export type Follow = "" | "summarize" | "analyze" | "entities" | "related" | "another";

export type Mind = {
  intent: Intent;
  follow: Follow;
  lang: Lang;
  tone: Tone;
  searchText: string;
};

export type Card = Record<string, unknown>;

export type Briefing = {
  event: string;
  context: string;
  result: string;
  proves: string;
  limits: string;
};

const FILLER = new Set([
  "ابحث", "بحث", "عن", "اخبار", "خبر", "الخبر", "المتعلق", "المتعلقة", "ما", "ماذا", "هو", "هي", "في", "من", "على", "هل", "حول",
  "اخر", "الجديد", "مؤخرا", "لي", "التي", "الذي", "هذا", "هذه", "ذلك", "تلك", "please", "the", "a", "an", "of", "about", "what",
  "whats", "who", "how", "why", "is", "are", "news", "latest", "اليوم", "امس", "الان", "جديد", "مستجد", "مستجدات", "العالم",
  "الوضع", "الاوضاع", "الاسبوع", "الماضي", "خلال", "حدث", "حدثني", "اخبرني", "قل", "قلي", "قول", "ابي", "ابغى", "بدي", "عندك",
  "فيه", "شي", "شيء", "عاجل", "update", "updates", "الى", "مع", "بعد", "قبل", "بين", "قصة", "موضوع", "تفاصيل", "معلومات",
  "تقرير", "مقال", "وقع", "يحدث", "صار", "حصل", "يوجد", "توجد", "كان", "كانت", "شو", "وش", "ليش", "وين", "اين", "متى", "كيف",
  "لماذا", "خلال", "اخر", "اخري", "جديد", "بطاقه", "اضافيه", "اعرض", "واحده", "التاليه", "مرتبط", "مرتبطه", "لخص",
  "حلل", "جهات", "مذكوره", "المذكوره", "related", "another", "card", "summarize", "analyze", "show", "one", "more", "next",
  "me", "some", "any", "هناك", "فيه", "عنها", "عنه", "لها", "له", "حق", "مال", "تبع", "لو", "اذا", "إن", "ان", "ثم", "قد",
  "وقد", "كما", "وذلك", "حيث", "تم", "يتم", "حتى", "نحو", "دون", "ضد", "عبر", "لدى", "عند", "اكثر", "مدينه", "عاصمه",
  "mentioned", "entities", "entity", "whos", "summarise",
  "اهلا", "اهلين", "هلا", "هلو", "مرحبا", "السلام", "سلام", "صباح", "مساء", "الخير", "النور", "كيفك", "شلونك",
  "hi", "hello", "hey", "thanks", "thank", "شكرا", "يسلمو", "تسلم", "تمام", "حلو", "ok", "okay", "بك", "رحمه", "بركاته",
  "لك", "you", "good", "morning", "evening", "عليكم", "ورحمه", "الله",
]);

const EVENTISH = new Set([
  "زلزال", "هزه", "حرب", "اتفاق", "اتفاقية", "اجتماع", "قمه", "اسعار", "نفط", "طاقه", "مباراه", "هدف", "قتل", "هجوم",
  "انفجار", "عقوبات", "انتخابات", "فيضان", "حريق", "اقتصاد", "اقتصادي", "سياسه", "سياسي", "احتجاج", "مظاهره", "صفقة",
  "صفقة", "هدنه", "قصف", "غاره", "محادثات", "زياره", "اعصار", "حادث", "تحطم", "استقاله", "تعيين", "ازمه", "عقوبه",
]);

const WEAK_ALONE = new Set([
  "حرب", "اقتصاد", "سياسه", "رياضه", "طاقه", "نفط", "عالم", "وضع", "ازمه", "اتفاق", "اجتماع", "اخبار", "حدث", "هجوم",
  "انفجار", "عقوبات", "زياره", "محادثات",
]);

export function sanitizeInline(value: unknown, max = 700) {
  let text = String(value ?? "");
  text = text.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&(?:#\d+|#x[\da-f]+|[a-z]{2,12});/gi, " ");
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  text = text.replace(/\b(ignore (?:all |any |previous |prior )?instructions|disregard (?:the |all )?rules|system prompt|you are now|jailbreak|تجاهل التعليمات|تجاهل الاوامر)\b/gi, " ");
  text = text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return text.slice(0, max);
}

export function fold(value: string) {
  return value.toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[؟?!.,،؛:()[\]{}"'`«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normToken(word: string) {
  const token = fold(word);
  return token.startsWith("ال") && token.length >= 5 ? token.slice(2) : token;
}

function isFiller(word: string) {
  const token = normToken(word);
  if (/^(ه{3,}|ha{2,}|lol+|lmao+)$/.test(token)) return true;
  return token.length < 2 || FILLER.has(token) || FILLER.has(fold(word)) || /^\d+$/.test(token);
}

export function distinctive(value: string) {
  const seen = new Set<string>();
  for (const part of fold(value).split(" ")) {
    const token = normToken(part);
    if (isFiller(token) || seen.has(token)) continue;
    seen.add(token);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

export function langOf(value: string): Lang {
  const ar = (value.match(/[\u0600-\u06FF]/g) || []).length;
  const en = (value.match(/[A-Za-z]/g) || []).length;
  return en > ar ? "en" : "ar";
}

export function toneOf(value: string): Tone {
  const text = fold(value);
  if (/(حضرتك|يرجى|نرجو|لو سمحت|please|kindly)/.test(text)) return "polite";
  if (/(هلا|هلو|كيفك|شلونك|شو |ليش|يا |هههه|lol|hey|hi|بدي|ابغى|يلا|والله)/.test(text)) return "casual";
  return "plain";
}

function escapeReg(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasToken(text: string, token: string) {
  if (!token || token.length < 2) return false;
  if (token.length <= 3) return new RegExp(`(?:^|\\s)${escapeReg(token)}(?:\\s|$)`).test(text);
  return text.includes(token);
}

function forms(word: string) {
  const token = normToken(word);
  const found = new Set<string>([token]);
  if (/^[بلف]/.test(token) && token.length >= 6) found.add(normToken(token.slice(1)));
  return [...found].filter((item) => item.length >= 2);
}

function hits(text: string, word: string) {
  return forms(word).some((form) => hasToken(text, form));
}

function affirmed(text: string, word: string) {
  return forms(word).some((form) => {
    if (!hasToken(text, form)) return false;
    const denied = new RegExp(`لم\\s+(?:يذكر|يورد|يتناول|يشر|يحدث)\\s+\\S{0,12}${escapeReg(form)}`).test(text);
    const elsewhere = text.replace(new RegExp(`لم\\s+(?:يذكر|يورد|يتناول|يشر|يحدث)\\s+\\S{0,12}${escapeReg(form)}`, "g"), " ");
    return !denied || hasToken(elsewhere, form);
  });
}

export function classify(raw: string): Mind {
  const text = sanitizeInline(raw, 500);
  const lang = langOf(text);
  const tone = toneOf(text);
  const folded = fold(text);
  const keys = distinctive(text);
  const base = { lang, tone, searchText: keys.join(" "), follow: "" as Follow };

  const letters = text.match(/\p{L}/gu) || [];
  const compact = text.replace(/\s+/g, "");
  const vowelCount = (compact.match(/[aeiou]/gi) || []).length;
  const latinMash = /^[a-z]+$/i.test(compact) && compact.length >= 6 && vowelCount <= 1;
  const gibberish = letters.length < 2 || latinMash || (/(.)\1{5,}/u.test(compact) && keys.length === 0);
  if (gibberish) return { ...base, intent: "ambiguous", searchText: "" };

  const greetingLead = /^(?:اهلا|اهلين|هلا|هلو|مرحبا|السلام|سلام|صباح الخير|مساء الخير|صباح النور|مساء النور|كيفك|كيف حالك|شلونك|hi|hello|hey|good morning|good evening|thanks|thank you|شكرا|شكرا لك|يسلمو|تمام|حلو|ok|okay)(?:\s|$)/.test(folded);
  if (greetingLead && keys.length === 0) return { ...base, intent: "greeting", searchText: "" };

  if (/(نكت|طرفه|اضحك|joke|مزح|تستهبل)/.test(folded)) return { ...base, intent: "joke", searchText: "" };
  if (/(ههه+|hahaha|\blol\b|\blmao\b)/.test(folded) && keys.length === 0) return { ...base, intent: "joke", searchText: "" };

  const follow = followOf(folded, keys);
  if (follow === "analyze") return { ...base, intent: "analysis", follow, searchText: "" };
  if (follow) return { ...base, intent: "followup", follow, searchText: "" };

  if (!keys.length || (keys.length === 1 && WEAK_ALONE.has(keys[0]))) {
    return { ...base, intent: "ambiguous", searchText: "" };
  }

  const question = /[?؟]/.test(text) || /(هل|لماذا|ليش|كيف|متى|ماذا|why|how|what|when|who)\b/.test(folded);
  return { ...base, intent: question ? "question" : "search" };
}

function followOf(folded: string, keys: string[]): Follow {
  const extra = keys.filter((word) => !["لخص", "حلل", "جهات", "مذكوره", "بطاقه", "مرتبطه", "اخري"].includes(word));
  if (extra.length) return "";
  if (folded.length <= 56 && /(بطاقه (اخري|اضافيه)|خبر (اخر|ثاني)|اعرض (لي )?(واحده |بطاقه )?(اخري|اضافيه)|another card|one more|show another|next card)/.test(folded)) return "another";
  if (folded.length <= 42 && /(بطاقه مرتبط|خبر مرتبط|related card|^related$)/.test(folded)) return "related";
  if (folded.length <= 28 && /(^لخص|لخصها|لخصلي|summarize|summary|sum up)/.test(folded)) return "summarize";
  if (folded.length <= 28 && /(^حلل|حللها|تحليل|analyze|analysis)/.test(folded)) return "analyze";
  if (folded.length <= 48 && /(المذكوره|الاطراف المذكوره|mentioned entit|who is mentioned|whos mentioned)/.test(folded)) return "entities";
  return "";
}

export type Rank = { id: string; score: number; pass: boolean; published: string };

export function scoreCard(query: string, card: Card): Rank {
  const specific = distinctive(query);
  const names = specific.filter((word) => !EVENTISH.has(word) && word.length >= 4);
  const events = specific.filter((word) => EVENTISH.has(word));
  const primary = [...specific].sort((a, b) => b.length - a.length)[0] || "";
  const title = fold(sanitizeInline(card.headline, 400));
  const summary = fold(sanitizeInline(card.summary, 900));
  const blob = `${title} ${summary}`;
  const hit = (word: string) => affirmed(blob, word);
  const inTitle = (word: string) => affirmed(title, word);
  const specificHit = specific.filter(hit);
  let pass = false;
  if (specific.length === 1) pass = hit(specific[0]);
  else if (names.length) {
    const namesOk = names.every(hit);
    const eventsOk = !events.length || events.some(hit);
    pass = namesOk && eventsOk && specificHit.length >= Math.min(2, specific.length);
  } else {
    pass = !!primary && hit(primary) && specificHit.length >= Math.min(2, specific.length);
  }
  if (specific.length >= 3 && specificHit.length < 2) pass = false;
  if (specific.length >= 2 && specificHit.length < 2) pass = false;

  let score = 0;
  if (primary && inTitle(primary)) score += 12;
  else if (primary && hit(primary)) score += 7;
  for (const word of specific) {
    if (word === primary) continue;
    if (inTitle(word)) score += 4;
    else if (hit(word)) score += 2;
  }
  const years = fold(query).match(/20\d{2}/g) || [];
  const published = String(card.published_at || "");
  if (years.some((year) => published.startsWith(year))) score += 3;
  if (!pass) score = Math.min(score, 3);
  return { id: String(card.id || ""), score, pass, published };
}

export function rankCards(query: string, cards: Card[], exclude: Set<string>) {
  return cards
    .map((card) => ({ card, rank: scoreCard(query, card) }))
    .filter((item) => item.rank.pass && item.rank.id && !exclude.has(item.rank.id))
    .sort((a, b) => b.rank.score - a.rank.score || b.rank.published.localeCompare(a.rank.published) || a.rank.id.localeCompare(b.rank.id));
}

export function bestCard(query: string, cards: Card[], exclude: Set<string>) {
  return rankCards(query, cards, exclude)[0]?.card || null;
}

export function relatedCards(anchor: string, cards: Card[], exclude: Set<string>) {
  const name = normToken(anchor);
  if (name.length < 3) return [];
  return cards
    .map((card) => {
      const title = fold(sanitizeInline(card.headline, 400));
      const summary = fold(sanitizeInline(card.summary, 900));
      const id = String(card.id || "");
      const inTitle = hits(title, name);
      const inSummary = hits(summary, name);
      return { card, id, score: inTitle ? 10 : inSummary ? 6 : 0, published: String(card.published_at || "") };
    })
    .filter((item) => item.score > 0 && item.id && !exclude.has(item.id))
    .sort((a, b) => b.score - a.score || b.published.localeCompare(a.published));
}

export function suggestions(lang: Lang) {
  return lang === "en"
    ? ["Summarize", "Analyze", "Who is mentioned", "Related card", "Another card"]
    : ["لخّص", "حلّل", "الجهات المذكورة", "بطاقة مرتبطة", "بطاقة أخرى"];
}

export function say(lang: Lang, tone: Tone, key: string) {
  const ar: Record<string, Record<Tone, string>> = {
    greeting: {
      casual: "هلا. اكتب الاسم أو المكان، وإذا في خبر مطابق بطلعه لك.",
      plain: "أهلًا. اكتب الشخص أو المكان أو الحدث الذي تريده.",
      polite: "أهلًا بك. اكتب اسم الشخص أو المكان أو الحدث، من فضلك.",
    },
    joke: {
      casual: "هههه مزبوط، بس هون أرشيف أخبار مو مسرح. إذا تبي خبر، اكتب الاسم.",
      plain: "أفهم المزحة. البحث الإخباري يبدأ لما تكتب شخصًا أو مكانًا أو حدثًا.",
      polite: "سعيد بالنكتة. عندما تريد خبرًا، اكتب الشخص أو المكان أو الحدث.",
    },
    vague: {
      casual: "ما فهمت القصد. وضّح الاسم أو المكان أو الحدث.",
      plain: "الطلب غير واضح. حدّد الشخص أو المكان أو الحدث.",
      polite: "لم أتبين المقصود. حدّد الشخص أو المكان أو الحدث، من فضلك.",
    },
    none: {
      casual: "ما في تطابق قوي بهالاسم. وضّح الشخص أو المكان أو التاريخ أكثر.",
      plain: "لا يوجد تطابق قوي. حدّد الشخص أو المكان أو الحدث بشكل أوضح.",
      polite: "لم أجد تطابقًا قويًا. حدّد الشخص أو المكان أو الحدث بصورة أوضح.",
    },
    noCard: {
      casual: "ما في بطاقة ظاهرة الحين. اكتب الخبر أو الاسم أول.",
      plain: "لا توجد بطاقة حالية. ابدأ باسم الشخص أو المكان أو الحدث.",
      polite: "لا توجد بطاقة معروضة حاليًا. ابدأ بالشخص أو المكان أو الحدث.",
    },
    noNext: {
      casual: "خلصت البطاقات المطابقة بهالبحث. ما في بطاقة جديدة من دون تكرار.",
      plain: "لا توجد بطاقة مطابقة أخرى ضمن هذا البحث من غير تكرار.",
      polite: "لا تتوفر بطاقة مطابقة إضافية ضمن البحث نفسه من غير تكرار.",
    },
    noRelated: {
      casual: "ما لقيت بطاقة مرتبطة بوضوح بنفس الاسم.",
      plain: "لا توجد بطاقة مرتبطة يظهر فيها الاسم نفسه بوضوح.",
      polite: "لم أجد بطاقة مرتبطة يظهر فيها الاسم نفسه بوضوح.",
    },
    lead: {
      casual: "هاي أقرب بطاقة، والشرح تحت مأخوذ من نصها فقط.",
      plain: "هذه أقرب بطاقة مطابقة. الشرح بعدها مأخوذ من نصها فقط.",
      polite: "هذه أقرب بطاقة مطابقة. الشرح التالي مقتصر على نصها.",
    },
    anotherLead: {
      casual: "بطاقة ثانية من نفس البحث، من غير البطاقات اللي ظهرت.",
      plain: "بطاقة أخرى من سياق البحث السابق، مع استبعاد ما عُرض.",
      polite: "هذه بطاقة إضافية من البحث السابق، بعد استبعاد المعروض.",
    },
    relatedLead: {
      casual: "بطاقة مرتبطة بنفس الاسم، ومو تكرار للمعروض.",
      plain: "بطاقة مرتبطة يظهر فيها الاسم نفسه، وليست تكرارًا لما عُرض.",
      polite: "هذه بطاقة مرتبطة بالاسم نفسه، وليست تكرارًا للمعروض.",
    },
  };
  const en: Record<string, string> = {
    greeting: tone === "casual" ? "Hey. Give me a name, place, or event." : "Hello. Tell me the person, place, or event.",
    joke: tone === "casual" ? "Ha. This is a news archive, not a comedy set. Drop a name if you want a story." : "I caught the joke. A news lookup starts when you name a person, place, or event.",
    vague: "I didn't catch that. Name a person, place, or event.",
    none: "No strong match. Say the person, place, or event more clearly.",
    noCard: "There's no card on the table yet. Start with a name, place, or event.",
    noNext: "No other matching card in this search without repeating one.",
    noRelated: "No related card clearly carries the same name.",
    lead: "Closest matching card. The note under it uses only that card's text.",
    anotherLead: "Another card from the same search, skipping what you already saw.",
    relatedLead: "A related card with the same name, not a repeat.",
  };
  if (lang === "en") return en[key] || en.vague;
  return ar[key]?.[tone] || ar[key]?.plain || ar.vague.plain;
}

export function publishedLabel(value: unknown, lang: Lang) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ar", {
    dateStyle: "medium",
    timeZone: "Asia/Riyadh",
  }).format(date);
}

export function briefingFor(card: Card, lang: Lang): Briefing {
  const headline = sanitizeInline(card.headline, 280) || (lang === "en" ? "Untitled card" : "بطاقة بلا عنوان");
  const summary = sanitizeInline(card.summary, 700);
  const source = sanitizeInline(card.source_name, 80);
  const date = publishedLabel(card.published_at, lang);
  const contextBits = [
    lang === "en"
      ? "People and place are only those literally written in the headline or summary."
      : "الأطراف والمكان هم المذكورون حرفيًا في العنوان أو الملخص فقط.",
  ];
  if (date) contextBits.push(lang === "en" ? `Card publication date: ${date}.` : `تاريخ نشر البطاقة: ${date}.`);
  if (source) contextBits.push(lang === "en" ? `Source name on the card: ${source}.` : `اسم المصدر على البطاقة: ${source}.`);
  return {
    event: headline,
    context: contextBits.join(" "),
    result: summary || (lang === "en" ? "The card states no result beyond the headline." : "لا نتيجة مكتوبة أبعد من العنوان."),
    proves: lang === "en"
      ? "It shows only the wording in the headline and summary above."
      : "يثبت فقط الصياغة المكتوبة في العنوان والملخص أعلاه.",
    limits: lang === "en"
      ? "It does not prove motives, numbers, causes, or later outcomes that are not written there."
      : "لا يثبت دوافع أو أرقامًا أو أسبابًا أو نتائج لاحقة غير مكتوبة هناك.",
  };
}

export function summarizeCard(card: Card, lang: Lang) {
  const headline = sanitizeInline(card.headline, 280);
  const summary = sanitizeInline(card.summary, 420);
  if (lang === "en") return [headline, summary].filter(Boolean).join("\n\n") || "This card has no text to summarize.";
  return [headline, summary].filter(Boolean).join("\n\n") || "لا نص في هذه البطاقة لألخصه.";
}

export function analyzeCard(card: Card, lang: Lang, tone: Tone) {
  const headline = sanitizeInline(card.headline, 280);
  const summary = sanitizeInline(card.summary, 500);
  if (lang === "en") {
    return [
      "Reading only the text on this card:",
      headline ? `The headline says: ${headline}` : "The headline is empty.",
      summary ? `The summary adds: ${summary}` : "There is no summary beyond the headline.",
      "Anything not written there — cause, scale, or what happened next — stays unproven.",
    ].join("\n");
  }
  const lead = tone === "casual" ? "قراءة سريعة لنص البطاقة نفسها، من دون زيادة:" : "قراءة لنص هذه البطاقة فقط:";
  return [
    lead,
    headline ? `العنوان يقول: ${headline}` : "العنوان فارغ.",
    summary ? `الملخص يضيف: ${summary}` : "لا ملخص أبعد من العنوان.",
    "ما لم يُكتب هنا من سبب أو حجم أو ما حدث بعد ذلك يبقى غير مثبت.",
  ].join("\n");
}

export function entitiesOf(card: Card, lang: Lang) {
  const pool = distinctive(`${sanitizeInline(card.headline, 300)} ${sanitizeInline(card.summary, 700)}`);
  const names = pool.filter((word) => !EVENTISH.has(word) && word.length >= 4).slice(0, 8);
  if (!names.length) {
    return lang === "en"
      ? "The card text does not isolate a clear named party beyond the headline wording."
      : "نص البطاقة لا يفرز جهة باسم واضح أبعد من صياغة العنوان.";
  }
  const list = names.join(lang === "en" ? ", " : "، ");
  return lang === "en"
    ? `Words on this card that look like names or places, and nothing added: ${list}.`
    : `ألفاظ ظاهرة في نص البطاقة فقط، وقد تكون أسماء أو أماكن: ${list}.`;
}

export function anchorName(card: Card, previousQuery: string) {
  const fromQuery = distinctive(previousQuery).filter((word) => !EVENTISH.has(word) && word.length >= 4);
  if (fromQuery.length) return [...fromQuery].sort((a, b) => b.length - a.length)[0];
  const fromCard = distinctive(sanitizeInline(card.headline, 300)).filter((word) => word.length >= 4);
  return fromCard[0] || "";
}

export function publicCard(card: Card) {
  const url = String(card.source_url || "");
  let sourceUrl = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") sourceUrl = parsed.href;
  } catch { /* drop unsafe urls */ }
  let claim = "";
  const digest = card.claim_digest;
  if (typeof digest === "string") claim = sanitizeInline(digest, 240);
  else if (digest && typeof digest === "object" && "main_claim" in digest) claim = sanitizeInline((digest as { main_claim?: unknown }).main_claim, 240);
  return {
    id: String(card.id || ""),
    source_name: sanitizeInline(card.source_name, 80),
    source_url: sourceUrl,
    headline: sanitizeInline(card.headline, 280),
    summary: sanitizeInline(card.summary, 700),
    category: sanitizeInline(card.category, 40),
    importance_score: Number(card.importance_score || 0),
    sentiment: sanitizeInline(card.sentiment, 24),
    layout_size: sanitizeInline(card.layout_size, 16),
    update_count: Number(card.update_count || 0),
    source_count: Number(card.source_count || 0),
    confidence_score: Number(card.confidence_score || 0),
    claim_digest: claim ? { main_claim: claim } : null,
    published_at: sanitizeInline(card.published_at, 40),
  };
}
