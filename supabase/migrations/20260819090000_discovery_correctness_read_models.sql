INSERT INTO public.schema_contracts (
  name,
  required_version,
  compatible_min_version,
  current_version,
  updated_at
)
VALUES (
  'wmatch_api',
  '20260819090000',
  '20260720012500',
  '20260819090000',
  NOW()
)
ON CONFLICT (name) DO UPDATE
SET
  required_version = EXCLUDED.required_version,
  compatible_min_version = EXCLUDED.compatible_min_version,
  current_version = EXCLUDED.current_version,
  updated_at = NOW();

-- Keep the mobile and database implementations of the existing 65/35 weighted
-- Jaccard score identical. The helper is deliberately data-free so both
-- discovery read models can reuse it without issuing per-candidate queries.
CREATE OR REPLACE FUNCTION public.calculate_discovery_compatibility_score(
  p_current_favorite_count BIGINT,
  p_candidate_favorite_count BIGINT,
  p_common_favorite_count BIGINT,
  p_current_watched_count BIGINT,
  p_candidate_watched_count BIGINT,
  p_common_watched_count BIGINT
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  WITH metrics AS (
    SELECT
      GREATEST(
        COALESCE(p_current_favorite_count, 0)
          + COALESCE(p_candidate_favorite_count, 0)
          - COALESCE(p_common_favorite_count, 0),
        0
      )::NUMERIC AS favorite_union,
      GREATEST(
        COALESCE(p_current_watched_count, 0)
          + COALESCE(p_candidate_watched_count, 0)
          - COALESCE(p_common_watched_count, 0),
        0
      )::NUMERIC AS watched_union,
      GREATEST(COALESCE(p_common_favorite_count, 0), 0)::NUMERIC AS common_favorites,
      GREATEST(COALESCE(p_common_watched_count, 0), 0)::NUMERIC AS common_watched
  ),
  weighted AS (
    SELECT
      CASE
        WHEN favorite_union > 0 THEN (common_favorites / favorite_union) * 0.65
        ELSE 0
      END
      + CASE
        WHEN watched_union > 0 THEN (common_watched / watched_union) * 0.35
        ELSE 0
      END AS weighted_score,
      CASE WHEN favorite_union > 0 THEN 0.65 ELSE 0 END
      + CASE WHEN watched_union > 0 THEN 0.35 ELSE 0 END AS active_weight
    FROM metrics
  )
  SELECT CASE
    WHEN active_weight = 0 THEN 0
    ELSE ROUND((weighted_score / active_weight) * 100)::INTEGER
  END
  FROM weighted;
$$;

REVOKE ALL ON FUNCTION public.calculate_discovery_compatibility_score(BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_discovery_compatibility_score(BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT)
  TO service_role;

-- The old cursor was based on raw overlap. Dropping it prevents a stale Edge
-- deployment from silently returning globally mis-ranked pages.
DROP FUNCTION IF EXISTS public.get_compatibility_candidate_page(UUID, BIGINT, UUID, INTEGER);

CREATE FUNCTION public.get_compatibility_candidate_page(
  p_current_user_id UUID,
  p_cursor_score INTEGER DEFAULT NULL,
  p_cursor_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 41
)
RETURNS TABLE (
  user_id UUID,
  compatibility_score INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH current_context AS (
    SELECT
      profile.id,
      profile.age,
      profile.gender,
      CASE
        WHEN preference.gender_preference IN ('female', 'male', 'nonbinary')
          THEN preference.gender_preference
        ELSE 'random'
      END AS gender_preference,
      COALESCE(preference.age_min, 18) AS age_min,
      COALESCE(preference.age_max, 99) AS age_max,
      COALESCE(preference.distance_min_km, 0) AS distance_min_km,
      COALESCE(preference.distance_max_km, 500) AS distance_max_km,
      COALESCE(preference.compatibility_min, 0) AS compatibility_min,
      COALESCE(preference.compatibility_max, 100) AS compatibility_max,
      private_profile.latitude,
      private_profile.longitude
    FROM public.profiles profile
    LEFT JOIN public.discovery_preferences preference ON preference.user_id = profile.id
    LEFT JOIN public.profiles_private private_profile ON private_profile.user_id = profile.id
    WHERE profile.id = p_current_user_id
  ),
  current_counts AS (
    SELECT
      COUNT(DISTINCT (media_type, movie_id)) FILTER (WHERE type = 'favorite')::BIGINT AS favorite_count,
      COUNT(DISTINCT (media_type, movie_id)) FILTER (WHERE type = 'watched')::BIGINT AS watched_count
    FROM public.user_movies
    WHERE user_id = p_current_user_id
  ),
  candidate_ids AS (
    SELECT DISTINCT candidate.user_id
    FROM public.user_movies current_item
    JOIN public.user_movies candidate
      ON candidate.media_type = current_item.media_type
     AND candidate.movie_id = current_item.movie_id
     AND candidate.type = current_item.type
    JOIN public.profiles candidate_profile
      ON candidate_profile.id = candidate.user_id
     AND candidate_profile.email_confirmed = TRUE
    WHERE current_item.user_id = p_current_user_id
      AND candidate.user_id <> p_current_user_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_blocks block
        WHERE (block.blocker_id = p_current_user_id AND block.blocked_id = candidate.user_id)
           OR (block.blocker_id = candidate.user_id AND block.blocked_id = p_current_user_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.likes own_like
        WHERE own_like.user_id = p_current_user_id
          AND own_like.liked_user_id = candidate.user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.likes hidden_like
        WHERE hidden_like.user_id = candidate.user_id
          AND hidden_like.liked_user_id = p_current_user_id
          AND hidden_like.hidden_by_liked_user = TRUE
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.matches matched_row
        WHERE matched_row.status = 'active'
          AND (
            (matched_row.user1_id = p_current_user_id AND matched_row.user2_id = candidate.user_id)
            OR (matched_row.user2_id = p_current_user_id AND matched_row.user1_id = candidate.user_id)
          )
      )
  ),
  candidate_metrics AS (
    SELECT
      candidate_id.user_id,
      COUNT(DISTINCT (candidate.media_type, candidate.movie_id))
        FILTER (WHERE candidate.type = 'favorite')::BIGINT AS favorite_count,
      COUNT(DISTINCT (candidate.media_type, candidate.movie_id))
        FILTER (WHERE candidate.type = 'watched')::BIGINT AS watched_count,
      COUNT(DISTINCT (candidate.media_type, candidate.movie_id))
        FILTER (
          WHERE candidate.type = 'favorite'
            AND EXISTS (
              SELECT 1
              FROM public.user_movies current_item
              WHERE current_item.user_id = p_current_user_id
                AND current_item.type = 'favorite'
                AND current_item.media_type = candidate.media_type
                AND current_item.movie_id = candidate.movie_id
            )
        )::BIGINT AS common_favorite_count,
      COUNT(DISTINCT (candidate.media_type, candidate.movie_id))
        FILTER (
          WHERE candidate.type = 'watched'
            AND EXISTS (
              SELECT 1
              FROM public.user_movies current_item
              WHERE current_item.user_id = p_current_user_id
                AND current_item.type = 'watched'
                AND current_item.media_type = candidate.media_type
                AND current_item.movie_id = candidate.movie_id
            )
        )::BIGINT AS common_watched_count
    FROM candidate_ids candidate_id
    LEFT JOIN public.user_movies candidate ON candidate.user_id = candidate_id.user_id
    GROUP BY candidate_id.user_id
  ),
  scored AS (
    SELECT
      candidate.user_id,
      public.calculate_discovery_compatibility_score(
        current_counts.favorite_count,
        candidate.favorite_count,
        candidate.common_favorite_count,
        current_counts.watched_count,
        candidate.watched_count,
        candidate.common_watched_count
      ) AS compatibility_score
    FROM candidate_metrics candidate
    CROSS JOIN current_counts
  ),
  candidate_context AS (
    SELECT
      scored.user_id,
      scored.compatibility_score,
      current_profile.age AS current_age,
      current_profile.gender AS current_gender,
      current_profile.gender_preference AS current_gender_preference,
      current_profile.age_min AS current_age_min,
      current_profile.age_max AS current_age_max,
      current_profile.distance_min_km AS current_distance_min_km,
      current_profile.distance_max_km AS current_distance_max_km,
      current_profile.compatibility_min AS current_compatibility_min,
      current_profile.compatibility_max AS current_compatibility_max,
      current_profile.latitude AS current_latitude,
      current_profile.longitude AS current_longitude,
      candidate_profile.age AS candidate_age,
      candidate_profile.gender AS candidate_gender,
      CASE
        WHEN candidate_preference.gender_preference IN ('female', 'male', 'nonbinary')
          THEN candidate_preference.gender_preference
        ELSE 'random'
      END AS candidate_gender_preference,
      COALESCE(candidate_preference.age_min, 18) AS candidate_age_min,
      COALESCE(candidate_preference.age_max, 99) AS candidate_age_max,
      COALESCE(candidate_preference.distance_min_km, 0) AS candidate_distance_min_km,
      COALESCE(candidate_preference.distance_max_km, 500) AS candidate_distance_max_km,
      COALESCE(candidate_preference.compatibility_min, 0) AS candidate_compatibility_min,
      COALESCE(candidate_preference.compatibility_max, 100) AS candidate_compatibility_max,
      candidate_private.latitude AS candidate_latitude,
      candidate_private.longitude AS candidate_longitude
    FROM scored
    CROSS JOIN current_context current_profile
    JOIN public.profiles candidate_profile ON candidate_profile.id = scored.user_id
    LEFT JOIN public.discovery_preferences candidate_preference
      ON candidate_preference.user_id = scored.user_id
    LEFT JOIN public.profiles_private candidate_private
      ON candidate_private.user_id = scored.user_id
  ),
  measured AS (
    SELECT
      candidate_context.*,
      CASE
        WHEN current_latitude IS NULL OR current_longitude IS NULL
          OR candidate_latitude IS NULL OR candidate_longitude IS NULL
          THEN NULL
        ELSE 2 * 6371 * ASIN(SQRT(LEAST(1::DOUBLE PRECISION,
          POWER(SIN(RADIANS(candidate_latitude - current_latitude) / 2), 2)
          + COS(RADIANS(current_latitude)) * COS(RADIANS(candidate_latitude))
            * POWER(SIN(RADIANS(candidate_longitude - current_longitude) / 2), 2)
        )))
      END AS distance_km
    FROM candidate_context
  ),
  eligible AS (
    SELECT measured.user_id, measured.compatibility_score
    FROM measured
    WHERE measured.compatibility_score > 0
      AND (measured.current_gender_preference = 'random'
        OR measured.current_gender_preference = measured.candidate_gender)
      AND (measured.candidate_gender_preference = 'random'
        OR measured.candidate_gender_preference = measured.current_gender)
      AND measured.candidate_age BETWEEN measured.current_age_min AND measured.current_age_max
      AND measured.current_age BETWEEN measured.candidate_age_min AND measured.candidate_age_max
      AND measured.compatibility_score
        BETWEEN measured.current_compatibility_min AND measured.current_compatibility_max
      AND measured.compatibility_score
        BETWEEN measured.candidate_compatibility_min AND measured.candidate_compatibility_max
      AND (
        (
          measured.current_distance_min_km = 0
          AND measured.current_distance_max_km = 500
          AND measured.candidate_distance_min_km = 0
          AND measured.candidate_distance_max_km = 500
        )
        OR (
          measured.distance_km IS NOT NULL
          AND (
            (measured.current_distance_min_km = 0 AND measured.current_distance_max_km = 500)
            OR measured.distance_km BETWEEN measured.current_distance_min_km AND measured.current_distance_max_km
          )
          AND (
            (measured.candidate_distance_min_km = 0 AND measured.candidate_distance_max_km = 500)
            OR measured.distance_km BETWEEN measured.candidate_distance_min_km AND measured.candidate_distance_max_km
          )
        )
      )
  )
  SELECT eligible.user_id, eligible.compatibility_score
  FROM eligible
  WHERE p_cursor_score IS NULL
    OR eligible.compatibility_score < p_cursor_score
    OR (
      eligible.compatibility_score = p_cursor_score
      AND p_cursor_user_id IS NOT NULL
      AND eligible.user_id > p_cursor_user_id
    )
  ORDER BY eligible.compatibility_score DESC, eligible.user_id ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 41), 1), 81);
$$;

REVOKE ALL ON FUNCTION public.get_compatibility_candidate_page(UUID, INTEGER, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_compatibility_candidate_page(UUID, INTEGER, UUID, INTEGER)
  TO service_role;

DROP FUNCTION IF EXISTS public.get_watch_discovery_candidate_page(UUID, INTEGER, TEXT, TIMESTAMPTZ, UUID, INTEGER);

CREATE FUNCTION public.get_watch_discovery_candidate_page(
  p_current_user_id UUID,
  p_movie_id INTEGER,
  p_media_type TEXT,
  p_cursor_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_user_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 41
)
RETURNS TABLE (
  user_id UUID,
  updated_at TIMESTAMPTZ,
  compatibility_score INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH current_context AS (
    SELECT
      profile.id,
      profile.age,
      profile.gender,
      CASE
        WHEN preference.gender_preference IN ('female', 'male', 'nonbinary')
          THEN preference.gender_preference
        ELSE 'random'
      END AS gender_preference,
      COALESCE(preference.age_min, 18) AS age_min,
      COALESCE(preference.age_max, 99) AS age_max,
      COALESCE(preference.distance_min_km, 0) AS distance_min_km,
      COALESCE(preference.distance_max_km, 500) AS distance_max_km,
      COALESCE(preference.compatibility_min, 0) AS compatibility_min,
      COALESCE(preference.compatibility_max, 100) AS compatibility_max,
      private_profile.latitude,
      private_profile.longitude
    FROM public.profiles profile
    LEFT JOIN public.discovery_preferences preference ON preference.user_id = profile.id
    LEFT JOIN public.profiles_private private_profile ON private_profile.user_id = profile.id
    WHERE profile.id = p_current_user_id
  ),
  watch_candidates AS (
    SELECT watching.user_id, watching.updated_at
    FROM public.currently_watching watching
    JOIN public.profiles candidate_profile
      ON candidate_profile.id = watching.user_id
     AND candidate_profile.email_confirmed = TRUE
    WHERE watching.movie_id = p_movie_id
      AND watching.media_type = p_media_type
      AND watching.state = 'active'
      AND watching.expires_at > NOW()
      AND watching.user_id <> p_current_user_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_blocks block
        WHERE (block.blocker_id = p_current_user_id AND block.blocked_id = watching.user_id)
           OR (block.blocker_id = watching.user_id AND block.blocked_id = p_current_user_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.likes own_like
        WHERE own_like.user_id = p_current_user_id
          AND own_like.liked_user_id = watching.user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.likes hidden_like
        WHERE hidden_like.user_id = watching.user_id
          AND hidden_like.liked_user_id = p_current_user_id
          AND hidden_like.hidden_by_liked_user = TRUE
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.matches matched_row
        WHERE matched_row.status = 'active'
          AND (
            (matched_row.user1_id = p_current_user_id AND matched_row.user2_id = watching.user_id)
            OR (matched_row.user2_id = p_current_user_id AND matched_row.user1_id = watching.user_id)
          )
      )
  ),
  current_counts AS (
    SELECT
      COUNT(DISTINCT (media_type, movie_id)) FILTER (WHERE type = 'favorite')::BIGINT AS favorite_count,
      COUNT(DISTINCT (media_type, movie_id)) FILTER (WHERE type = 'watched')::BIGINT AS watched_count
    FROM public.user_movies
    WHERE user_id = p_current_user_id
  ),
  candidate_metrics AS (
    SELECT
      watch_candidate.user_id,
      watch_candidate.updated_at,
      COUNT(DISTINCT (candidate.media_type, candidate.movie_id))
        FILTER (WHERE candidate.type = 'favorite')::BIGINT AS favorite_count,
      COUNT(DISTINCT (candidate.media_type, candidate.movie_id))
        FILTER (WHERE candidate.type = 'watched')::BIGINT AS watched_count,
      COUNT(DISTINCT (candidate.media_type, candidate.movie_id))
        FILTER (
          WHERE candidate.type = 'favorite'
            AND EXISTS (
              SELECT 1
              FROM public.user_movies current_item
              WHERE current_item.user_id = p_current_user_id
                AND current_item.type = 'favorite'
                AND current_item.media_type = candidate.media_type
                AND current_item.movie_id = candidate.movie_id
            )
        )::BIGINT AS common_favorite_count,
      COUNT(DISTINCT (candidate.media_type, candidate.movie_id))
        FILTER (
          WHERE candidate.type = 'watched'
            AND EXISTS (
              SELECT 1
              FROM public.user_movies current_item
              WHERE current_item.user_id = p_current_user_id
                AND current_item.type = 'watched'
                AND current_item.media_type = candidate.media_type
                AND current_item.movie_id = candidate.movie_id
            )
        )::BIGINT AS common_watched_count
    FROM watch_candidates watch_candidate
    LEFT JOIN public.user_movies candidate ON candidate.user_id = watch_candidate.user_id
    GROUP BY watch_candidate.user_id, watch_candidate.updated_at
  ),
  scored AS (
    SELECT
      candidate.user_id,
      candidate.updated_at,
      public.calculate_discovery_compatibility_score(
        current_counts.favorite_count,
        candidate.favorite_count,
        candidate.common_favorite_count,
        current_counts.watched_count,
        candidate.watched_count,
        candidate.common_watched_count
      ) AS compatibility_score
    FROM candidate_metrics candidate
    CROSS JOIN current_counts
  ),
  candidate_context AS (
    SELECT
      scored.user_id,
      scored.updated_at,
      scored.compatibility_score,
      current_profile.age AS current_age,
      current_profile.gender AS current_gender,
      current_profile.gender_preference AS current_gender_preference,
      current_profile.age_min AS current_age_min,
      current_profile.age_max AS current_age_max,
      current_profile.distance_min_km AS current_distance_min_km,
      current_profile.distance_max_km AS current_distance_max_km,
      current_profile.compatibility_min AS current_compatibility_min,
      current_profile.compatibility_max AS current_compatibility_max,
      current_profile.latitude AS current_latitude,
      current_profile.longitude AS current_longitude,
      candidate_profile.age AS candidate_age,
      candidate_profile.gender AS candidate_gender,
      CASE
        WHEN candidate_preference.gender_preference IN ('female', 'male', 'nonbinary')
          THEN candidate_preference.gender_preference
        ELSE 'random'
      END AS candidate_gender_preference,
      COALESCE(candidate_preference.age_min, 18) AS candidate_age_min,
      COALESCE(candidate_preference.age_max, 99) AS candidate_age_max,
      COALESCE(candidate_preference.distance_min_km, 0) AS candidate_distance_min_km,
      COALESCE(candidate_preference.distance_max_km, 500) AS candidate_distance_max_km,
      COALESCE(candidate_preference.compatibility_min, 0) AS candidate_compatibility_min,
      COALESCE(candidate_preference.compatibility_max, 100) AS candidate_compatibility_max,
      candidate_private.latitude AS candidate_latitude,
      candidate_private.longitude AS candidate_longitude
    FROM scored
    CROSS JOIN current_context current_profile
    JOIN public.profiles candidate_profile ON candidate_profile.id = scored.user_id
    LEFT JOIN public.discovery_preferences candidate_preference
      ON candidate_preference.user_id = scored.user_id
    LEFT JOIN public.profiles_private candidate_private
      ON candidate_private.user_id = scored.user_id
  ),
  measured AS (
    SELECT
      candidate_context.*,
      CASE
        WHEN current_latitude IS NULL OR current_longitude IS NULL
          OR candidate_latitude IS NULL OR candidate_longitude IS NULL
          THEN NULL
        ELSE 2 * 6371 * ASIN(SQRT(LEAST(1::DOUBLE PRECISION,
          POWER(SIN(RADIANS(candidate_latitude - current_latitude) / 2), 2)
          + COS(RADIANS(current_latitude)) * COS(RADIANS(candidate_latitude))
            * POWER(SIN(RADIANS(candidate_longitude - current_longitude) / 2), 2)
        )))
      END AS distance_km
    FROM candidate_context
  ),
  eligible AS (
    SELECT measured.user_id, measured.updated_at, measured.compatibility_score
    FROM measured
    WHERE (measured.current_gender_preference = 'random'
        OR measured.current_gender_preference = measured.candidate_gender)
      AND (measured.candidate_gender_preference = 'random'
        OR measured.candidate_gender_preference = measured.current_gender)
      AND measured.candidate_age BETWEEN measured.current_age_min AND measured.current_age_max
      AND measured.current_age BETWEEN measured.candidate_age_min AND measured.candidate_age_max
      AND measured.compatibility_score
        BETWEEN measured.current_compatibility_min AND measured.current_compatibility_max
      AND measured.compatibility_score
        BETWEEN measured.candidate_compatibility_min AND measured.candidate_compatibility_max
      AND (
        (
          measured.current_distance_min_km = 0
          AND measured.current_distance_max_km = 500
          AND measured.candidate_distance_min_km = 0
          AND measured.candidate_distance_max_km = 500
        )
        OR (
          measured.distance_km IS NOT NULL
          AND (
            (measured.current_distance_min_km = 0 AND measured.current_distance_max_km = 500)
            OR measured.distance_km BETWEEN measured.current_distance_min_km AND measured.current_distance_max_km
          )
          AND (
            (measured.candidate_distance_min_km = 0 AND measured.candidate_distance_max_km = 500)
            OR measured.distance_km BETWEEN measured.candidate_distance_min_km AND measured.candidate_distance_max_km
          )
        )
      )
  )
  SELECT eligible.user_id, eligible.updated_at, eligible.compatibility_score
  FROM eligible
  WHERE p_cursor_updated_at IS NULL
    OR eligible.updated_at < p_cursor_updated_at
    OR (
      eligible.updated_at = p_cursor_updated_at
      AND p_cursor_user_id IS NOT NULL
      AND eligible.user_id < p_cursor_user_id
    )
  ORDER BY eligible.updated_at DESC, eligible.user_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 41), 1), 81);
$$;

REVOKE ALL ON FUNCTION public.get_watch_discovery_candidate_page(UUID, INTEGER, TEXT, TIMESTAMPTZ, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_watch_discovery_candidate_page(UUID, INTEGER, TEXT, TIMESTAMPTZ, UUID, INTEGER)
  TO service_role;
