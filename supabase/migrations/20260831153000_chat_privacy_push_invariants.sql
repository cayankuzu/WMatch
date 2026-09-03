-- Forward-only closures for chat ordering, push suppression, and presence privacy.

INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260831153000',
  '20260830120000',
  '20260831153000',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

-- A suppressed push is terminal. It remains in the notification timeline for
-- auditability, but it can never be reclaimed by the delivery worker.
ALTER TABLE public.notification_events
  ADD COLUMN IF NOT EXISTS push_suppressed_at TIMESTAMPTZ;

ALTER TABLE public.notification_events
  DROP CONSTRAINT IF EXISTS notification_events_push_status_check;

ALTER TABLE public.notification_events
  ADD CONSTRAINT notification_events_push_status_check
  CHECK (push_status IN (
    'not_requested',
    'pending',
    'processing',
    'retry',
    'submitted',
    'no_tokens',
    'dead',
    'suppressed'
  ));

CREATE OR REPLACE FUNCTION public.suppress_pair_push_events(
  p_left_user_id UUID,
  p_right_user_id UUID,
  p_reason TEXT DEFAULT 'relationship_inactive'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user1 UUID;
  v_user2 UUID;
  v_suppressed INTEGER := 0;
  v_reason TEXT := LEFT(
    COALESCE(NULLIF(BTRIM(p_reason), ''), 'relationship_inactive'),
    500
  );
BEGIN
  IF p_left_user_id IS NULL
    OR p_right_user_id IS NULL
    OR p_left_user_id = p_right_user_id
  THEN
    RETURN 0;
  END IF;

  IF p_left_user_id < p_right_user_id THEN
    v_user1 := p_left_user_id;
    v_user2 := p_right_user_id;
  ELSE
    v_user1 := p_right_user_id;
    v_user2 := p_left_user_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user1::TEXT), hashtext(v_user2::TEXT));

  UPDATE public.notification_events AS event
  SET
    push_status = 'suppressed',
    push_locked_at = NULL,
    push_next_attempt_at = NULL,
    push_suppressed_at = COALESCE(event.push_suppressed_at, NOW()),
    push_last_error = v_reason
  WHERE event.push_status IN ('pending', 'retry', 'processing')
    AND (
      (
        event.user_id = v_user1
        AND (event.actor_user_id = v_user2 OR event.route_user_id = v_user2)
      ) OR (
        event.user_id = v_user2
        AND (event.actor_user_id = v_user1 OR event.route_user_id = v_user1)
      )
    );

  GET DIAGNOSTICS v_suppressed = ROW_COUNT;
  RETURN v_suppressed;
END;
$$;

REVOKE ALL ON FUNCTION public.suppress_pair_push_events(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suppress_pair_push_events(UUID, UUID, TEXT)
  TO service_role;

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
  v_already_suppressed BOOLEAN := FALSE;
BEGIN
  IF p_status NOT IN ('retry', 'submitted', 'no_tokens', 'dead', 'suppressed') THEN
    RAISE EXCEPTION 'Invalid push delivery completion status.';
  END IF;

  UPDATE public.notification_events
  SET
    push_status = p_status,
    push_locked_at = NULL,
    push_submitted_at = CASE
      WHEN p_status = 'submitted' THEN NOW()
      ELSE push_submitted_at
    END,
    push_suppressed_at = CASE
      WHEN p_status = 'suppressed' THEN COALESCE(push_suppressed_at, NOW())
      ELSE push_suppressed_at
    END,
    push_next_attempt_at = CASE
      WHEN p_status = 'retry' THEN NOW() + make_interval(
        secs => LEAST(
          GREATEST(COALESCE(p_retry_after_seconds, 30), 5),
          3600
        )
      )
      ELSE NULL
    END,
    push_last_error = CASE
      WHEN p_status = 'suppressed' THEN LEFT(
        COALESCE(NULLIF(BTRIM(p_error), ''), 'suppressed_by_delivery_policy'),
        500
      )
      WHEN p_error IS NULL THEN NULL
      ELSE LEFT(p_error, 500)
    END
  WHERE id = p_event_id
    AND push_status = 'processing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    RETURN TRUE;
  END IF;

  IF p_status = 'suppressed' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.notification_events AS event
      WHERE event.id = p_event_id
        AND event.push_status = 'suppressed'
    ) INTO v_already_suppressed;
  END IF;

  RETURN v_already_suppressed;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_push_delivery_job(UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_push_delivery_job(UUID, TEXT, TEXT, INTEGER)
  TO service_role;

-- Claiming and sending are separated by an external provider request. This
-- authorization RPC serializes the final DB decision with block/unmatch and
-- suppresses stale work before the provider call begins.
CREATE OR REPLACE FUNCTION public.authorize_push_delivery_job(
  p_event_id UUID
)
RETURNS TABLE (
  authorized BOOLEAN,
  reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.notification_events%ROWTYPE;
  v_counterpart UUID;
  v_user1 UUID;
  v_user2 UUID;
  v_match public.matches%ROWTYPE;
  v_recipient_deleted_at TIMESTAMPTZ;
  v_notifications_enabled BOOLEAN := TRUE;
  v_reason TEXT;
BEGIN
  SELECT event.* INTO v_event
  FROM public.notification_events AS event
  WHERE event.id = p_event_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'event_missing'::TEXT;
    RETURN;
  END IF;

  IF v_event.push_status <> 'processing' THEN
    RETURN QUERY SELECT FALSE, 'delivery_state_changed'::TEXT;
    RETURN;
  END IF;

  v_counterpart := CASE
    WHEN v_event.route_user_id IS NOT NULL
      AND v_event.route_user_id <> v_event.user_id
      THEN v_event.route_user_id
    WHEN v_event.actor_user_id IS NOT NULL
      AND v_event.actor_user_id <> v_event.user_id
      THEN v_event.actor_user_id
    ELSE NULL
  END;

  IF v_counterpart IS NULL THEN
    RETURN QUERY SELECT TRUE, NULL::TEXT;
    RETURN;
  END IF;

  IF v_event.user_id < v_counterpart THEN
    v_user1 := v_event.user_id;
    v_user2 := v_counterpart;
  ELSE
    v_user1 := v_counterpart;
    v_user2 := v_event.user_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user1::TEXT), hashtext(v_user2::TEXT));

  -- Relationship mutations take the canonical pair lock before touching
  -- notification rows. Refresh and lock the event in that same order so a
  -- block/end racing authorization cannot form an event-row/pair-lock cycle.
  SELECT event.* INTO v_event
  FROM public.notification_events AS event
  WHERE event.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'event_missing'::TEXT;
    RETURN;
  END IF;

  IF v_event.push_status <> 'processing' THEN
    RETURN QUERY SELECT FALSE, 'delivery_state_changed'::TEXT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_blocks AS block
    WHERE (block.blocker_id = v_user1 AND block.blocked_id = v_user2)
       OR (block.blocker_id = v_user2 AND block.blocked_id = v_user1)
  ) THEN
    v_reason := 'relationship_blocked';
  ELSIF v_event.route_kind = 'chat' THEN
    SELECT matched.* INTO v_match
    FROM public.matches AS matched
    WHERE matched.user1_id = v_user1
      AND matched.user2_id = v_user2;

    IF v_match.user1_id IS NULL
      OR v_match.status <> 'active'
      OR v_match.ended_at IS NOT NULL
    THEN
      v_reason := 'relationship_inactive';
    ELSE
      v_recipient_deleted_at := CASE
        WHEN v_event.user_id = v_user1 THEN v_match.user1_chat_deleted_at
        ELSE v_match.user2_chat_deleted_at
      END;

      IF v_recipient_deleted_at IS NOT NULL THEN
        v_reason := 'recipient_chat_deleted';
      ELSE
        SELECT COALESCE((
          SELECT settings.notifications_enabled
          FROM public.chat_settings AS settings
          WHERE settings.owner_user_id = v_event.user_id
            AND settings.other_user_id = v_counterpart
        ), TRUE) INTO v_notifications_enabled;

        IF NOT v_notifications_enabled THEN
          v_reason := 'chat_notifications_disabled';
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.notification_events AS event
    SET
      push_status = 'suppressed',
      push_locked_at = NULL,
      push_next_attempt_at = NULL,
      push_suppressed_at = COALESCE(event.push_suppressed_at, NOW()),
      push_last_error = v_reason
    WHERE event.id = p_event_id
      AND event.push_status = 'processing';

    RETURN QUERY SELECT FALSE, v_reason;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_push_delivery_job(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_push_delivery_job(UUID)
  TO service_role;

-- The message authorization check and insert now share the exact advisory
-- lock used by relationship mutations. Client IDs remain globally idempotent
-- per sender, including replays that race across different receiver pairs.
CREATE OR REPLACE FUNCTION public.send_chat_message_atomic(
  p_sender_user_id UUID,
  p_receiver_user_id UUID,
  p_text TEXT,
  p_client_message_id TEXT DEFAULT NULL,
  p_client_payload_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
  outcome TEXT,
  message_id UUID,
  sender_id UUID,
  receiver_id UUID,
  message_text TEXT,
  message_read BOOLEAN,
  message_created_at TIMESTAMPTZ,
  client_request_id TEXT,
  client_message_id TEXT,
  idempotency_replayed BOOLEAN,
  receiver_chat_deleted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_user1 UUID;
  v_user2 UUID;
  v_match public.matches%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_receiver_chat_deleted_at TIMESTAMPTZ;
  v_replayed BOOLEAN := FALSE;
BEGIN
  IF p_sender_user_id IS NULL
    OR p_receiver_user_id IS NULL
    OR p_sender_user_id = p_receiver_user_id
  THEN
    RETURN QUERY SELECT
      'invalid_pair'::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::BOOLEAN,
      NULL::TIMESTAMPTZ,
      NULL::TEXT,
      NULL::TEXT,
      FALSE,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_text IS NULL
    OR p_text <> BTRIM(p_text)
    OR char_length(p_text) NOT BETWEEN 1 AND 700
  THEN
    RETURN QUERY SELECT
      'invalid_message'::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::BOOLEAN,
      NULL::TIMESTAMPTZ,
      NULL::TEXT,
      NULL::TEXT,
      FALSE,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_client_message_id IS NOT NULL
    AND p_client_message_id !~ '^[A-Za-z0-9_.:-]{8,120}$'
  THEN
    RETURN QUERY SELECT
      'invalid_client_message_id'::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::BOOLEAN,
      NULL::TIMESTAMPTZ,
      NULL::TEXT,
      NULL::TEXT,
      FALSE,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF (p_client_message_id IS NULL AND p_client_payload_hash IS NOT NULL)
    OR (
      p_client_message_id IS NOT NULL
      AND (
        p_client_payload_hash IS NULL
        OR p_client_payload_hash !~ '^[a-f0-9]{64}$'
      )
    )
  THEN
    RETURN QUERY SELECT
      'invalid_payload_hash'::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::BOOLEAN,
      NULL::TIMESTAMPTZ,
      NULL::TEXT,
      NULL::TEXT,
      FALSE,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF p_sender_user_id < p_receiver_user_id THEN
    v_user1 := p_sender_user_id;
    v_user2 := p_receiver_user_id;
  ELSE
    v_user1 := p_receiver_user_id;
    v_user2 := p_sender_user_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user1::TEXT), hashtext(v_user2::TEXT));

  SELECT matched.* INTO v_match
  FROM public.matches AS matched
  WHERE matched.user1_id = v_user1
    AND matched.user2_id = v_user2
  FOR UPDATE;

  IF v_match.user1_id IS NULL THEN
    RETURN QUERY SELECT
      'missing_match'::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::BOOLEAN,
      NULL::TIMESTAMPTZ,
      NULL::TEXT,
      NULL::TEXT,
      FALSE,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_match.status <> 'active'
    OR v_match.ended_at IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM public.user_blocks AS block
      WHERE (block.blocker_id = v_user1 AND block.blocked_id = v_user2)
         OR (block.blocker_id = v_user2 AND block.blocked_id = v_user1)
    )
    OR (
      p_sender_user_id = v_user1
      AND v_match.user1_chat_deleted_at IS NOT NULL
    )
    OR (
      p_sender_user_id = v_user2
      AND v_match.user2_chat_deleted_at IS NOT NULL
    )
  THEN
    RETURN QUERY SELECT
      'relationship_locked'::TEXT,
      NULL::UUID,
      NULL::UUID,
      NULL::UUID,
      NULL::TEXT,
      NULL::BOOLEAN,
      NULL::TIMESTAMPTZ,
      NULL::TEXT,
      NULL::TEXT,
      FALSE,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_receiver_chat_deleted_at := CASE
    WHEN p_receiver_user_id = v_user1 THEN v_match.user1_chat_deleted_at
    ELSE v_match.user2_chat_deleted_at
  END;

  IF p_client_message_id IS NULL THEN
    INSERT INTO public.messages (
      sender_id,
      receiver_id,
      text
    )
    VALUES (
      p_sender_user_id,
      p_receiver_user_id,
      p_text
    )
    RETURNING * INTO v_message;
  ELSE
    INSERT INTO public.messages (
      sender_id,
      receiver_id,
      text,
      client_message_id,
      client_payload_hash
    )
    VALUES (
      p_sender_user_id,
      p_receiver_user_id,
      p_text,
      p_client_message_id,
      p_client_payload_hash
    )
    ON CONFLICT (sender_id, client_message_id)
      WHERE client_message_id IS NOT NULL
      DO NOTHING
    RETURNING * INTO v_message;

    IF v_message.id IS NULL THEN
      SELECT existing.* INTO v_message
      FROM public.messages AS existing
      WHERE existing.sender_id = p_sender_user_id
        AND existing.client_message_id = p_client_message_id;

      IF v_message.id IS NULL
        OR v_message.receiver_id <> p_receiver_user_id
        OR NOT (
          (
            v_message.client_payload_hash IS NOT NULL
            AND v_message.client_payload_hash = p_client_payload_hash
          ) OR (
            v_message.client_payload_hash IS NULL
            AND v_message.text = p_text
          )
        )
      THEN
        RETURN QUERY SELECT
          'idempotency_conflict'::TEXT,
          NULL::UUID,
          NULL::UUID,
          NULL::UUID,
          NULL::TEXT,
          NULL::BOOLEAN,
          NULL::TIMESTAMPTZ,
          NULL::TEXT,
          NULL::TEXT,
          FALSE,
          NULL::TIMESTAMPTZ;
        RETURN;
      END IF;

      v_replayed := TRUE;
    END IF;
  END IF;

  IF NOT v_replayed THEN
    DELETE FROM public.hidden_chats AS hidden
    WHERE (hidden.user_id = v_user1 AND hidden.other_user_id = v_user2)
       OR (hidden.user_id = v_user2 AND hidden.other_user_id = v_user1);
  END IF;

  RETURN QUERY SELECT
    CASE WHEN v_replayed THEN 'replayed' ELSE 'sent' END::TEXT,
    v_message.id,
    v_message.sender_id,
    v_message.receiver_id,
    v_message.text,
    COALESCE(v_message.read, FALSE),
    v_message.created_at,
    v_message.client_request_id,
    v_message.client_message_id,
    v_replayed,
    v_receiver_chat_deleted_at;
END;
$$;

REVOKE ALL ON FUNCTION public.send_chat_message_atomic(UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_chat_message_atomic(UUID, UUID, TEXT, TEXT, TEXT)
  TO service_role;

-- Expo tokens are opaque credentials. Constrain their complete envelope,
-- expire stale registrations, and keep a deterministic newest-N set per user.
DELETE FROM public.device_push_tokens AS token_row
WHERE char_length(token_row.token) NOT BETWEEN 35 AND 220
   OR token_row.token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{20,200}\]$';

ALTER TABLE public.device_push_tokens
  DROP CONSTRAINT IF EXISTS device_push_tokens_token_format_check;

ALTER TABLE public.device_push_tokens
  ADD CONSTRAINT device_push_tokens_token_format_check
  CHECK (
    char_length(token) BETWEEN 35 AND 220
    AND token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{20,200}\]$'
  );

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_stale_cleanup
  ON public.device_push_tokens(last_seen_at, user_id);

CREATE OR REPLACE FUNCTION public.prune_device_push_tokens(
  p_user_id UUID DEFAULT NULL,
  p_stale_after_days INTEGER DEFAULT 90,
  p_max_tokens_per_user INTEGER DEFAULT 8
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER := 0;
  v_step_deleted INTEGER := 0;
  v_stale_after_days INTEGER := LEAST(
    GREATEST(COALESCE(p_stale_after_days, 90), 7),
    365
  );
  v_max_tokens INTEGER := LEAST(
    GREATEST(COALESCE(p_max_tokens_per_user, 8), 1),
    32
  );
BEGIN
  DELETE FROM public.device_push_tokens AS token_row
  WHERE (p_user_id IS NULL OR token_row.user_id = p_user_id)
    AND token_row.last_seen_at < NOW() - make_interval(days => v_stale_after_days);

  GET DIAGNOSTICS v_step_deleted = ROW_COUNT;
  v_deleted := v_deleted + v_step_deleted;

  WITH ranked AS (
    SELECT
      token_row.token,
      ROW_NUMBER() OVER (
        PARTITION BY token_row.user_id
        ORDER BY
          token_row.last_seen_at DESC,
          token_row.updated_at DESC,
          token_row.token ASC
      ) AS token_rank
    FROM public.device_push_tokens AS token_row
    WHERE p_user_id IS NULL OR token_row.user_id = p_user_id
  )
  DELETE FROM public.device_push_tokens AS token_row
  USING ranked
  WHERE token_row.token = ranked.token
    AND ranked.token_rank > v_max_tokens;

  GET DIAGNOSTICS v_step_deleted = ROW_COUNT;
  RETURN v_deleted + v_step_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_device_push_token_atomic(
  p_user_id UUID,
  p_token TEXT,
  p_platform TEXT,
  p_max_tokens_per_user INTEGER DEFAULT 8,
  p_stale_after_days INTEGER DEFAULT 90
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_platform TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_platform), ''), 'unknown'));
BEGIN
  IF p_user_id IS NULL
    OR p_token IS NULL
    OR char_length(p_token) NOT BETWEEN 35 AND 220
    OR p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{20,200}\]$'
    OR v_platform NOT IN ('ios', 'android', 'unknown')
  THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.device_push_tokens (
    token,
    user_id,
    platform,
    last_seen_at,
    updated_at
  )
  VALUES (
    p_token,
    p_user_id,
    v_platform,
    clock_timestamp(),
    clock_timestamp()
  )
  ON CONFLICT (token) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    last_seen_at = clock_timestamp(),
    updated_at = clock_timestamp();

  PERFORM public.prune_device_push_tokens(
    p_user_id,
    p_stale_after_days,
    p_max_tokens_per_user
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_device_push_tokens(UUID, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_device_push_token_atomic(UUID, TEXT, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_device_push_tokens(UUID, INTEGER, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.register_device_push_token_atomic(UUID, TEXT, TEXT, INTEGER, INTEGER)
  TO service_role;

-- Relationship changes share the pair lock with send_chat_message_atomic and
-- suppress every not-yet-terminal paired push before commit.
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
  IF p_actor_user_id IS NULL
    OR p_target_user_id IS NULL
    OR p_actor_user_id = p_target_user_id
  THEN
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

  SELECT matched.* INTO v_match
  FROM public.matches AS matched
  WHERE matched.user1_id = v_user1
    AND matched.user2_id = v_user2
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

    PERFORM public.suppress_pair_push_events(
      v_user1,
      v_user2,
      'relationship_blocked'
    );

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
    PERFORM public.suppress_pair_push_events(
      v_user1,
      v_user2,
      'relationship_inactive'
    );
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

  PERFORM public.suppress_pair_push_events(
    v_user1,
    v_user2,
    'relationship_inactive'
  );

  RETURN QUERY SELECT 'ended'::TEXT, 'ended'::TEXT, v_user1, v_user2;
END;
$$;

REVOKE ALL ON FUNCTION public.update_pair_relationship_atomic(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_pair_relationship_atomic(UUID, UUID, TEXT)
  TO service_role;

-- Recreate every remaining user-bound policy with auth functions wrapped in
-- scalar subqueries. This is semantically identical and removes per-row auth
-- evaluation reported by the auth_rls_initplan advisor.
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can view their own outgoing likes" ON public.likes;
CREATE POLICY "Users can view their own outgoing likes" ON public.likes
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own matches" ON public.matches;
CREATE POLICY "Users can view their own matches" ON public.matches
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = user1_id
    OR (SELECT auth.uid()) = user2_id
  );

DROP POLICY IF EXISTS "Users can manage their own blocked users" ON public.user_blocks;
CREATE POLICY "Users can manage their own blocked users" ON public.user_blocks
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = blocker_id)
  WITH CHECK ((SELECT auth.uid()) = blocker_id);

DROP POLICY IF EXISTS "Users can manage their own hidden chats" ON public.hidden_chats;
CREATE POLICY "Users can manage their own hidden chats" ON public.hidden_chats
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage their own chat settings" ON public.chat_settings;
CREATE POLICY "Users can manage their own chat settings" ON public.chat_settings
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = owner_user_id)
  WITH CHECK ((SELECT auth.uid()) = owner_user_id);

DROP POLICY IF EXISTS "Users can manage their own push tokens" ON public.device_push_tokens;
CREATE POLICY "Users can manage their own push tokens" ON public.device_push_tokens
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can upload their own profile photos" ON storage.objects;
CREATE POLICY "Users can upload their own profile photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

DROP POLICY IF EXISTS "Users can delete their own profile photos" ON storage.objects;
CREATE POLICY "Users can delete their own profile photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

-- RLS on chat_settings intentionally hides a peer's row. These narrow helper
-- functions bind the caller to auth.uid(), then read the peer preference under
-- a definer boundary so Realtime authorization cannot mistake a hidden row for
-- the default-enabled setting.
CREATE OR REPLACE FUNCTION public.can_access_conversation_realtime(
  p_user1 TEXT,
  p_user2 TEXT,
  p_mode TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_user1 UUID;
  v_user2 UUID;
  v_peer UUID;
  v_setting_owner UUID;
BEGIN
  IF v_requester IS NULL
    OR p_mode NOT IN ('receive', 'send')
    OR p_user1 !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_user2 !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RETURN FALSE;
  END IF;

  v_user1 := p_user1::UUID;
  v_user2 := p_user2::UUID;

  IF v_user1 >= v_user2
    OR v_requester NOT IN (v_user1, v_user2)
  THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.matches AS matched
    WHERE matched.user1_id = v_user1
      AND matched.user2_id = v_user2
      AND matched.status = 'active'
      AND matched.ended_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.user_blocks AS block
    WHERE (block.blocker_id = v_user1 AND block.blocked_id = v_user2)
       OR (block.blocker_id = v_user2 AND block.blocked_id = v_user1)
  ) THEN
    RETURN FALSE;
  END IF;

  v_peer := CASE WHEN v_requester = v_user1 THEN v_user2 ELSE v_user1 END;
  v_setting_owner := CASE WHEN p_mode = 'receive' THEN v_peer ELSE v_requester END;

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.chat_settings AS settings
    WHERE settings.owner_user_id = v_setting_owner
      AND settings.other_user_id = CASE
        WHEN v_setting_owner = v_requester THEN v_peer
        ELSE v_requester
      END
      AND settings.typing_indicator_enabled = FALSE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_presence_realtime(
  p_owner_user_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_owner UUID;
  v_user1 UUID;
  v_user2 UUID;
BEGIN
  IF v_requester IS NULL
    OR p_owner_user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RETURN FALSE;
  END IF;

  v_owner := p_owner_user_id::UUID;
  IF v_owner = v_requester THEN
    RETURN TRUE;
  END IF;

  IF v_requester < v_owner THEN
    v_user1 := v_requester;
    v_user2 := v_owner;
  ELSE
    v_user1 := v_owner;
    v_user2 := v_requester;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.matches AS matched
    WHERE matched.user1_id = v_user1
      AND matched.user2_id = v_user2
      AND matched.status = 'active'
      AND matched.ended_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_blocks AS block
        WHERE (block.blocker_id = v_user1 AND block.blocked_id = v_user2)
           OR (block.blocker_id = v_user2 AND block.blocked_id = v_user1)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.chat_settings AS settings
        WHERE settings.owner_user_id = v_owner
          AND settings.other_user_id = v_requester
          AND settings.online_status_enabled = FALSE
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_publish_app_presence()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches AS matched
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN matched.user1_id = auth.uid() THEN matched.user2_id
        ELSE matched.user1_id
      END AS peer_user_id
    ) AS peer
    WHERE auth.uid() IS NOT NULL
      AND auth.uid() IN (matched.user1_id, matched.user2_id)
      AND matched.status = 'active'
      AND matched.ended_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_blocks AS block
        WHERE (block.blocker_id = matched.user1_id AND block.blocked_id = matched.user2_id)
           OR (block.blocker_id = matched.user2_id AND block.blocked_id = matched.user1_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.chat_settings AS settings
        WHERE settings.owner_user_id = auth.uid()
          AND settings.other_user_id = peer.peer_user_id
          AND settings.online_status_enabled = FALSE
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_conversation_realtime(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_presence_realtime(TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_publish_app_presence()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_conversation_realtime(TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_presence_realtime(TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_publish_app_presence()
  TO authenticated;

DROP POLICY IF EXISTS "WMatch private realtime select" ON realtime.messages;
CREATE POLICY "WMatch private realtime select" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.topic() = 'user:' || (SELECT auth.uid())::TEXT
    OR realtime.topic() = 'user-events:' || (SELECT auth.uid())::TEXT
    OR realtime.topic() = 'presence:' || (SELECT auth.uid())::TEXT
    OR (
      realtime.topic() ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND public.can_access_conversation_realtime(
        split_part(realtime.topic(), ':', 2),
        split_part(realtime.topic(), ':', 3),
        'receive'
      )
    )
    OR (
      realtime.topic() ~ '^presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND public.can_access_presence_realtime(
        split_part(realtime.topic(), ':', 2)
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
      realtime.topic() = 'presence:' || (SELECT auth.uid())::TEXT
      AND public.can_publish_app_presence()
    )
    OR (
      realtime.topic() ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND public.can_access_conversation_realtime(
        split_part(realtime.topic(), ':', 2),
        split_part(realtime.topic(), ':', 3),
        'send'
      )
    )
  );
