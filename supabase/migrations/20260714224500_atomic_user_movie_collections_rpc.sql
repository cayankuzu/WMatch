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
  v_favorite_movie_ids INTEGER[];
  v_watched_movie_ids INTEGER[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  IF p_favorite_movie_ids IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM unnest(p_favorite_movie_ids) AS movie_id
      WHERE movie_id IS NULL OR movie_id <= 0
    ) THEN
      RAISE EXCEPTION 'favorite movie ids must be positive integers';
    END IF;

    SELECT COALESCE(array_agg(DISTINCT movie_id ORDER BY movie_id), ARRAY[]::INTEGER[])
    INTO v_favorite_movie_ids
    FROM unnest(p_favorite_movie_ids) AS movie_id;

    IF cardinality(v_favorite_movie_ids) > 100 THEN
      RAISE EXCEPTION 'favorite movie limit exceeded';
    END IF;

    DELETE FROM public.user_movies
    WHERE user_id = p_user_id
      AND type = 'favorite';

    INSERT INTO public.user_movies (user_id, movie_id, type)
    SELECT p_user_id, movie_id, 'favorite'
    FROM unnest(v_favorite_movie_ids) AS movie_id;
  END IF;

  IF p_watched_movie_ids IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM unnest(p_watched_movie_ids) AS movie_id
      WHERE movie_id IS NULL OR movie_id <= 0
    ) THEN
      RAISE EXCEPTION 'watched movie ids must be positive integers';
    END IF;

    SELECT COALESCE(array_agg(DISTINCT movie_id ORDER BY movie_id), ARRAY[]::INTEGER[])
    INTO v_watched_movie_ids
    FROM unnest(p_watched_movie_ids) AS movie_id;

    IF cardinality(v_watched_movie_ids) > 500 THEN
      RAISE EXCEPTION 'watched movie limit exceeded';
    END IF;

    DELETE FROM public.user_movies
    WHERE user_id = p_user_id
      AND type = 'watched';

    INSERT INTO public.user_movies (user_id, movie_id, type)
    SELECT p_user_id, movie_id, 'watched'
    FROM unnest(v_watched_movie_ids) AS movie_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) TO service_role;
