(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce'} });
  const CATEGORY_LABELS={Politics:'سياسة',Economy:'اقتصاد',Tech:'تقنية',Society:'مجتمع',Sports:'رياضة'};
  const CATEGORY_COLORS={Politics:'#8b7bc7',Economy:'#c9a227',Tech:'#4f9dde',Society:'#b8794a',Sports:'#4fa8a0'};
  const grid=document.getElementById('news24Grid');
  const status=document.getElementById('news24Status');
  const count=document.getElementById('news24Count');
  const template=document.getElementById('news24CardTemplate');
  const relative=new Intl.RelativeTimeFormat('ar',{numeric:'auto'});
  function time(iso){const t=new Date(iso).getTime();if(!Number.isFinite(t))return 'وقت غير محدد';const m=Math.round((t-Date.now())/60000);if(Math.abs(m)<60)return relative.format(m,'minute');const h=Math.round(m/60);if(Math.abs(h)<24)return relative.format(h,'hour');return relative.format(Math.round(h/24),'day')}
  function card(a){
    const n=template.content.firstElementChild.cloneNode(true);
    n.dataset.id=a.id;
    n.querySelector('.card__score').textContent=String(a.importance_score??'');
    n.querySelector('.card__category').textContent=CATEGORY_LABELS[a.category]||a.category||'عام';
    n.querySelector('.card__dot').style.background=CATEGORY_COLORS[a.category]||'#888';
    n.querySelector('.card__source').textContent=a.source_name||'مصدر';
    n.querySelector('.card__headline').textContent=String(a.headline||'');
    n.querySelector('.card__summary').textContent=String(a.summary||'');
    n.querySelector('.card__confidence').textContent=`ثقة ${Math.round(Number(a.confidence_score??0))}%`;
    n.querySelector('.card__time').textContent=time(a.published_at);
    n.querySelector('.card__time').dateTime=a.published_at;
    const badge=n.querySelector('.card__update-badge');
    badge.hidden=Number(a.update_count||0)<=0;
    if(!badge.hidden)badge.textContent=`+${a.update_count} تحديث`;
    n.addEventListener('click',async()=>{
      try{const {error}=await sb.rpc('open_article',{p_article_id:a.id});if(error)throw error;window.open(a.source_url,'_blank','noopener,noreferrer')}
      catch(error){console.warn('[mirsad 24h] open failed',error);window.open(a.source_url,'_blank','noopener,noreferrer')}
    });
    n.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();n.click()}});
    return n;
  }
  async function load(){
    status.hidden=false;status.textContent='جارٍ التحقق من فتحات الأخبار…';
    if(!window.mirsadViewAccess){ status.textContent='تعذر التحقق من فتحات الأخبار.'; return; }
    const access=await window.mirsadViewAccess.consume('24h');
    if(!access.allowed){
      status.textContent=access.error?.message==='not_authenticated'?'سجّل الدخول لاستخدام أخبار 24 ساعة.':'لا توجد فتحات كافية لفتح أخبار 24 ساعة.';
      return;
    }
    status.textContent='جارٍ تحميل أخبار آخر 24 ساعة…';
    const now=new Date();const cutoff=new Date(now.getTime()-24*60*60*1000).toISOString();
    const {data,error}=await sb.from('news_24h_articles').select('id,source_name,source_url,headline,summary,category,importance_score,update_count,confidence_score,published_at').gte('published_at',cutoff).lte('published_at',now.toISOString()).order('published_at',{ascending:false}).order('updated_at',{ascending:false});
    if(error){console.error(error);status.textContent='تعذر تحميل أخبار آخر 24 ساعة.';return}
    grid.innerHTML='';
    (data||[]).forEach(a=>grid.appendChild(card(a)));
    count.textContent=`${(data||[]).length} خبر · حتى 20 من كل مصدر`;
    status.textContent=(data||[]).length?`آخر تحديث للصفحة: ${new Intl.DateTimeFormat('ar',{hour:'2-digit',minute:'2-digit'}).format(now)}`:'لا توجد أخبار منشورة خلال آخر 24 ساعة.';
  }
  load();setInterval(load,5*60*1000);
})();
