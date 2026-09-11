(() => {
  'use strict';
  const CONFIG={SUPABASE_URL:'https://dndlkenyfymlrjnslyzb.supabase.co',SUPABASE_KEY:'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx',PROFILE_TABLE:'profiles',GUEST_KEY:'mirsad.guest.v1',PRODUCTION_ORIGIN:'https://marsad.website/'};
  const AUTH_OPTIONS={auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce'}};
  let sb=null;
  try{if(window.supabase?.createClient)sb=window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_KEY,AUTH_OPTIONS)}catch(error){console.error('[mirsad auth] Supabase initialization failed',error)}
  const supabaseReady=Boolean(sb);
  // OAuth always returns to the canonical production site.
  // This prevents local previews/dev servers from becoming the final callback target.
  const redirectTo=()=>CONFIG.PRODUCTION_ORIGIN;
  const AUTH_QUERY_KEYS=['code','state','error','error_code','error_description'];
  let googleFlowActive=false;
  let googleFlowStartedAt=0;
  let googleFlowTimer=null;
  const GOOGLE_FLOW_TIMEOUT_MS=15000;
  const AUTH_HASH_KEYS=['access_token','refresh_token','expires_in','expires_at','token_type','type','error','error_code','error_description','provider_token','provider_refresh_token'];
  function cleanAuthUrl(){
    const url=new URL(window.location.href);
    let changed=false;
    AUTH_QUERY_KEYS.forEach(k=>{if(url.searchParams.has(k)){url.searchParams.delete(k);changed=true}});
    if(url.hash){
      const hash=new URLSearchParams(url.hash.replace(/^#/,''));
      AUTH_HASH_KEYS.forEach(k=>{if(hash.has(k)){hash.delete(k);changed=true}});
      const next=hash.toString();
      url.hash=next?next:'';
    }
    if(changed)history.replaceState({},document.title,url.pathname+url.search+(url.hash||''));
  }
  function readOAuthError(){
    const url=new URL(window.location.href);
    const hash=new URLSearchParams(window.location.hash.replace(/^#/,''));
    return url.searchParams.get('error_description')||url.searchParams.get('error')||hash.get('error_description')||hash.get('error')||'';
  }
  const isGuest=()=>localStorage.getItem(CONFIG.GUEST_KEY)==='1';
  const maskEmail=e=>{const[n,d]=String(e||'').split('@');return d?(`${(n||'').slice(0,1)}•••@${d}`):e};
  const logo=()=>'<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="32" cy="32" r="7" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 13v9M32 42v9M13 32h9M42 32h9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="32" r="2.5" fill="currentColor"/></svg>';
  const statusText=(el,v)=>{if(el)el.textContent=v};

  function injectStyles(){
    if(document.getElementById('mirsadAuthStyles'))return;
    const s=document.createElement('style');s.id='mirsadAuthStyles';s.textContent=`
      body.mirsad-auth-required > :not(#mirsadAuthGate){visibility:hidden!important}
      .mirsad-auth-gate{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:20px;background:radial-gradient(ellipse at top left,rgba(201,162,39,.06),transparent 45%),var(--bg);color:var(--text)}
      .mirsad-auth-card{width:min(420px,100%);text-align:center;padding:24px}.mirsad-auth-logo{width:68px;height:68px;margin:0 auto 18px;color:var(--gold)}.mirsad-auth-logo svg{width:100%;height:100%}
      .mirsad-auth-title{margin:0;font-family:var(--font-display);font-size:28px}.mirsad-auth-subtitle{margin:8px 0 24px;color:var(--text-dim);font-size:13px}.mirsad-auth-actions{display:grid;gap:10px}
      .mirsad-auth-input,.mirsad-auth-button{width:100%;min-height:46px;border-radius:999px;font:inherit}.mirsad-auth-input{padding:0 16px;border:1px solid var(--panel-border-strong);background:rgba(255,255,255,.03);color:var(--text);text-align:right;outline:none}.mirsad-auth-input:focus{border-color:var(--gold)}
      .mirsad-auth-button{border:1px solid var(--panel-border-strong);background:rgba(255,255,255,.03);color:var(--text);cursor:pointer}.mirsad-auth-button:disabled{opacity:.55;cursor:wait}.mirsad-auth-button.primary{border-color:var(--gold);background:var(--gold-soft);color:var(--gold)}
      .mirsad-auth-divider{color:var(--text-faint);font-size:12px}.mirsad-auth-status{min-height:22px;margin-top:12px;color:var(--text-dim);font-size:12px}.mirsad-auth-secondary{margin-top:10px;border:0;background:none;color:var(--text-dim);cursor:pointer;text-decoration:underline}
      .mirsad-otp-row{width:min(344px,calc(100% - 16px));max-width:344px;margin:0 auto;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:clamp(4px,1.6vw,6px);box-sizing:border-box;overflow:visible}.mirsad-otp-input{width:100%;min-width:0;box-sizing:border-box;height:46px;border-radius:10px;border:1px solid var(--panel-border-strong);background:rgba(255,255,255,.03);color:var(--text);text-align:center;font:600 19px var(--font-mono);outline:none}.mirsad-otp-input:focus{border-color:var(--gold)}@media (max-width:380px){.mirsad-otp-row{max-width:100%;gap:4px}.mirsad-otp-input{height:44px;font-size:18px}}
      .mirsad-profile-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:4500;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;border:1px solid var(--panel-border-strong);border-radius:14px;background:rgba(16,21,28,.97);box-shadow:0 12px 40px rgba(0,0,0,.28)}
      .mirsad-profile-banner__text{min-width:0}.mirsad-profile-banner__text strong{display:block}.mirsad-profile-banner__text span{display:block;color:var(--text-dim);font-size:12px;margin-top:3px}.mirsad-profile-banner__actions{display:flex;gap:8px;flex-shrink:0}
      .mirsad-profile-modal{position:fixed;inset:0;z-index:5100;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.72)}.mirsad-profile-panel{width:min(520px,100%);max-height:90vh;overflow:auto;padding:22px;border:1px solid var(--panel-border-strong);border-radius:22px;background:linear-gradient(180deg,rgba(22,29,39,.99),rgba(11,15,20,.99))}
      .mirsad-profile-panel h2{margin:0 0 16px;font-family:var(--font-display)}.mirsad-profile-grid{display:grid;gap:11px}.mirsad-profile-grid label{display:grid;gap:6px;color:var(--text-dim);font-size:12px}.mirsad-profile-grid input{min-height:44px;padding:10px 12px;border-radius:12px;border:1px solid var(--panel-border-strong);background:rgba(255,255,255,.03);color:var(--text)}.mirsad-profile-footer{display:flex;gap:10px;margin-top:16px}.mirsad-profile-footer button{flex:1}
      .mirsad-guest-exit{position:fixed;top:12px;left:12px;z-index:5400;display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:28px;padding:0 9px;border:1px solid var(--panel-border-strong);border-radius:999px;background:rgba(16,21,28,.82);backdrop-filter:blur(8px);color:var(--text-dim);font:500 10px var(--font-sans,inherit);cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.14)}
      .mirsad-guest-exit:hover{color:var(--text);border-color:var(--gold)}.mirsad-guest-exit:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
      .mirsad-user-menu{position:fixed;top:10px;left:10px;z-index:5400}
      .mirsad-user-button{width:34px;height:34px;padding:0;border-radius:50%;border:1px solid var(--gold);background:rgba(16,21,28,.88);color:var(--gold);display:grid;place-items:center;overflow:hidden;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18)}
      .mirsad-user-button img{width:100%;height:100%;object-fit:cover}.mirsad-user-initial{font-size:12px;font-weight:700}
      .mirsad-user-dropdown{position:absolute;top:42px;left:0;min-width:150px;padding:6px;border:1px solid var(--panel-border-strong);border-radius:12px;background:rgba(16,21,28,.98);box-shadow:0 10px 30px rgba(0,0,0,.28)}
      .mirsad-user-item{display:block;width:100%;padding:9px 10px;border:0;border-radius:8px;background:none;color:var(--text);text-align:right;font:inherit;cursor:pointer}.mirsad-user-item:hover{background:rgba(255,255,255,.06)}
      .mirsad-guest-lock-toast{position:fixed;left:16px;right:16px;bottom:18px;z-index:5500;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border:1px solid var(--panel-border-strong);border-radius:14px;background:rgba(16,21,28,.97);color:var(--text);box-shadow:0 10px 35px rgba(0,0,0,.3);opacity:0;transform:translateY(12px);transition:opacity .2s ease,transform .2s ease}
      .mirsad-guest-lock-toast.is-visible{opacity:1;transform:translateY(0)}.mirsad-guest-lock-toast__text{font-size:13px}.mirsad-guest-lock-toast__text small{display:block;color:var(--text-dim);margin-top:3px}.mirsad-guest-lock-toast__button{border:1px solid var(--gold);background:var(--gold-soft);color:var(--gold);border-radius:999px;padding:8px 13px;font:inherit;cursor:pointer;white-space:nowrap}
      @media(max-width:700px){.mirsad-profile-banner{align-items:flex-start;flex-direction:column}.mirsad-profile-banner__actions{width:100%}.mirsad-profile-banner__actions button{flex:1}.mirsad-guest-exit{top:8px;left:8px;min-width:32px;height:26px;padding:0 8px;font-size:9px}.mirsad-guest-lock-toast{bottom:12px;left:10px;right:10px}}
    `;document.head.appendChild(s);
  }

  function removeGuestExit(){document.getElementById('mirsadGuestExit')?.remove();}
  function showGuestExit(){
    injectStyles();if(document.getElementById('mirsadGuestExit'))return;
    const b=document.createElement('button');b.id='mirsadGuestExit';b.className='mirsad-guest-exit';b.type='button';b.textContent='تسجيل الدخول';b.setAttribute('aria-label','الخروج من وضع الزائر والعودة إلى صفحة تسجيل الدخول');
    b.addEventListener('click',()=>{localStorage.removeItem(CONFIG.GUEST_KEY);removeGuestExit();document.getElementById('mirsadGuestLockToast')?.remove();document.body.classList.add('mirsad-auth-required');showGate();});
    document.body.appendChild(b);
  }

  function showGuestLockToast(){
    injectStyles();let toast=document.getElementById('mirsadGuestLockToast');
    if(!toast){
      toast=document.createElement('aside');toast.id='mirsadGuestLockToast';toast.className='mirsad-guest-lock-toast';
      toast.innerHTML='<div class="mirsad-guest-lock-toast__text"><strong>سجّل الدخول لقراءة تفاصيل الخبر</strong><small>يمكنك متابعة الأخبار كزائر، لكن قراءة التفاصيل تتطلب حسابًا.</small></div><button class="mirsad-guest-lock-toast__button" type="button">تسجيل الدخول</button>';
      document.body.appendChild(toast);
      toast.querySelector('button').addEventListener('click',()=>{localStorage.removeItem(CONFIG.GUEST_KEY);toast.remove();document.body.classList.add('mirsad-auth-required');showGate();});
    }
    requestAnimationFrame(()=>toast.classList.add('is-visible'));clearTimeout(showGuestLockToast.timer);showGuestLockToast.timer=setTimeout(()=>{toast.classList.remove('is-visible');setTimeout(()=>toast.remove(),220)},5000);
  }

  function installGuestCardGuard(){
    document.addEventListener('click',(event)=>{
      if(!isGuest())return;
      const card=event.target.closest?.('.card');
      if(!card)return;
      event.preventDefault();event.stopImmediatePropagation();showGuestLockToast();
    },true);
    document.addEventListener('keydown',(event)=>{
      if(!isGuest()||(event.key!=='Enter'&&event.key!==' '))return;
      const card=event.target.closest?.('.card');
      if(!card)return;
      event.preventDefault();event.stopImmediatePropagation();showGuestLockToast();
    },true);
  }

  function gateMarkup(){return `<main class="mirsad-auth-card" aria-labelledby="mirsadAuthTitle"><div class="mirsad-auth-logo">${logo()}</div><h1 id="mirsadAuthTitle" class="mirsad-auth-title">مِرصاد</h1><p class="mirsad-auth-subtitle">رصد الشرق الأوسط لحظة بلحظة</p><div class="mirsad-auth-actions"><button id="mirsadGoogle" class="mirsad-auth-button primary" type="button">متابعة باستخدام Google</button><div class="mirsad-auth-divider">أو</div><input id="mirsadEmail" class="mirsad-auth-input" type="email" autocomplete="email" inputmode="email" placeholder="أدخل بريدك الإلكتروني" aria-label="البريد الإلكتروني"><button id="mirsadEmailContinue" class="mirsad-auth-button" type="button">متابعة</button></div><button id="mirsadGuest" class="mirsad-auth-secondary" type="button">متابعة كزائر</button><div id="mirsadAuthStatus" class="mirsad-auth-status" role="status" aria-live="polite"></div></main>`;}
  function showGate(){
    injectStyles();let gate=document.getElementById('mirsadAuthGate');if(!gate){gate=document.createElement('div');gate.id='mirsadAuthGate';gate.className='mirsad-auth-gate';document.body.appendChild(gate);}gate.innerHTML=gateMarkup();removeGuestExit();
    const status=gate.querySelector('#mirsadAuthStatus'),email=gate.querySelector('#mirsadEmail');
    gate.querySelector('#mirsadGoogle').addEventListener('click',async()=>{
      const btn=gate.querySelector('#mirsadGoogle');
      if(googleFlowActive && Date.now()-googleFlowStartedAt<GOOGLE_FLOW_TIMEOUT_MS)return;
      clearTimeout(googleFlowTimer);
      googleFlowActive=true;googleFlowStartedAt=Date.now();btn.disabled=true;statusText(status,'جارٍ فتح Google…');
      const timeout=()=>{googleFlowActive=false;btn.disabled=false;if(status?.textContent==='جارٍ فتح Google…')statusText(status,'');};
      googleFlowTimer=setTimeout(timeout,GOOGLE_FLOW_TIMEOUT_MS);
      try{
        const{error}=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirectTo(),queryParams:{prompt:'select_account'},skipBrowserRedirect:false}});
        if(error){clearTimeout(googleFlowTimer);googleFlowActive=false;btn.disabled=false;statusText(status,'تعذر فتح Google. حاول مرة أخرى.');}
      }catch(error){clearTimeout(googleFlowTimer);googleFlowActive=false;btn.disabled=false;statusText(status,'تعذر فتح Google. حاول مرة أخرى.');}
    });
    const sendOtp=async()=>{const value=email.value.trim();if(!/^\S+@\S+\.\S+$/.test(value)){statusText(status,'أدخل بريدًا إلكترونيًا صحيحًا.');return;}const button=gate.querySelector('#mirsadEmailContinue');button.disabled=true;statusText(status,'جارٍ إرسال رمز التحقق…');const{error}=await sb.auth.signInWithOtp({email:value,options:{shouldCreateUser:true}});button.disabled=false;if(error){statusText(status,'تعذر إرسال الرمز. '+(error.message||'حاول لاحقًا.'));return;}showOtp(value);};
    gate.querySelector('#mirsadEmailContinue').addEventListener('click',sendOtp);email.addEventListener('keydown',e=>{if(e.key==='Enter')sendOtp()});
    gate.querySelector('#mirsadGuest').addEventListener('click',()=>{localStorage.setItem(CONFIG.GUEST_KEY,'1');gate.remove();document.body.classList.remove('mirsad-auth-required');showGuestExit();});
  }

  function showOtp(email){
    const gate=document.getElementById('mirsadAuthGate');if(!gate)return;
    gate.innerHTML=`<main class="mirsad-auth-card" aria-labelledby="mirsadOtpTitle"><div class="mirsad-auth-logo">${logo()}</div><h1 id="mirsadOtpTitle" class="mirsad-auth-title">تحقق من بريدك</h1><p class="mirsad-auth-subtitle">أرسلنا رمزًا إلى ${maskEmail(email)}</p><div class="mirsad-otp-row" dir="ltr">${Array.from({length:8},(_,i)=>`<input class="mirsad-otp-input" maxlength="1" inputmode="numeric" ${i===0?'autocomplete="one-time-code" ':''}aria-label="الرقم ${i+1}">`).join('')}</div><div class="mirsad-auth-actions" style="margin-top:14px"><button id="mirsadOtpVerify" class="mirsad-auth-button primary" type="button">متابعة</button><button id="mirsadResend" class="mirsad-auth-button" type="button" disabled>إعادة إرسال الرمز (30)</button></div><button id="mirsadOtpBack" class="mirsad-auth-secondary" type="button">العودة</button><div id="mirsadAuthStatus" class="mirsad-auth-status" role="status" aria-live="polite"></div></main>`;
    const inputs=[...gate.querySelectorAll('.mirsad-otp-input')],status=gate.querySelector('#mirsadAuthStatus'),resend=gate.querySelector('#mirsadResend');let remaining=30;
    const timer=setInterval(()=>{if(!document.getElementById('mirsadAuthGate')){clearInterval(timer);return;}remaining-=1;resend.textContent=remaining>0?`إعادة إرسال الرمز (${remaining})`:'إعادة إرسال الرمز';if(remaining<=0){clearInterval(timer);resend.disabled=false}},1000);
    inputs.forEach((input,i)=>{input.addEventListener('input',()=>{input.value=input.value.replace(/\D/g,'').slice(-1);if(input.value&&inputs[i+1])inputs[i+1].focus()});input.addEventListener('keydown',e=>{if(e.key==='Backspace'&&!input.value&&inputs[i-1])inputs[i-1].focus()});input.addEventListener('paste',e=>{const v=(e.clipboardData?.getData('text')||'').replace(/\D/g,'').slice(0,8-i);if(!v)return;e.preventDefault();[...v].forEach((n,j)=>{if(inputs[i+j])inputs[i+j].value=n});inputs[Math.min(i+v.length,8)-1]?.focus()})});
    gate.querySelector('#mirsadOtpBack').addEventListener('click',showGate);
    resend.addEventListener('click',async()=>{resend.disabled=true;statusText(status,'جارٍ إرسال رمز جديد…');const{error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:true}});if(error){statusText(status,'تعذر إعادة إرسال الرمز. حاول لاحقًا.');resend.disabled=false;return;}remaining=30;statusText(status,'تم إرسال رمز جديد.');const tick=setInterval(()=>{remaining-=1;resend.textContent=remaining>0?`إعادة إرسال الرمز (${remaining})`:'إعادة إرسال الرمز';if(remaining<=0){clearInterval(tick);resend.disabled=false}},1000)});
    gate.querySelector('#mirsadOtpVerify').addEventListener('click',async()=>{const token=inputs.map(x=>x.value).join('');if(!/^\d{8}$/.test(token)){statusText(status,'أدخل رمز التحقق المكوّن من 8 أرقام.');return;}const btn=gate.querySelector('#mirsadOtpVerify');btn.disabled=true;statusText(status,'جارٍ التحقق…');const{data,error}=await sb.auth.verifyOtp({email,token,type:'email'});if(error||!data?.session?.user){btn.disabled=false;statusText(status,'رمز التحقق غير صحيح أو منتهي.');return;}await finishAuthenticated(data.session.user)});
    inputs[0]?.focus();
  }

  async function ensureProfile(user){
    const meta=user.user_metadata||{};
    const selectCols='id,display_name,username,bio,avatar_url,onboarding_completed';
    const{data:existing}=await sb.from(CONFIG.PROFILE_TABLE).select(selectCols).eq('id',user.id).maybeSingle();
    if(existing)return existing;
    const payload={id:user.id,display_name:meta.full_name||meta.name||'',avatar_url:meta.avatar_url||meta.picture||null};
    const{data,error}=await sb.from(CONFIG.PROFILE_TABLE).upsert(payload,{onConflict:'id'}).select(selectCols).maybeSingle();
    if(data)return data;
    const{data:again}=await sb.from(CONFIG.PROFILE_TABLE).select(selectCols).eq('id',user.id).maybeSingle();
    if(again)return again;
    if(error)throw error;
    return {id:user.id,display_name:payload.display_name,username:null,bio:null,onboarding_completed:false};
  }

  const isProfilePage=()=>window.location.pathname.endsWith('/profile.html');
  const profilePageUrl=()=>new URL('profile.html',window.location.href).href;
  const avatarUrl=value=>{try{const url=new URL(String(value||'').trim());return ['https:','http:'].includes(url.protocol)?url.href:''}catch{return ''}};
  function renderProfilePage(user,profile){
    const root=document.getElementById('mirsadProfilePage');if(!root)return;
    const safe=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const avatar=avatarUrl(profile?.avatar_url||user.user_metadata?.avatar_url||user.user_metadata?.picture||'');
    const initial=(profile?.display_name||user.email||'مِ').trim().charAt(0).toUpperCase();
    root.innerHTML=`<div class="mirsad-profile-page__shell"><header class="mirsad-profile-page__header"><div class="mirsad-profile-page__brand"><span aria-hidden="true">◉</span><span>مِرصاد</span></div><button class="mirsad-profile-page__back" type="button" data-back>العودة للأخبار</button></header><section class="mirsad-profile-page__card"><div class="mirsad-profile-page__avatar">${avatar?`<img src="${safe(avatar)}" alt="" loading="lazy">`:`<span>${safe(initial)}</span>`}</div><h1 class="mirsad-profile-page__title">ملفي الشخصي</h1><p class="mirsad-profile-page__intro">إدارة معلوماتك وتجربتك في مِرصاد.</p><div class="mirsad-profile-grid"><label>البريد الإلكتروني<input value="${safe(user.email||'')}" disabled></label><label>الاسم<input id="profilePageName" maxlength="80" value="${safe(profile?.display_name||'')}" placeholder="اسمك"></label><label>رابط الصورة<input id="profilePageAvatar" maxlength="500" value="${safe(profile?.avatar_url||'')}" placeholder="رابط صورة اختياري"></label><label>اسم المستخدم<input id="profilePageUsername" maxlength="30" value="${safe(profile?.username||'')}" placeholder="اسم مستخدم"></label><label>نبذة قصيرة<input id="profilePageBio" maxlength="160" value="${safe(profile?.bio||'')}" placeholder="اختياري"></label></div><div class="mirsad-profile-page__actions"><button class="mirsad-auth-button primary" type="button" data-save>حفظ ومتابعة</button><button class="mirsad-auth-button" type="button" data-signout>تسجيل الخروج</button></div><div id="mirsadProfilePageStatus" class="mirsad-auth-status" role="status" aria-live="polite"></div><div class="mirsad-profile-page__danger"><button class="mirsad-auth-button" type="button" data-delete>حذف الحساب</button></div></section></div>`;
    root.hidden=false;
    root.querySelector('.mirsad-profile-page__avatar img')?.addEventListener('error',event=>{event.currentTarget.remove();const fallback=document.createElement('span');fallback.textContent=initial;root.querySelector('.mirsad-profile-page__avatar')?.appendChild(fallback)});
    root.querySelector('[data-back]').addEventListener('click',()=>{window.location.href=new URL('index.html',window.location.href).href});
    root.querySelector('[data-signout]').addEventListener('click',async()=>{const{error}=await sb.auth.signOut({scope:'local'});if(error){statusText(root.querySelector('#mirsadProfilePageStatus'),'تعذر تسجيل الخروج. حاول مرة أخرى.');return}window.location.href=new URL('index.html',window.location.href).href});
    root.querySelector('[data-save]').addEventListener('click',async()=>{const status=root.querySelector('#mirsadProfilePageStatus'),btn=root.querySelector('[data-save]');const payload={id:user.id,display_name:root.querySelector('#profilePageName').value.trim(),avatar_url:avatarUrl(root.querySelector('#profilePageAvatar').value)||null,username:root.querySelector('#profilePageUsername').value.trim()||null,bio:root.querySelector('#profilePageBio').value.trim()||null,onboarding_completed:true};btn.disabled=true;statusText(status,'جارٍ الحفظ…');const{error}=await sb.from(CONFIG.PROFILE_TABLE).upsert(payload,{onConflict:'id'});btn.disabled=false;if(error){statusText(status,'تعذر حفظ الملف. تحقق من البيانات وحاول مجددًا.');return}statusText(status,'تم حفظ الملف بنجاح.')});
    root.querySelector('[data-delete]').addEventListener('click',async()=>{const status=root.querySelector('#mirsadProfilePageStatus');if(!window.confirm('هل أنت متأكد من حذف حسابك؟ سيتم حذف بيانات ملفك وتسجيل خروجك.'))return;const{error}=await sb.functions.invoke('delete-account',{body:{}});if(error){statusText(status,'تعذر حذف الحساب. حاول مرة أخرى.');return}window.location.href=new URL('index.html',window.location.href).href});
  }

  async function openProfile(user){
    if(isProfilePage()){renderProfilePage(user,await ensureProfile(user));return}
    window.location.href=profilePageUrl();
  }

  function showProfileBanner(user){
    if(document.getElementById('mirsadProfileBanner'))return;
    const b=document.createElement('aside');b.id='mirsadProfileBanner';b.className='mirsad-profile-banner';b.innerHTML=`<div class="mirsad-profile-banner__text"><strong>أكمل ملفك الشخصي</strong><span>أضف معلوماتك لتخصيص تجربتك في مِرصاد.</span></div><div class="mirsad-profile-banner__actions"><button class="mirsad-auth-button primary" type="button" data-open>إكمال الملف</button><button class="mirsad-auth-button" type="button" data-later>لاحقًا</button></div>`;document.body.appendChild(b);b.querySelector('[data-open]').addEventListener('click',()=>openProfile(user));b.querySelector('[data-later]').addEventListener('click',()=>b.remove());
  }

  function showUserMenu(user,profile=null){
    document.getElementById('mirsadUserMenu')?.remove();
    const wrap=document.createElement('div');wrap.id='mirsadUserMenu';wrap.className='mirsad-user-menu';
    const initial=(user.email||'مِ').trim().charAt(0).toUpperCase();
    const avatar=avatarUrl(profile?.avatar_url||user.user_metadata?.avatar_url||user.user_metadata?.picture||'');
    wrap.innerHTML=`<button class="mirsad-user-button" type="button" aria-label="الملف الشخصي">${avatar?`<img src="${String(avatar).replace(/"/g,'&quot;')}" alt="">`:`<span class="mirsad-user-initial">${initial}</span>`}</button><div class="mirsad-user-dropdown" hidden><button class="mirsad-user-item" type="button" data-profile>الملف الشخصي</button><button class="mirsad-user-item" type="button" data-signout>تسجيل الخروج</button></div>`;
    document.body.appendChild(wrap);
    const btn=wrap.querySelector('.mirsad-user-button'),menu=wrap.querySelector('.mirsad-user-dropdown');
    btn.addEventListener('click',()=>{menu.hidden=!menu.hidden});
    wrap.querySelector('[data-profile]').addEventListener('click',()=>{menu.hidden=true;window.location.href=profilePageUrl()});
    wrap.querySelector('[data-signout]').addEventListener('click',async()=>{const{error}=await sb.auth.signOut({scope:'local'});if(error){console.error('[mirsad auth] signout failed',error);return;}menu.hidden=true;wrap.remove();document.body.classList.add('mirsad-auth-required');showGate()});
    document.addEventListener('click',e=>{if(!wrap.contains(e.target))menu.hidden=true},{once:false});
  }
  
  async function finishAuthenticated(user){
    localStorage.removeItem(CONFIG.GUEST_KEY);removeGuestExit();
    // Authentication success must reveal the app immediately; profile hydration is non-blocking.
    document.getElementById('mirsadAuthGate')?.remove();document.body.classList.remove('mirsad-auth-required');document.getElementById('mirsadGuestLockToast')?.remove();
    let profile=null;
    try{profile=await withAuthTimeout(ensureProfile(user),5000)}catch(error){console.error('[mirsad auth] profile setup failed',error)}
    showUserMenu(user,profile);
    if(isProfilePage()){renderProfilePage(user,profile||{});return;}if(profile && !profile.onboarding_completed)setTimeout(()=>showProfileBanner(user),350);
  }

  function resetOAuthButtonAfterReturn(){
    clearTimeout(googleFlowTimer);googleFlowActive=false;googleFlowStartedAt=0;
    const gate=document.getElementById('mirsadAuthGate');
    if(!gate)return;
    const btn=gate.querySelector('#mirsadGoogle');
    if(btn){btn.disabled=false;}
    const status=gate.querySelector('#mirsadAuthStatus');
    if(status && status.textContent==='جارٍ فتح Google…')status.textContent='';
  }

  window.addEventListener('pageshow',()=>resetOAuthButtonAfterReturn());
  window.addEventListener('popstate',()=>resetOAuthButtonAfterReturn());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resetOAuthButtonAfterReturn()});

  const AUTH_RECOVERY_TIMEOUT_MS=8000;
  const withAuthTimeout=(promise,ms)=>Promise.race([promise,new Promise(resolve=>setTimeout(()=>resolve(null),ms))]);
  async function recoverSession(){
    if(!sb)return null;
    try{
      const url=new URL(window.location.href);
      const code=url.searchParams.get('code');
      if(code){
        const{data,error}=await sb.auth.exchangeCodeForSession(code);
        if(error)console.error('[mirsad auth] oauth exchange failed',error);
        if(data?.session?.user)return data.session;
      }
      let {data,error}=await sb.auth.getSession();
      if(error)console.error('[mirsad auth] session lookup failed',error);
      if(data?.session?.user)return data.session;
      if(window.location.hash.includes('access_token=')){
        for(let i=0;i<20 && !data?.session?.user;i++){
          await new Promise(resolve=>setTimeout(resolve,150));
          ({data}=await sb.auth.getSession());
        }
      }
      return data?.session||null;
    }catch(error){
      console.error('[mirsad auth] session recovery failed',error);
      return null;
    }
  }

  if(sb)sb.auth.onAuthStateChange((event,session)=>{
    if((event==='SIGNED_IN'||event==='USER_UPDATED') && session?.user){
      if(document.getElementById('mirsadAuthGate') || document.body.classList.contains('mirsad-auth-required')){
        void finishAuthenticated(session.user);
      }
    }
  });

  async function init(){
    injectStyles();installGuestCardGuard();document.body.classList.add('mirsad-auth-required');
    if(!supabaseReady){
      showGate();
      statusText(document.getElementById('mirsadAuthStatus'),'تعذر تحميل خدمة تسجيل الدخول. أعد تحديث الصفحة للمحاولة مرة أخرى.');
      return;
    }
    const oauthError=readOAuthError();
    const session=await withAuthTimeout(recoverSession(),AUTH_RECOVERY_TIMEOUT_MS);
    cleanAuthUrl();
    if(session?.user){
      await finishAuthenticated(session.user);return;
    }
    if(isGuest()){if(isProfilePage()){localStorage.removeItem(CONFIG.GUEST_KEY);showGate();return;}document.body.classList.remove('mirsad-auth-required');showGuestExit();return;}
    showGate();
    if(oauthError)statusText(document.getElementById('mirsadAuthStatus'),'تعذر إكمال تسجيل الدخول عبر Google. حاول مرة أخرى.');
  }
  const start=()=>{if(document.body)void init()};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
