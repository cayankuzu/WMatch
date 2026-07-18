CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);
CREATE TABLE IF NOT EXISTS hidden_chats (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  other_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, other_user_id),
  CHECK (user_id != other_user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker_id ON user_blocks(blocker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_id ON user_blocks(blocked_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hidden_chats_user_id ON hidden_chats(user_id, created_at DESC);
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hidden_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own blocked users" ON user_blocks;
CREATE POLICY "Users can manage their own blocked users" ON user_blocks
  FOR ALL
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);
DROP POLICY IF EXISTS "Users can manage their own hidden chats" ON hidden_chats;
CREATE POLICY "Users can manage their own hidden chats" ON hidden_chats
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
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

    INSERT INTO matches (user1_id, user2_id, status)
    VALUES (uid1, uid2, 'active')
    ON CONFLICT (user1_id, user2_id) DO UPDATE
      SET status = CASE
        WHEN matches.status = 'ended' THEN matches.status
        ELSE 'active'
      END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
