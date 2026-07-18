CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_action TEXT,
  p_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  current_count INTEGER,
  retry_after_seconds INTEGER,
  reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  now_ts TIMESTAMPTZ := timezone('utc', now());
  window_start_ts TIMESTAMPTZ;
  expires_at_ts TIMESTAMPTZ;
  next_count INTEGER;
BEGIN
  IF p_limit <= 0 OR p_window_seconds <= 0 OR coalesce(btrim(p_action), '') = '' OR coalesce(btrim(p_key), '') = '' THEN
    RAISE EXCEPTION 'Invalid rate limit configuration.';
  END IF;

  DELETE FROM public.request_rate_limits
  WHERE expires_at < now_ts - INTERVAL '1 hour';

  window_start_ts := to_timestamp(floor(extract(epoch from now_ts) / p_window_seconds) * p_window_seconds);
  expires_at_ts := window_start_ts + make_interval(secs => p_window_seconds);

  INSERT INTO public.request_rate_limits (
    action,
    hashed_key,
    window_start,
    request_count,
    expires_at,
    created_at,
    updated_at
  )
  VALUES (
    p_action,
    encode(extensions.digest(p_key, 'sha256'), 'hex'),
    window_start_ts,
    1,
    expires_at_ts,
    now_ts,
    now_ts
  )
  ON CONFLICT (action, hashed_key, window_start)
  DO UPDATE
    SET request_count = public.request_rate_limits.request_count + 1,
        updated_at = now_ts
  RETURNING request_count, expires_at
  INTO next_count, reset_at;

  allowed := next_count <= p_limit;
  current_count := next_count;
  retry_after_seconds := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (reset_at - now_ts)))::INTEGER);

  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, TEXT, INTEGER, INTEGER) TO service_role;
