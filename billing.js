(() => {
  'use strict';
  const status = document.getElementById('billingStatus');
  const packages = {
    'باقة المبتدئين': { balance: '1,000 فتحة أخبار', total: '$1.00 USD', url: 'https://www.paypal.com/ncp/payment/4ZYSG6FTLQNSC' },
    'الباقة الأساسية': { balance: '5,000 فتحة أخبار', total: '$5.00 USD', url: 'https://www.paypal.com/ncp/payment/HG4PJ2KF2ZYLJ' },
    'الباقة المتقدمة': { balance: '10,000 فتحة أخبار', total: '$10.00 USD', url: 'https://www.paypal.com/ncp/payment/4LYDXZGSJK432' },
    'الباقة الضخمة': { balance: '25,000 فتحة أخبار', total: '$25.00 USD', url: 'https://www.paypal.com/ncp/payment/9P29LQBSTDR74' },
    'الباقة النهائية': { balance: '50,000 فتحة أخبار', total: '$50.00 USD', url: 'https://www.paypal.com/ncp/payment/8JJ2FJ2ZRMTXA' }
  };
  let selectedPackage = null;
  const paymentReview = document.getElementById('paymentReview');
  const reviewTitle = document.getElementById('paymentReviewTitle');
  const reviewBalance = document.getElementById('paymentReviewBalance');
  const reviewTotal = document.getElementById('paymentReviewTotal');
  const closePaymentReview = () => { if (paymentReview) paymentReview.hidden = true; };
  const openPaymentReview = (name) => {
    const packageInfo = packages[name];
    if (!packageInfo || !paymentReview) return;
    selectedPackage = packageInfo;
    if (reviewTitle) reviewTitle.textContent = name;
    if (reviewBalance) reviewBalance.textContent = packageInfo.balance;
    if (reviewTotal) reviewTotal.textContent = packageInfo.total;
    paymentReview.hidden = false;
  };
  document.getElementById('paymentReviewClose')?.addEventListener('click', closePaymentReview);
  document.getElementById('paymentReviewCancel')?.addEventListener('click', closePaymentReview);
  document.getElementById('paymentReviewContinue')?.addEventListener('click', () => {
    if (selectedPackage?.url) window.location.href = selectedPackage.url;
  });
  paymentReview?.addEventListener('click', (event) => { if (event.target === paymentReview) closePaymentReview(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && paymentReview && !paymentReview.hidden) closePaymentReview();
  });
  document.querySelector('[data-back]')?.addEventListener('click', () => {
    window.location.href = new URL('index.html', window.location.href).href;
  });
  document.querySelectorAll('[data-package]').forEach((button) => button.addEventListener('click', () => {
    const name = button.dataset.package;
    if (!packages[name]) return;
    if (status) status.textContent = 'راجع تفاصيل الباقة ثم تابع إلى PayPal.';
    openPaymentReview(name);
  }));
})();
