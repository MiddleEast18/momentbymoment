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

export function asksYesNo(value: string) {
  const folded = fold(value);
  return /^(?:هل)(?:\s|$)/.test(folded) || /^(?:is|are|did|was|were|do|does|has|have)\b/.test(folded);
}

export function sameTopic(left: string, right: string) {
  const words = distinctive(left);
  const other = new Set(distinctive(right));
  if (!words.length || !other.size) return false;
  const hit = words.filter((word) => other.has(word)).length;
  return hit >= Math.min(words.length, other.size);
}

export function hasToken(text: string, token: string) {
  if (!token || token.length < 2) return false;
  if (token.length <= 3) return new RegExp(`(?:^|\\s)${escapeReg(token)}(?:\\s|$)`).test(text);
  return text.includes(token);
}

function partyWord(word: string) {
  const token = normToken(word);
  const bare = /^[وفبل]/.test(token) && token.length >= 6 ? token.slice(1) : token;
  if (token.length < 4 || EVENTISH.has(token) || EVENTISH.has(bare)) return false;
  const blocked = /^(وقع|وقعت|ضرب|يضرب|اثار|اثارت|قال|قالت|اعلن|اعلنت|ذكر|ذكرت|شمل|تشمل|نقل|نقلت|اكد|اكدت|ارض|ارضيه|هزه|حكوم|مدن|متضرر|خطه|اعمار|جديد|كبير|قوي)$/;
  return !blocked.test(token) && !blocked.test(bare);
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

  if (/(نكت|طرفه|اضحك|joke|مزح|تستهبل)/.test(folded)) {
    const jokeWords = new Set(["نكت", "نكته", "طرفه", "اضحك", "joke", "مزح", "تستهبل"]);
    return { ...base, intent: "joke", searchText: keys.filter((word) => !jokeWords.has(word)).join(" ") };
  }
  if (/(ههه+|hahaha|\blol\b|\blmao\b)/.test(folded) && keys.length === 0) return { ...base, intent: "joke", searchText: "" };

  const follow = followOf(folded, keys);
  if (follow === "analyze") return { ...base, intent: "analysis", follow, searchText: "" };
  if (follow) return { ...base, intent: "followup", follow, searchText: "" };

  if (!keys.length || (keys.length === 1 && WEAK_ALONE.has(keys[0]))) {
    return { ...base, intent: "ambiguous", searchText: "" };
  }

  const question = /[?؟]/.test(text) || asksYesNo(text) || /(?:^|\s)(?:لماذا|ليش|كيف|متى|ماذا|why|how|what|when|who)(?:\s|$)/.test(folded);
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

export function bestCard(query: string, cards: Card[], exclude: Set<string>, salt = 0) {
  const ranked = rankCards(query, cards, exclude);
  if (!ranked.length) return null;
  const top = ranked[0].rank.score;
  const ties = ranked.filter((item) => item.rank.score === top);
  const index = ties.length ? Math.abs(salt) % ties.length : 0;
  return ties[index]?.card || null;
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

export function pickLine(options: string[], seed: string, previous: string[] = []) {
  const unique = [...new Set(options.map((item) => item.replace(/\s+/g, " ").trim()).filter((item) => item.length > 1))];
  if (!unique.length) return "";
  const prior = new Set(previous.map((item) => fold(item)));
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  const start = (hash >>> 0) % unique.length;
  for (let index = 0; index < unique.length; index += 1) {
    const line = unique[(start + index) % unique.length];
    if (!prior.has(fold(line))) return line;
  }
  return unique[start];
}

export function suggestions(lang: Lang) {
  return lang === "en"
    ? ["Summarize", "Analyze", "Who is mentioned", "Related card", "Another card"]
    : ["لخّص", "حلّل", "الجهات المذكورة", "بطاقة مرتبطة", "بطاقة أخرى"];
}

export function say(lang: Lang, tone: Tone, key: string, seed = "", previous: string[] = []) {
  const ar: Record<string, Record<Tone, string[]>> = {
    greeting: {
      casual: [
        "هلا. اكتب اسم الشخص أو المدينة وبشوف لك الخبر.",
        "يا هلا. عطني الاسم أو المكان مباشرة.",
        "أهلين. مين أو وين تدور؟",
      ],
      plain: [
        "أهلًا. اكتب الشخص أو المكان أو الحدث.",
        "مرحبًا. أعطني الاسم أو المدينة لأبحث.",
        "أهلًا بك. أي خبر تريده؟ اكتب الطرف أو المكان.",
      ],
      polite: [
        "أهلًا بك. اكتب اسم الشخص أو المكان، من فضلك.",
        "مرحبًا. لو سمحت حدّد الشخص أو المدينة أو الحدث.",
        "أهلًا. يسعدني أبحث عندما تكتب الاسم أو المكان.",
      ],
    },
    joke: {
      casual: [
        "هههه تمام. إذا تبي خبر حقيقي، اكتب الاسم من دون نكتة.",
        "ضحكت. الأخبار هنا ما تتألف، عطني شخص أو مكان.",
        "حلوة. خلّ النكتة ورا، واكتب مين تقصد.",
      ],
      plain: [
        "أفهم المزحة. اكتب شخصًا أو مكانًا إذا تريد خبرًا من الأرشيف.",
        "ما راح أؤلف نكتة مكان الخبر. حدّد الاسم أو المدينة.",
        "المزحة وصلت. البحث يبدأ باسم شخص أو مكان أو حدث.",
      ],
      polite: [
        "سعيد بالنكتة. عندما تريد خبرًا، اكتب الشخص أو المكان.",
        "أقدّر المزحة. للبحث، أحتاج اسم الشخص أو المدينة.",
        "شكرًا للنكتة. الخبر يحتاج شخصًا أو مكانًا أو حدثًا.",
      ],
    },
    noCard: {
      casual: [
        "ما في بطاقة قدامك. اكتب الاسم أو المدينة أول.",
        "لسا ما اخترنا خبر. عطني الشخص أو المكان.",
        "ابدأ بالاسم، وبعدين أقدر ألخص أو أجيب بطاقة ثانية.",
      ],
      plain: [
        "لا توجد بطاقة حالية. ابدأ باسم الشخص أو المكان.",
        "ما في خبر معروض. اكتب الحدث أو المدينة أولًا.",
        "أظهر خبرًا أولًا، ثم اطلب التلخيص أو بطاقة أخرى.",
      ],
      polite: [
        "لا توجد بطاقة معروضة. ابدأ بالشخص أو المكان، من فضلك.",
        "لم تُعرض بطاقة بعد. اكتب الاسم أو المدينة أولًا.",
        "بعد عرض خبر، أستطيع تلخيصه أو إحضار غيره.",
      ],
    },
    noNext: {
      casual: [
        "خلصت البطاقات القوية بهالبحث. ما بكرر اللي طلع.",
        "ما في خبر جديد بنفس القوة. غيّر الاسم أو المدينة.",
        "عرضت المتاح المطابق. إذا عندك طرف ثاني اكتبه.",
      ],
      plain: [
        "لا توجد بطاقة مطابقة أخرى من غير تكرار.",
        "انتهت النتائج القوية لهذا البحث. جرّب اسمًا أدق.",
        "ما بقي خبر يجمع نفس الكلمات ولم يُعرض.",
      ],
      polite: [
        "لا تتوفر بطاقة إضافية مطابقة من غير تكرار.",
        "عُرضت البطاقات القوية لهذا الطلب. يمكن تضييق الاسم.",
        "لم يبقَ خبر أوضح ضمن البحث نفسه.",
      ],
    },
    noRelated: {
      casual: [
        "ما لقيت خبرًا ثانيًا يظهر فيه نفس الاسم.",
        "الاسم هذا ما تكرر في بطاقة ثانية واضحة.",
        "ما في ارتباط ظاهر بنفس الاسم خارج اللي شفته.",
      ],
      plain: [
        "لا توجد بطاقة أخرى يظهر فيها الاسم نفسه بوضوح.",
        "لم يتكرر الاسم في خبر ثانٍ مطابق.",
        "ما وجدت ارتباطًا أوضح من البطاقة الحالية.",
      ],
      polite: [
        "لم أجد بطاقة أخرى تحمل الاسم نفسه بوضوح.",
        "لا يوجد خبر مرتبط يظهر فيه نفس الاسم.",
        "انتهى ما يتصل بهذا الاسم من غير تكرار.",
      ],
    },
  };
  const en: Record<string, string[]> = {
    greeting: tone === "casual"
      ? ["Hey. Give me a name or a city.", "Hi. Who or where should I look up?", "Hello. Drop a person, place, or event."]
      : ["Hello. Tell me the person, place, or event.", "Welcome. Name a person or a city and I'll look.", "Hello. Which story do you want?"],
    joke: tone === "casual"
      ? ["Ha. I won't invent a joke in place of a story. Give me a name.", "Funny. This desk only has published cards. Who do you mean?", "Nice one. Ask again with a person or a place if you want the story."]
      : ["I caught the joke. A lookup needs a person, place, or event.", "I won't make up a punchline as news. Name someone or somewhere.", "Understood. Tell me who or where when you want an actual card."],
    noCard: ["There's no card yet. Start with a name or a city.", "Show me a person or a place first.", "I need a story on the table before I can go further."],
    noNext: ["No other strong card in this search.", "That's the matching set. Try a sharper name.", "Nothing new matches without repeating a card."],
    noRelated: ["No other card clearly carries the same name.", "That name doesn't show up in a second story.", "I didn't find a related card beyond this one."],
  };
  if (lang === "en") return pickLine(en[key] || en.greeting, seed || key, previous);
  const toneLines = ar[key]?.[tone] || ar[key]?.plain || ar.greeting.plain;
  return pickLine(toneLines, seed || `${key}:${tone}`, previous);
}

export function vagueReply(lang: Lang, tone: Tone, raw: string, seed = "", previous: string[] = []) {
  const word = distinctive(raw)[0] || "";
  if (lang === "en") {
    const lines = word
      ? [`"${word}" is too broad. Which person or place?`, `I need more than "${word}". Add a city or a name.`, `Which "${word}"? Tell me where or who.`]
      : ["I didn't catch that. Name a person, place, or event.", "Say that again with a name or a city.", "That isn't a lookup yet. Who or where?"];
    return pickLine(tone === "polite" ? lines.map((line) => `Please: ${line}`) : lines, seed || raw, previous);
  }
  const lines = word
    ? [
      `«${word}» لوحدها واسعة. أي بلد أو أي شخص تقصد؟`,
      `وضّح «${word}»: وين، أو مين الطرف؟`,
      `أحتاج غير كلمة «${word}». اكتب المكان أو الاسم.`,
    ]
    : [
      "ما فهمت القصد. اكتب اسم شخص أو مدينة أو حدث.",
      "الجملة ما فيها طرف واضح. مين أو وين؟",
      "صغها باسم أو مكان حتى أقدر أبحث.",
    ];
  if (tone === "casual" && word) lines[0] = `«${word}» كثير واسعة. قولي وين أو مين.`;
  if (tone === "polite" && word) lines[0] = `«${word}» وحدها لا تكفي. حدّد البلد أو الشخص، من فضلك.`;
  return pickLine(lines, seed || raw, previous);
}

export function missReply(lang: Lang, tone: Tone, query: string, seed = "", previous: string[] = []) {
  const q = sanitizeInline(query, 60) || (lang === "en" ? "that" : "هذا الطلب");
  if (lang === "en") {
    return pickLine([
      `Nothing strong matches "${q}". Try the full name or add the city.`,
      `I couldn't pin "${q}" to one card. Add a place or a year.`,
      `"${q}" doesn't sit together in a single story here. Rephrase the person or the place.`,
    ], seed || q, previous);
  }
  const lines = [
    `ما في خبر يجمع «${q}» بوضوح. اكتب الاسم كامل أو أضف المكان.`,
    `على «${q}» ما لقيت تطابقًا قويًا. جرّب المدينة أو السنة.`,
    `كلمات «${q}» ما اجتمعت في بطاقة واحدة. غيّر الاسم أو المكان.`,
  ];
  if (tone === "casual") lines[1] = `ما لقيت شي قوي على «${q}». حط المدينة أو اسم العائلة.`;
  if (tone === "polite") lines[0] = `لم أجد خبرًا يجمع «${q}» بوضوح. جرّب الاسم الكامل أو المدينة.`;
  return pickLine(lines, seed || q, previous);
}

export function jokeReply(lang: Lang, tone: Tone, leftover: string, seed = "", previous: string[] = []) {
  const name = sanitizeInline(leftover, 40);
  if (!name) return say(lang, tone, "joke", seed, previous);
  if (lang === "en") {
    return pickLine([
      `I won't invent a joke about ${name}. Ask with the name alone if you want the story.`,
      `${name} stays a news lookup, not a punchline. Drop the joke word and I'll search.`,
      `No made-up joke about ${name}. Send the name again when you want a real card.`,
    ], seed || name, previous);
  }
  const lines = [
    `ما راح ألف نكتة عن ${name}. اكتب الاسم لحاله إذا تبي الخبر.`,
    `${name} دوري أجيب خبره، مو أختلق طرفة. أعد الاسم بدون كلمة نكتة.`,
    `عن ${name} ما عندي إلا بطاقات منشورة. احذف النكتة وأعد الطلب.`,
  ];
  if (tone === "polite") lines[0] = `لن أؤلف نكتة عن ${name}. أعد الاسم وحده إذا أردت الخبر.`;
  return pickLine(lines, seed || name, previous);
}

export function publishedLabel(value: unknown, lang: Lang) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Riyadh" }).formatToParts(date);
  const day = String(Number(parts.find((part) => part.type === "day")?.value || 0));
  const month = Number(parts.find((part) => part.type === "month")?.value || 0);
  const year = parts.find((part) => part.type === "year")?.value || "";
  if (!Number(day) || !month || !year) return "";
  if (lang === "en") {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${day} ${months[month - 1]} ${year}`;
  }
  const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  return `${day} ${months[month - 1]} ${year}`;
}

function spoken(bits: string[]) {
  return bits.filter(Boolean).map((bit) => /[.!?؟]$/.test(bit) ? bit : `${bit}.`).join(" ");
}

function factBits(card: Card) {
  const headline = sanitizeInline(card.headline, 240);
  const summary = sanitizeInline(card.summary, 520);
  const pieces = [...summary.split(/\n+|(?<=[.!?؟])\s+/), ...headline.split(/\n+|(?<=[.!?؟])\s+/)]
    .map((item) => item.trim())
    .filter((item) => item.length >= 8)
    .sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const bit of pieces) {
    const folded = fold(bit);
    if (kept.some((item) => {
      const other = fold(item);
      return other === folded || other.includes(folded) || folded.includes(other);
    })) continue;
    kept.push(bit);
    if (kept.length >= 3) break;
  }
  return { headline, summary, bits: kept };
}

export function missingWords(query: string, card: Card) {
  const blob = fold(`${sanitizeInline(card.headline, 400)} ${sanitizeInline(card.summary, 900)}`);
  return distinctive(query).filter((word) => !affirmed(blob, word));
}

function gapLine(card: Card, lang: Lang, query: string) {
  const text = `${sanitizeInline(card.headline, 300)} ${sanitizeInline(card.summary, 500)}`;
  const missing = missingWords(query, card).slice(0, 3);
  if (missing.length) {
    const list = missing.join(lang === "en" ? ", " : "، ");
    return lang === "en" ? `The text does not confirm: ${list}.` : `النص ما يؤكد: ${list}.`;
  }
  if (!/\d/.test(text)) return lang === "en" ? "No number is written in this text." : "ما فيه رقم في هذا النص.";
  return lang === "en" ? "Nothing beyond those written sentences is established." : "ما يثبت شيئًا أبعد من الجمل المكتوبة.";
}

export function briefingFor(card: Card, lang: Lang, query = ""): Briefing {
  const { headline, bits } = factBits(card);
  const source = sanitizeInline(card.source_name, 80);
  const date = publishedLabel(card.published_at, lang);
  const names = distinctive(`${headline} ${sanitizeInline(card.summary, 500)}`).filter(partyWord).slice(0, 6);
  const context = [
    names.length ? (lang === "en" ? `Named in the text: ${names.join(", ")}.` : `مذكور في النص: ${names.join("، ")}.`) : "",
    date ? (lang === "en" ? `Published ${date}.` : `تاريخ النشر: ${date}.`) : "",
    source ? (lang === "en" ? `Source: ${source}.` : `المصدر: ${source}.`) : "",
  ].filter(Boolean).join(" ");
  const result = bits.find((bit) => fold(bit) !== fold(headline)) || bits[0] || headline;
  return {
    event: headline || (lang === "en" ? "Untitled card" : "بطاقة بلا عنوان"),
    context: context || (lang === "en" ? "The card names no separate party." : "النص ما يفرز طرفًا أو تاريخًا إضافيًا."),
    result: result || (lang === "en" ? "No result beyond the headline." : "لا نتيجة مكتوبة أبعد من العنوان."),
    proves: bits[0] ? (lang === "en" ? `The wording says: ${bits[0]}` : `الصياغة تقول: ${bits[0]}`) : (lang === "en" ? "The card has no body text." : "لا نص أبعد من العنوان."),
    limits: gapLine(card, lang, query),
  };
}

export type ReplyMode = "fresh" | "another" | "related" | "revisit";

export function composeReply(args: {
  card: Card;
  lang: Lang;
  tone: Tone;
  query: string;
  mode: ReplyMode;
  seed: string;
  yesNo?: boolean;
  previous?: string[];
}) {
  const { headline, bits } = factBits(args.card);
  const source = sanitizeInline(args.card.source_name, 80);
  const date = publishedLabel(args.card.published_at, args.lang);
  const first = bits[0] || headline;
  const second = bits[1] || "";
  const story = spoken(second ? [first, second] : [first]);
  const asked = distinctive(args.query).slice(0, 4).join(" ");
  const gaps = missingWords(args.query, args.card);
  const affirm = Boolean(args.yesNo) && gaps.length === 0 && args.mode === "fresh";
  const stamp = source ? `${source}${date ? (args.lang === "en" ? `, ${date}` : `، ${date}`) : ""}` : date;
  const previous = args.previous || [];
  if (args.lang === "en") {
    const options = args.mode === "another"
      ? [`Different card. ${story}`, second ? `Not the previous one. ${spoken([second])}` : `Not the previous one. ${story}`, stamp ? `${stamp}: ${spoken([first])}` : story]
      : args.mode === "related"
        ? [`Related by the same name. ${story}`, second ? `Same name, different story: ${spoken([second])}` : `Same name, different story: ${story}`]
        : args.mode === "revisit"
          ? [`This is still the strongest card. ${spoken([second || first])}`, `No second story matches as clearly. ${spoken([second || first])}`]
          : [story, asked ? `On "${asked}": ${spoken([first])}` : spoken([first]), stamp ? `${stamp}: ${spoken([first])}` : spoken([first])];
    const voiced = affirm ? options.map((line, index) => index % 2 === 0 ? `Yes. ${line}` : `The text says so. ${line}`) : options;
    return pickLine(voiced, args.seed, previous);
  }
  const options = args.mode === "another"
    ? [`خبر غير اللي سبق. ${story}`, second ? `بطاقة ثانية. ${spoken([second])}` : `بطاقة ثانية. ${story}`, stamp ? `${stamp}: ${spoken([first])}` : story]
    : args.mode === "related"
      ? [`نفس الاسم في خبر آخر. ${story}`, second ? `مرتبطة بالاسم، والتفصيل: ${spoken([second])}` : `مرتبطة بالاسم: ${story}`]
      : args.mode === "revisit"
        ? [`ما لقيت خبرًا أوضح من هذا. ${spoken([second || first])}`, `بقيت هذي البطاقة الأقوى. ${spoken([second || first])}`]
        : [story, asked ? `عن «${asked}»: ${spoken([first])}` : spoken([first]), stamp ? `${stamp}: ${spoken([first])}` : spoken([first])];
  const voiced = affirm
    ? options.map((line, index) => (index % 2 === 0 ? `نعم. ${line}` : `النص يذكر ذلك. ${line}`))
    : options;
  if (args.tone === "casual" && args.mode === "fresh") voiced.push(`شوف: ${spoken([first])}`);
  if (args.tone === "polite" && args.mode === "fresh") voiced.push(`وجدت هذا في النص: ${spoken([first])}`);
  return pickLine(voiced, args.seed, previous);
}

export function summarizeCard(card: Card, lang: Lang, seed = "", previous: string[] = []) {
  const { headline, bits } = factBits(card);
  const source = sanitizeInline(card.source_name, 80);
  const date = publishedLabel(card.published_at, lang);
  const first = bits[0] || headline;
  const second = bits[1] || "";
  const stamp = source ? `${source}${date ? (lang === "en" ? `, ${date}` : `، ${date}`) : ""}` : "";
  if (lang === "en") {
    return pickLine([
      [first, second].filter(Boolean).join(" "),
      stamp ? `${first} (${stamp})` : first,
      second || first,
    ], seed || first, previous) || "This card has no text to summarize.";
  }
  return pickLine([
    [first, second].filter(Boolean).join(" "),
    stamp ? `${first} (${stamp})` : first,
    second ? `باختصار: ${second}` : first,
  ], seed || first, previous) || "لا نص في هذه البطاقة لألخصه.";
}

export function analyzeCard(card: Card, lang: Lang, tone: Tone, seed = "", previous: string[] = []) {
  const { headline, bits } = factBits(card);
  const extra = bits.find((bit) => fold(bit) !== fold(headline)) || "";
  const gap = gapLine(card, lang, "");
  if (lang === "en") {
    return pickLine([
      `The headline says "${headline || "nothing"}". ${extra ? `The summary adds: ${extra}` : "The summary adds no separate fact."} ${gap}`,
      `${extra || headline} That is as far as the text goes. ${gap}`,
      `Read only this card: ${headline}. ${gap}`,
    ], seed || headline, previous);
  }
  const options = [
    `العنوان يقول «${headline || "لا شيء"}». ${extra ? `الملخص يضيف: ${extra}` : "الملخص ما يضيف واقعة جديدة."} ${gap}`,
    `${extra || headline} وهنا يقف النص. ${gap}`,
    tone === "casual" ? `لو نقرأها بهدوء: ${headline}. ${extra ? `وبعدين: ${extra}. ` : ""}${gap}` : `من النص وحده: ${headline}. ${gap}`,
  ];
  return pickLine(options, seed || headline, previous);
}

export function entitiesOf(card: Card, lang: Lang, seed = "", previous: string[] = []) {
  const pool = distinctive(`${sanitizeInline(card.headline, 300)} ${sanitizeInline(card.summary, 700)}`);
  const names = pool.filter(partyWord).slice(0, 8);
  if (!names.length) {
    return lang === "en"
      ? pickLine(["No clear name stands apart from the headline.", "The text doesn't isolate a person or a place.", "I can't list a party that the wording itself separates."], seed || "none", previous)
      : pickLine(["ما فيه اسم واضح زيادة على صياغة العنوان.", "النص ما يفرز شخصًا أو مكانًا لحاله.", "ما أقدر أعد جهة ما كتبها النص كاسم."], seed || "none", previous);
  }
  const list = names.join(lang === "en" ? ", " : "، ");
  return lang === "en"
    ? pickLine([`Named in this text: ${list}.`, `The card writes: ${list}. Nothing added from outside.`, `People or places on the card: ${list}.`], seed || list, previous)
    : pickLine([`اللي يظهر بالاسم: ${list}.`, `البطاقة تكتب: ${list}. ما أضفت جهة من برّا.`, `أشخاص أو أماكن في النص: ${list}.`], seed || list, previous);
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
