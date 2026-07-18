ALTER TABLE public.user_movies
  ADD COLUMN IF NOT EXISTS media_type TEXT;

UPDATE public.user_movies
SET media_type = 'movie'
WHERE media_type IS NULL;

ALTER TABLE public.user_movies
  ALTER COLUMN media_type SET DEFAULT 'movie',
  ALTER COLUMN media_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_movies_media_type_check'
  ) THEN
    ALTER TABLE public.user_movies
      ADD CONSTRAINT user_movies_media_type_check
      CHECK (media_type IN ('movie', 'tv'));
  END IF;
END $$;

ALTER TABLE public.currently_watching
  ADD COLUMN IF NOT EXISTS media_type TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE public.currently_watching
SET
  media_type = COALESCE(media_type, 'movie'),
  expires_at = COALESCE(expires_at, updated_at + INTERVAL '12 hours', NOW() + INTERVAL '12 hours')
WHERE media_type IS NULL
  OR expires_at IS NULL;

ALTER TABLE public.currently_watching
  ALTER COLUMN media_type SET DEFAULT 'movie',
  ALTER COLUMN media_type SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '12 hours'),
  ALTER COLUMN expires_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'currently_watching_media_type_check'
  ) THEN
    ALTER TABLE public.currently_watching
      ADD CONSTRAINT currently_watching_media_type_check
      CHECK (media_type IN ('movie', 'tv'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_currently_watching_live_now
  ON public.currently_watching(state, expires_at DESC, updated_at DESC, user_id);

CREATE INDEX IF NOT EXISTS idx_currently_watching_media_live
  ON public.currently_watching(media_type, movie_id, state, expires_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_movies_media_type_movie
  ON public.user_movies(media_type, movie_id, type, user_id);
