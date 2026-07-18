CREATE TABLE IF NOT EXISTS request_rate_limits (
  action TEXT NOT NULL,
  hashed_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (action, hashed_key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_request_rate_limits_expires_at
  ON request_rate_limits(expires_at);
CREATE INDEX IF NOT EXISTS idx_currently_watching_movie_id
  ON currently_watching(movie_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_movies_movie_id
  ON user_movies(movie_id, type, user_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_created_at
  ON likes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_liked_user_created_at
  ON likes(liked_user_id, created_at DESC);
UPDATE profiles
SET
  name = LEFT(COALESCE(NULLIF(btrim(name), ''), 'Kullanici'), 40),
  bio = LEFT(COALESCE(bio, ''), 240),
  letterboxd = LEFT(COALESCE(letterboxd, ''), 120),
  age = LEAST(GREATEST(COALESCE(age, 18), 18), 99),
  photos = CASE
    WHEN photos IS NULL THEN ARRAY[]::TEXT[]
    ELSE COALESCE(photos[1:6], ARRAY[]::TEXT[])
  END;
UPDATE profiles
SET username = '@user_' || substr(id::text, 1, 8)
WHERE username IS NULL
   OR btrim(username) = ''
   OR char_length(username) < 4
   OR char_length(username) > 25;
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_name_length_check,
  DROP CONSTRAINT IF EXISTS profiles_bio_length_check,
  DROP CONSTRAINT IF EXISTS profiles_letterboxd_length_check,
  DROP CONSTRAINT IF EXISTS profiles_username_length_check,
  DROP CONSTRAINT IF EXISTS profiles_age_range_check,
  DROP CONSTRAINT IF EXISTS profiles_photos_length_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_name_length_check CHECK (char_length(btrim(name)) BETWEEN 2 AND 40),
  ADD CONSTRAINT profiles_bio_length_check CHECK (char_length(btrim(bio)) <= 240),
  ADD CONSTRAINT profiles_letterboxd_length_check CHECK (char_length(btrim(letterboxd)) <= 120),
  ADD CONSTRAINT profiles_username_length_check CHECK (char_length(username) BETWEEN 4 AND 25),
  ADD CONSTRAINT profiles_age_range_check CHECK (age BETWEEN 18 AND 99),
  ADD CONSTRAINT profiles_photos_length_check CHECK (cardinality(photos) <= 6);
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_text_length_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_text_length_check CHECK (char_length(btrim(text)) BETWEEN 1 AND 1000);
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
) AS $$
DECLARE
  now_ts TIMESTAMPTZ := timezone('utc', now());
  window_start_ts TIMESTAMPTZ;
  expires_at_ts TIMESTAMPTZ;
  next_count INTEGER;
BEGIN
  IF p_limit <= 0 OR p_window_seconds <= 0 OR coalesce(btrim(p_action), '') = '' OR coalesce(btrim(p_key), '') = '' THEN
    RAISE EXCEPTION 'Invalid rate limit configuration.';
  END IF;

  DELETE FROM request_rate_limits
  WHERE expires_at < now_ts - INTERVAL '1 hour';

  window_start_ts := to_timestamp(floor(extract(epoch from now_ts) / p_window_seconds) * p_window_seconds);
  expires_at_ts := window_start_ts + make_interval(secs => p_window_seconds);

  INSERT INTO request_rate_limits (
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
    encode(digest(p_key, 'sha256'), 'hex'),
    window_start_ts,
    1,
    expires_at_ts,
    now_ts,
    now_ts
  )
  ON CONFLICT (action, hashed_key, window_start)
  DO UPDATE
    SET request_count = request_rate_limits.request_count + 1,
        updated_at = now_ts
  RETURNING request_count, expires_at
  INTO next_count, reset_at;

  allowed := next_count <= p_limit;
  current_count := next_count;
  retry_after_seconds := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (reset_at - now_ts)))::INTEGER);

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
