-- Harden the public API boundary: mobile clients may read allowed rows, but
-- business mutations must go through the Edge API/service role.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_message_id
  ON public.messages(sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_pair_created_at
  ON public.messages(sender_id, receiver_id, created_at DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-photos',
  'profile-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public profile photos are readable" ON storage.objects;
CREATE POLICY "Public profile photos are readable" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'profile-photos');

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

REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.profiles,
  public.user_movies,
  public.currently_watching,
  public.likes,
  public.matches,
  public.messages,
  public.discovery_preferences,
  public.swipe_quotas,
  public.hidden_chats,
  public.chat_settings,
  public.user_blocks,
  public.device_push_tokens,
  public.notification_events
FROM anon, authenticated;

DROP POLICY IF EXISTS "Users can view other profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "No direct profile updates" ON public.profiles;
CREATE POLICY "No direct profile updates" ON public.profiles
  FOR UPDATE
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Users can manage their own movies" ON public.user_movies;
DROP POLICY IF EXISTS "No direct user movie writes" ON public.user_movies;
CREATE POLICY "No direct user movie writes" ON public.user_movies
  FOR INSERT
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "No direct user movie updates" ON public.user_movies;
CREATE POLICY "No direct user movie updates" ON public.user_movies
  FOR UPDATE
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "No direct user movie deletes" ON public.user_movies;
CREATE POLICY "No direct user movie deletes" ON public.user_movies
  FOR DELETE
  USING (FALSE);

DROP POLICY IF EXISTS "Users can manage their currently watching" ON public.currently_watching;
DROP POLICY IF EXISTS "No direct currently watching writes" ON public.currently_watching;
CREATE POLICY "No direct currently watching writes" ON public.currently_watching
  FOR INSERT
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "No direct currently watching updates" ON public.currently_watching;
CREATE POLICY "No direct currently watching updates" ON public.currently_watching
  FOR UPDATE
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "No direct currently watching deletes" ON public.currently_watching;
CREATE POLICY "No direct currently watching deletes" ON public.currently_watching
  FOR DELETE
  USING (FALSE);

DROP POLICY IF EXISTS "Users can manage their own likes" ON public.likes;
DROP POLICY IF EXISTS "No direct like writes" ON public.likes;
CREATE POLICY "No direct like writes" ON public.likes
  FOR INSERT
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "No direct like deletes" ON public.likes;
CREATE POLICY "No direct like deletes" ON public.likes
  FOR DELETE
  USING (FALSE);

DROP POLICY IF EXISTS "Users can update their own matches" ON public.matches;
DROP POLICY IF EXISTS "No direct match updates" ON public.matches;
CREATE POLICY "No direct match updates" ON public.matches
  FOR UPDATE
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update their received messages" ON public.messages;
DROP POLICY IF EXISTS "No direct message writes" ON public.messages;
CREATE POLICY "No direct message writes" ON public.messages
  FOR INSERT
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "No direct message updates" ON public.messages;
CREATE POLICY "No direct message updates" ON public.messages
  FOR UPDATE
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Users can manage their own discovery preferences" ON public.discovery_preferences;
DROP POLICY IF EXISTS "No direct discovery preference writes" ON public.discovery_preferences;
CREATE POLICY "No direct discovery preference writes" ON public.discovery_preferences
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Users can manage their own swipe quotas" ON public.swipe_quotas;
DROP POLICY IF EXISTS "No direct swipe quota writes" ON public.swipe_quotas;
CREATE POLICY "No direct swipe quota writes" ON public.swipe_quotas
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);
