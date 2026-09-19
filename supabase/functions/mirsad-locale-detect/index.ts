import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const fallback: Record<string, { language: string; name: string; confidence: number }> = {
  JP: { language: "ja", name: "日本語", confidence: 0.98 },
  FR: { language: "fr", name: "Français", confidence: 0.96 },
  DE: { language: "de", name: "Deutsch", confidence: 0.96 },
  ES: { language: "es", name: "Español", confidence: 0.96 },
  IT: { language: "it", name: "Italiano", confidence: 0.96 },
  TR: { language: "tr", name: "Türkçe", confidence: 0.96 },
  GB: { language: "en", name: "English", confidence: 0.97 },
  US: { language: "en", name: "English", confidence: 0.97 },
  CA: { language: "en", name: "English", confidence: 0.72 },
  IN: { language: "en", name: "English", confidence: 0.45 },
  BE: { language: "nl", name: "Nederlands", confidence: 0.52 },
  CH: { language: "de", name: "Deutsch", confidence: 0.48 },
  DZ: { language: "ar", name: "العربية", confidence: 0.78 },
  MA: { language: "ar", name: "العربية", confidence: 0.76 },
  TN: { language: "ar", name: "العربية", confidence: 0.82 },
  SA: { language: "ar", name: "العربية", confidence: 0.98 },
  AE: { language: "ar", name: "العربية", confidence: 0.83 },
};
const countryLanguage: Record<string, string> = {
  CN: "zh", TW: "zh-TW", HK: "zh-HK", MO: "zh", KR: "ko", KP: "ko", VN: "vi", TH: "th", ID: "id", MY: "ms", PH: "fil", SG: "en",
  PT: "pt", BR: "pt-BR", AO: "pt", MZ: "pt", CV: "pt", GW: "pt", ST: "pt", TL: "pt", ES: "es", MX: "es", AR: "es", CL: "es", CO: "es", PE: "es", VE: "es", EC: "es", BO: "es", PY: "es", UY: "es", CR: "es", PA: "es", DO: "es", CU: "es", GT: "es", HN: "es", SV: "es", NI: "es", PR: "es",
  RU: "ru", UA: "uk", BY: "be", PL: "pl", CZ: "cs", SK: "sk", HU: "hu", RO: "ro", BG: "bg", HR: "hr", SI: "sl", SR: "sr", BA: "bs", MK: "mk", AL: "sq", GR: "el", RS: "sr", LT: "lt", LV: "lv", EE: "et", FI: "fi", SE: "sv", NO: "no", DK: "da", IS: "is",
  IL: "he", IR: "fa", AF: "fa", PK: "ur", BD: "bn", IN: "hi", NP: "ne", LK: "si", MM: "my", KH: "km", LA: "lo", MN: "mn",
  ET: "am", KE: "sw", TZ: "sw", UG: "en", GH: "en", NG: "en", ZA: "en", ZW: "en", NA: "en", BW: "en", ZM: "en", MW: "en", MU: "en",
  FR: "fr", BE: "fr", CH: "fr", LU: "fr", MC: "fr", CA: "fr-CA", HT: "fr", SN: "fr", CI: "fr", CM: "fr", MG: "fr", ML: "fr", NE: "fr", BF: "fr", TD: "fr", CD: "fr", CG: "fr", GA: "fr", BJ: "fr", TG: "fr", RW: "fr",
  DE: "de", AT: "de", LI: "de", NL: "nl", IT: "it", MT: "mt", IE: "en", GB: "en", US: "en", AU: "en", NZ: "en", FJ: "en", JM: "en", TT: "en", BB: "en", BS: "en",
  TR: "tr", AZ: "az", KZ: "kk", UZ: "uz", GE: "ka", AM: "hy", TJ: "tg", TM: "tk", KG: "ky",
  SA: "ar", AE: "ar", EG: "ar", DZ: "ar", MA: "ar", TN: "ar", LY: "ar", SD: "ar", IQ: "ar", SY: "ar", JO: "ar", LB: "ar", PS: "ar", KW: "ar", QA: "ar", BH: "ar", OM: "ar", YE: "ar", SO: "so"
};
const clean = (value: unknown, max: number) => String(value ?? "").replace(/[^\p{L}\p{N} .,_-]/gu, "").slice(0, max);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const geminiKey = Deno.env.get("GOOGLE_GEMINI_KEY2");
  if (!geminiKey) return json({ error: "Locale AI is not configured" }, 503);
  let supplied: { country_code?: string; country_name?: string; region?: string; city?: string } = {};
  try { supplied = await request.json(); } catch { /* empty body uses server-side fallback */ }
  const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "";
  const ip = forwarded.split(",")[0].trim();
  let geo: { country_code?: string; country_name?: string; region?: string; city?: string } = {};
  try {
    if (supplied.country_code || supplied.country_name || supplied.region || supplied.city) {
      geo = supplied;
    } else {
    const url = ip && !["127.0.0.1", "::1"].includes(ip) ? `https://ipapi.co/${encodeURIComponent(ip)}/json/` : "https://ipapi.co/json/";
    const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (response.ok) geo = await response.json();
    }
  } catch { /* use a neutral fallback without blocking the site */ }
  const country = clean(geo.country_code || "", 2).toUpperCase();
  const countryName = clean(geo.country_name || "", 80);
  const region = clean(geo.region || "", 100);
  const city = clean(geo.city || "", 80);
  const known = fallback[country] || (countryLanguage[country] ? { language: countryLanguage[country], name: countryLanguage[country], confidence: 0.82 } : undefined);
  const prompt = `You are a conservative locale classifier. Choose the most commonly used public website language for this approximate location. Do not use browser language. Return JSON only with language (BCP-47 code), language_name, confidence (0 to 1), and reason. If the region is ambiguous, choose the country's safest majority language and lower confidence. Location: country=${countryName || country || "unknown"}; region=${region || "unknown"}; city=${city || "unknown"}.`;
  let result = known ? { language: known.language, language_name: known.name, confidence: known.confidence, reason: "regional default" } : { language: "en", language_name: "English", confidence: 0.2, reason: "unknown location" };
  try {
    const models = [Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash"];
    for (const model of models) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 300 } }), signal: AbortSignal.timeout(9000) });
      if (!response.ok) { if ([400, 404, 429, 500, 502, 503].includes(response.status)) continue; break; }
      const payload = await response.json();
      const raw = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
      const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const ai = JSON.parse(raw.slice(start, end + 1));
        if (/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?$/.test(String(ai.language || "")) && Number(ai.confidence) >= 0.35) result = { language: String(ai.language), language_name: clean(ai.language_name, 60), confidence: Math.min(1, Number(ai.confidence)), reason: clean(ai.reason, 180) };
      }
      break;
    }
  } catch { /* deterministic regional fallback remains active */ }
  return json({ country_code: country || null, country_name: countryName || null, region: region || null, city: city || null, ...result, source: "approximate_ip_region", expires_in_seconds: 604800 });
});
