ALTER TABLE IF EXISTS public.request_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.request_rate_limits FROM anon, authenticated, public;
DROP POLICY IF EXISTS "No direct access to request rate limits" ON public.request_rate_limits;
CREATE POLICY "No direct access to request rate limits" ON public.request_rate_limits
  FOR ALL
  USING (false)
  WITH CHECK (false);
ALTER TABLE IF EXISTS public.kv_store_d962235e ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kv_store_d962235e FROM anon, authenticated, public;
DROP POLICY IF EXISTS "No direct access to kv store" ON public.kv_store_d962235e;
CREATE POLICY "No direct access to kv store" ON public.kv_store_d962235e
  FOR ALL
  USING (false)
  WITH CHECK (false);
