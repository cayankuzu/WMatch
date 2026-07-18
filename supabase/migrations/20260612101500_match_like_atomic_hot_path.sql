CREATE OR REPLACE FUNCTION public.check_and_create_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mutual_like_exists BOOLEAN := FALSE;
  users_blocked BOOLEAN := FALSE;
  uid1 UUID;
  uid2 UUID;
BEGIN
  IF current_setting('wmatch.skip_like_match_trigger', true) = '1' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_blocks
      WHERE (blocker_id = NEW.user_id AND blocked_id = NEW.liked_user_id)
         OR (blocker_id = NEW.liked_user_id AND blocked_id = NEW.user_id)
    ) INTO users_blocked;
  EXCEPTION
    WHEN undefined_table THEN
      users_blocked := FALSE;
  END;

  IF users_blocked THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.likes
    WHERE user_id = NEW.liked_user_id
      AND liked_user_id = NEW.user_id
  ) INTO mutual_like_exists;

  IF NOT mutual_like_exists THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id < NEW.liked_user_id THEN
    uid1 := NEW.user_id;
    uid2 := NEW.liked_user_id;
  ELSE
    uid1 := NEW.liked_user_id;
    uid2 := NEW.user_id;
  END IF;

  BEGIN
    INSERT INTO public.matches (
      user1_id,
      user2_id,
      status,
      ended_at,
      ended_by_user_id,
      match_source_type,
      match_source_score,
      match_source_movie_id,
      common_favorite_movie_ids,
      common_watched_movie_ids,
      first_like_by_user_id,
      accepted_by_user_id
    )
    VALUES (
      uid1,
      uid2,
      'active',
      NULL,
      NULL,
      'like',
      NULL,
      NULL,
      '{}'::INTEGER[],
      '{}'::INTEGER[],
      NULL,
      NULL
    )
    ON CONFLICT (user1_id, user2_id) DO UPDATE
      SET status = 'active',
          ended_at = NULL,
          ended_by_user_id = NULL,
          match_source_type = 'like',
          match_source_score = NULL,
          match_source_movie_id = NULL,
          common_favorite_movie_ids = '{}'::INTEGER[],
          common_watched_movie_ids = '{}'::INTEGER[],
          first_like_by_user_id = NULL,
          accepted_by_user_id = NULL;
  EXCEPTION
    WHEN undefined_table THEN
      RETURN NEW;
    WHEN undefined_column THEN
      BEGIN
        INSERT INTO public.matches (user1_id, user2_id, status)
        VALUES (uid1, uid2, 'active')
        ON CONFLICT (user1_id, user2_id) DO UPDATE
          SET status = 'active';
      EXCEPTION
        WHEN undefined_table THEN
          RETURN NEW;
      END;
  END;

  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.process_like_action_atomic(
  p_actor_user_id UUID,
  p_target_user_id UUID,
  p_source_type TEXT,
  p_window_hours INTEGER,
  p_like_limit INTEGER
)
RETURNS TABLE (
  outcome TEXT,
  matched BOOLEAN,
  match_became_active BOOLEAN,
  reward_granted BOOLEAN,
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
  v_now TIMESTAMPTZ := NOW();
  v_window_interval INTERVAL := make_interval(hours => GREATEST(1, p_window_hours));
  v_outcome TEXT := 'liked';
  v_normalized_source_type TEXT := CASE
    WHEN p_source_type IN ('watch', 'compatibility', 'like') THEN p_source_type
    ELSE 'like'
  END;
  v_like_already_existed BOOLEAN := FALSE;
  v_reverse_like_exists BOOLEAN := FALSE;
  v_users_blocked BOOLEAN := FALSE;
  v_match_was_active BOOLEAN := FALSE;
  v_match_became_active BOOLEAN := FALSE;
  v_reward_granted BOOLEAN := FALSE;
  v_user1 UUID;
  v_user2 UUID;
  v_quota public.swipe_quotas%ROWTYPE;
  v_consume_result RECORD;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_actor_user_id = p_target_user_id THEN
    RAISE EXCEPTION 'Invalid like pair.';
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
    AND sq.window_started_at <= v_now - v_window_interval;

  SELECT sq.*
  INTO v_quota
  FROM public.swipe_quotas AS sq
  WHERE sq.user_id = p_actor_user_id
  FOR UPDATE;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_blocks
    WHERE (blocker_id = p_actor_user_id AND blocked_id = p_target_user_id)
       OR (blocker_id = p_target_user_id AND blocked_id = p_actor_user_id)
  ) INTO v_users_blocked;

  IF v_users_blocked THEN
    RETURN QUERY
    SELECT
      'blocked'::TEXT,
      FALSE,
      FALSE,
      FALSE,
      v_quota.window_started_at,
      v_quota.used_like_swipes,
      v_quota.used_dislike_swipes,
      v_quota.used_undos;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.likes
    WHERE user_id = p_actor_user_id
      AND liked_user_id = p_target_user_id
  ) INTO v_like_already_existed;

  SELECT EXISTS (
    SELECT 1
    FROM public.matches
    WHERE user1_id = v_user1
      AND user2_id = v_user2
      AND status = 'active'
  ) INTO v_match_was_active;

  IF NOT v_like_already_existed THEN
    SELECT *
    INTO v_consume_result
    FROM public.consume_swipe_quota_atomic(
      p_actor_user_id,
      'like',
      p_window_hours,
      p_like_limit,
      0,
      0
    );

    v_quota.user_id := v_consume_result.user_id;
    v_quota.window_started_at := v_consume_result.window_started_at;
    v_quota.used_like_swipes := v_consume_result.used_like_swipes;
    v_quota.used_dislike_swipes := v_consume_result.used_dislike_swipes;
    v_quota.used_undos := v_consume_result.used_undos;

    IF COALESCE(v_consume_result.consumed, FALSE) = FALSE THEN
      RETURN QUERY
      SELECT
        'quota_exhausted'::TEXT,
        v_match_was_active,
        FALSE,
        FALSE,
        v_quota.window_started_at,
        v_quota.used_like_swipes,
        v_quota.used_dislike_swipes,
        v_quota.used_undos;
      RETURN;
    END IF;
  END IF;

  PERFORM set_config('wmatch.skip_like_match_trigger', '1', TRUE);

  INSERT INTO public.likes (
    user_id,
    liked_user_id,
    hidden_by_liked_user
  )
  VALUES (
    p_actor_user_id,
    p_target_user_id,
    FALSE
  )
  ON CONFLICT (user_id, liked_user_id) DO UPDATE
    SET hidden_by_liked_user = FALSE;

  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM public.likes
      WHERE user_id = p_target_user_id
        AND liked_user_id = p_actor_user_id
        AND hidden_by_liked_user = FALSE
    ) INTO v_reverse_like_exists;
  EXCEPTION
    WHEN undefined_column THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.likes
        WHERE user_id = p_target_user_id
          AND liked_user_id = p_actor_user_id
      ) INTO v_reverse_like_exists;
  END;

  IF v_reverse_like_exists AND NOT v_match_was_active THEN
    INSERT INTO public.matches (
      user1_id,
      user2_id,
      status,
      ended_at,
      ended_by_user_id,
      match_source_type,
      match_source_score,
      match_source_movie_id,
      common_favorite_movie_ids,
      common_watched_movie_ids,
      first_like_by_user_id,
      accepted_by_user_id
    )
    VALUES (
      v_user1,
      v_user2,
      'active',
      NULL,
      NULL,
      v_normalized_source_type,
      NULL,
      NULL,
      '{}'::INTEGER[],
      '{}'::INTEGER[],
      p_target_user_id,
      p_actor_user_id
    )
    ON CONFLICT (user1_id, user2_id) DO UPDATE
      SET status = 'active',
          ended_at = NULL,
          ended_by_user_id = NULL,
          match_source_type = EXCLUDED.match_source_type,
          match_source_score = NULL,
          match_source_movie_id = NULL,
          common_favorite_movie_ids = '{}'::INTEGER[],
          common_watched_movie_ids = '{}'::INTEGER[],
          first_like_by_user_id = EXCLUDED.first_like_by_user_id,
          accepted_by_user_id = EXCLUDED.accepted_by_user_id;

    v_match_became_active := TRUE;
  END IF;

  IF v_match_became_active AND NOT v_like_already_existed THEN
    UPDATE public.swipe_quotas AS sq
    SET
      used_like_swipes = GREATEST(0, sq.used_like_swipes - 1),
      updated_at = v_now
    WHERE sq.user_id = p_actor_user_id
    RETURNING sq.* INTO v_quota;

    v_reward_granted := TRUE;
  END IF;

  IF v_reverse_like_exists OR v_match_was_active THEN
    v_outcome := 'matched';
  ELSIF v_like_already_existed THEN
    v_outcome := 'duplicate';
  END IF;

  RETURN QUERY
  SELECT
    v_outcome,
    (v_reverse_like_exists OR v_match_was_active),
    v_match_became_active,
    v_reward_granted,
    v_quota.window_started_at,
    v_quota.used_like_swipes,
    v_quota.used_dislike_swipes,
    v_quota.used_undos;
END;
$$;
REVOKE ALL ON FUNCTION public.process_like_action_atomic(UUID, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_like_action_atomic(UUID, UUID, TEXT, INTEGER, INTEGER) TO service_role;
