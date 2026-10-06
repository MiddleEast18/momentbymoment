-- Isolated semantic-search sidecar for news_articles that still exist in the live table.
-- Does not modify news_articles, ingestion, translation, trimming, or live-feed ordering.
-- This migration is prepared locally only; it has NOT been applied to production.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.mirsad_archive_normalize_arabic(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(
    regexp_replace(
      translate(
        lower(coalesce(p_text, '')),
        U&'\0622\0623\0625\0671\0649\0640\064B\064C\064D\064E\064F\0650\0651\0652\0670',
        'ااااي'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.mirsad_archive_content_fingerprint(
  p_headline text,
  p_summary text,
  p_source_name text,
  p_category text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT md5(concat_ws(E'\n',
    public.mirsad_archive_normalize_arabic(p_headline),
    public.mirsad_archive_normalize_arabic(p_summary),
    public.mirsad_archive_normalize_arabic(p_source_name),
    public.mirsad_archive_normalize_arabic(p_category)
  ));
$$;

-- Only vector metadata is stored here. News-card content remains canonical in news_articles.
CREATE TABLE IF NOT EXISTS public.mirsad_archive_embeddings (
  article_id uuid PRIMARY KEY REFERENCES public.news_articles(id) ON DELETE CASCADE,
  content_fingerprint text NOT NULL,
  embedding extensions.vector(768),
  embedding_model text,
  embedding_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mirsad_archive_embeddings_article_idx
  ON public.mirsad_archive_embeddings (article_id);
ALTER TABLE public.mirsad_archive_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mirsad_archive_embeddings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mirsad_archive_embeddings TO service_role;

-- Record only fingerprints for already published rows. No headline, summary, or card data
-- is copied into the sidecar; pending articles are excluded.
INSERT INTO public.mirsad_archive_embeddings (article_id, content_fingerprint)
SELECT n.id,
       public.mirsad_archive_content_fingerprint(n.headline, n.summary, n.source_name, n.category::text)
FROM public.news_articles n
WHERE n.is_pending_verification IS FALSE
  AND n.source_url ~* '^https?://'
ON CONFLICT (article_id) DO UPDATE SET
  embedding = CASE
    WHEN public.mirsad_archive_embeddings.content_fingerprint IS DISTINCT FROM EXCLUDED.content_fingerprint
    THEN NULL ELSE public.mirsad_archive_embeddings.embedding END,
  embedding_model = CASE
    WHEN public.mirsad_archive_embeddings.content_fingerprint IS DISTINCT FROM EXCLUDED.content_fingerprint
    THEN NULL ELSE public.mirsad_archive_embeddings.embedding_model END,
  embedding_updated_at = CASE
    WHEN public.mirsad_archive_embeddings.content_fingerprint IS DISTINCT FROM EXCLUDED.content_fingerprint
    THEN NULL ELSE public.mirsad_archive_embeddings.embedding_updated_at END,
  content_fingerprint = EXCLUDED.content_fingerprint;

-- Short-window request limits for the public chat endpoint; raw IPs are never persisted.
CREATE TABLE IF NOT EXISTS public.mirsad_archive_rate_limits (
  subject_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (subject_hash, window_start)
);
CREATE INDEX IF NOT EXISTS mirsad_archive_rate_limits_window_idx
  ON public.mirsad_archive_rate_limits (window_start);
ALTER TABLE public.mirsad_archive_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mirsad_archive_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mirsad_archive_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.mirsad_archive_consume_rate_limit(
  p_subject_hash text,
  p_window_start timestamptz,
  p_limit integer DEFAULT 12
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_subject_hash IS NULL OR length(p_subject_hash) < 32 OR length(p_subject_hash) > 128
     OR p_limit < 1 OR p_limit > 60 THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.mirsad_archive_rate_limits (subject_hash, window_start, request_count)
  VALUES (p_subject_hash, p_window_start, 1)
  ON CONFLICT (subject_hash, window_start) DO UPDATE
    SET request_count = LEAST(public.mirsad_archive_rate_limits.request_count + 1, p_limit + 1)
  RETURNING request_count INTO v_count;
  DELETE FROM public.mirsad_archive_rate_limits
    WHERE subject_hash = p_subject_hash AND window_start < now() - interval '1 day';
  IF extract(minute FROM p_window_start)::integer % 30 = 0 THEN
    DELETE FROM public.mirsad_archive_rate_limits WHERE window_start < now() - interval '1 day';
  END IF;
  RETURN v_count <= p_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.mirsad_archive_consume_rate_limit(text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mirsad_archive_consume_rate_limit(text, timestamptz, integer) TO service_role;

-- Exact vector scan is intentional for the current ~1K-row news table. It avoids approximate
-- index recall loss after excluding the 400 cards already presented on the live page.
CREATE OR REPLACE FUNCTION public.mirsad_archive_search(
  p_embedding extensions.vector(768),
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
           plainto_tsquery('simple'::regconfig,
             public.mirsad_archive_normalize_arabic(p_search_text)) AS tsq
  ), live_window AS (
    SELECT n.id
    FROM public.news_articles n
    WHERE n.is_pending_verification IS FALSE
    ORDER BY n.published_at DESC NULLS LAST, n.updated_at DESC NULLS LAST,
             n.created_at DESC NULLS LAST, n.id DESC
    LIMIT 400
  ), eligible AS (
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
           ) AS normalized_text,
           public.mirsad_archive_content_fingerprint(
             n.headline, n.summary, n.source_name, n.category::text
           ) AS current_fingerprint,
           e.embedding
    FROM public.news_articles n
    LEFT JOIN public.mirsad_archive_embeddings e ON e.article_id = n.id
    WHERE n.is_pending_verification IS FALSE
      AND n.source_url ~* '^https?://'
      AND NOT EXISTS (SELECT 1 FROM live_window l WHERE l.id = n.id)
  ), lexical AS (
    SELECT a.id,
           row_number() OVER (
             ORDER BY ts_rank_cd(to_tsvector('simple'::regconfig, a.normalized_text), q.tsq) DESC,
                      a.published_at DESC NULLS LAST, a.id DESC
           ) AS rank_no
    FROM eligible a
    CROSS JOIN q
    WHERE numnode(q.tsq) > 0
      AND to_tsvector('simple'::regconfig, a.normalized_text) @@ q.tsq
    ORDER BY ts_rank_cd(to_tsvector('simple'::regconfig, a.normalized_text), q.tsq) DESC,
             a.published_at DESC NULLS LAST, a.id DESC
    LIMIT 100
  ), semantic AS (
    SELECT a.id,
           row_number() OVER (ORDER BY a.embedding <=> p_embedding ASC, a.id) AS rank_no
    FROM eligible a
    JOIN public.mirsad_archive_embeddings e ON e.article_id = a.id
    WHERE e.embedding IS NOT NULL
      AND e.content_fingerprint = a.current_fingerprint
    ORDER BY e.embedding <=> p_embedding ASC, a.id
    LIMIT 100
  ), fused AS (
    SELECT r.id, sum(1.0 / (60.0 + r.rank_no))::double precision AS rrf_score
    FROM (
      SELECT id, rank_no FROM lexical
      UNION ALL
      SELECT id, rank_no FROM semantic
    ) r
    GROUP BY r.id
  )
  SELECT a.id, a.source_name, a.source_url, a.headline, a.summary,
         a.category, a.importance_score, a.sentiment, a.layout_size,
         a.update_count, a.source_count, a.confidence_score, a.claim_digest,
         a.published_at, f.rrf_score
  FROM fused f
  JOIN eligible a ON a.id = f.id
  ORDER BY f.rrf_score DESC, a.published_at DESC NULLS LAST, a.id DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 6), 1), 6);
$$;
REVOKE ALL ON FUNCTION public.mirsad_archive_search(extensions.vector, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mirsad_archive_search(extensions.vector, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mirsad_archive_pending_embeddings(p_limit integer DEFAULT 5)
RETURNS TABLE (
  article_id uuid,
  headline text,
  summary text,
  source_name text,
  category text,
  content_fingerprint text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT n.id,
         n.headline,
         n.summary,
         n.source_name,
         n.category::text,
         public.mirsad_archive_content_fingerprint(n.headline, n.summary, n.source_name, n.category::text)
  FROM public.news_articles n
  LEFT JOIN public.mirsad_archive_embeddings e ON e.article_id = n.id
  WHERE n.is_pending_verification IS FALSE
    AND n.source_url ~* '^https?://'
    AND (e.article_id IS NULL
      OR e.content_fingerprint IS DISTINCT FROM public.mirsad_archive_content_fingerprint(n.headline, n.summary, n.source_name, n.category::text)
      OR e.embedding IS NULL)
  ORDER BY n.published_at ASC NULLS FIRST, n.id
  LIMIT LEAST(GREATEST(coalesce(p_limit, 5), 1), 10);
$$;
REVOKE ALL ON FUNCTION public.mirsad_archive_pending_embeddings(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mirsad_archive_pending_embeddings(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mirsad_archive_store_embedding(
  p_article_id uuid,
  p_content_fingerprint text,
  p_embedding extensions.vector(768),
  p_model text DEFAULT 'gemini-embedding-001'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_current_fingerprint text;
BEGIN
  SELECT public.mirsad_archive_content_fingerprint(n.headline, n.summary, n.source_name, n.category::text)
  INTO v_current_fingerprint
  FROM public.news_articles n
  WHERE n.id = p_article_id AND n.is_pending_verification IS FALSE;
  IF v_current_fingerprint IS NULL OR v_current_fingerprint IS DISTINCT FROM p_content_fingerprint THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.mirsad_archive_embeddings (
    article_id, content_fingerprint, embedding, embedding_model, embedding_updated_at
  ) VALUES (
    p_article_id, p_content_fingerprint, p_embedding,
    left(coalesce(p_model, 'gemini-embedding-001'), 100), now()
  )
  ON CONFLICT (article_id) DO UPDATE SET
    content_fingerprint = EXCLUDED.content_fingerprint,
    embedding = EXCLUDED.embedding,
    embedding_model = EXCLUDED.embedding_model,
    embedding_updated_at = EXCLUDED.embedding_updated_at;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.mirsad_archive_store_embedding(uuid, text, extensions.vector, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mirsad_archive_store_embedding(uuid, text, extensions.vector, text) TO service_role;
