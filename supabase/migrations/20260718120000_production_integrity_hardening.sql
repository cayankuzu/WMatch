-- Forward repair for environments where the historical notification/chat
-- migrations were applied while they were empty. All statements are additive
-- or idempotent so older mobile clients remain compatible.

INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260718120000',
  '20260715201000',
  '20260718120000',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS user1_chat_deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user2_chat_deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user1_chat_cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user2_chat_cleared_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_matches_user1_chat_visibility
  ON public.matches(user1_id, user1_chat_deleted_at, user1_chat_cleared_at);

CREATE INDEX IF NOT EXISTS idx_matches_user2_chat_visibility
  ON public.matches(user2_id, user2_chat_deleted_at, user2_chat_cleared_at);

CREATE TABLE IF NOT EXISTS public.notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  route_kind TEXT NOT NULL,
  route_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_events_user_created
  ON public.notification_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_events_unread_route
  ON public.notification_events(user_id, route_kind, route_user_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS push_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS push_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS push_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_last_error TEXT;

ALTER TABLE public.notification_events
  ALTER COLUMN push_status SET DEFAULT 'pending',
  ALTER COLUMN push_next_attempt_at SET DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_events_push_status_check'
      AND conrelid = 'public.notification_events'::REGCLASS
  ) THEN
    ALTER TABLE public.notification_events
      ADD CONSTRAINT notification_events_push_status_check
      CHECK (push_status IN (
        'not_requested', 'pending', 'processing', 'retry', 'submitted', 'no_tokens', 'dead'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_events_push_attempt_count_check'
      AND conrelid = 'public.notification_events'::REGCLASS
  ) THEN
    ALTER TABLE public.notification_events
      ADD CONSTRAINT notification_events_push_attempt_count_check
      CHECK (push_attempt_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notification_events_push_outbox
  ON public.notification_events(push_next_attempt_at, created_at, id)
  WHERE push_status IN ('pending', 'retry', 'processing');

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_push_delivery_jobs(
  p_event_ids UUID[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 25
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  actor_user_id UUID,
  kind TEXT,
  route_kind TEXT,
  route_user_id UUID,
  title TEXT,
  body TEXT,
  payload JSONB,
  attempt_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT event.id
    FROM public.notification_events event
    WHERE (
      (
        event.push_status IN ('pending', 'retry')
        AND COALESCE(event.push_next_attempt_at, event.created_at) <= NOW()
      ) OR (
        event.push_status = 'processing'
        AND event.push_locked_at < NOW() - INTERVAL '5 minutes'
      )
    )
      AND (p_event_ids IS NULL OR event.id = ANY(p_event_ids))
    ORDER BY COALESCE(event.push_next_attempt_at, event.created_at), event.created_at, event.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  ),
  claimed AS (
    UPDATE public.notification_events event
    SET
      push_status = 'processing',
      push_attempt_count = event.push_attempt_count + 1,
      push_locked_at = NOW(),
      push_last_error = NULL
    FROM claimable
    WHERE event.id = claimable.id
    RETURNING event.*
  )
  SELECT
    claimed.id,
    claimed.user_id,
    claimed.actor_user_id,
    claimed.kind,
    claimed.route_kind,
    claimed.route_user_id,
    claimed.title,
    claimed.body,
    claimed.payload,
    claimed.push_attempt_count
  FROM claimed
  ORDER BY claimed.created_at, claimed.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_push_delivery_job(
  p_event_id UUID,
  p_status TEXT,
  p_error TEXT DEFAULT NULL,
  p_retry_after_seconds INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_status NOT IN ('retry', 'submitted', 'no_tokens', 'dead') THEN
    RAISE EXCEPTION 'Invalid push delivery completion status.';
  END IF;

  UPDATE public.notification_events
  SET
    push_status = p_status,
    push_locked_at = NULL,
    push_submitted_at = CASE WHEN p_status = 'submitted' THEN NOW() ELSE push_submitted_at END,
    push_next_attempt_at = CASE
      WHEN p_status = 'retry' THEN NOW() + make_interval(secs => LEAST(GREATEST(COALESCE(p_retry_after_seconds, 30), 5), 3600))
      ELSE NULL
    END,
    push_last_error = CASE
      WHEN p_error IS NULL THEN NULL
      ELSE LEFT(p_error, 500)
    END
  WHERE id = p_event_id
    AND push_status = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_delivery_jobs(UUID[], INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_push_delivery_job(UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_delivery_jobs(UUID[], INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_push_delivery_job(UUID, TEXT, TEXT, INTEGER) TO service_role;

UPDATE storage.buckets
SET public = FALSE
WHERE id = 'profile-photos';

DROP POLICY IF EXISTS "Public profile photos are readable" ON storage.objects;

CREATE TABLE IF NOT EXISTS public.account_deletion_jobs (
  user_id UUID PRIMARY KEY,
  photo_paths JSONB NOT NULL DEFAULT '[]'::JSONB,
  stage TEXT NOT NULL DEFAULT 'requested'
    CHECK (stage IN ('requested', 'related_data_deleted', 'storage_deleted', 'auth_deleted', 'completed')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_deletion_jobs TO service_role;

DROP POLICY IF EXISTS "Service boundary account deletion jobs" ON public.account_deletion_jobs;
CREATE POLICY "Service boundary account deletion jobs" ON public.account_deletion_jobs
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

CREATE INDEX IF NOT EXISTS idx_account_deletion_jobs_incomplete
  ON public.account_deletion_jobs(updated_at)
  WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.mutation_idempotency_records (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mutation_route TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  PRIMARY KEY (user_id, mutation_route, idempotency_key),
  CHECK (char_length(idempotency_key) BETWEEN 8 AND 180),
  CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.mutation_idempotency_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mutation_idempotency_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mutation_idempotency_records TO service_role;

DROP POLICY IF EXISTS "Service boundary mutation idempotency" ON public.mutation_idempotency_records;
CREATE POLICY "Service boundary mutation idempotency" ON public.mutation_idempotency_records
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

CREATE INDEX IF NOT EXISTS idx_mutation_idempotency_expiry
  ON public.mutation_idempotency_records(user_id, mutation_route, expires_at);

CREATE OR REPLACE FUNCTION public.process_like_action_idempotent(
  p_actor_user_id UUID,
  p_target_user_id UUID,
  p_source_type TEXT,
  p_window_hours INTEGER,
  p_like_limit INTEGER,
  p_idempotency_key TEXT,
  p_payload_hash TEXT
)
RETURNS TABLE (
  outcome TEXT,
  matched BOOLEAN,
  match_became_active BOOLEAN,
  reward_granted BOOLEAN,
  window_started_at TIMESTAMPTZ,
  used_like_swipes INTEGER,
  used_dislike_swipes INTEGER,
  used_undos INTEGER,
  idempotency_replayed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.mutation_idempotency_records%ROWTYPE;
  v_result RECORD;
  v_response JSONB;
BEGIN
  IF p_idempotency_key IS NULL OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 180 THEN
    RAISE EXCEPTION 'Invalid idempotency key.';
  END IF;

  IF p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid idempotency payload hash.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_actor_user_id::TEXT),
    hashtext('like:' || p_idempotency_key)
  );

  DELETE FROM public.mutation_idempotency_records
  WHERE user_id = p_actor_user_id
    AND mutation_route = 'like'
    AND expires_at <= NOW();

  SELECT * INTO v_existing
  FROM public.mutation_idempotency_records
  WHERE user_id = p_actor_user_id
    AND mutation_route = 'like'
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing.user_id IS NOT NULL THEN
    IF v_existing.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'idempotency_key_reused_with_different_payload' USING ERRCODE = '22023';
    END IF;

    v_response := v_existing.response_payload;
    RETURN QUERY SELECT
      v_response ->> 'outcome',
      (v_response ->> 'matched')::BOOLEAN,
      (v_response ->> 'match_became_active')::BOOLEAN,
      (v_response ->> 'reward_granted')::BOOLEAN,
      (v_response ->> 'window_started_at')::TIMESTAMPTZ,
      (v_response ->> 'used_like_swipes')::INTEGER,
      (v_response ->> 'used_dislike_swipes')::INTEGER,
      (v_response ->> 'used_undos')::INTEGER,
      TRUE;
    RETURN;
  END IF;

  SELECT * INTO v_result
  FROM public.process_like_action_atomic(
    p_actor_user_id,
    p_target_user_id,
    p_source_type,
    p_window_hours,
    p_like_limit
  );

  v_response := jsonb_build_object(
    'outcome', v_result.outcome,
    'matched', v_result.matched,
    'match_became_active', v_result.match_became_active,
    'reward_granted', v_result.reward_granted,
    'window_started_at', v_result.window_started_at,
    'used_like_swipes', v_result.used_like_swipes,
    'used_dislike_swipes', v_result.used_dislike_swipes,
    'used_undos', v_result.used_undos
  );

  INSERT INTO public.mutation_idempotency_records (
    user_id,
    mutation_route,
    idempotency_key,
    payload_hash,
    response_payload
  ) VALUES (
    p_actor_user_id,
    'like',
    p_idempotency_key,
    p_payload_hash,
    v_response
  );

  RETURN QUERY SELECT
    v_result.outcome::TEXT,
    v_result.matched::BOOLEAN,
    v_result.match_became_active::BOOLEAN,
    v_result.reward_granted::BOOLEAN,
    v_result.window_started_at::TIMESTAMPTZ,
    v_result.used_like_swipes::INTEGER,
    v_result.used_dislike_swipes::INTEGER,
    v_result.used_undos::INTEGER,
    FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.process_like_action_idempotent(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_like_action_idempotent(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.chat_pair_summaries (
  user1_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_message_id UUID,
  last_message TEXT NOT NULL DEFAULT '',
  last_message_time TIMESTAMPTZ,
  unread_user1 INTEGER NOT NULL DEFAULT 0 CHECK (unread_user1 >= 0),
  unread_user2 INTEGER NOT NULL DEFAULT 0 CHECK (unread_user2 >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user1_id, user2_id),
  CHECK (user1_id < user2_id)
);

ALTER TABLE public.chat_pair_summaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_pair_summaries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_pair_summaries TO service_role;

DROP POLICY IF EXISTS "Service boundary chat pair summaries" ON public.chat_pair_summaries;
CREATE POLICY "Service boundary chat pair summaries" ON public.chat_pair_summaries
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

CREATE INDEX IF NOT EXISTS idx_chat_pair_summaries_user1_activity
  ON public.chat_pair_summaries(user1_id, last_message_time DESC, user2_id DESC);

CREATE INDEX IF NOT EXISTS idx_chat_pair_summaries_user2_activity
  ON public.chat_pair_summaries(user2_id, last_message_time DESC, user1_id DESC);

WITH ranked_messages AS (
  SELECT
    LEAST(sender_id, receiver_id) AS user1_id,
    GREATEST(sender_id, receiver_id) AS user2_id,
    id,
    text,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id)
      ORDER BY created_at DESC, id DESC
    ) AS row_number,
    COUNT(*) FILTER (WHERE receiver_id = LEAST(sender_id, receiver_id) AND read = FALSE)
      OVER (PARTITION BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id)) AS unread_user1,
    COUNT(*) FILTER (WHERE receiver_id = GREATEST(sender_id, receiver_id) AND read = FALSE)
      OVER (PARTITION BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id)) AS unread_user2
  FROM public.messages
  WHERE sender_id IS NOT NULL
    AND receiver_id IS NOT NULL
    AND sender_id <> receiver_id
)
INSERT INTO public.chat_pair_summaries (
  user1_id,
  user2_id,
  last_message_id,
  last_message,
  last_message_time,
  unread_user1,
  unread_user2,
  updated_at
)
SELECT
  user1_id,
  user2_id,
  id,
  text,
  created_at,
  unread_user1::INTEGER,
  unread_user2::INTEGER,
  NOW()
FROM ranked_messages
WHERE row_number = 1
ON CONFLICT (user1_id, user2_id) DO UPDATE
SET
  last_message_id = EXCLUDED.last_message_id,
  last_message = EXCLUDED.last_message,
  last_message_time = EXCLUDED.last_message_time,
  unread_user1 = EXCLUDED.unread_user1,
  unread_user2 = EXCLUDED.unread_user2,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.update_chat_pair_summary_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user1 UUID := LEAST(NEW.sender_id, NEW.receiver_id);
  v_user2 UUID := GREATEST(NEW.sender_id, NEW.receiver_id);
BEGIN
  IF NEW.sender_id IS NULL OR NEW.receiver_id IS NULL OR NEW.sender_id = NEW.receiver_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.chat_pair_summaries (
    user1_id,
    user2_id,
    last_message_id,
    last_message,
    last_message_time,
    unread_user1,
    unread_user2,
    updated_at
  ) VALUES (
    v_user1,
    v_user2,
    NEW.id,
    NEW.text,
    NEW.created_at,
    CASE WHEN NEW.receiver_id = v_user1 AND NEW.read = FALSE THEN 1 ELSE 0 END,
    CASE WHEN NEW.receiver_id = v_user2 AND NEW.read = FALSE THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (user1_id, user2_id) DO UPDATE
  SET
    last_message_id = CASE
      WHEN (EXCLUDED.last_message_time, EXCLUDED.last_message_id) >=
        (public.chat_pair_summaries.last_message_time, public.chat_pair_summaries.last_message_id)
      THEN EXCLUDED.last_message_id
      ELSE public.chat_pair_summaries.last_message_id
    END,
    last_message = CASE
      WHEN (EXCLUDED.last_message_time, EXCLUDED.last_message_id) >=
        (public.chat_pair_summaries.last_message_time, public.chat_pair_summaries.last_message_id)
      THEN EXCLUDED.last_message
      ELSE public.chat_pair_summaries.last_message
    END,
    last_message_time = GREATEST(
      public.chat_pair_summaries.last_message_time,
      EXCLUDED.last_message_time
    ),
    unread_user1 = public.chat_pair_summaries.unread_user1 + EXCLUDED.unread_user1,
    unread_user2 = public.chat_pair_summaries.unread_user2 + EXCLUDED.unread_user2,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_chat_pair_summary_on_read()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user1 UUID := LEAST(NEW.sender_id, NEW.receiver_id);
  v_user2 UUID := GREATEST(NEW.sender_id, NEW.receiver_id);
  v_delta INTEGER;
BEGIN
  IF NEW.read IS NOT DISTINCT FROM OLD.read OR NEW.receiver_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_delta := CASE WHEN NEW.read THEN -1 ELSE 1 END;

  UPDATE public.chat_pair_summaries
  SET
    unread_user1 = CASE
      WHEN NEW.receiver_id = v_user1 THEN GREATEST(0, unread_user1 + v_delta)
      ELSE unread_user1
    END,
    unread_user2 = CASE
      WHEN NEW.receiver_id = v_user2 THEN GREATEST(0, unread_user2 + v_delta)
      ELSE unread_user2
    END,
    updated_at = NOW()
  WHERE user1_id = v_user1 AND user2_id = v_user2;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_chat_pair_summary_after_insert ON public.messages;
CREATE TRIGGER update_chat_pair_summary_after_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_chat_pair_summary_on_insert();

DROP TRIGGER IF EXISTS update_chat_pair_summary_after_read ON public.messages;
CREATE TRIGGER update_chat_pair_summary_after_read
  AFTER UPDATE OF read ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_chat_pair_summary_on_read();

REVOKE ALL ON FUNCTION public.update_chat_pair_summary_on_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_chat_pair_summary_on_read() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_chat_pair_summary_on_insert() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_chat_pair_summary_on_read() TO service_role;

CREATE OR REPLACE FUNCTION public.get_chat_directory_page(
  p_current_user_id UUID,
  p_cursor_time TIMESTAMPTZ DEFAULT NULL,
  p_cursor_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 41
)
RETURNS TABLE (
  other_user_id UUID,
  activity_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH current_matches AS (
    SELECT
      m.user2_id AS other_user_id,
      m.created_at,
      m.user1_chat_deleted_at AS deleted_at,
      m.user1_chat_cleared_at AS cleared_at
    FROM public.matches m
    WHERE m.user1_id = p_current_user_id
    UNION ALL
    SELECT
      m.user1_id,
      m.created_at,
      m.user2_chat_deleted_at,
      m.user2_chat_cleared_at
    FROM public.matches m
    WHERE m.user2_id = p_current_user_id
  ),
  current_summaries AS (
    SELECT s.user2_id AS other_user_id, s.last_message_time
    FROM public.chat_pair_summaries s
    WHERE s.user1_id = p_current_user_id
    UNION ALL
    SELECT s.user1_id, s.last_message_time
    FROM public.chat_pair_summaries s
    WHERE s.user2_id = p_current_user_id
  ),
  peer_ids AS (
    SELECT other_user_id FROM current_matches
    UNION
    SELECT other_user_id FROM current_summaries
  ),
  visible_peers AS (
    SELECT
      peers.other_user_id,
      CASE
        WHEN summary.last_message_time >= GREATEST(
          COALESCE(match.created_at, '-infinity'::TIMESTAMPTZ),
          COALESCE(match.cleared_at, '-infinity'::TIMESTAMPTZ)
        ) THEN summary.last_message_time
        ELSE GREATEST(
          COALESCE(match.created_at, '-infinity'::TIMESTAMPTZ),
          COALESCE(match.cleared_at, '-infinity'::TIMESTAMPTZ)
        )
      END AS activity_at
    FROM peer_ids peers
    LEFT JOIN current_matches match ON match.other_user_id = peers.other_user_id
    LEFT JOIN current_summaries summary ON summary.other_user_id = peers.other_user_id
    WHERE peers.other_user_id IS NOT NULL
      AND peers.other_user_id <> p_current_user_id
      AND match.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.hidden_chats hidden
        WHERE hidden.user_id = p_current_user_id
          AND hidden.other_user_id = peers.other_user_id
      )
  )
  SELECT visible_peers.other_user_id, visible_peers.activity_at
  FROM visible_peers
  WHERE visible_peers.activity_at > '-infinity'::TIMESTAMPTZ
    AND (
      p_cursor_time IS NULL
      OR visible_peers.activity_at < p_cursor_time
      OR (
        visible_peers.activity_at = p_cursor_time
        AND p_cursor_user_id IS NOT NULL
        AND visible_peers.other_user_id < p_cursor_user_id
      )
    )
  ORDER BY visible_peers.activity_at DESC, visible_peers.other_user_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 41), 1), 81);
$$;

REVOKE ALL ON FUNCTION public.get_chat_directory_page(UUID, TIMESTAMPTZ, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_directory_page(UUID, TIMESTAMPTZ, UUID, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_compatibility_candidate_page(
  p_current_user_id UUID,
  p_cursor_overlap BIGINT DEFAULT NULL,
  p_cursor_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 41
)
RETURNS TABLE (
  user_id UUID,
  overlap_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH current_media AS (
    SELECT DISTINCT movie_id, media_type
    FROM public.user_movies
    WHERE user_id = p_current_user_id
  ),
  candidate_scores AS (
    SELECT
      candidate.user_id,
      COUNT(DISTINCT (candidate.movie_id, candidate.media_type))::BIGINT AS overlap_count
    FROM current_media current_item
    JOIN public.user_movies candidate
      ON candidate.movie_id = current_item.movie_id
     AND candidate.media_type = current_item.media_type
    WHERE candidate.user_id <> p_current_user_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_blocks block
        WHERE (block.blocker_id = p_current_user_id AND block.blocked_id = candidate.user_id)
           OR (block.blocker_id = candidate.user_id AND block.blocked_id = p_current_user_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.likes own_like
        WHERE own_like.user_id = p_current_user_id
          AND own_like.liked_user_id = candidate.user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.matches matched_row
        WHERE matched_row.status = 'active'
          AND (
            (matched_row.user1_id = p_current_user_id AND matched_row.user2_id = candidate.user_id)
            OR (matched_row.user2_id = p_current_user_id AND matched_row.user1_id = candidate.user_id)
          )
      )
    GROUP BY candidate.user_id
  )
  SELECT candidate_scores.user_id, candidate_scores.overlap_count
  FROM candidate_scores
  WHERE p_cursor_overlap IS NULL
    OR candidate_scores.overlap_count < p_cursor_overlap
    OR (
      candidate_scores.overlap_count = p_cursor_overlap
      AND p_cursor_user_id IS NOT NULL
      AND candidate_scores.user_id > p_cursor_user_id
    )
  ORDER BY candidate_scores.overlap_count DESC, candidate_scores.user_id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 41), 1), 81);
$$;

REVOKE ALL ON FUNCTION public.get_compatibility_candidate_page(UUID, BIGINT, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_compatibility_candidate_page(UUID, BIGINT, UUID, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_watch_discovery_candidate_page(
  p_current_user_id UUID,
  p_movie_id INTEGER,
  p_media_type TEXT,
  p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 41
)
RETURNS TABLE (
  user_id UUID,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT watching.user_id, watching.updated_at
  FROM public.currently_watching watching
  WHERE watching.movie_id = p_movie_id
    AND watching.media_type = p_media_type
    AND watching.state = 'active'
    AND watching.expires_at > NOW()
    AND watching.user_id <> p_current_user_id
    AND (
      p_cursor_updated_at IS NULL
      OR watching.updated_at < p_cursor_updated_at
      OR (
        watching.updated_at = p_cursor_updated_at
        AND p_cursor_user_id IS NOT NULL
        AND watching.user_id < p_cursor_user_id
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_blocks block
      WHERE (block.blocker_id = p_current_user_id AND block.blocked_id = watching.user_id)
         OR (block.blocker_id = watching.user_id AND block.blocked_id = p_current_user_id)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.likes own_like
      WHERE own_like.user_id = p_current_user_id
        AND own_like.liked_user_id = watching.user_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.matches matched_row
      WHERE matched_row.status = 'active'
        AND (
          (matched_row.user1_id = p_current_user_id AND matched_row.user2_id = watching.user_id)
          OR (matched_row.user2_id = p_current_user_id AND matched_row.user1_id = watching.user_id)
        )
    )
  ORDER BY watching.updated_at DESC, watching.user_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 41), 1), 81);
$$;

REVOKE ALL ON FUNCTION public.get_watch_discovery_candidate_page(UUID, INTEGER, TEXT, TIMESTAMPTZ, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_watch_discovery_candidate_page(UUID, INTEGER, TEXT, TIMESTAMPTZ, UUID, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_chat_list_stats(
  p_current_user_id UUID,
  p_other_user_ids UUID[],
  p_visible_since JSONB
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
  WITH peers AS (
    SELECT DISTINCT peer_id AS other_user_id
    FROM unnest(COALESCE(p_other_user_ids, ARRAY[]::UUID[])) AS peer_id
    WHERE peer_id IS NOT NULL
      AND peer_id <> p_current_user_id
    LIMIT 500
  )
  SELECT
    peers.other_user_id,
    latest.text AS last_message,
    latest.created_at AS last_message_time,
    COALESCE(unread.total, 0)::BIGINT AS unread_count
  FROM peers
  LEFT JOIN LATERAL (
    SELECT m.text, m.created_at
    FROM public.messages m
    WHERE (
      (m.sender_id = p_current_user_id AND m.receiver_id = peers.other_user_id)
      OR (m.sender_id = peers.other_user_id AND m.receiver_id = p_current_user_id)
    )
      AND m.created_at >= COALESCE(
        NULLIF(p_visible_since ->> peers.other_user_id::TEXT, '')::TIMESTAMPTZ,
        '-infinity'::TIMESTAMPTZ
      )
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) latest ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS total
    FROM public.messages m
    WHERE m.sender_id = peers.other_user_id
      AND m.receiver_id = p_current_user_id
      AND m.read = FALSE
      AND m.created_at >= COALESCE(
        NULLIF(p_visible_since ->> peers.other_user_id::TEXT, '')::TIMESTAMPTZ,
        '-infinity'::TIMESTAMPTZ
      )
  ) unread ON TRUE;
$$;

REVOKE ALL ON FUNCTION public.get_chat_list_stats(UUID, UUID[], JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_list_stats(UUID, UUID[], JSONB)
  TO service_role;

CREATE OR REPLACE FUNCTION public.update_pair_relationship_atomic(
  p_actor_user_id UUID,
  p_target_user_id UUID,
  p_action TEXT
)
RETURNS TABLE (
  outcome TEXT,
  match_status TEXT,
  user1_id UUID,
  user2_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user1 UUID;
  v_user2 UUID;
  v_match public.matches%ROWTYPE;
  v_other_block_exists BOOLEAN := FALSE;
  v_next_status TEXT;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_actor_user_id = p_target_user_id THEN
    RAISE EXCEPTION 'Invalid relationship pair.';
  END IF;

  IF p_action NOT IN ('block', 'unblock', 'end') THEN
    RAISE EXCEPTION 'Invalid relationship action.';
  END IF;

  IF p_actor_user_id < p_target_user_id THEN
    v_user1 := p_actor_user_id;
    v_user2 := p_target_user_id;
  ELSE
    v_user1 := p_target_user_id;
    v_user2 := p_actor_user_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user1::TEXT), hashtext(v_user2::TEXT));

  SELECT * INTO v_match
  FROM public.matches
  WHERE matches.user1_id = v_user1
    AND matches.user2_id = v_user2
  FOR UPDATE;

  IF p_action = 'block' THEN
    INSERT INTO public.user_blocks (blocker_id, blocked_id)
    VALUES (p_actor_user_id, p_target_user_id)
    ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

    DELETE FROM public.likes
    WHERE (likes.user_id = p_actor_user_id AND likes.liked_user_id = p_target_user_id)
       OR (likes.user_id = p_target_user_id AND likes.liked_user_id = p_actor_user_id);

    IF v_match.user1_id IS NOT NULL THEN
      v_next_status := CASE
        WHEN p_actor_user_id = v_user1 THEN 'blocked_by_user1'
        ELSE 'blocked_by_user2'
      END;

      UPDATE public.matches
      SET
        status = v_next_status,
        ended_at = COALESCE(ended_at, NOW()),
        ended_by_user_id = COALESCE(ended_by_user_id, p_actor_user_id)
      WHERE matches.user1_id = v_user1
        AND matches.user2_id = v_user2;
    END IF;

    RETURN QUERY SELECT 'blocked'::TEXT, v_next_status, v_user1, v_user2;
    RETURN;
  END IF;

  IF p_action = 'unblock' THEN
    DELETE FROM public.user_blocks
    WHERE blocker_id = p_actor_user_id
      AND blocked_id = p_target_user_id;

    SELECT EXISTS (
      SELECT 1
      FROM public.user_blocks
      WHERE blocker_id = p_target_user_id
        AND blocked_id = p_actor_user_id
    ) INTO v_other_block_exists;

    IF v_match.user1_id IS NOT NULL THEN
      v_next_status := CASE
        WHEN v_other_block_exists AND p_target_user_id = v_user1 THEN 'blocked_by_user1'
        WHEN v_other_block_exists THEN 'blocked_by_user2'
        WHEN v_match.ended_at IS NOT NULL OR v_match.status = 'ended' THEN 'ended'
        ELSE 'active'
      END;

      UPDATE public.matches
      SET status = v_next_status
      WHERE matches.user1_id = v_user1
        AND matches.user2_id = v_user2;
    END IF;

    RETURN QUERY SELECT 'unblocked'::TEXT, v_next_status, v_user1, v_user2;
    RETURN;
  END IF;

  IF v_match.user1_id IS NULL THEN
    RETURN QUERY SELECT 'missing_match'::TEXT, NULL::TEXT, v_user1, v_user2;
    RETURN;
  END IF;

  UPDATE public.matches
  SET
    status = 'ended',
    ended_at = NOW(),
    ended_by_user_id = p_actor_user_id
  WHERE matches.user1_id = v_user1
    AND matches.user2_id = v_user2;

  DELETE FROM public.likes
  WHERE (likes.user_id = p_actor_user_id AND likes.liked_user_id = p_target_user_id)
     OR (likes.user_id = p_target_user_id AND likes.liked_user_id = p_actor_user_id);

  RETURN QUERY SELECT 'ended'::TEXT, 'ended'::TEXT, v_user1, v_user2;
END;
$$;

REVOKE ALL ON FUNCTION public.update_pair_relationship_atomic(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_pair_relationship_atomic(UUID, UUID, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.delete_chat_for_user_atomic(
  p_actor_user_id UUID,
  p_target_user_id UUID,
  p_mode TEXT
)
RETURNS TABLE (
  outcome TEXT,
  deleted_for_self BOOLEAN,
  deleted_for_everyone BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user1 UUID;
  v_user2 UUID;
  v_match public.matches%ROWTYPE;
  v_other_deleted_at TIMESTAMPTZ;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_actor_user_id = p_target_user_id THEN
    RAISE EXCEPTION 'Invalid chat deletion pair.';
  END IF;

  IF p_mode NOT IN ('block', 'end') THEN
    RAISE EXCEPTION 'Invalid chat deletion mode.';
  END IF;

  IF p_actor_user_id < p_target_user_id THEN
    v_user1 := p_actor_user_id;
    v_user2 := p_target_user_id;
  ELSE
    v_user1 := p_target_user_id;
    v_user2 := p_actor_user_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user1::TEXT), hashtext(v_user2::TEXT));
  PERFORM *
  FROM public.update_pair_relationship_atomic(
    p_actor_user_id,
    p_target_user_id,
    p_mode
  );

  SELECT * INTO v_match
  FROM public.matches
  WHERE matches.user1_id = v_user1
    AND matches.user2_id = v_user2
  FOR UPDATE;

  IF v_match.user1_id IS NULL THEN
    DELETE FROM public.hidden_chats
    WHERE user_id = p_actor_user_id
      AND other_user_id = p_target_user_id;

    DELETE FROM public.notification_events
    WHERE user_id = p_actor_user_id
      AND route_kind = 'chat'
      AND route_user_id = p_target_user_id;

    RETURN QUERY SELECT 'missing_match'::TEXT, TRUE, FALSE;
    RETURN;
  END IF;

  v_other_deleted_at := CASE
    WHEN p_target_user_id = v_user1 THEN v_match.user1_chat_deleted_at
    ELSE v_match.user2_chat_deleted_at
  END;

  IF v_other_deleted_at IS NOT NULL THEN
    DELETE FROM public.messages
    WHERE (sender_id = v_user1 AND receiver_id = v_user2)
       OR (sender_id = v_user2 AND receiver_id = v_user1);

    DELETE FROM public.hidden_chats
    WHERE (user_id = v_user1 AND other_user_id = v_user2)
       OR (user_id = v_user2 AND other_user_id = v_user1);

    DELETE FROM public.chat_settings
    WHERE (owner_user_id = v_user1 AND other_user_id = v_user2)
       OR (owner_user_id = v_user2 AND other_user_id = v_user1);

    DELETE FROM public.notification_events
    WHERE route_kind = 'chat'
      AND (
        (user_id = v_user1 AND route_user_id = v_user2)
        OR (user_id = v_user2 AND route_user_id = v_user1)
      );

    DELETE FROM public.chat_pair_summaries
    WHERE user1_id = v_user1
      AND user2_id = v_user2;

    DELETE FROM public.matches
    WHERE matches.user1_id = v_user1
      AND matches.user2_id = v_user2;

    RETURN QUERY SELECT 'deleted_for_everyone'::TEXT, TRUE, TRUE;
    RETURN;
  END IF;

  UPDATE public.matches
  SET
    user1_chat_deleted_at = CASE
      WHEN p_actor_user_id = v_user1 THEN NOW()
      ELSE user1_chat_deleted_at
    END,
    user2_chat_deleted_at = CASE
      WHEN p_actor_user_id = v_user2 THEN NOW()
      ELSE user2_chat_deleted_at
    END
  WHERE matches.user1_id = v_user1
    AND matches.user2_id = v_user2;

  DELETE FROM public.hidden_chats
  WHERE user_id = p_actor_user_id
    AND other_user_id = p_target_user_id;

  DELETE FROM public.notification_events
  WHERE user_id = p_actor_user_id
    AND route_kind = 'chat'
    AND route_user_id = p_target_user_id;

  RETURN QUERY SELECT 'deleted_for_self'::TEXT, TRUE, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_chat_for_user_atomic(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_chat_for_user_atomic(UUID, UUID, TEXT)
  TO service_role;

-- Raw media preferences and active watch rows are service-boundary data.
-- Mobile clients receive only the filtered payloads exposed by the Edge API.
DROP POLICY IF EXISTS "Users can view others' movies" ON public.user_movies;
DROP POLICY IF EXISTS "Users can manage their own movies" ON public.user_movies;
DROP POLICY IF EXISTS "Users can view others' currently watching" ON public.currently_watching;
DROP POLICY IF EXISTS "Users can manage their currently watching" ON public.currently_watching;

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_movies FROM PUBLIC, anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.currently_watching FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_movies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.currently_watching TO service_role;

DROP POLICY IF EXISTS "Service boundary user movie reads" ON public.user_movies;
CREATE POLICY "Service boundary user movie reads" ON public.user_movies
  FOR SELECT
  USING (FALSE);

DROP POLICY IF EXISTS "Service boundary currently watching reads" ON public.currently_watching;
CREATE POLICY "Service boundary currently watching reads" ON public.currently_watching
  FOR SELECT
  USING (FALSE);

CREATE OR REPLACE FUNCTION public.undo_like_action_atomic(
  p_actor_user_id UUID,
  p_target_user_id UUID,
  p_window_hours INTEGER,
  p_undo_limit INTEGER
)
RETURNS TABLE (
  outcome TEXT,
  window_started_at TIMESTAMPTZ,
  used_like_swipes INTEGER,
  used_dislike_swipes INTEGER,
  used_undos INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user1 UUID;
  v_user2 UUID;
  v_now TIMESTAMPTZ := NOW();
  v_quota public.swipe_quotas%ROWTYPE;
  v_consume_result RECORD;
  v_active_match BOOLEAN;
  v_like_exists BOOLEAN;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_actor_user_id = p_target_user_id THEN
    RAISE EXCEPTION 'Invalid unlike pair.';
  END IF;

  IF p_actor_user_id < p_target_user_id THEN
    v_user1 := p_actor_user_id;
    v_user2 := p_target_user_id;
  ELSE
    v_user1 := p_target_user_id;
    v_user2 := p_actor_user_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user1::TEXT), hashtext(v_user2::TEXT));

  INSERT INTO public.swipe_quotas AS sq (
    user_id,
    window_started_at,
    used_like_swipes,
    used_dislike_swipes,
    used_undos,
    updated_at
  )
  VALUES (p_actor_user_id, v_now, 0, 0, 0, v_now)
  ON CONFLICT ON CONSTRAINT swipe_quotas_pkey DO NOTHING;

  UPDATE public.swipe_quotas AS sq
  SET
    window_started_at = v_now,
    used_like_swipes = 0,
    used_dislike_swipes = 0,
    used_undos = 0,
    updated_at = v_now
  WHERE sq.user_id = p_actor_user_id
    AND sq.window_started_at <= v_now - make_interval(hours => GREATEST(1, p_window_hours));

  SELECT sq.* INTO v_quota
  FROM public.swipe_quotas AS sq
  WHERE sq.user_id = p_actor_user_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM public.matches
    WHERE user1_id = v_user1
      AND user2_id = v_user2
      AND status = 'active'
  ) INTO v_active_match;

  SELECT EXISTS (
    SELECT 1
    FROM public.likes
    WHERE user_id = p_actor_user_id
      AND liked_user_id = p_target_user_id
  ) INTO v_like_exists;

  IF v_active_match THEN
    RETURN QUERY SELECT
      'active_match'::TEXT,
      v_quota.window_started_at,
      v_quota.used_like_swipes,
      v_quota.used_dislike_swipes,
      v_quota.used_undos;
    RETURN;
  END IF;

  IF NOT v_like_exists THEN
    RETURN QUERY SELECT
      'missing'::TEXT,
      v_quota.window_started_at,
      v_quota.used_like_swipes,
      v_quota.used_dislike_swipes,
      v_quota.used_undos;
    RETURN;
  END IF;

  SELECT * INTO v_consume_result
  FROM public.consume_swipe_quota_atomic(
    p_actor_user_id,
    'undo',
    p_window_hours,
    0,
    0,
    p_undo_limit
  );

  v_quota.user_id := v_consume_result.user_id;
  v_quota.window_started_at := v_consume_result.window_started_at;
  v_quota.used_like_swipes := v_consume_result.used_like_swipes;
  v_quota.used_dislike_swipes := v_consume_result.used_dislike_swipes;
  v_quota.used_undos := v_consume_result.used_undos;

  IF COALESCE(v_consume_result.consumed, FALSE) = FALSE THEN
    RETURN QUERY SELECT
      'quota_exhausted'::TEXT,
      v_quota.window_started_at,
      v_quota.used_like_swipes,
      v_quota.used_dislike_swipes,
      v_quota.used_undos;
    RETURN;
  END IF;

  DELETE FROM public.likes
  WHERE user_id = p_actor_user_id
    AND liked_user_id = p_target_user_id;

  RETURN QUERY SELECT
    'undone'::TEXT,
    v_quota.window_started_at,
    v_quota.used_like_swipes,
    v_quota.used_dislike_swipes,
    v_quota.used_undos;
END;
$$;

REVOKE ALL ON FUNCTION public.undo_like_action_atomic(UUID, UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_like_action_atomic(UUID, UUID, INTEGER, INTEGER)
  TO service_role;

-- The current mobile client receives targeted private Broadcast events from the
-- service boundary. Removing table replication prevents database-wide WAL
-- fan-out and keeps private rows out of generic Postgres Changes streams.
DO $$
DECLARE
  v_table_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOR v_table_name IN
      SELECT tablename
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
    LOOP
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', v_table_name);
    END LOOP;
  END IF;
END;
$$;

-- Realtime private topics are limited to the authenticated user's own topics
-- or a two-user conversation containing that user id.
DROP POLICY IF EXISTS "WMatch private realtime select" ON realtime.messages;
CREATE POLICY "WMatch private realtime select" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() = 'user:' || (SELECT auth.uid())::TEXT
    OR realtime.topic() = 'user-events:' || (SELECT auth.uid())::TEXT
    OR (
      realtime.topic() ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (
        split_part(realtime.topic(), ':', 2) = (SELECT auth.uid())::TEXT
        OR split_part(realtime.topic(), ':', 3) = (SELECT auth.uid())::TEXT
      )
    )
  );

DROP POLICY IF EXISTS "WMatch private realtime insert" ON realtime.messages;
CREATE POLICY "WMatch private realtime insert" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.topic() = 'user:' || (SELECT auth.uid())::TEXT
    OR realtime.topic() = 'user-events:' || (SELECT auth.uid())::TEXT
    OR (
      realtime.topic() ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (
        split_part(realtime.topic(), ':', 2) = (SELECT auth.uid())::TEXT
        OR split_part(realtime.topic(), ':', 3) = (SELECT auth.uid())::TEXT
      )
    )
  );
