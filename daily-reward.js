(() => {
  'use strict';
  const CONFIG={url:'https://dndlkenyfymlrjnslyzb.supabase.co',key:'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx'};
  const sb=window.supabase?.createClient?.(CONFIG.url,CONFIG.key,{auth:{persistSession:true,autoRefreshToken:true}});
  const root=document.getElementById('mirsadRewardPage');
  const safe=v=>String(v??'').replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"');
  const fmtDate=v=>{try{return new Intl.DateTimeFormat('ar',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(`${v}T00:00:00Z`))}catch{return v}};
  const days=[1,1,2,2,3,3,5];
  const reasonText={claimed:'تتجدد المكافأة عند انتهاء العدّاد.',unlimited:'حسابك غير محدود، ولا تُضاف فتحات يومية إليه.',balance_high:'رصيدك كافٍ الآن. استخدم الفتحات أولاً، والمكافأة اليومية للتذكير لا لتكديس الرصيد.',inactive:'استخدم الموقع اليوم (فتح تفاصيل أو مصدر) حتى تُفعَّل المكافأة.',ok:''};
  let countdownTimer;
  const countdownText=ms=>{const total=Math.max(0,Math.floor(ms/1000)),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`};
  const startCountdown=until=>{clearInterval(countdownTimer);const el=root.querySelector('[data-countdown]');if(!el||!until)return;const tick=()=>{const left=new Date(until).getTime()-Date.now();el.textContent=countdownText(left);if(left<=0){clearInterval(countdownTimer);setTimeout(render,500)}};tick();countdownTimer=setInterval(tick,1000)};
  async function render(){
    if(!root||!sb)return;
    const [{data:status,error:statusError},{data:history}]=await Promise.all([sb.rpc('get_daily_reward_status'),sb.from('daily_reward_claims').select('claim_date,reward_amount,streak_day').order('claim_date',{ascending:false}).limit(10)]);
    if(statusError){root.innerHTML='<div class="mirsad-reward-page__shell"><section class="mirsad-reward-card"><h1>المكافأة اليومية</h1><p class="mirsad-reward-intro">تعذر تحميل حالة المكافأة الآن. حاول تحديث الصفحة.</p></section></div>';root.hidden=false;return}
    const s=Array.isArray(status)?status[0]:status,reward=Number(s?.today_reward||0),streak=Number(s?.streak_day||1),balance=s?.unlimited?'غير محدود':Number(s?.current_balance||0),claimed=!s?.can_claim,reason=String(s?.reason||'claimed');
    const statusLine=reasonText[reason]||'';
    const billingNeeded=reason==='balance_high'||reason==='inactive';
    root.innerHTML=`<div class="mirsad-reward-page__shell"><header class="mirsad-reward-page__header"><div class="mirsad-reward-page__brand"><span aria-hidden="true">◉</span><span>مِرصاد</span></div><button class="mirsad-reward-page__back" type="button" data-back>العودة للأخبار</button></header><section class="mirsad-reward-card"><h1>المكافأة اليومية</h1><p class="mirsad-reward-intro">دفعة صغيرة بعد الاستخدام الفعلي، وليست بديلاً عن الشحن.</p><div class="mirsad-reward-hero"><small>${claimed?(reason==='claimed'?'تم استلام مكافأة اليوم':'المكافأة غير متاحة الآن'):'مكافأة اليوم'}</small><div class="mirsad-reward-amount">${claimed&&reason==='claimed'?'✓':'+'+reward}</div><small>${reason==='claimed'?'المكافأة التالية بعد:':'فتحات تذكير'}</small>${reason==='claimed'?'<div class="mirsad-reward-countdown" data-countdown>00:00:00</div>':''}</div><div class="mirsad-reward-balance"><span>رصيدك الحالي</span><strong>${safe(balance)} ${s?.unlimited?'':'فتحة'}</strong></div><button class="mirsad-auth-button primary mirsad-reward-action" type="button" data-claim ${s?.can_claim?'':'disabled'}>${s?.can_claim?'استلام المكافأة':'غير متاح الآن'}</button>${billingNeeded?'<button class="mirsad-auth-button mirsad-reward-action" type="button" data-billing style="margin-top:8px">شحن الرصيد</button>':''}<div id="dailyRewardStatus" class="mirsad-auth-status mirsad-reward-status" role="status" aria-live="polite">${safe(statusLine)}</div><section class="mirsad-reward-streak"><h2>سلسلة الحضور</h2><div class="mirsad-reward-days">${days.map((amount,i)=>`<div class="mirsad-reward-day"${i+1===streak?' style="border-color:var(--gold);color:var(--text)"':''}><strong>+${amount}</strong>اليوم ${i+1}</div>`).join('')}</div></section><section class="mirsad-reward-history"><h2>آخر المكافآت</h2><ul>${(history||[]).length?(history||[]).map(row=>`<li><span>${safe(fmtDate(row.claim_date))} · اليوم ${safe(row.streak_day)}</span><strong>+${safe(row.reward_amount)}</strong></li>`).join(''):'<li><span>لا توجد مكافآت مستلمة بعد</span></li>'}</ul></section></section></div>`;
    root.hidden=false;
    root.querySelector('[data-back]')?.addEventListener('click',()=>{window.location.href=new URL('index.html',window.location.href).href});
    root.querySelector('[data-billing]')?.addEventListener('click',()=>{window.location.href=new URL('billing.html',window.location.href).href});
    if(reason==='claimed')startCountdown(s.next_claim_at);
    root.querySelector('[data-claim]')?.addEventListener('click',async e=>{const btn=e.currentTarget,statusEl=root.querySelector('#dailyRewardStatus');btn.disabled=true;statusEl.textContent='جارٍ استلام المكافأة…';const {data,error}=await sb.rpc('claim_daily_reward');if(error){btn.disabled=false;statusEl.textContent='تعذر استلام المكافأة. حاول مرة أخرى.';return}const result=Array.isArray(data)?data[0]:data;if(result?.claimed){statusEl.textContent=`تمت إضافة ${result.reward_amount} فتحات.`;setTimeout(render,500)}else{setTimeout(render,300)}});
  }
  window.addEventListener('mirsad:authenticated',render,{once:true});
  setTimeout(render,1200);
})();
