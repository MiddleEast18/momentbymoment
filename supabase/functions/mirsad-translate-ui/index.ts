const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors});
const clean=(v:unknown,n:number)=>String(v??"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,n);
const valid=(v:string)=>/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?$/.test(v)&&v.length<=20;
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply(405,{error:"Method not allowed"});
  const key=Deno.env.get("GOOGLE_GEMINI_KEY2")||Deno.env.get("GEMINI_API_KEY");
  if(!key)return reply(503,{error:"UI translation is not configured"});
  let body:{target_language?:string;strings?:unknown};try{body=await req.json()}catch{return reply(400,{error:"Invalid JSON"})}
  const lang=clean(body.target_language||"",20);const strings=Array.isArray(body.strings)?body.strings.map(x=>clean(x,180)).filter(Boolean).slice(0,60):[];
  if(!valid(lang)||!strings.length)return reply(400,{error:"Invalid language or strings"});
  const prompt=`Translate each visible website string into the standard written language identified by BCP-47 code ${lang}. Preserve placeholders, numbers, punctuation, source names, agency names, people names, places, brands, and product names; transliterate only when natural for the target script. Return JSON only as an array of objects with exactly source and translation fields, in the same order. Do not translate names such as Mirsad. STRINGS:\n${JSON.stringify(strings)}`;
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(key)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0,responseMimeType:"application/json",maxOutputTokens:3500}}),signal:AbortSignal.timeout(25000)});
  if(!r.ok)return reply(502,{error:"UI translation provider request failed"});
  const p=await r.json();const raw=p?.candidates?.[0]?.content?.parts?.map((x:{text?:string})=>x.text||"").join("")||"";let result:unknown;
  try{const s=raw.indexOf("[");const e=raw.lastIndexOf("]");result=JSON.parse(raw.slice(s,e+1))}catch{return reply(502,{error:"UI translation response was invalid"})}
  if(!Array.isArray(result))return reply(502,{error:"UI translation response was invalid"});
  return reply(200,{translations:result.filter((x)=>x&&typeof x.source==="string"&&typeof x.translation==="string").slice(0,60),target_language:lang});
});
