INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260719234500',
  '20260719113000',
  '20260719234500',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

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
      WHERE COALESCE(item->>'mediaType', '') NOT IN ('movie', 'tv')
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

    WITH incoming AS (
      SELECT DISTINCT ON (media_type, movie_id)
        media_type,
        movie_id,
        ordinal
      FROM (
        SELECT
          item->>'mediaType' AS media_type,
          (item->>'id')::INTEGER AS movie_id,
          ordinal
        FROM jsonb_array_elements(p_favorites) WITH ORDINALITY AS source(item, ordinal)
      ) parsed
      ORDER BY media_type, movie_id, ordinal
    ),
    upserted AS (
      INSERT INTO public.user_movies (user_id, movie_id, media_type, type, created_at)
      SELECT
        p_user_id,
        movie_id,
        media_type,
        'favorite',
        NOW() - ((ordinal - 1) * INTERVAL '1 millisecond')
      FROM incoming
      ON CONFLICT (user_id, media_type, movie_id, type) DO UPDATE
      SET created_at = EXCLUDED.created_at
      RETURNING movie_id, media_type
    )
    DELETE FROM public.user_movies existing
    WHERE existing.user_id = p_user_id
      AND existing.type = 'favorite'
      AND NOT EXISTS (
        SELECT 1
        FROM incoming
        WHERE incoming.movie_id = existing.movie_id
          AND incoming.media_type = existing.media_type
      );
  END IF;

  IF p_watched IS NOT NULL THEN
    IF jsonb_typeof(p_watched) <> 'array' THEN
      RAISE EXCEPTION 'watched must be an array';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_watched) AS item
      WHERE COALESCE(item->>'mediaType', '') NOT IN ('movie', 'tv')
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

    WITH incoming AS (
      SELECT DISTINCT ON (media_type, movie_id)
        media_type,
        movie_id,
        ordinal
      FROM (
        SELECT
          item->>'mediaType' AS media_type,
          (item->>'id')::INTEGER AS movie_id,
          ordinal
        FROM jsonb_array_elements(p_watched) WITH ORDINALITY AS source(item, ordinal)
      ) parsed
      ORDER BY media_type, movie_id, ordinal
    ),
    upserted AS (
      INSERT INTO public.user_movies (user_id, movie_id, media_type, type, created_at)
      SELECT
        p_user_id,
        movie_id,
        media_type,
        'watched',
        NOW() - ((ordinal - 1) * INTERVAL '1 millisecond')
      FROM incoming
      ON CONFLICT (user_id, media_type, movie_id, type) DO UPDATE
      SET created_at = EXCLUDED.created_at
      RETURNING movie_id, media_type
    )
    DELETE FROM public.user_movies existing
    WHERE existing.user_id = p_user_id
      AND existing.type = 'watched'
      AND NOT EXISTS (
        SELECT 1
        FROM incoming
        WHERE incoming.movie_id = existing.movie_id
          AND incoming.media_type = existing.media_type
      );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_media_collections(UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_user_media_collections(UUID, JSONB, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_media_collections(UUID, JSONB, JSONB) TO service_role;
