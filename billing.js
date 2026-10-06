(() => {
  'use strict';
  const status=document.getElementById('billingStatus');
  const paypalStarterUrl='https://www.paypal.com/ncp/payment/4ZYSG6FTLQNSC';
  document.querySelector('[data-back]')?.addEventListener('click',()=>{window.location.href=new URL('index.html',window.location.href).href});
  document.querySelectorAll('[data-package]').forEach(button=>button.addEventListener('click',()=>{
    if(button.dataset.package==='باقة المبتدئين'){
      if(status)status.textContent='جارٍ فتح بوابة PayPal الآمنة…';
      window.location.href=paypalStarterUrl;
      return;
    }
    if(status)status.textContent=`تم اختيار ${button.dataset.package}. سيتم تفعيل الدفع لهذه الباقة لاحقًا.`;
  }));
})();
