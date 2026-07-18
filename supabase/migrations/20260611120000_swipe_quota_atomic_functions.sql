CREATE OR REPLACE FUNCTION public.consume_swipe_quota_atomic(
  p_user_id UUID,
  p_kind TEXT,
  p_window_hours INTEGER,
  p_like_limit INTEGER,
  p_dislike_limit INTEGER,
  p_undo_limit INTEGER
)
RETURNS TABLE (
  user_id UUID,
  window_started_at TIMESTAMPTZ,
  used_like_swipes INTEGER,
  used_dislike_swipes INTEGER,
  used_undos INTEGER,
  consumed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_window_interval INTERVAL := make_interval(hours => GREATEST(1, p_window_hours));
  v_row public.swipe_quotas%ROWTYPE;
  v_consumed BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.swipe_quotas (
    user_id,
    window_started_at,
    used_like_swipes,
    used_dislike_swipes,
    used_undos,
    updated_at
  )
  VALUES (p_user_id, v_now, 0, 0, 0, v_now)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.swipe_quotas
  SET
    window_started_at = v_now,
    used_like_swipes = 0,
    used_dislike_swipes = 0,
    used_undos = 0,
    updated_at = v_now
  WHERE user_id = p_user_id
    AND window_started_at <= v_now - v_window_interval;

  IF p_kind = 'like' THEN
    UPDATE public.swipe_quotas
    SET
      used_like_swipes = used_like_swipes + 1,
      updated_at = v_now
    WHERE user_id = p_user_id
      AND used_like_swipes < GREATEST(0, p_like_limit)
    RETURNING * INTO v_row;

    v_consumed := FOUND;
  ELSIF p_kind = 'dislike' THEN
    UPDATE public.swipe_quotas
    SET
      used_dislike_swipes = used_dislike_swipes + 1,
      updated_at = v_now
    WHERE user_id = p_user_id
      AND used_dislike_swipes < GREATEST(0, p_dislike_limit)
    RETURNING * INTO v_row;

    v_consumed := FOUND;
  ELSIF p_kind = 'undo' THEN
    UPDATE public.swipe_quotas
    SET
      used_undos = used_undos + 1,
      updated_at = v_now
    WHERE user_id = p_user_id
      AND used_undos < GREATEST(0, p_undo_limit)
    RETURNING * INTO v_row;

    v_consumed := FOUND;
  ELSE
    RAISE EXCEPTION 'Unsupported swipe quota kind: %', p_kind;
  END IF;

  IF NOT v_consumed THEN
    SELECT *
    INTO v_row
    FROM public.swipe_quotas
    WHERE public.swipe_quotas.user_id = p_user_id;
  END IF;

  RETURN QUERY
  SELECT
    v_row.user_id,
    v_row.window_started_at,
    v_row.used_like_swipes,
    v_row.used_dislike_swipes,
    v_row.used_undos,
    v_consumed;
END;
$$;
CREATE OR REPLACE FUNCTION public.reward_swipe_quota_atomic(
  p_user_id UUID,
  p_kind TEXT,
  p_window_hours INTEGER
)
RETURNS TABLE (
  user_id UUID,
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
  v_row public.swipe_quotas%ROWTYPE;
BEGIN
  INSERT INTO public.swipe_quotas (
    user_id,
    window_started_at,
    used_like_swipes,
    used_dislike_swipes,
    used_undos,
    updated_at
  )
  VALUES (p_user_id, v_now, 0, 0, 0, v_now)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.swipe_quotas
  SET
    window_started_at = v_now,
    used_like_swipes = 0,
    used_dislike_swipes = 0,
    used_undos = 0,
    updated_at = v_now
  WHERE user_id = p_user_id
    AND window_started_at <= v_now - v_window_interval;

  IF p_kind = 'like' THEN
    UPDATE public.swipe_quotas
    SET
      used_like_swipes = GREATEST(0, used_like_swipes - 1),
      updated_at = v_now
    WHERE user_id = p_user_id
    RETURNING * INTO v_row;
  ELSIF p_kind = 'dislike' THEN
    UPDATE public.swipe_quotas
    SET
      used_dislike_swipes = GREATEST(0, used_dislike_swipes - 1),
      updated_at = v_now
    WHERE user_id = p_user_id
    RETURNING * INTO v_row;
  ELSE
    RAISE EXCEPTION 'Unsupported swipe quota reward kind: %', p_kind;
  END IF;

  RETURN QUERY
  SELECT
    v_row.user_id,
    v_row.window_started_at,
    v_row.used_like_swipes,
    v_row.used_dislike_swipes,
    v_row.used_undos;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_swipe_quota_atomic(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reward_swipe_quota_atomic(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_swipe_quota_atomic(UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.reward_swipe_quota_atomic(UUID, TEXT, INTEGER) TO service_role;
