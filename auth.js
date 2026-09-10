(() => {
  'use strict';

  const CONFIG = {
    SUPABASE_URL: 'https://dndlkenyfymlrjnslyzb.supabase.co',
    SUPABASE_KEY: 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx',
    PROFILE_TABLE: 'profiles',
    GUEST_KEY: 'mirsad.guest.v1',
    PROFILE_DONE_KEY: 'mirsad.profile.completed.v1'
  };

  if (!window.supabase) return;
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

  const maskEmail = (email) => {
    const [name, domain] = String(email || '').split('@');
    if (!domain) return email;
    return `${(name || '').slice(0, 1)}•••@${domain}`;
  };

  const logo = () => `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="32" cy="32" r="7" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 13v9M32 42v9M13 32h9M42 32h9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="32" r="2.5" fill="currentColor"/></svg>`;

  const setStatus = (el, text) => { if (el) el.textContent = text; };

  function addStyles() {
    if (document.getElementById('mirsadAuthStyles')) return;
    const style = document.createElement('style');
    style.id = 'mirsadAuthStyles';
    style.textContent = `
      body.mirsad-auth-required > :not(#mirsadAuthGate) { visibility:hidden !important; }
      .mirsad-auth-gate{position:fixed;inset:0;z-index:5000;display:grid;place-items:center;padding:20px;background:radial-gradient(ellipse at top left,rgba(201,162,39,.06),transparent 45%),var(--bg);color:var(--text)}
      .mirsad-auth-card{width:min(420px,100%);text-align:center;padding:24px}
      .mirsad-auth-logo{width:68px;height:68px;margin:0 auto 18px;color:var(--gold)}
      .mirsad-auth-logo svg{width:100%;height:100%}
      .mirsad-auth-title{margin:0;font-family:var(--font-display);font-size:28px}
      .mirsad-auth-subtitle{margin:8px 0 24px;color:var(--text-dim);font-size:13px}
      .mirsad-auth-actions{display:grid;gap:10px}
      .mirsad-auth-input,.mirsad-auth-button{width:100%;min-height:46px;border-radius:999px;font:inherit}
      .mirsad-auth-input{padding:0 16px;border:1px solid var(--panel-border-strong);background:rgba(255,255,255,.03);color:var(--text);text-align:right;outline:none}
      .mirsad-auth-input:focus{border-color:var(--gold)}
      .mirsad-auth-button{border:1px solid var(--panel-border-strong);background:rgba(255,255,255,.03);color:var(--text);cursor:pointer}
      .mirsad-auth-button.primary{border-color:var(--gold);background:var(--gold-soft);color:var(--gold)}
      .mirsad-auth-divider{color:var(--text-faint);font-size:12px}
      .mirsad-auth-status{min-height:22px;margin-top:12px;color:var(--text-dim);font-size:12px}
      .mirsad-auth-secondary{margin-top:10px;border:0;background:none;color:var(--text-dim);cursor:pointer;text-decoration:underline}
      .mirsad-otp-row{display:flex;justify-content:center;gap:8px}
      .mirsad-otp-input{width:48px;height:54px;border-radius:12px;border:1px solid var(--panel-border-strong);background:rgba(255,255,255,.03);color:var(--text);text-align:center;font:600 22px var(--font-mono);outline:none}
      .mirsad-otp-input:focus{border-color:var(--gold)}
      .mirsad-otp-resend{color:var(--text-dim);font-size:12px}
      .mirsad-profile-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:4500;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;border:1px solid var(--panel-border-strong);border-radius:14px;background:rgba(16,21,28,.97);box-shadow:0 12px 40px rgba(0,0,0,.28)}
      .mirsad-profile-banner__text{min-width:0}.mirsad-profile-banner__text strong{display:block}.mirsad-profile-banner__text span{display:block;color:var(--text-dim);font-size:12px;margin-top:3px}
      .mirsad-profile-banner__actions{display:flex;gap:8px;flex-shrink:0}
      .mirsad-profile-modal{position:fixed;inset:0;z-index:5100;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.72)}
      .mirsad-profile-panel{width:min(520px,100%);max-height:90vh;overflow:auto;padding:22px;border:1px solid var(--panel-border-strong);border-radius:22px;background:linear-gradient(180deg,rgba(22,29,39,.99),rgba(11,15,20,.99))}
      .mirsad-profile-panel h2{margin:0 0 16px;font-family:var(--font-display)}
      .mirsad-profile-grid{display:grid;gap:11px}.mirsad-profile-grid label{display:grid;gap:6px;color:var(--text-dim);font-size:12px}
      .mirsad-profile-grid input{min-height:44px;padding:10px 12px;border-radius:12px;border:1px solid var(--panel-border-strong);background:rgba(255,255,255,.03);color:var(--text)}
      .mirsad-profile-footer{display:flex;gap:10px;margin-top:16px}.mirsad-profile-footer button{flex:1}
      @media(max-width:700px){.mirsad-profile-banner{align-items:flex-start;flex-direction:column}.mirsad-profile-banner__actions{width:100%}.mirsad-profile-banner__actions button{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function gateMarkup() {
    return `<main class="mirsad-auth-card" aria-labelledby="mirsadAuthTitle">
      <div class="mirsad-auth-logo">${logo()}</div>
      <h1 id="mirsadAuthTitle" class="mirsad-auth-title">مِرصاد</h1>
      <p class="mirsad-auth-subtitle">رصد الشرق الأوسط لحظة بلحظة</p>
      <div class="mirsad-auth-actions">
        <button id="mirsadGoogle" class="mirsad-auth-button primary" type="button">متابعة باستخدام Google</button>
        <div class="mirsad-auth-divider">أو</div>
        <input id="mirsadEmail" class="mirsad-auth-input" type="email" autocomplete="email" inputmode="email" placeholder="أدخل بريدك الإلكتروني" aria-label="البريد الإلكتروني">
        <button id="mirsadEmailContinue" class="mirsad-auth-button" type="button">متابعة</button>
      </div>
      <button id="mirsadGuest" class="mirsad-auth-secondary" type="button">متابعة كزائر</button>
      <div id="mirsadAuthStatus" class="mirsad-auth-status" role="status" aria-live="polite"></div>
    </main>`;
  }

  function showGate() {
    addStyles();
    let gate = document.getElementById('mirsadAuthGate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'mirsadAuthGate';
      gate.className = 'mirsad-auth-gate';
      document.body.appendChild(gate);
    }
    gate.innerHTML = gateMarkup();

    const status = gate.querySelector('#mirsadAuthStatus');
    const email = gate.querySelector('#mirsadEmail');

    gate.querySelector('#mirsadGoogle').addEventListener('click', async () => {
      setStatus(status, 'جارٍ فتح Google…');
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
      if (error) setStatus(status, 'تعذر تسجيل الدخول عبر Google حاليًا.');
    });

    const sendOtp = async () => {
      const value = email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(value)) {
        setStatus(status, 'أدخل بريدًا إلكترونيًا صحيحًا.');
        return;
      }
      const button = gate.querySelector('#mirsadEmailContinue');
      button.disabled = true;
      setStatus(status, 'جارٍ إرسال رمز التحقق…');
      const { error } = await sb.auth.signInWithOtp({ email: value, options: { shouldCreateUser: true } });
      button.disabled = false;
      if (error) {
        setStatus(status, error.message || 'تعذر إرسال رمز التحقق.');
        return;
      }
      showOtp(value);
    };

    gate.querySelector('#mirsadEmailContinue').addEventListener('click', sendOtp);
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendOtp(); });

    gate.querySelector('#mirsadGuest').addEventListener('click', () => {
      localStorage.setItem(CONFIG.GUEST_KEY, '1');
      gate.remove();
      document.body.classList.remove('mirsad-auth-required');
    });
  }

  function showOtp(email) {
    const gate = document.getElementById('mirsadAuthGate');
    if (!gate) return;
    gate.innerHTML = `<main class="mirsad-auth-card" aria-labelledby="mirsadOtpTitle">
      <div class="mirsad-auth-logo">${logo()}</div>
      <h1 id="mirsadOtpTitle" class="mirsad-auth-title">تحقق من بريدك</h1>
      <p class="mirsad-auth-subtitle">أرسلنا رمزًا إلى ${maskEmail(email)}</p>
      <div class="mirsad-otp-row" dir="ltr">
        <input class="mirsad-otp-input" maxlength="1" inputmode="numeric" autocomplete="one-time-code" aria-label="الرقم الأول">
        <input class="mirsad-otp-input" maxlength="1" inputmode="numeric" aria-label="الرقم الثاني">
        <input class="mirsad-otp-input" maxlength="1" inputmode="numeric" aria-label="الرقم الثالث">
        <input class="mirsad-otp-input" maxlength="1" inputmode="numeric" aria-label="الرقم الرابع">
        <input class="mirsad-otp-input" maxlength="1" inputmode="numeric" aria-label="الرقم الخامس">
        <input class="mirsad-otp-input" maxlength="1" inputmode="numeric" aria-label="الرقم السادس">
      </div>
      <div class="mirsad-auth-actions" style="margin-top:14px">
        <button id="mirsadOtpVerify" class="mirsad-auth-button primary" type="button">متابعة</button>
        <button id="mirsadResend" class="mirsad-auth-button" type="button" disabled>إعادة إرسال الرمز (30)</button>
      </div>
      <button id="mirsadOtpBack" class="mirsad-auth-secondary" type="button">العودة</button>
      <div id="mirsadAuthStatus" class="mirsad-auth-status" role="status" aria-live="polite"></div>
    </main>`;

    const inputs = [...gate.querySelectorAll('.mirsad-otp-input')];
    const status = gate.querySelector('#mirsadAuthStatus');
    const resend = gate.querySelector('#mirsadResend');
    let remaining = 30;
    const timer = setInterval(() => {
      if (!document.getElementById('mirsadAuthGate')) { clearInterval(timer); return; }
      remaining -= 1;
      resend.textContent = remaining > 0 ? `إعادة إرسال الرمز (${remaining})` : 'إعادة إرسال الرمز';
      if (remaining <= 0) { clearInterval(timer); resend.disabled = false; }
    }, 1000);

    inputs.forEach((input, i) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(-1);
        if (input.value && inputs[i + 1]) inputs[i + 1].focus();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && inputs[i - 1]) inputs[i - 1].focus();
      });
      input.addEventListener('paste', (e) => {
        const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (!text) return;
        e.preventDefault();
        [...text].forEach((n, j) => { if (inputs[j]) inputs[j].value = n; });
        inputs[Math.min(text.length, 6) - 1]?.focus();
      });
    });

    gate.querySelector('#mirsadOtpBack').addEventListener('click', () => showGate());
    resend.addEventListener('click', async () => {
      resend.disabled = true;
      setStatus(status, 'جارٍ إرسال رمز جديد…');
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) {
        setStatus(status, 'تعذر إعادة إرسال الرمز. حاول لاحقًا.');
        resend.disabled = false;
      } else {
        remaining = 30;
        setStatus(status, 'تم إرسال رمز جديد.');
        setTimeout(() => { if (remaining > 0) resend.disabled = true; }, 0);
      }
    });

    gate.querySelector('#mirsadOtpVerify').addEventListener('click', async () => {
      const token = inputs.map(x => x.value).join('');
      if (!/^\d{6}$/.test(token)) { setStatus(status, 'أدخل رمز التحقق المكوّن من 6 أرقام.'); return; }
      setStatus(status, 'جارٍ التحقق…');
      const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      if (error || !data?.session?.user) {
        setStatus(status, 'رمز التحقق غير صحيح أو منتهي.');
        return;
      }
      await finishAuthenticated(data.session.user);
    });
    inputs[0]?.focus();
  }

  async function ensureProfile(user) {
    const meta = user.user_metadata || {};
    const payload = {
      id: user.id,
      display_name: meta.full_name || meta.name || '',
      avatar_url: meta.avatar_url || meta.picture || null
    };
    const { data: existing } = await sb.from(CONFIG.PROFILE_TABLE).select('id,display_name,username,bio,onboarding_completed').eq('id', user.id).maybeSingle();
    if (!existing) await sb.from(CONFIG.PROFILE_TABLE).insert(payload);
    return existing || payload;
  }

  async function openProfile(user) {
    const { data: profile } = await sb.from(CONFIG.PROFILE_TABLE).select('display_name,username,bio,onboarding_completed').eq('id', user.id).maybeSingle();
    const p = profile || {};
    const modal = document.createElement('div');
    modal.className = 'mirsad-profile-modal';
    modal.innerHTML = `<section class="mirsad-profile-panel" role="dialog" aria-modal="true" aria-labelledby="mirsadProfileTitle">
      <h2 id="mirsadProfileTitle">ملفي الشخصي</h2>
      <div class="mirsad-profile-grid">
        <label>البريد الإلكتروني<input value="${String(user.email || '').replace(/"/g,'&quot;')}" disabled></label>
        <label>الاسم<input id="profileName" maxlength="80" value="${String(p.display_name || '').replace(/"/g,'&quot;')}" placeholder="اسمك"></label>
        <label>اسم المستخدم<input id="profileUsername" maxlength="30" value="${String(p.username || '').replace(/"/g,'&quot;')}" placeholder="اسم مستخدم"></label>
        <label>نبذة قصيرة<input id="profileBio" maxlength="160" value="${String(p.bio || '').replace(/"/g,'&quot;')}" placeholder="اختياري"></label>
      </div>
      <div class="mirsad-profile-footer"><button class="mirsad-auth-button primary" type="button" data-save>حفظ</button><button class="mirsad-auth-button" type="button" data-close>إغلاق</button></div>
      <div id="mirsadProfileStatus" class="mirsad-auth-status" role="status" aria-live="polite"></div>
    </section>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-close]').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('[data-save]').addEventListener('click', async () => {
      const status = modal.querySelector('#mirsadProfileStatus');
      const payload = {
        display_name: modal.querySelector('#profileName').value.trim(),
        username: modal.querySelector('#profileUsername').value.trim() || null,
        bio: modal.querySelector('#profileBio').value.trim(),
        onboarding_completed: true
      };
      setStatus(status, 'جارٍ الحفظ…');
      const { error } = await sb.from(CONFIG.PROFILE_TABLE).update(payload).eq('id', user.id);
      if (error) { setStatus(status, 'تعذر حفظ الملف. تحقق من اسم المستخدم وحاول مجددًا.'); return; }
      localStorage.setItem(CONFIG.PROFILE_DONE_KEY, '1');
      modal.remove();
    });
  }

  async function finishAuthenticated(user) {
    localStorage.removeItem(CONFIG.GUEST_KEY);
    await ensureProfile(user);
    const gate = document.getElementById('mirsadAuthGate');
    gate?.remove();
    document.body.classList.remove('mirsad-auth-required');

    const { data: profile } = await sb.from(CONFIG.PROFILE_TABLE).select('onboarding_completed').eq('id', user.id).maybeSingle();
    if (!profile?.onboarding_completed && localStorage.getItem(CONFIG.PROFILE_DONE_KEY) !== '1') {
      setTimeout(() => {
        if (document.getElementById('mirsadProfileBanner')) return;
        const banner = document.createElement('aside');
        banner.id = 'mirsadProfileBanner';
        banner.className = 'mirsad-profile-banner';
        banner.innerHTML = `<div class="mirsad-profile-banner__text"><strong>أكمل ملفك الشخصي</strong><span>أضف معلوماتك لتخصيص تجربتك في مِرصاد.</span></div><div class="mirsad-profile-banner__actions"><button class="mirsad-auth-button primary" type="button" data-open>إكمال الملف</button><button class="mirsad-auth-button" type="button" data-later>لاحقًا</button></div>`;
        document.body.appendChild(banner);
        banner.querySelector('[data-open]').addEventListener('click', () => openProfile(user));
        banner.querySelector('[data-later]').addEventListener('click', () => banner.remove());
      }, 350);
    }
  }

  async function init() {
    addStyles();
    document.body.classList.add('mirsad-auth-required');
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      await finishAuthenticated(data.session.user);
      return;
    }
    if (localStorage.getItem(CONFIG.GUEST_KEY) === '1') {
      document.body.classList.remove('mirsad-auth-required');
      return;
    }
    showGate();
    sb.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) await finishAuthenticated(session.user);
    });
  }

  const start = () => { if (!document.body) return; void init(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();