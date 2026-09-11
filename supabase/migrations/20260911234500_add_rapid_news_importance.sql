alter table public.rapid_news
  add column if not exists importance_score integer not null default 0;

create index if not exists rapid_news_importance_idx
  on public.rapid_news (importance_score desc, received_at desc);

update public.rapid_news
set importance_score = least(
  100,
  35
  + case when headline ~ '(عاجل|عاجلة|هجوم|حرب|انفجار|زلزال|قتلى|وفيات|اغتيال)' then 25 else 0 end
  + case when headline ~ '(رئيس|حكومة|انتخابات|اتفاق|تصعيد|إيران|إسرائيل|أمريكا)' then 10 else 0 end
)
where importance_score = 0;
