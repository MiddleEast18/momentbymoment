(() => {
  'use strict';
  const URL='https://dndlkenyfymlrjnslyzb.supabase.co/functions/v1/mirsad-locale-detect';
  const KEY='mirsad.locale.v1';
  const MAX_AGE=604800000;
  const publish=value=>{if(!value?.language)return;document.documentElement.dataset.mirsadLocale=value.language;document.documentElement.dataset.mirsadCountry=value.country_code||'';window.dispatchEvent(new CustomEvent('mirsad:locale-detected',{detail:value}));};
  try{const cached=JSON.parse(localStorage.getItem(KEY)||'null');if(cached?.saved_at&&Date.now()-cached.saved_at<MAX_AGE){publish(cached);return;}}catch{}
  fetch(URL,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',credentials:'omit',cache:'no-store'}).then(r=>r.ok?r.json():null).then(value=>{if(!value?.language)return;try{localStorage.setItem(KEY,JSON.stringify({...value,saved_at:Date.now()}));}catch{}publish(value);}).catch(()=>{});
})();
