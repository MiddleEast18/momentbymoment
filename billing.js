(() => {
  'use strict';
  const SUPABASE_URL = 'https://dndlkenyfymlrjnslyzb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_C92j3hFC-qVem_ncKHDf9Q_Ew970XUx';
  const status = document.getElementById('billingStatus');
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const packages = {
    'باقة المبتدئين': { balance: '1,000 فتحة أخبار', full: '$1.00 USD', discount: '$0.85 USD', url: 'https://www.paypal.com/ncp/payment/4ZYSG6FTLQNSC', discountUrl: 'https://www.paypal.com/ncp/payment/UY4AT385BSHUW' },
    'الباقة الأساسية': { balance: '5,000 فتحة أخبار', full: '$5.00 USD', discount: '$4.25 USD', url: 'https://www.paypal.com/ncp/payment/HG4PJ2KF2ZYLJ', discountUrl: 'https://www.paypal.com/ncp/payment/JBKPFKVXJ3S7J' },
    'الباقة المتقدمة': { balance: '10,000 فتحة أخبار', full: '$10.00 USD', discount: '$8.50 USD', url: 'https://www.paypal.com/ncp/payment/4LYDXZGSJK432', discountUrl: 'https://www.paypal.com/ncp/payment/853CH7CVGQ5Z8' },
    'الباقة الضخمة': { balance: '25,000 فتحة أخبار', full: '$25.00 USD', discount: '$21.25 USD', url: 'https://www.paypal.com/ncp/payment/9P29LQBSTDR74', discountUrl: 'https://www.paypal.com/ncp/payment/6UAXTNNKA37PG' },
    'الباقة النهائية': { balance: '50,000 فتحة أخبار', full: '$50.00 USD', discount: '$42.50 USD', url: 'https://www.paypal.com/ncp/payment/8JJ2FJ2ZRMTXA', discountUrl: 'https://www.paypal.com/ncp/payment/5U3HPRY6Z7J6W' }
  };
  let discountEligible = false;
  let selectedPackage = null;
  const paymentReview = document.getElementById('paymentReview');
  const reviewTitle = document.getElementById('paymentReviewTitle');
  const reviewBalance = document.getElementById('paymentReviewBalance');
  const reviewTotal = document.getElementById('paymentReviewTotal');
  const formatPrice = (info) => discountEligible ? info.discount : info.full;
  const renderCards = () => {
    document.querySelectorAll('[data-package]').forEach((button) => {
      const info = packages[button.dataset.package];
      const card = button.closest('.mirsad-billing-package');
      const price = card?.querySelector('.mirsad-billing-package__price');
      if (!info || !card || !price) return;
      price.innerHTML = discountEligible
        ? `<del>${info.full.replace(' USD', '')}</del> <strong>${info.discount.replace(' USD', '')}</strong> دولار بعد خصم 15%`
        : `<strong>${info.full.replace(' USD', '')}</strong> دولار`;
      let badge = card.querySelector('[data-discount-badge]');
      if (discountEligible && !badge) {
        badge = document.createElement('span'); badge.dataset.discountBadge = 'true'; badge.className = 'mirsad-billing-package__discount'; badge.textContent = 'خصم 15% للشحنة التالية'; card.insertBefore(badge, card.querySelector('h3'));
      }
      if (!discountEligible) badge?.remove();
    });
    const heroRule = document.querySelector('.mirsad-billing-rule');
    if (heroRule) heroRule.textContent = discountEligible ? 'خصم 15% متاح الآن للشحنة التالية' : 'ادفع فقط مقابل ما تحتاجه';
  };
  const loadEligibility = async () => {
    if (!client) return;
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session?.user) return;
    const { data, error } = await client.rpc('get_recharge_offer_status');
    if (error) { console.warn('[mirsad recharge discount] eligibility lookup failed', error); return; }
    const row = Array.isArray(data) ? data[0] : data;
    discountEligible = Boolean(row?.eligible);
    renderCards();
    if (status && discountEligible) status.textContent = 'خصم 15% متاح للشحنة التالية بعد استهلاك أول 1,000 فتحة مدفوعة.';
  };
  const closePaymentReview = () => { if (paymentReview) paymentReview.hidden = true; };
  const openPaymentReview = (name) => {
    const info = packages[name];
    if (!info || !paymentReview) return;
    selectedPackage = info;
    if (reviewTitle) reviewTitle.textContent = name + (discountEligible ? ' — خصم 15%' : '');
    if (reviewBalance) reviewBalance.textContent = info.balance;
    if (reviewTotal) reviewTotal.textContent = formatPrice(info);
    paymentReview.hidden = false;
  };
  document.getElementById('paymentReviewClose')?.addEventListener('click', closePaymentReview);
  document.getElementById('paymentReviewCancel')?.addEventListener('click', closePaymentReview);
  document.getElementById('paymentReviewContinue')?.addEventListener('click', () => {
    const url = discountEligible ? selectedPackage?.discountUrl : selectedPackage?.url;
    if (url) window.location.href = url;
  });
  paymentReview?.addEventListener('click', (event) => { if (event.target === paymentReview) closePaymentReview(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && paymentReview && !paymentReview.hidden) closePaymentReview(); });
  document.querySelector('[data-back]')?.addEventListener('click', () => { window.location.href = new URL('index.html', window.location.href).href; });
  document.querySelectorAll('[data-package]').forEach((button) => button.addEventListener('click', () => {
    const name = button.dataset.package;
    if (!packages[name]) return;
    if (status) status.textContent = discountEligible ? 'راجع السعر المخفض ثم تابع إلى PayPal.' : 'راجع تفاصيل الباقة ثم تابع إلى PayPal.';
    openPaymentReview(name);
  }));
  renderCards();
  void loadEligibility();
})();
