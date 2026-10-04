(() => {
  'use strict';
  if (window.__mirsadNav) return;
  window.__mirsadNav = true;
  var DRAWER = "<div class=\"mirsad-drawer\" id=\"mirsadDrawer\" hidden>\n    <div class=\"mirsad-drawer-backdrop\" data-mirsad-close></div>\n    <div class=\"mirsad-drawer-panel\" role=\"dialog\" aria-modal=\"true\" aria-label=\"القائمة\">\n      <div class=\"mirsad-drawer-head\"><span class=\"mirsad-drawer-mark\"><svg viewBox=\"0 0 64 64\" aria-hidden=\"true\"><circle cx=\"32\" cy=\"32\" r=\"22\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\"/><circle cx=\"32\" cy=\"32\" r=\"7\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\"/><path d=\"M32 13v9M32 42v9M13 32h9M42 32h9\" stroke=\"currentColor\" stroke-width=\"3\" stroke-linecap=\"round\"/><circle cx=\"32\" cy=\"32\" r=\"2.5\" fill=\"currentColor\"/></svg></span><button type=\"button\" class=\"mirsad-drawer-close\" data-mirsad-close aria-label=\"إغلاق\">×</button></div>\n      <nav class=\"mirsad-drawer-nav\"><ul class=\"mirsad-drawer-list\"><li><a class=\"mirsad-drawer-item\" href=\"index.html\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z\"/></svg><span>الرئيسية</span></a></li><li><a class=\"mirsad-drawer-item\" href=\"live.html\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 12h2l2-5 4 10 2-5h4\"/></svg><span>البث المباشر</span></a></li><li><a class=\"mirsad-drawer-item\" href=\"coverage.html\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"M4 12h16M12 4c2.2 2.4 3.3 5.1 3.3 8s-1.1 5.6-3.3 8c-2.2-2.4-3.3-5.1-3.3-8s1.1-5.6 3.3-8z\"/></svg><span>أخبار الدول</span></a></li><li><a class=\"mirsad-drawer-item\" href=\"english-desk.html\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 7h8M5 12h6M5 17h8\"/><path d=\"M16 8.5c1.4-1.3 3.6-1 4.4.7.8 1.5.1 3.2-1.4 4\"/></svg><span>الإنجليزية</span></a></li><li><a class=\"mirsad-drawer-item\" href=\"archive.html\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 7h16v3H4zM6 10v8h12v-8\"/><path d=\"M10 14h4\"/></svg><span>الأرشيف</span></a></li><li><a class=\"mirsad-drawer-item\" href=\"sources.html\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 4 4 8l8 4 8-4-8-4z\"/><path d=\"M4 12l8 4 8-4\"/><path d=\"M4 16l8 4 8-4\"/></svg><span>المصادر</span></a></li><li><a class=\"mirsad-drawer-item\" href=\"method.html\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 19V9M10 19V5M15 19v-7M20 19V8\"/></svg><span>التحليل</span></a></li></ul><hr class=\"mirsad-drawer-rule\"><ul class=\"mirsad-drawer-list\"><li><a class=\"mirsad-drawer-item\" href=\"handbook.html\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"m15.5 8.5-2.2 5.3L8 16l2.2-5.3z\"/></svg><span>الدليل</span></a></li><li><a class=\"mirsad-drawer-item\" href=\"community.html\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16.5 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z\"/><path d=\"M3.5 19c.6-2.4 2.4-3.5 4.5-3.5s3.9 1.1 4.5 3.5M13 15.6c.7-.4 1.6-.6 2.6-.6 1.8 0 3.3.9 3.9 2.8\"/></svg><span>المجتمع</span></a></li><li><a class=\"mirsad-drawer-item\" href=\"settings.html\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 4v2M12 18v2M4 12h2M18 12h2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4\"/></svg><span>الإعدادات</span></a></li></ul></nav>\n    </div>\n  </div>";
  function button() {
    var nodes = document.querySelectorAll('.mirsad-logo-btn');
    var btn = nodes[0] || null;
    var i;
    for (i = 1; i < nodes.length; i += 1) nodes[i].remove();
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'القائمة');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="32" cy="32" r="7" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 13v9M32 42v9M13 32h9M42 32h9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="32" r="2.5" fill="currentColor"/></svg>';
    }
    btn.className = 'mirsad-logo-btn mirsad-logo-btn--fixed';
    btn.id = 'mirsadLogo';
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
    btn.style.setProperty('position', 'fixed', 'important');
    btn.style.setProperty('top', 'max(10px, env(safe-area-inset-top))', 'important');
    btn.style.setProperty('bottom', 'auto', 'important');
    btn.style.setProperty('inset-inline-start', 'max(12px, env(safe-area-inset-inline-start, 0px))', 'important');
    btn.style.setProperty('inset-inline-end', 'auto', 'important');
    btn.style.setProperty('margin', '0', 'important');
    document.body.classList.add('mirsad-has-logo');
    return btn;
  }
  function boot() {
    if (!document.body) return;
    var btn = button();
    var drawer = document.getElementById('mirsadDrawer');
    if (!drawer) {
      document.body.insertAdjacentHTML('beforeend', DRAWER);
      drawer = document.getElementById('mirsadDrawer');
    }
    var file = (location.pathname.split('/').pop() || 'index.html').split('?')[0] || 'index.html';
    if (file === '' || file === '/') file = 'index.html';
    drawer.querySelectorAll('a[href]').forEach(function (link) {
      if (link.getAttribute('href') === file) link.setAttribute('aria-current', 'page');
    });
    var wait = 0;
    var lock = function (on) {
      document.documentElement.classList.toggle('mirsad-nav-lock', on);
      document.body.classList.toggle('mirsad-nav-lock', on);
    };
    var open = function () {
      drawer.hidden = false;
      requestAnimationFrame(function () { drawer.classList.add('is-open'); });
      btn.setAttribute('aria-expanded', 'true');
      lock(true);
      var closeBtn = drawer.querySelector('.mirsad-drawer-close');
      if (closeBtn) closeBtn.focus();
    };
    var close = function () {
      drawer.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      lock(false);
      setTimeout(function () { if (!drawer.classList.contains('is-open')) drawer.hidden = true; }, 220);
      btn.focus();
    };
    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-expanded') === 'true') { close(); return; }
      var motion = document.documentElement.getAttribute('data-rs-motion');
      var reduce = motion === 'reduce' || (motion !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (reduce) { open(); return; }
      btn.classList.remove('mirsad-logo-spin');
      void btn.offsetWidth;
      btn.classList.add('mirsad-logo-spin');
      clearTimeout(wait);
      wait = setTimeout(open, 600);
    });
    drawer.addEventListener('click', function (event) {
      if (event.target.closest('[data-mirsad-close]')) { close(); return; }
      if (event.target.closest('.mirsad-drawer-item')) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') { event.preventDefault(); close(); }
    });
  }
  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
