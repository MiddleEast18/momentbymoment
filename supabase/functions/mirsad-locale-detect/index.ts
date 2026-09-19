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
const clean = (value: unknown, max: number) => String(value ?? "").replace(/[^\p{L}\p{N} .,_-]/gu, "").slice(0, max);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const geminiKey = Deno.env.get("GOOGLE_GEMINI_KEY2") || Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return json({ error: "Locale AI is not configured" }, 503);
  const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "";
  const ip = forwarded.split(",")[0].trim();
  let geo: { country_code?: string; country_name?: string; region?: string; city?: string } = {};
  try {
    const url = ip && !["127.0.0.1", "::1"].includes(ip) ? `https://ipapi.co/${encodeURIComponent(ip)}/json/` : "https://ipapi.co/json/";
    const response = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (response.ok) geo = await response.json();
  } catch { /* use a neutral fallback without blocking the site */ }
  const country = clean(geo.country_code || "", 2).toUpperCase();
  const countryName = clean(geo.country_name || "", 80);
  const region = clean(geo.region || "", 100);
  const city = clean(geo.city || "", 80);
  const known = fallback[country];
  const prompt = `You are a conservative locale classifier. Choose the most commonly used public website language for this approximate location. Do not use browser language. Return JSON only with language (BCP-47 code), language_name, confidence (0 to 1), and reason. If the region is ambiguous, choose the country's safest majority language and lower confidence. Location: country=${countryName || country || "unknown"}; region=${region || "unknown"}; city=${city || "unknown"}.`;
  let result = known ? { language: known.language, language_name: known.name, confidence: known.confidence, reason: "regional default" } : { language: "en", language_name: "English", confidence: 0.2, reason: "unknown location" };
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(geminiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 300 } }), signal: AbortSignal.timeout(9000) });
    if (response.ok) {
      const payload = await response.json();
      const raw = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
      const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const ai = JSON.parse(raw.slice(start, end + 1));
        if (/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(String(ai.language || "")) && Number(ai.confidence) >= 0.35) result = { language: String(ai.language), language_name: clean(ai.language_name, 60), confidence: Math.min(1, Number(ai.confidence)), reason: clean(ai.reason, 180) };
      }
    }
  } catch { /* deterministic regional fallback remains active */ }
  return json({ country_code: country || null, country_name: countryName || null, region: region || null, city: city || null, ...result, source: "approximate_ip_region", expires_in_seconds: 604800 });
});
