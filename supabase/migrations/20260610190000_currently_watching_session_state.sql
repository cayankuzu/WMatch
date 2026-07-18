ALTER TABLE public.currently_watching
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS remaining_ms BIGINT;
UPDATE public.currently_watching
SET
  state = COALESCE(state, 'active'),
  remaining_ms = COALESCE(remaining_ms, 43200000);
ALTER TABLE public.currently_watching
  ALTER COLUMN state SET DEFAULT 'active',
  ALTER COLUMN state SET NOT NULL,
  ALTER COLUMN remaining_ms SET DEFAULT 43200000,
  ALTER COLUMN remaining_ms SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'currently_watching_state_check'
  ) THEN
    ALTER TABLE public.currently_watching
      ADD CONSTRAINT currently_watching_state_check
      CHECK (state IN ('active', 'paused'));
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'currently_watching_remaining_ms_check'
  ) THEN
    ALTER TABLE public.currently_watching
      ADD CONSTRAINT currently_watching_remaining_ms_check
      CHECK (remaining_ms >= 0 AND remaining_ms <= 43200000);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_currently_watching_state_movie_id
  ON public.currently_watching(state, movie_id, updated_at DESC);
