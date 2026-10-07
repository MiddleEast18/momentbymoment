-- Fast local text search for archive chat.
-- This reads the canonical news_articles table and the archive sidecar metadata only.
-- It does not fetch, duplicate, reorder, or mutate news cards.

CREATE OR REPLACE FUNCTION public.mirsad_archive_chat_text_search(
  p_search_text text,
  p_limit integer DEFAULT 6
)
RETURNS TABLE (
  id uuid,
  source_name text,
  source_url text,
  headline text,
  summary text,
  category text,
  importance_score integer,
  sentiment text,
  layout_size text,
  update_count integer,
  source_count integer,
  confidence_score numeric,
  claim_digest jsonb,
  published_at timestamptz,
  search_score double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH q AS (
    SELECT public.mirsad_archive_normalize_arabic(p_search_text) AS qtext,
           plainto_tsquery('simple'::regconfig, public.mirsad_archive_normalize_arabic(p_search_text)) AS tsq
  ), candidates AS (
    SELECT n.id,
           n.source_name,
           n.source_url,
           n.headline,
           n.summary,
           n.category::text AS category,
           n.importance_score::integer AS importance_score,
           n.sentiment::text AS sentiment,
           n.layout_size::text AS layout_size,
           n.update_count,
           n.source_count,
           n.confidence_score,
           n.claim_digest,
           n.published_at,
           public.mirsad_archive_normalize_arabic(
             concat_ws(' ', n.headline, n.summary, n.source_name, n.category::text)
           ) AS normalized_text
    FROM public.news_articles n
    WHERE n.is_pending_verification IS FALSE
      AND n.source_url ~* '^https?://'
  ), ranked AS (
    SELECT c.*,
           CASE
             WHEN c.normalized_text ILIKE '%' || q.qtext || '%' AND length(q.qtext) >= 2 THEN 3.0
             ELSE ts_rank_cd(to_tsvector('simple'::regconfig, c.normalized_text), q.tsq)::double precision
           END AS score
    FROM candidates c
    CROSS JOIN q
    WHERE (length(q.qtext) >= 2 AND c.normalized_text ILIKE '%' || q.qtext || '%')
       OR (numnode(q.tsq) > 0 AND to_tsvector('simple'::regconfig, c.normalized_text) @@ q.tsq)
  )
  SELECT r.id, r.source_name, r.source_url, r.headline, r.summary, r.category,
         r.importance_score, r.sentiment, r.layout_size, r.update_count,
         r.source_count, r.confidence_score, r.claim_digest, r.published_at, r.score
  FROM ranked r
  ORDER BY r.score DESC, r.published_at DESC NULLS LAST, r.id DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 6), 1), 6);
$$;

REVOKE ALL ON FUNCTION public.mirsad_archive_chat_text_search(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mirsad_archive_chat_text_search(text, integer) TO service_role;
