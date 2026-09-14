alter table public.source_item_ledger
  add column if not exists ingest_decision text;

comment on column public.source_item_ledger.ingest_decision is
  'Latest mirsad-ingest decision for this item: inserted, duplicate, source_updated, cluster_merged, insert_failed, or skipped.';
