CREATE TABLE IF NOT EXISTS swipe_quotas (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_like_swipes INTEGER NOT NULL DEFAULT 0 CHECK (used_like_swipes >= 0),
  used_dislike_swipes INTEGER NOT NULL DEFAULT 0 CHECK (used_dislike_swipes >= 0),
  used_undos INTEGER NOT NULL DEFAULT 0 CHECK (used_undos >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE swipe_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own swipe quotas" ON swipe_quotas;
CREATE POLICY "Users can manage their own swipe quotas" ON swipe_quotas
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_swipe_quotas_updated_at ON swipe_quotas;
CREATE TRIGGER update_swipe_quotas_updated_at
  BEFORE UPDATE ON swipe_quotas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
