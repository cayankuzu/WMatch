CREATE TABLE IF NOT EXISTS public.profiles_private (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location_updated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profiles_private_location_pair_check CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (
      latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
    )
  )
);

INSERT INTO public.profiles_private (user_id, latitude, longitude, location_updated_at, updated_at)
SELECT id, latitude, longitude, location_updated_at, now()
FROM public.profiles
WHERE latitude IS NOT NULL OR longitude IS NOT NULL OR location_updated_at IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
SET
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  location_updated_at = EXCLUDED.location_updated_at,
  updated_at = now();

UPDATE public.profiles
SET
  latitude = NULL,
  longitude = NULL,
  location_updated_at = NULL
WHERE latitude IS NOT NULL OR longitude IS NOT NULL OR location_updated_at IS NOT NULL;

ALTER TABLE public.profiles_private ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles_private FROM anon, authenticated, public;
GRANT ALL ON TABLE public.profiles_private TO service_role;

DROP POLICY IF EXISTS "No direct private profile access" ON public.profiles_private;
CREATE POLICY "No direct private profile access" ON public.profiles_private
  FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'profiles_private'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles_private;
  END IF;
END $$;
