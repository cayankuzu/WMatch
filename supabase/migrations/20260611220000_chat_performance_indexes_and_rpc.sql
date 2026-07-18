CREATE INDEX IF NOT EXISTS idx_user_movies_movie_user
  ON public.user_movies(movie_id, user_id);
CREATE INDEX IF NOT EXISTS idx_currently_watching_movie_updated_at
  ON public.currently_watching(movie_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_user1_active
  ON public.matches(user1_id, updated_at DESC)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_matches_user2_active
  ON public.matches(user2_id, updated_at DESC)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_messages_pair_created_at
  ON public.messages (
    LEAST(sender_id, receiver_id),
    GREATEST(sender_id, receiver_id),
    created_at DESC,
    id DESC
  );
CREATE INDEX IF NOT EXISTS idx_messages_receiver_sender_read_created_at
  ON public.messages(receiver_id, sender_id, read, created_at DESC, id DESC);
CREATE OR REPLACE FUNCTION public.get_chat_messages_page(
  p_current_user_id UUID,
  p_other_user_id UUID,
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,
  p_before_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE (
  id UUID,
  sender_id UUID,
  receiver_id UUID,
  text TEXT,
  read BOOLEAN,
  created_at TIMESTAMPTZ,
  client_request_id TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.sender_id,
    m.receiver_id,
    m.text,
    m.read,
    m.created_at,
    m.client_request_id
  FROM public.messages AS m
  WHERE (
    (m.sender_id = p_current_user_id AND m.receiver_id = p_other_user_id)
    OR
    (m.sender_id = p_other_user_id AND m.receiver_id = p_current_user_id)
  )
    AND (
      p_before_created_at IS NULL
      OR m.created_at < p_before_created_at
      OR (
        m.created_at = p_before_created_at
        AND p_before_id IS NOT NULL
        AND m.id < p_before_id
      )
    )
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 101);
$$;
CREATE OR REPLACE FUNCTION public.get_chat_message_stats(
  p_current_user_id UUID,
  p_other_user_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  other_user_id UUID,
  last_message TEXT,
  last_message_time TIMESTAMPTZ,
  unread_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped_messages AS (
    SELECT
      CASE
        WHEN m.sender_id = p_current_user_id THEN m.receiver_id
        ELSE m.sender_id
      END AS other_user_id,
      m.id,
      m.text,
      m.created_at,
      CASE
        WHEN m.sender_id <> p_current_user_id
          AND m.receiver_id = p_current_user_id
          AND NOT m.read
        THEN 1
        ELSE 0
      END AS unread_increment
    FROM public.messages AS m
    WHERE (
      m.sender_id = p_current_user_id
      OR m.receiver_id = p_current_user_id
    )
      AND (
        p_other_user_ids IS NULL
        OR (
          CASE
            WHEN m.sender_id = p_current_user_id THEN m.receiver_id
            ELSE m.sender_id
          END
        ) = ANY(p_other_user_ids)
      )
  ),
  latest_per_chat AS (
    SELECT DISTINCT ON (other_user_id)
      other_user_id,
      text,
      created_at
    FROM scoped_messages
    ORDER BY other_user_id, created_at DESC, id DESC
  ),
  unread_per_chat AS (
    SELECT
      other_user_id,
      COALESCE(SUM(unread_increment), 0)::BIGINT AS unread_count
    FROM scoped_messages
    GROUP BY other_user_id
  )
  SELECT
    latest_per_chat.other_user_id,
    latest_per_chat.text AS last_message,
    latest_per_chat.created_at AS last_message_time,
    COALESCE(unread_per_chat.unread_count, 0)::BIGINT AS unread_count
  FROM latest_per_chat
  LEFT JOIN unread_per_chat
    ON unread_per_chat.other_user_id = latest_per_chat.other_user_id;
$$;
REVOKE ALL ON FUNCTION public.get_chat_messages_page(UUID, UUID, TIMESTAMPTZ, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_chat_message_stats(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_messages_page(UUID, UUID, TIMESTAMPTZ, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_message_stats(UUID, UUID[]) TO service_role;
