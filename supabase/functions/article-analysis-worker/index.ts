import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const geminiKey = Deno.env.get("GEMINI_API_KEY");
const model = "gemini-3.5-flash-lite";

if (!url || !serviceKey) throw new Error("Missing Supabase environment variables");
const db = createClient(url, serviceKey);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({error:"Method not allowed"}, {status:405});
  if (!geminiKey) return Response.json({ok:false,error:"GEMINI_API_KEY is not configured"}, {status:503});

  const body = await req.json().catch(() => ({}));
  const requestedJobId = typeof body?.job_id === "string" ? body.job_id : null;
  const {data: jobs, error: claimError} = await db.rpc("claim_analysis_job", {p_job_id: requestedJobId});
  if (claimError) return Response.json({ok:false,error:claimError.message},{status:500});

  const job = Array.isArray(jobs) ? jobs[0] : jobs;
  if (!job) return Response.json({ok:true,message:"No queued analysis job"});

  try {
    const {data: article, error: articleError} = await db
      .from("news_articles")
      .select("id,source_name,source_url,agency_urls,headline,summary,category,importance_score,sentiment,published_at")
      .eq("id", job.article_id)
      .single();
    if (articleError || !article) throw new Error(articleError?.message ?? "Article not found");

    const prompt = [
      "أنت محرر أخبار في مِرصاد.",
      "اكتب قراءة تحليلية قصيرة مناسبة للظهور داخل بطاقة خبر، بالعربية الفصحى الواضحة.",
      "لا تختلق معلومات ولا تتجاوز ما يسمح به الخبر المتاح.",
      "افصل بين الوقائع والاستنتاج، واجعل الصياغة محايدة وغير دعائية.",
      "العنوان: " + (article.headline ?? ""),
      "الملخص: " + (article.summary ?? ""),
      "المصدر: " + (article.source_name ?? ""),
      "التصنيف: " + (article.category ?? "")
    ].join("\n");

    const schema = {
      type:"object",
      properties:{
        executive_summary:{type:"string"},
        key_points:{type:"array",items:{type:"string"}},
        entities:{type:"array",items:{type:"object",properties:{name:{type:"string"},type:{type:"string"}},required:["name","type"]}},
        claims:{type:"array",items:{type:"object",properties:{claim:{type:"string"},confidence:{type:"number"}},required:["claim","confidence"]}},
        context:{type:"string"},
        impact:{type:"string"},
        risk_flags:{type:"array",items:{type:"string"}},
        confidence:{type:"number"}
      },
      required:["executive_summary","key_points","entities","claims","context","impact","risk_flags","confidence"]
    };

    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(geminiKey), {
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        contents:[{role:"user",parts:[{text:prompt}]}],
        generationConfig:{responseMimeType:"application/json",responseSchema:schema,temperature:0.2,maxOutputTokens:1200}
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      await db.from("analysis_jobs").update({
        status: retryable ? "queued" : "failed",
        error_message: "Gemini API " + res.status,
        updated_at:new Date().toISOString()
      }).eq("id",job.id);
      return Response.json({ok:false,job_id:job.id,retryable,provider_status:res.status},{status:retryable ? 429 : 502});
    }

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof raw !== "string") throw new Error("Gemini returned no text");
    const analysis = JSON.parse(raw);

    const {error: saveError} = await db.from("article_analysis").upsert({
      article_id:article.id,
      job_id:job.id,
      provider:"google",
      model:model,
      status:"completed",
      analysis:analysis,
      prompt_version:"v1-gemini-flash-lite",
      analyzed_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }, {onConflict:"article_id,prompt_version"});
    if (saveError) throw new Error(saveError.message);

    await db.from("analysis_jobs").update({
      status:"completed",
      completed_at:new Date().toISOString(),
      error_message:null,
      updated_at:new Date().toISOString()
    }).eq("id",job.id).eq("status","processing");

    return Response.json({ok:true,job_id:job.id,article_id:article.id,provider:"google",model:model,status:"completed"});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("analysis_jobs").update({status:"failed",error_message:message.slice(0,2000),updated_at:new Date().toISOString()}).eq("id",job.id);
    return Response.json({ok:false,job_id:job.id,error:message},{status:500});
  }
});