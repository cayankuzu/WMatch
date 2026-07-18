ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
UPDATE matches
SET
  ended_at = COALESCE(ended_at, updated_at),
  ended_by_user_id = COALESCE(ended_by_user_id, user1_id)
WHERE status = 'ended' AND ended_at IS NULL;
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

    INSERT INTO matches (user1_id, user2_id, status, ended_at, ended_by_user_id)
    VALUES (uid1, uid2, 'active', NULL, NULL)
    ON CONFLICT (user1_id, user2_id) DO UPDATE
      SET status = 'active',
          ended_at = NULL,
          ended_by_user_id = NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
