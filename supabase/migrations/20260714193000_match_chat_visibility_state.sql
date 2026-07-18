ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS user1_chat_deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user2_chat_deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user1_chat_cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user2_chat_cleared_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_matches_user1_chat_visibility
  ON public.matches(user1_id, user1_chat_deleted_at, user1_chat_cleared_at);

CREATE INDEX IF NOT EXISTS idx_matches_user2_chat_visibility
  ON public.matches(user2_id, user2_chat_deleted_at, user2_chat_cleared_at);
