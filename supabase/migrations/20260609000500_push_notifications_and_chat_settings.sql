CREATE TABLE IF NOT EXISTS chat_settings (
  owner_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  other_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  read_receipts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  online_status_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  typing_indicator_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_user_id, other_user_id),
  CHECK (owner_user_id != other_user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_settings_owner_user_id
  ON chat_settings(owner_user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS device_push_tokens (
  token TEXT PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'unknown' CHECK (platform IN ('ios', 'android', 'unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user_id
  ON device_push_tokens(user_id, updated_at DESC);
ALTER TABLE chat_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own chat settings" ON chat_settings;
CREATE POLICY "Users can manage their own chat settings" ON chat_settings
  FOR ALL
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);
DROP POLICY IF EXISTS "Users can manage their own push tokens" ON device_push_tokens;
CREATE POLICY "Users can manage their own push tokens" ON device_push_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
UPDATE profiles
SET
  name = LEFT(COALESCE(NULLIF(btrim(name), ''), 'Kullanici'), 32),
  bio = LEFT(COALESCE(bio, ''), 280),
  letterboxd = LEFT(COALESCE(letterboxd, ''), 80),
  username = CASE
    WHEN username IS NULL
      OR btrim(username) = ''
      OR char_length(username) < 4
      OR char_length(username) > 21
    THEN '@user_' || substr(id::text, 1, 8)
    ELSE username
  END;
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_name_length_check,
  DROP CONSTRAINT IF EXISTS profiles_bio_length_check,
  DROP CONSTRAINT IF EXISTS profiles_letterboxd_length_check,
  DROP CONSTRAINT IF EXISTS profiles_username_length_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_name_length_check CHECK (char_length(btrim(name)) BETWEEN 2 AND 32),
  ADD CONSTRAINT profiles_bio_length_check CHECK (char_length(btrim(bio)) <= 280),
  ADD CONSTRAINT profiles_letterboxd_length_check CHECK (char_length(btrim(letterboxd)) <= 80),
  ADD CONSTRAINT profiles_username_length_check CHECK (char_length(username) BETWEEN 4 AND 21);
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_text_length_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_text_length_check CHECK (char_length(btrim(text)) BETWEEN 1 AND 700);
DROP TRIGGER IF EXISTS update_chat_settings_updated_at ON chat_settings;
CREATE TRIGGER update_chat_settings_updated_at
  BEFORE UPDATE ON chat_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS update_device_push_tokens_updated_at ON device_push_tokens;
CREATE TRIGGER update_device_push_tokens_updated_at
  BEFORE UPDATE ON device_push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
