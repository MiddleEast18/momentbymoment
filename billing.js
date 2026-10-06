(() => {
  'use strict';
  const status=document.getElementById('billingStatus');
  const paypalStarterUrl='https://www.paypal.com/ncp/payment/4ZYSG6FTLQNSC';
  const paymentReview=document.getElementById('paymentReview');
  const closePaymentReview=()=>{if(paymentReview)paymentReview.hidden=true;};
  document.getElementById('paymentReviewClose')?.addEventListener('click',closePaymentReview);
  document.getElementById('paymentReviewCancel')?.addEventListener('click',closePaymentReview);
  document.getElementById('paymentReviewContinue')?.addEventListener('click',()=>{window.location.href=paypalStarterUrl;});
  paymentReview?.addEventListener('click',(event)=>{if(event.target===paymentReview)closePaymentReview();});
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape' && paymentReview && !paymentReview.hidden)closePaymentReview();});
  document.querySelector('[data-back]')?.addEventListener('click',()=>{window.location.href=new URL('index.html',window.location.href).href});
  document.querySelectorAll('[data-package]').forEach(button=>button.addEventListener('click',()=>{
    if(button.dataset.package==='باقة المبتدئين'){
      if(status)status.textContent='راجع تفاصيل الباقة ثم تابع إلى PayPal.';
      if(paymentReview)paymentReview.hidden=false;
      return;
    }
    if(status)status.textContent=`تم اختيار ${button.dataset.package}. سيتم تفعيل الدفع لهذه الباقة لاحقًا.`;
  }));
})();
