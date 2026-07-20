INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260719235500',
  '20260719234500',
  '20260719235500',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.apply_watch_session_transition(
  p_user_id UUID,
  p_action TEXT,
  p_movie_id INTEGER DEFAULT NULL,
  p_media_type TEXT DEFAULT NULL,
  p_expected_version INTEGER DEFAULT NULL,
  p_duration_ms INTEGER DEFAULT 43200000
)
RETURNS TABLE (
  movie_id INTEGER,
  media_type TEXT,
  state TEXT,
  remaining_ms INTEGER,
  expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  version INTEGER,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.currently_watching%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_duration_ms INTEGER := LEAST(GREATEST(COALESCE(p_duration_ms, 43200000), 60000), 86400000);
  v_media_type TEXT := CASE WHEN p_media_type = 'tv' THEN 'tv' ELSE 'movie' END;
  v_movie_id INTEGER;
  v_remaining_ms INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  IF p_action NOT IN ('start', 'pause', 'resume', 'stop') THEN
    RAISE EXCEPTION 'invalid watch action';
  END IF;

  SELECT *
  INTO v_current
  FROM public.currently_watching
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF p_expected_version IS NOT NULL
    AND FOUND
    AND v_current.version <> p_expected_version THEN
    RAISE EXCEPTION 'watch_version_conflict'
      USING ERRCODE = '40001';
  END IF;

  IF p_action = 'stop' THEN
    DELETE FROM public.currently_watching
    WHERE user_id = p_user_id;
    RETURN;
  END IF;

  IF p_action = 'pause' THEN
    IF NOT FOUND THEN
      RETURN;
    END IF;

    v_remaining_ms := CASE
      WHEN v_current.state = 'active' AND v_current.expires_at IS NOT NULL THEN
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_current.expires_at - v_now)) * 1000)::INTEGER)
      ELSE
        GREATEST(0, COALESCE(v_current.remaining_ms, v_duration_ms))
    END;

    RETURN QUERY
    UPDATE public.currently_watching cw
    SET state = 'paused',
        remaining_ms = v_remaining_ms,
        paused_at = v_now,
        updated_at = v_now,
        version = cw.version + 1
    WHERE cw.user_id = p_user_id
    RETURNING
      cw.movie_id::INTEGER,
      cw.media_type::TEXT,
      cw.state::TEXT,
      cw.remaining_ms::INTEGER,
      cw.expires_at,
      cw.started_at,
      cw.paused_at,
      cw.version::INTEGER,
      cw.updated_at;
    RETURN;
  END IF;

  v_movie_id := COALESCE(p_movie_id, CASE WHEN FOUND THEN v_current.movie_id ELSE NULL END);

  IF v_movie_id IS NULL OR v_movie_id <= 0 THEN
    RAISE EXCEPTION 'movie_id is required';
  END IF;

  IF p_action = 'resume' THEN
    v_media_type := CASE
      WHEN p_media_type = 'tv' THEN 'tv'
      WHEN p_media_type = 'movie' THEN 'movie'
      WHEN FOUND AND v_current.media_type = 'tv' THEN 'tv'
      ELSE 'movie'
    END;
    v_remaining_ms := GREATEST(0, COALESCE(CASE WHEN FOUND THEN v_current.remaining_ms ELSE NULL END, v_duration_ms));
  ELSE
    v_remaining_ms := v_duration_ms;
  END IF;

  RETURN QUERY
  INSERT INTO public.currently_watching (
    user_id,
    movie_id,
    media_type,
    state,
    remaining_ms,
    started_at,
    paused_at,
    expires_at,
    updated_at,
    version
  )
  VALUES (
    p_user_id,
    v_movie_id,
    v_media_type,
    'active',
    v_remaining_ms,
    CASE WHEN p_action = 'resume' AND FOUND THEN COALESCE(v_current.started_at, v_now) ELSE v_now END,
    NULL,
    v_now + make_interval(secs => v_remaining_ms / 1000.0),
    v_now,
    1
  )
  ON CONFLICT (user_id) DO UPDATE
  SET movie_id = EXCLUDED.movie_id,
      media_type = EXCLUDED.media_type,
      state = EXCLUDED.state,
      remaining_ms = EXCLUDED.remaining_ms,
      started_at = EXCLUDED.started_at,
      paused_at = NULL,
      expires_at = EXCLUDED.expires_at,
      updated_at = EXCLUDED.updated_at,
      version = public.currently_watching.version + 1
  RETURNING
    currently_watching.movie_id::INTEGER,
    currently_watching.media_type::TEXT,
    currently_watching.state::TEXT,
    currently_watching.remaining_ms::INTEGER,
    currently_watching.expires_at,
    currently_watching.started_at,
    currently_watching.paused_at,
    currently_watching.version::INTEGER,
    currently_watching.updated_at;

  INSERT INTO public.user_movies (user_id, movie_id, media_type, type)
  VALUES (p_user_id, v_movie_id, v_media_type, 'watched')
  ON CONFLICT (user_id, media_type, movie_id, type) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_watch_session_transition(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_watch_session_transition(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_watch_session_transition(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER) TO service_role;
