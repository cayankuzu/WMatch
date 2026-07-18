ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_confirmed BOOLEAN NOT NULL DEFAULT FALSE;;
UPDATE public.profiles AS profile
SET email_confirmed = COALESCE(auth_user.email_confirmed_at IS NOT NULL, FALSE)
FROM auth.users AS auth_user
WHERE auth_user.id = profile.id;;
CREATE INDEX IF NOT EXISTS idx_profiles_email_confirmed
  ON public.profiles(email_confirmed, updated_at DESC);;
CREATE OR REPLACE FUNCTION public.sync_profile_email_confirmed()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET email_confirmed = COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;;
DROP TRIGGER IF EXISTS sync_profile_email_confirmed_on_auth_insert ON auth.users;;
CREATE TRIGGER sync_profile_email_confirmed_on_auth_insert
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_confirmed();;
DROP TRIGGER IF EXISTS sync_profile_email_confirmed_on_auth_update ON auth.users;;
CREATE TRIGGER sync_profile_email_confirmed_on_auth_update
  AFTER UPDATE OF email_confirmed_at, email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_confirmed();;
CREATE TABLE IF NOT EXISTS public.moderation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('profile', 'chat_message', 'match', 'other')),
  target_record_id TEXT,
  reason_code TEXT NOT NULL CHECK (char_length(btrim(reason_code)) BETWEEN 2 AND 80),
  details TEXT NOT NULL CHECK (char_length(btrim(details)) BETWEEN 20 AND 1500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')),
  reporter_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  target_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  context_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  reviewer_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);;
CREATE INDEX IF NOT EXISTS idx_moderation_reports_created_at
  ON public.moderation_reports(created_at DESC);;
CREATE INDEX IF NOT EXISTS idx_moderation_reports_status
  ON public.moderation_reports(status, created_at DESC);;
CREATE INDEX IF NOT EXISTS idx_moderation_reports_target_user_id
  ON public.moderation_reports(target_user_id, created_at DESC);;
CREATE INDEX IF NOT EXISTS idx_moderation_reports_reporter_user_id
  ON public.moderation_reports(reporter_user_id, created_at DESC);;
ALTER TABLE public.moderation_reports ENABLE ROW LEVEL SECURITY;;
DROP POLICY IF EXISTS "Users can create their own moderation reports" ON public.moderation_reports;;
CREATE POLICY "Users can create their own moderation reports" ON public.moderation_reports
  FOR INSERT
  WITH CHECK (auth.uid() = reporter_user_id);;
DROP POLICY IF EXISTS "Users can view their own moderation reports" ON public.moderation_reports;;
CREATE POLICY "Users can view their own moderation reports" ON public.moderation_reports
  FOR SELECT
  USING (auth.uid() = reporter_user_id);;
DROP TRIGGER IF EXISTS update_moderation_reports_updated_at ON public.moderation_reports;;
CREATE TRIGGER update_moderation_reports_updated_at
  BEFORE UPDATE ON public.moderation_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'profiles'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'user_movies'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_movies';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'currently_watching'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.currently_watching';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'likes'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.likes';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'discovery_preferences'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.discovery_preferences';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'moderation_reports'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.moderation_reports';
    END IF;
  END IF;
END;
$$;;
