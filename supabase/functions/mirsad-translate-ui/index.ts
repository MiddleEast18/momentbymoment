const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors});
const clean=(v:unknown,n:number)=>String(v??"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,n);
const valid=(v:string)=>/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?$/.test(v)&&v.length<=20;
const fallbackModels=[Deno.env.get("GEMINI_MODEL")||"gemini-3.6-flash","gemini-2.5-flash","gemini-2.5-flash-lite","gemini-2.0-flash","gemini-1.5-flash"];
const getModels=async(key:string)=>{try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,{signal:AbortSignal.timeout(10000)});if(r.ok){const p=await r.json();const names=(p?.models||[]).filter((x:{name?:string,supportedGenerationMethods?:string[]})=>x?.name&&x.supportedGenerationMethods?.includes("generateContent")).map((x:{name:string})=>x.name.replace(/^models\//,""));if(names.length)return Array.from(new Set([...names,...fallbackModels]));}}catch{}return fallbackModels;};
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply(405,{error:"Method not allowed"});
  const key=Deno.env.get("GOOGLE_GEMINI_KEY2");
  if(!key)return reply(503,{error:"UI translation is not configured"});
  let body:{target_language?:string;strings?:unknown};try{body=await req.json()}catch{return reply(400,{error:"Invalid JSON"})}
  const lang=clean(body.target_language||"",20);const strings=Array.isArray(body.strings)?body.strings.map(x=>clean(x,180)).filter(Boolean).slice(0,60):[];
  if(!valid(lang)||!strings.length)return reply(400,{error:"Invalid language or strings"});
  const prompt=`Translate each visible website string into the standard written language identified by BCP-47 code ${lang}. Preserve placeholders, numbers, punctuation, source names, agency names, people names, places, brands, and product names; transliterate only when natural for the target script. Return JSON only as an object with a translations array. Every array item must contain exactly source and translation string fields, in the same order as the input. Do not translate names such as Mirsad. STRINGS:\n${JSON.stringify(strings)}`;
  const requestBody={contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0,responseMimeType:"application/json",maxOutputTokens:3500}};
  let r:Response|null=null;
  for(const model of await getModels(key)){
    r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(requestBody),signal:AbortSignal.timeout(25000)});
    if(r.ok)break;
    if(![400,404,429,500,502,503].includes(r.status))break;
  }
  if(!r?.ok)return reply(502,{error:"UI translation provider request failed",provider_status:r?.status??0});
  const p=await r.json();const raw=p?.candidates?.[0]?.content?.parts?.map((x:{text?:string})=>x.text||"").join("")||"";let result:unknown;
  try{const fenced=raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);const normalized=(fenced?.[1]||raw).trim();const starts=[normalized.indexOf("{"),normalized.indexOf("[")].filter(x=>x>=0);const start=starts.length?Math.min(...starts):-1;const ends=[normalized.lastIndexOf("}"),normalized.lastIndexOf("]")];const end=Math.max(...ends);if(start<0||end<start)throw new Error("empty");result=JSON.parse(normalized.slice(start,end+1))}catch{const pairs=[...raw.matchAll(/\"source\"\s*:\s*\"((?:\\.|[^\"])*)\"[\s,}]+\"translation\"\s*:\s*\"((?:\\.|[^\"])*)\"/g)].map(m=>({source:m[1],translation:m[2]}));if(!pairs.length)return reply(502,{error:"UI translation response was invalid"});result=pairs}
  const translations=Array.isArray(result)?result:(result&&typeof result==="object"&&Array.isArray((result as {translations?:unknown}).translations)?(result as {translations:unknown[]}).translations:[]);
  return reply(200,{translations:translations.filter((x)=>x&&typeof (x as {source?:unknown}).source==="string"&&typeof (x as {translation?:unknown}).translation==="string").slice(0,60),target_language:lang});
});
