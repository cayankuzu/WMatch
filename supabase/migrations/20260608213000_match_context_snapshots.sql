ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS match_source_type TEXT NOT NULL DEFAULT 'like' CHECK (match_source_type IN ('watch', 'uyum', 'like')),
  ADD COLUMN IF NOT EXISTS match_source_score INTEGER CHECK (match_source_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS match_source_movie_id INTEGER,
  ADD COLUMN IF NOT EXISTS common_favorite_movie_ids INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS common_watched_movie_ids INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS first_like_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION public.check_and_create_match()
RETURNS TRIGGER AS $$
DECLARE
  mutual_like_exists BOOLEAN;
  users_blocked BOOLEAN;
  uid1 UUID;
  uid2 UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM user_blocks
    WHERE (blocker_id = NEW.user_id AND blocked_id = NEW.liked_user_id)
       OR (blocker_id = NEW.liked_user_id AND blocked_id = NEW.user_id)
  ) INTO users_blocked;

  IF users_blocked THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM likes
    WHERE user_id = NEW.liked_user_id
      AND liked_user_id = NEW.user_id
  ) INTO mutual_like_exists;

  IF mutual_like_exists THEN
    IF NEW.user_id < NEW.liked_user_id THEN
      uid1 := NEW.user_id;
      uid2 := NEW.liked_user_id;
    ELSE
      uid1 := NEW.liked_user_id;
      uid2 := NEW.user_id;
    END IF;

    INSERT INTO matches (
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
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
