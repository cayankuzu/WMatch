CREATE TABLE IF NOT EXISTS public.kv_store_d962235e (
  key TEXT NOT NULL PRIMARY KEY,
  value JSONB NOT NULL
);

ALTER TABLE public.kv_store_d962235e ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS kv_store_d962235e_key_idx
  ON public.kv_store_d962235e (key text_pattern_ops);

DROP INDEX IF EXISTS public.kv_store_d962235e_key_idx1;
DROP INDEX IF EXISTS public.kv_store_d962235e_key_idx2;
DROP INDEX IF EXISTS public.kv_store_d962235e_key_idx3;
DROP INDEX IF EXISTS public.kv_store_d962235e_key_idx4;
DROP INDEX IF EXISTS public.kv_store_d962235e_key_idx5;
DROP INDEX IF EXISTS public.kv_store_d962235e_key_idx6;
DROP INDEX IF EXISTS public.kv_store_d962235e_key_idx7;
