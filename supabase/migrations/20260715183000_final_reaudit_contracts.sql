CREATE TABLE IF NOT EXISTS public.schema_contracts (
  name TEXT PRIMARY KEY,
  required_version TEXT NOT NULL,
  compatible_min_version TEXT NOT NULL,
  current_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON TABLE public.schema_contracts FROM anon, authenticated;

INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260715183000',
  '20260715162000',
  '20260715183000',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.media_identity_repair_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL CHECK (source_table IN ('user_movies', 'currently_watching')),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  movie_id INTEGER NOT NULL CHECK (movie_id > 0),
  collection_type TEXT NULL CHECK (collection_type IN ('favorite', 'watched')),
  assumed_media_type TEXT NULL CHECK (assumed_media_type IN ('movie', 'tv')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  UNIQUE (source_table, user_id, movie_id, collection_type, reason)
);

ALTER TABLE public.media_identity_repair_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.media_identity_repair_queue FROM anon, authenticated;

DROP POLICY IF EXISTS "No direct media identity repair reads" ON public.media_identity_repair_queue;
CREATE POLICY "No direct media identity repair reads" ON public.media_identity_repair_queue
  FOR SELECT USING (FALSE);

DROP POLICY IF EXISTS "No direct media identity repair writes" ON public.media_identity_repair_queue;
CREATE POLICY "No direct media identity repair writes" ON public.media_identity_repair_queue
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

INSERT INTO public.media_identity_repair_queue (
  source_table,
  user_id,
  movie_id,
  collection_type,
  assumed_media_type,
  reason
)
SELECT
  'user_movies',
  user_id,
  movie_id,
  type,
  media_type,
  'legacy_row_assumed_movie_before_typed_identity'
FROM public.user_movies
WHERE media_type = 'movie'
  AND created_at < TIMESTAMPTZ '2026-07-15 16:20:00+00'
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_media_identity_repair_queue_status
  ON public.media_identity_repair_queue(status, created_at DESC);

WITH ranked_user_movies AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, media_type, movie_id, type
      ORDER BY created_at NULLS LAST, ctid
    ) AS row_number
  FROM public.user_movies
)
DELETE FROM public.user_movies target
USING ranked_user_movies ranked
WHERE target.ctid = ranked.ctid
  AND ranked.row_number > 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_movies_pkey'
      AND conrelid = 'public.user_movies'::regclass
  ) THEN
    ALTER TABLE public.user_movies
      DROP CONSTRAINT user_movies_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_movies_pkey'
      AND conrelid = 'public.user_movies'::regclass
  ) THEN
    ALTER TABLE public.user_movies
      ADD CONSTRAINT user_movies_pkey
      PRIMARY KEY (user_id, media_type, movie_id, type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_movies_user_media_type
  ON public.user_movies(user_id, media_type, type, movie_id);

CREATE OR REPLACE FUNCTION public.replace_user_media_collections(
  p_user_id UUID,
  p_favorites JSONB DEFAULT NULL,
  p_watched JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  IF p_favorites IS NULL AND p_watched IS NULL THEN
    RETURN;
  END IF;

  IF p_favorites IS NOT NULL THEN
    IF jsonb_typeof(p_favorites) <> 'array' THEN
      RAISE EXCEPTION 'favorites must be an array';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_favorites) AS item
      WHERE item->>'mediaType' NOT IN ('movie', 'tv')
        OR COALESCE(item->>'id', '') !~ '^[1-9][0-9]*$'
    ) THEN
      RAISE EXCEPTION 'favorites must contain positive typed media refs';
    END IF;

    SELECT COUNT(*)
    INTO v_count
    FROM (
      SELECT DISTINCT item->>'mediaType', (item->>'id')::INTEGER
      FROM jsonb_array_elements(p_favorites) AS item
    ) refs;

    IF v_count > 100 THEN
      RAISE EXCEPTION 'favorite media limit exceeded';
    END IF;

    DELETE FROM public.user_movies
    WHERE user_id = p_user_id
      AND type = 'favorite';

    INSERT INTO public.user_movies (user_id, movie_id, media_type, type)
    SELECT DISTINCT
      p_user_id,
      (item->>'id')::INTEGER,
      item->>'mediaType',
      'favorite'
    FROM jsonb_array_elements(p_favorites) AS item
    ON CONFLICT (user_id, media_type, movie_id, type) DO NOTHING;
  END IF;

  IF p_watched IS NOT NULL THEN
    IF jsonb_typeof(p_watched) <> 'array' THEN
      RAISE EXCEPTION 'watched must be an array';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_watched) AS item
      WHERE item->>'mediaType' NOT IN ('movie', 'tv')
        OR COALESCE(item->>'id', '') !~ '^[1-9][0-9]*$'
    ) THEN
      RAISE EXCEPTION 'watched must contain positive typed media refs';
    END IF;

    SELECT COUNT(*)
    INTO v_count
    FROM (
      SELECT DISTINCT item->>'mediaType', (item->>'id')::INTEGER
      FROM jsonb_array_elements(p_watched) AS item
    ) refs;

    IF v_count > 500 THEN
      RAISE EXCEPTION 'watched media limit exceeded';
    END IF;

    DELETE FROM public.user_movies
    WHERE user_id = p_user_id
      AND type = 'watched';

    INSERT INTO public.user_movies (user_id, movie_id, media_type, type)
    SELECT DISTINCT
      p_user_id,
      (item->>'id')::INTEGER,
      item->>'mediaType',
      'watched'
    FROM jsonb_array_elements(p_watched) AS item
    ON CONFLICT (user_id, media_type, movie_id, type) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_media_collections(UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_user_media_collections(UUID, JSONB, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_media_collections(UUID, JSONB, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.replace_user_movie_collections(
  p_user_id UUID,
  p_favorite_movie_ids INTEGER[] DEFAULT NULL,
  p_watched_movie_ids INTEGER[] DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_favorites JSONB;
  v_watched JSONB;
BEGIN
  IF p_favorite_movie_ids IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM unnest(p_favorite_movie_ids) AS movie_id
      WHERE movie_id IS NULL OR movie_id <= 0
    ) THEN
      RAISE EXCEPTION 'favorite movie ids must be positive integers';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('mediaType', 'movie', 'id', movie_id)), '[]'::JSONB)
    INTO v_favorites
    FROM (
      SELECT DISTINCT movie_id
      FROM unnest(p_favorite_movie_ids) AS movie_id
      ORDER BY movie_id
    ) refs;
  END IF;

  IF p_watched_movie_ids IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM unnest(p_watched_movie_ids) AS movie_id
      WHERE movie_id IS NULL OR movie_id <= 0
    ) THEN
      RAISE EXCEPTION 'watched movie ids must be positive integers';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('mediaType', 'movie', 'id', movie_id)), '[]'::JSONB)
    INTO v_watched
    FROM (
      SELECT DISTINCT movie_id
      FROM unnest(p_watched_movie_ids) AS movie_id
      ORDER BY movie_id
    ) refs;
  END IF;

  PERFORM public.replace_user_media_collections(p_user_id, v_favorites, v_watched);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) TO service_role;

ALTER TABLE public.currently_watching
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

UPDATE public.currently_watching
SET
  started_at = COALESCE(started_at, updated_at),
  version = GREATEST(COALESCE(version, 1), 1);

ALTER TABLE public.currently_watching
  ALTER COLUMN started_at SET DEFAULT NOW(),
  ALTER COLUMN started_at SET NOT NULL,
  ALTER COLUMN version SET DEFAULT 1,
  ALTER COLUMN version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'currently_watching_version_check'
      AND conrelid = 'public.currently_watching'::regclass
  ) THEN
    ALTER TABLE public.currently_watching
      ADD CONSTRAINT currently_watching_version_check
      CHECK (version > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_currently_watching_live_keyset
  ON public.currently_watching(state, expires_at DESC, updated_at DESC, user_id DESC)
  WHERE state = 'active';

CREATE OR REPLACE FUNCTION public.get_live_now_users(
  p_current_user_id UUID,
  p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 81
)
RETURNS TABLE (
  user_id UUID,
  movie_id INTEGER,
  media_type TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cw.user_id,
    cw.movie_id,
    cw.media_type,
    cw.updated_at
  FROM public.currently_watching cw
  JOIN public.profiles p ON p.id = cw.user_id
  WHERE cw.state = 'active'
    AND cw.expires_at > NOW()
    AND cw.user_id <> p_current_user_id
    AND p.email_confirmed IS TRUE
    AND CARDINALITY(p.photos) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_blocks b
      WHERE (b.blocker_id = p_current_user_id AND b.blocked_id = cw.user_id)
         OR (b.blocker_id = cw.user_id AND b.blocked_id = p_current_user_id)
    )
    AND (
      p_cursor_updated_at IS NULL
      OR cw.updated_at < p_cursor_updated_at
      OR (
        cw.updated_at = p_cursor_updated_at
        AND p_cursor_user_id IS NOT NULL
        AND cw.user_id < p_cursor_user_id
      )
    )
  ORDER BY cw.updated_at DESC, cw.user_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 81), 1), 121);
$$;

REVOKE ALL ON FUNCTION public.get_live_now_users(UUID, TIMESTAMPTZ, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_live_now_users(UUID, TIMESTAMPTZ, UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_live_now_users(UUID, TIMESTAMPTZ, UUID, INTEGER) TO service_role;

CREATE TABLE IF NOT EXISTS public.user_entitlements (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'expired', 'revoked')),
  source TEXT NOT NULL DEFAULT 'manual',
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NULL,
  provider_reference TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, feature_key, source)
);

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_entitlements FROM anon, authenticated;

DROP POLICY IF EXISTS "No direct entitlement reads" ON public.user_entitlements;
CREATE POLICY "No direct entitlement reads" ON public.user_entitlements
  FOR SELECT USING (FALSE);

DROP POLICY IF EXISTS "No direct entitlement writes" ON public.user_entitlements;
CREATE POLICY "No direct entitlement writes" ON public.user_entitlements
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

CREATE INDEX IF NOT EXISTS idx_user_entitlements_feature_active
  ON public.user_entitlements(user_id, feature_key, status, valid_until);

DROP POLICY IF EXISTS "Users can view likes they received" ON public.likes;
DROP POLICY IF EXISTS "Users can manage their own likes" ON public.likes;
DROP POLICY IF EXISTS "Users can view their own outgoing likes" ON public.likes;
CREATE POLICY "Users can view their own outgoing likes" ON public.likes
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile-photo-staging',
  'profile-photo-staging',
  false,
  15728640,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    BEGIN
      EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';

      EXECUTE 'DROP POLICY IF EXISTS "WMatch private realtime select" ON realtime.messages';
      EXECUTE 'DROP POLICY IF EXISTS "WMatch private realtime insert" ON realtime.messages';

      EXECUTE $policy$
      CREATE POLICY "WMatch private realtime select" ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        topic = 'user:' || (SELECT auth.uid())::TEXT
        OR (
          topic ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (
            split_part(topic, ':', 2)::UUID = (SELECT auth.uid())
            OR split_part(topic, ':', 3)::UUID = (SELECT auth.uid())
          )
          AND EXISTS (
            SELECT 1
            FROM public.matches m
            WHERE m.status = 'active'
              AND m.user1_id = split_part(topic, ':', 2)::UUID
              AND m.user2_id = split_part(topic, ':', 3)::UUID
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.user_blocks b
            WHERE (
              b.blocker_id = split_part(topic, ':', 2)::UUID
              AND b.blocked_id = split_part(topic, ':', 3)::UUID
            )
            OR (
              b.blocker_id = split_part(topic, ':', 3)::UUID
              AND b.blocked_id = split_part(topic, ':', 2)::UUID
            )
          )
        )
      )
      $policy$;

      EXECUTE $policy$
      CREATE POLICY "WMatch private realtime insert" ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        topic = 'user:' || (SELECT auth.uid())::TEXT
        OR (
          topic ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (
            split_part(topic, ':', 2)::UUID = (SELECT auth.uid())
            OR split_part(topic, ':', 3)::UUID = (SELECT auth.uid())
          )
          AND EXISTS (
            SELECT 1
            FROM public.matches m
            WHERE m.status = 'active'
              AND m.user1_id = split_part(topic, ':', 2)::UUID
              AND m.user2_id = split_part(topic, ':', 3)::UUID
          )
        )
      )
      $policy$;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping realtime.messages policies because the migration role is not the table owner.';
    END;
  END IF;
END $$;
