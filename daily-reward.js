(() => {
  'use strict';
  const CONFIG={url:'https://dndlkenyfymlrjnslyzb.supabase.co',key:'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx'};
  const sb=window.supabase?.createClient?.(CONFIG.url,CONFIG.key,{auth:{persistSession:true,autoRefreshToken:true}});
  const root=document.getElementById('mirsadRewardPage');
  const safe=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmtDate=v=>{try{return new Intl.DateTimeFormat('ar',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(`${v}T00:00:00Z`))}catch{return v}};
  const days=[5,5,10,10,15,15,30];
  async function render(){
    if(!root||!sb)return;
    const [{data:status,error:statusError},{data:history}]=await Promise.all([
      sb.rpc('get_daily_reward_status'),
      sb.from('daily_reward_claims').select('claim_date,reward_amount,streak_day').order('claim_date',{ascending:false}).limit(10)
    ]);
    if(statusError){root.innerHTML='<div class="mirsad-reward-page__shell"><section class="mirsad-reward-card"><h1>المكافأة اليومية</h1><p class="mirsad-reward-intro">تعذر تحميل حالة المكافأة الآن. حاول تحديث الصفحة.</p></section></div>';root.hidden=false;return}
    const s=Array.isArray(status)?status[0]:status;
    const reward=Number(s?.today_reward||0), streak=Number(s?.streak_day||1), balance=s?.unlimited?'غير محدود':Number(s?.current_balance||0);
    root.innerHTML=`<div class="mirsad-reward-page__shell"><header class="mirsad-reward-page__header"><div class="mirsad-reward-page__brand"><span aria-hidden="true">◉</span><span>مِرصاد</span></div><button class="mirsad-reward-page__back" type="button" data-back>العودة للأخبار</button></header><section class="mirsad-reward-card"><h1>المكافأة اليومية</h1><p class="mirsad-reward-intro">عد كل يوم واحصل على فتحات إضافية لمتابعة الأخبار.</p><div class="mirsad-reward-hero"><small>مكافأة اليوم</small><div class="mirsad-reward-amount">+${reward}</div><small>فتحات أخبار</small></div><div class="mirsad-reward-balance"><span>رصيدك الحالي</span><strong>${safe(balance)} ${s?.unlimited?'':'فتحة'}</strong></div><button class="mirsad-auth-button primary mirsad-reward-action" type="button" data-claim ${s?.can_claim?'':'disabled'}>${s?.can_claim?'استلام المكافأة':'تم استلام مكافأة اليوم'}</button><div id="dailyRewardStatus" class="mirsad-auth-status mirsad-reward-status" role="status" aria-live="polite">${s?.can_claim?'':'المكافأة التالية متاحة غدًا.'}</div><section class="mirsad-reward-streak"><h2>سلسلة الحضور</h2><div class="mirsad-reward-days">${days.map((amount,i)=>`<div class="mirsad-reward-day"${i+1===streak?' style="border-color:var(--gold);color:var(--text)"':''}><strong>+${amount}</strong>اليوم ${i+1}</div>`).join('')}</div></section><section class="mirsad-reward-history"><h2>آخر المكافآت</h2><ul>${(history||[]).length?(history||[]).map(row=>`<li><span>${safe(fmtDate(row.claim_date))} · اليوم ${safe(row.streak_day)}</span><strong>+${safe(row.reward_amount)}</strong></li>`).join(''):'<li><span>لا توجد مكافآت مستلمة بعد</span></li>'}</ul></section></section></div>`;
    root.hidden=false;
    root.querySelector('[data-back]')?.addEventListener('click',()=>{window.location.href=new URL('index.html',window.location.href).href});
    root.querySelector('[data-claim]')?.addEventListener('click',async e=>{const btn=e.currentTarget,statusEl=root.querySelector('#dailyRewardStatus');btn.disabled=true;statusEl.textContent='جارٍ استلام المكافأة…';const {data,error}=await sb.rpc('claim_daily_reward');if(error){btn.disabled=false;statusEl.textContent='تعذر استلام المكافأة. حاول مرة أخرى.';return}const result=Array.isArray(data)?data[0]:data;if(result?.claimed){statusEl.textContent=`تمت إضافة ${result.reward_amount} فتحات إلى رصيدك. رصيدك الآن ${result.remaining_unlocks} فتحة.`;setTimeout(render,500)}else{statusEl.textContent='تم استلام مكافأة اليوم بالفعل.';setTimeout(render,300)}});
  }
  window.addEventListener('mirsad:authenticated',render,{once:true});
  setTimeout(render,1200);
})();
