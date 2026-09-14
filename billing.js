(() => {
  'use strict';
  const status=document.getElementById('billingStatus');
  document.querySelector('[data-back]')?.addEventListener('click',()=>{window.location.href=new URL('index.html',window.location.href).href});
  document.querySelectorAll('[data-package]').forEach(button=>button.addEventListener('click',()=>{if(status)status.textContent=`تم اختيار ${button.dataset.package}. سيتم فتح بوابة الدفع عند تفعيلها.`}));
})();
