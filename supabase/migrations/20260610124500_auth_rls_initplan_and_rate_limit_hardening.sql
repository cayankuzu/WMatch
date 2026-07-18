ALTER TABLE IF EXISTS public.request_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.request_rate_limits FROM anon, authenticated, public;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT
  USING ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE
  USING ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS "Users can manage their own movies" ON public.user_movies;
CREATE POLICY "Users can manage their own movies" ON public.user_movies
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can manage their currently watching" ON public.currently_watching;
CREATE POLICY "Users can manage their currently watching" ON public.currently_watching
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can manage their own likes" ON public.likes;
CREATE POLICY "Users can manage their own likes" ON public.likes
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can view likes they received" ON public.likes;
CREATE POLICY "Users can view likes they received" ON public.likes
  FOR SELECT
  USING (((SELECT auth.uid()) = liked_user_id) OR ((SELECT auth.uid()) = user_id));
DROP POLICY IF EXISTS "Users can view their own matches" ON public.matches;
CREATE POLICY "Users can view their own matches" ON public.matches
  FOR SELECT
  USING (((SELECT auth.uid()) = user1_id) OR ((SELECT auth.uid()) = user2_id));
DROP POLICY IF EXISTS "Users can update their own matches" ON public.matches;
CREATE POLICY "Users can update their own matches" ON public.matches
  FOR UPDATE
  USING (((SELECT auth.uid()) = user1_id) OR ((SELECT auth.uid()) = user2_id));
DROP POLICY IF EXISTS "Users can view their own messages" ON public.messages;
CREATE POLICY "Users can view their own messages" ON public.messages
  FOR SELECT
  USING (((SELECT auth.uid()) = sender_id) OR ((SELECT auth.uid()) = receiver_id));
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = sender_id);
DROP POLICY IF EXISTS "Users can update their received messages" ON public.messages;
CREATE POLICY "Users can update their received messages" ON public.messages
  FOR UPDATE
  USING ((SELECT auth.uid()) = receiver_id);
DROP POLICY IF EXISTS "Users can manage their own blocked users" ON public.user_blocks;
CREATE POLICY "Users can manage their own blocked users" ON public.user_blocks
  FOR ALL
  USING ((SELECT auth.uid()) = blocker_id)
  WITH CHECK ((SELECT auth.uid()) = blocker_id);
DROP POLICY IF EXISTS "Users can manage their own hidden chats" ON public.hidden_chats;
CREATE POLICY "Users can manage their own hidden chats" ON public.hidden_chats
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can manage their own chat settings" ON public.chat_settings;
CREATE POLICY "Users can manage their own chat settings" ON public.chat_settings
  FOR ALL
  USING ((SELECT auth.uid()) = owner_user_id)
  WITH CHECK ((SELECT auth.uid()) = owner_user_id);
DROP POLICY IF EXISTS "Users can manage their own push tokens" ON public.device_push_tokens;
CREATE POLICY "Users can manage their own push tokens" ON public.device_push_tokens
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can manage their own discovery preferences" ON public.discovery_preferences;
CREATE POLICY "Users can manage their own discovery preferences" ON public.discovery_preferences
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS "Users can manage their own swipe quotas" ON public.swipe_quotas;
CREATE POLICY "Users can manage their own swipe quotas" ON public.swipe_quotas
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
