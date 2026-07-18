INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260715201000',
  '20260715183000',
  '20260715201000',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_identity_repair_queue_unique_source
  ON public.media_identity_repair_queue (
    source_table,
    user_id,
    movie_id,
    COALESCE(collection_type, '__watch_session__'),
    reason
  );

CREATE TABLE IF NOT EXISTS public.media_identity_repair_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_id UUID NOT NULL REFERENCES public.media_identity_repair_queue(id) ON DELETE CASCADE,
  source_table TEXT NOT NULL CHECK (source_table IN ('user_movies', 'currently_watching')),
  user_id UUID NOT NULL,
  movie_id INTEGER NOT NULL CHECK (movie_id > 0),
  collection_type TEXT,
  previous_media_type TEXT NOT NULL CHECK (previous_media_type IN ('movie', 'tv')),
  next_media_type TEXT NOT NULL CHECK (next_media_type IN ('movie', 'tv')),
  action TEXT NOT NULL CHECK (action IN ('resolved', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.media_identity_repair_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.media_identity_repair_history FROM anon, authenticated, public;
GRANT SELECT, INSERT ON TABLE public.media_identity_repair_history TO service_role;

DROP POLICY IF EXISTS "No direct media identity repair history reads" ON public.media_identity_repair_history;
CREATE POLICY "No direct media identity repair history reads" ON public.media_identity_repair_history
  FOR SELECT
  USING (false);

DROP POLICY IF EXISTS "No direct media identity repair history writes" ON public.media_identity_repair_history;
CREATE POLICY "No direct media identity repair history writes" ON public.media_identity_repair_history
  FOR ALL
  USING (false)
  WITH CHECK (false);

INSERT INTO public.media_identity_repair_queue (
  source_table,
  user_id,
  movie_id,
  collection_type,
  assumed_media_type,
  reason
)
SELECT
  'currently_watching',
  user_id,
  movie_id,
  NULL,
  media_type,
  'legacy_currently_watching_assumed_movie_before_typed_identity'
FROM public.currently_watching cw
WHERE media_type = 'movie'
  AND updated_at < TIMESTAMPTZ '2026-07-15 16:20:00+00'
  AND NOT EXISTS (
    SELECT 1
    FROM public.media_identity_repair_queue q
    WHERE q.source_table = 'currently_watching'
      AND q.user_id = cw.user_id
      AND q.movie_id = cw.movie_id
      AND q.collection_type IS NULL
      AND q.reason = 'legacy_currently_watching_assumed_movie_before_typed_identity'
  );

CREATE OR REPLACE FUNCTION public.resolve_media_identity_repair(
  p_repair_id UUID,
  p_media_type TEXT,
  p_status TEXT DEFAULT 'resolved'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.media_identity_repair_queue%ROWTYPE;
  v_media_type TEXT := CASE WHEN p_media_type = 'tv' THEN 'tv' ELSE 'movie' END;
BEGIN
  IF p_status NOT IN ('resolved', 'ignored') THEN
    RAISE EXCEPTION 'invalid repair status';
  END IF;

  SELECT *
  INTO v_entry
  FROM public.media_identity_repair_queue
  WHERE id = p_repair_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'repair entry not found';
  END IF;

  IF v_entry.status <> 'pending' THEN
    RAISE EXCEPTION 'repair entry already closed';
  END IF;

  IF p_status = 'resolved' AND v_entry.assumed_media_type IS NULL THEN
    RAISE EXCEPTION 'repair entry missing assumed media type';
  END IF;

  INSERT INTO public.media_identity_repair_history (
    repair_id,
    source_table,
    user_id,
    movie_id,
    collection_type,
    previous_media_type,
    next_media_type,
    action
  )
  VALUES (
    v_entry.id,
    v_entry.source_table,
    v_entry.user_id,
    v_entry.movie_id,
    v_entry.collection_type,
    CASE WHEN v_entry.assumed_media_type = 'tv' THEN 'tv' ELSE 'movie' END,
    CASE WHEN p_status = 'ignored' THEN CASE WHEN v_entry.assumed_media_type = 'tv' THEN 'tv' ELSE 'movie' END ELSE v_media_type END,
    p_status
  );

  IF p_status = 'ignored' THEN
    UPDATE public.media_identity_repair_queue
    SET status = 'ignored', resolved_at = NOW()
    WHERE id = p_repair_id;
    RETURN;
  END IF;

  IF v_entry.source_table = 'user_movies' THEN
    INSERT INTO public.user_movies (user_id, movie_id, media_type, type, created_at)
    SELECT user_id, movie_id, v_media_type, type, created_at
    FROM public.user_movies
    WHERE user_id = v_entry.user_id
      AND movie_id = v_entry.movie_id
      AND type = v_entry.collection_type
      AND media_type = COALESCE(v_entry.assumed_media_type, media_type)
    ON CONFLICT (user_id, media_type, movie_id, type) DO NOTHING;

    DELETE FROM public.user_movies
    WHERE user_id = v_entry.user_id
      AND movie_id = v_entry.movie_id
      AND type = v_entry.collection_type
      AND media_type = COALESCE(v_entry.assumed_media_type, media_type)
      AND media_type <> v_media_type;
  ELSIF v_entry.source_table = 'currently_watching' THEN
    UPDATE public.currently_watching
    SET media_type = v_media_type,
        updated_at = NOW(),
        version = version + 1
    WHERE user_id = v_entry.user_id
      AND movie_id = v_entry.movie_id
      AND media_type = COALESCE(v_entry.assumed_media_type, media_type);
  END IF;

  UPDATE public.media_identity_repair_queue
  SET status = 'resolved',
      assumed_media_type = v_media_type,
      resolved_at = NOW()
  WHERE id = p_repair_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_media_identity_repair(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_media_identity_repair(UUID, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_media_identity_repair(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.replace_user_movie_collections(
  p_user_id UUID,
  p_favorite_movie_ids INTEGER[] DEFAULT NULL,
  p_watched_movie_ids INTEGER[] DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  IF p_favorite_movie_ids IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM unnest(p_favorite_movie_ids) AS movie_id
      WHERE movie_id IS NULL OR movie_id <= 0
    ) THEN
      RAISE EXCEPTION 'favorite movie ids must be positive integers';
    END IF;

    IF (
      SELECT COUNT(DISTINCT movie_id)
      FROM unnest(p_favorite_movie_ids) AS movie_id
    ) > 100 THEN
      RAISE EXCEPTION 'favorite movie limit exceeded';
    END IF;

    DELETE FROM public.user_movies
    WHERE user_id = p_user_id
      AND media_type = 'movie'
      AND type = 'favorite';

    INSERT INTO public.user_movies (user_id, movie_id, media_type, type)
    SELECT DISTINCT
      p_user_id,
      movie_id,
      'movie',
      'favorite'
    FROM unnest(p_favorite_movie_ids) AS movie_id
    ON CONFLICT (user_id, media_type, movie_id, type) DO NOTHING;
  END IF;

  IF p_watched_movie_ids IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM unnest(p_watched_movie_ids) AS movie_id
      WHERE movie_id IS NULL OR movie_id <= 0
    ) THEN
      RAISE EXCEPTION 'watched movie ids must be positive integers';
    END IF;

    IF (
      SELECT COUNT(DISTINCT movie_id)
      FROM unnest(p_watched_movie_ids) AS movie_id
    ) > 500 THEN
      RAISE EXCEPTION 'watched movie limit exceeded';
    END IF;

    DELETE FROM public.user_movies
    WHERE user_id = p_user_id
      AND media_type = 'movie'
      AND type = 'watched';

    INSERT INTO public.user_movies (user_id, movie_id, media_type, type)
    SELECT DISTINCT
      p_user_id,
      movie_id,
      'movie',
      'watched'
    FROM unnest(p_watched_movie_ids) AS movie_id
    ON CONFLICT (user_id, media_type, movie_id, type) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) TO service_role;

CREATE OR REPLACE FUNCTION public.get_chat_message_peers(
  p_current_user_id UUID,
  p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
  other_user_id UUID,
  last_message TEXT,
  last_message_time TIMESTAMPTZ,
  unread_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped_messages AS (
    SELECT
      CASE
        WHEN m.sender_id = p_current_user_id THEN m.receiver_id
        ELSE m.sender_id
      END AS other_user_id,
      m.text,
      m.created_at,
      m.id,
      m.sender_id,
      m.receiver_id,
      m.read
    FROM public.messages m
    WHERE m.sender_id = p_current_user_id
       OR m.receiver_id = p_current_user_id
  ),
  ranked_messages AS (
    SELECT
      scoped_messages.*,
      ROW_NUMBER() OVER (
        PARTITION BY scoped_messages.other_user_id
        ORDER BY scoped_messages.created_at DESC, scoped_messages.id DESC
      ) AS row_number
    FROM scoped_messages
    WHERE scoped_messages.other_user_id IS NOT NULL
  ),
  unread_per_peer AS (
    SELECT
      scoped_messages.other_user_id,
      COUNT(*)::BIGINT AS unread_count
    FROM scoped_messages
    WHERE scoped_messages.receiver_id = p_current_user_id
      AND scoped_messages.read IS FALSE
    GROUP BY scoped_messages.other_user_id
  )
  SELECT
    ranked_messages.other_user_id,
    ranked_messages.text,
    ranked_messages.created_at,
    COALESCE(unread_per_peer.unread_count, 0)::BIGINT
  FROM ranked_messages
  LEFT JOIN unread_per_peer
    ON unread_per_peer.other_user_id = ranked_messages.other_user_id
  WHERE ranked_messages.row_number = 1
  ORDER BY ranked_messages.created_at DESC, ranked_messages.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.get_chat_message_peers(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_chat_message_peers(UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_message_peers(UUID, INTEGER) TO service_role;

CREATE TABLE IF NOT EXISTS public.chat_repair_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'blocked', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CHECK (user1_id < user2_id),
  UNIQUE (user1_id, user2_id, reason)
);

ALTER TABLE public.chat_repair_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_repair_audit FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chat_repair_audit TO service_role;

DROP POLICY IF EXISTS "No direct chat repair audit reads" ON public.chat_repair_audit;
CREATE POLICY "No direct chat repair audit reads" ON public.chat_repair_audit
  FOR SELECT
  USING (false);

DROP POLICY IF EXISTS "No direct chat repair audit writes" ON public.chat_repair_audit;
CREATE POLICY "No direct chat repair audit writes" ON public.chat_repair_audit
  FOR ALL
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_chat_repair_audit_status_last_message
  ON public.chat_repair_audit(status, last_message_at DESC);

CREATE OR REPLACE FUNCTION public.refresh_chat_repair_audit(
  p_limit INTEGER DEFAULT 500
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_count INTEGER := 0;
BEGIN
  WITH message_pairs AS (
    SELECT
      CASE WHEN sender_id < receiver_id THEN sender_id ELSE receiver_id END AS user1_id,
      CASE WHEN sender_id < receiver_id THEN receiver_id ELSE sender_id END AS user2_id,
      MIN(created_at) AS first_message_at,
      MAX(created_at) AS last_message_at,
      COUNT(*)::INTEGER AS message_count
    FROM public.messages
    WHERE sender_id IS NOT NULL
      AND receiver_id IS NOT NULL
      AND sender_id <> receiver_id
    GROUP BY 1, 2
  ),
  missing_matches AS (
    SELECT mp.*
    FROM message_pairs mp
    LEFT JOIN public.matches existing_match
      ON existing_match.user1_id = mp.user1_id
     AND existing_match.user2_id = mp.user2_id
    WHERE existing_match.user1_id IS NULL
    ORDER BY mp.last_message_at DESC NULLS LAST, mp.user1_id, mp.user2_id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000)
  ),
  upserted AS (
    INSERT INTO public.chat_repair_audit (
      user1_id,
      user2_id,
      first_message_at,
      last_message_at,
      message_count,
      reason,
      status,
      updated_at
    )
    SELECT
      user1_id,
      user2_id,
      first_message_at,
      last_message_at,
      message_count,
      'messages_exist_without_match',
      'pending',
      NOW()
    FROM missing_matches
    ON CONFLICT (user1_id, user2_id, reason) DO UPDATE
      SET first_message_at = EXCLUDED.first_message_at,
          last_message_at = EXCLUDED.last_message_at,
          message_count = EXCLUDED.message_count,
          updated_at = NOW()
      WHERE public.chat_repair_audit.status = 'pending'
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_inserted_count
  FROM upserted;

  RETURN v_inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_chat_repair_audit(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_chat_repair_audit(INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_chat_repair_audit(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_chat_repair_audit(
  p_audit_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.chat_repair_audit%ROWTYPE;
  v_blocked BOOLEAN := false;
BEGIN
  SELECT *
  INTO v_entry
  FROM public.chat_repair_audit
  WHERE id = p_audit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat repair audit entry not found';
  END IF;

  IF v_entry.status <> 'pending' THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_blocks
    WHERE (blocker_id = v_entry.user1_id AND blocked_id = v_entry.user2_id)
       OR (blocker_id = v_entry.user2_id AND blocked_id = v_entry.user1_id)
  )
  INTO v_blocked;

  IF v_blocked THEN
    UPDATE public.chat_repair_audit
    SET status = 'blocked',
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_audit_id;
    RETURN false;
  END IF;

  INSERT INTO public.matches (user1_id, user2_id, status, created_at, updated_at)
  VALUES (v_entry.user1_id, v_entry.user2_id, 'active', COALESCE(v_entry.first_message_at, NOW()), NOW())
  ON CONFLICT (user1_id, user2_id) DO UPDATE
    SET status = CASE
          WHEN public.matches.status = 'ended' THEN public.matches.status
          WHEN public.matches.status LIKE 'blocked_by_%' THEN public.matches.status
          ELSE 'active'
        END,
        updated_at = NOW();

  UPDATE public.chat_repair_audit
  SET status = 'applied',
      resolved_at = NOW(),
      updated_at = NOW()
  WHERE id = p_audit_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_chat_repair_audit(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_chat_repair_audit(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_chat_repair_audit(UUID) TO service_role;

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
    RETURNING cw.movie_id, cw.media_type, cw.state, cw.remaining_ms, cw.expires_at, cw.started_at, cw.paused_at, cw.version, cw.updated_at;
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
  RETURNING currently_watching.movie_id,
            currently_watching.media_type,
            currently_watching.state,
            currently_watching.remaining_ms,
            currently_watching.expires_at,
            currently_watching.started_at,
            currently_watching.paused_at,
            currently_watching.version,
            currently_watching.updated_at;

  INSERT INTO public.user_movies (user_id, movie_id, media_type, type)
  VALUES (p_user_id, v_movie_id, v_media_type, 'watched')
  ON CONFLICT (user_id, media_type, movie_id, type) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_watch_session_transition(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_watch_session_transition(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_watch_session_transition(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER) TO service_role;
