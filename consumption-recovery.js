(() => {
  'use strict';
  const CONFIG={url:'https://dndlkenyfymlrjnslyzb.supabase.co',key:'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx'};
  const sb=window.supabase?.createClient?.(CONFIG.url,CONFIG.key,{auth:{persistSession:true,autoRefreshToken:true}});const root=document.getElementById('recoveryPage');
  const fmt=v=>Number(v||0).toLocaleString('ar');
  const render=async()=>{if(!root||!sb)return;const {data,error}=await sb.rpc('get_consumption_recovery_status');if(error){root.innerHTML='<div class="recovery-shell"><section class="recovery-card"><div class="recovery-heading"><p class="recovery-kicker">مِرصاد</p><h1>استرداد الاستهلاك</h1><p class="recovery-subtitle">تعذر تحميل الشريط حاليًا</p></div></section></div>';root.hidden=false;return}const s=Array.isArray(data)?data[0]:data,used=Number(s?.consumed_slots||0),target=Number(s?.target_slots||1000),percent=Math.min(100,Number(s?.progress_percent||0)),remaining=Math.max(0,Number(s?.remaining_slots||0)),hasPurchase=Boolean(s?.has_purchased),canClaim=Boolean(s?.can_claim),discount=Number(s?.active_discount||0);
    const subtitle=hasPurchase?'يُحتسب فقط ما أنفقته من فتحات مشحونة، لا المكافآت المجانية.':'الشريط يبدأ بعد أول شحن. الاستهلاك المجاني لا يُحتسب.';
    const offerTitle=discount>0?'خصمك جاهز':canClaim?'دورة مكتملة':'استرداد بعد الشحن';
    const offerText=discount>0?`لديك خصم ${discount}% على الشحنة التالية.`:'أكمل إنفاق 1,000 فتحة مشحونة لتحصل على خصم 15% على الشحنة التالية.';
    const actionLabel=!hasPurchase?'اشحن الآن':canClaim?'تفعيل خصم 15%':discount>0?'متابعة الشحن':'متاح بعد الشحن والاستهلاك';
    const actionEnabled=(!hasPurchase)||canClaim||discount>0;
    root.innerHTML=`<div class="recovery-shell"><header class="recovery-header"><div class="recovery-brand"><span class="recovery-mark">◉</span><span>مِرصاد</span></div><button class="recovery-back" type="button" data-back>العودة</button></header><section class="recovery-card"><div class="recovery-heading"><p class="recovery-kicker">ولاء الشحن</p><h1>استرداد الاستهلاك</h1><p class="recovery-subtitle">${subtitle}</p></div><div class="recovery-value"><strong>${percent.toLocaleString('ar')}%</strong><span>${hasPurchase?`من أصل ${fmt(target)} فتحة مشحونة`:'بانتظار أول شحن'}</span></div><div class="recovery-track" aria-label="نسبة الاستهلاك"><i style="width:${hasPurchase?percent:0}%"></i></div><div class="recovery-stats"><div class="recovery-stat">المحتسب<strong>${fmt(used)}</strong></div><div class="recovery-stat">المتبقي<strong>${fmt(hasPurchase?remaining:target)}</strong></div></div><div class="recovery-offer"><h2>${offerTitle}</h2><p>${offerText}</p><span class="recovery-price">خصم 15%</span><button class="mirsad-auth-button primary recovery-action" type="button" data-action ${actionEnabled?'':'disabled'}>${actionLabel}</button></div><p class="recovery-note">المكافأة اليومية وسحب العجلة ورصيد الترحيب لا تملأ هذا الشريط. الهدف أن يعود الشحن بخصم، لا بفتحات مجانية.</p></section></div>`;
    root.hidden=false;
    root.querySelector('[data-back]')?.addEventListener('click',()=>{location.href='index.html'});
    root.querySelector('[data-action]')?.addEventListener('click',async()=>{
      if(!hasPurchase||discount>0){location.href='billing.html';return}
      if(!canClaim)return;
      const btn=root.querySelector('[data-action]');btn.disabled=true;btn.textContent='جارٍ التفعيل…';
      const {data:claim,error:claimError}=await sb.rpc('claim_consumption_recovery');
      if(claimError){btn.disabled=false;btn.textContent='تعذر التفعيل';return}
      const r=Array.isArray(claim)?claim[0]:claim;
      if(r?.claimed){location.href='billing.html';return}
      render();
    });
  };
  window.addEventListener('mirsad:authenticated',render,{once:true});setTimeout(render,1200);
})();
