BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public, pg_catalog;

SELECT plan(18);

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
SELECT
  '00000000-0000-0000-0000-000000000000'::UUID,
  seed.id,
  'authenticated',
  'authenticated',
  seed.label || '@discovery.test',
  NOW(),
  '{"provider":"email","providers":["email"]}'::JSONB,
  jsonb_build_object(
    'name', seed.label,
    'username', seed.label,
    'age', 28,
    'gender', 'male'
  ),
  NOW(),
  NOW()
FROM (
  VALUES
    ('00000000-0000-0000-0000-000000000201'::UUID, 'discovery_201'),
    ('00000000-0000-0000-0000-000000000202'::UUID, 'discovery_202'),
    ('00000000-0000-0000-0000-000000000203'::UUID, 'discovery_203'),
    ('00000000-0000-0000-0000-000000000204'::UUID, 'discovery_204'),
    ('00000000-0000-0000-0000-000000000205'::UUID, 'discovery_205'),
    ('00000000-0000-0000-0000-000000000206'::UUID, 'discovery_206'),
    ('00000000-0000-0000-0000-000000000207'::UUID, 'discovery_207'),
    ('00000000-0000-0000-0000-000000000208'::UUID, 'discovery_208'),
    ('00000000-0000-0000-0000-000000000209'::UUID, 'discovery_209'),
    ('00000000-0000-0000-0000-000000000210'::UUID, 'discovery_210'),
    ('00000000-0000-0000-0000-000000000211'::UUID, 'discovery_211'),
    ('00000000-0000-0000-0000-000000000212'::UUID, 'discovery_212'),
    ('00000000-0000-0000-0000-000000000213'::UUID, 'discovery_213'),
    ('00000000-0000-0000-0000-000000000214'::UUID, 'discovery_214')
) AS seed(id, label);

UPDATE public.profiles
SET email_confirmed = TRUE, age = 28, gender = 'male'
WHERE id BETWEEN
  '00000000-0000-0000-0000-000000000201'::UUID AND
  '00000000-0000-0000-0000-000000000214'::UUID;

UPDATE public.profiles
SET email_confirmed = FALSE
WHERE id = '00000000-0000-0000-0000-000000000209';

UPDATE public.profiles
SET age = 70
WHERE id = '00000000-0000-0000-0000-000000000211';

UPDATE public.discovery_preferences
SET age_max = 50
WHERE user_id = '00000000-0000-0000-0000-000000000201';

UPDATE public.discovery_preferences
SET gender_preference = 'female'
WHERE user_id = '00000000-0000-0000-0000-000000000210';

UPDATE public.discovery_preferences
SET distance_max_km = 10
WHERE user_id = '00000000-0000-0000-0000-000000000212';

INSERT INTO public.user_movies (user_id, movie_id, media_type, type)
VALUES
  ('00000000-0000-0000-0000-000000000201', 1001, 'movie', 'favorite'),
  ('00000000-0000-0000-0000-000000000201', 1002, 'movie', 'favorite'),
  ('00000000-0000-0000-0000-000000000201', 1003, 'movie', 'favorite'),
  ('00000000-0000-0000-0000-000000000201', 1004, 'movie', 'favorite'),
  ('00000000-0000-0000-0000-000000000201', 1010, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000201', 1011, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000202', 1010, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000203', 1011, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000204', 1001, 'movie', 'favorite'),
  ('00000000-0000-0000-0000-000000000204', 1002, 'movie', 'favorite'),
  ('00000000-0000-0000-0000-000000000204', 1003, 'movie', 'favorite'),
  ('00000000-0000-0000-0000-000000000205', 1010, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000206', 1010, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000207', 1010, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000208', 1010, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000209', 1010, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000210', 1010, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000211', 1010, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000212', 1010, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000213', 1999, 'movie', 'favorite');

INSERT INTO public.user_movies (user_id, movie_id, media_type, type)
SELECT
  '00000000-0000-0000-0000-000000000204'::UUID,
  movie_id,
  'movie',
  'favorite'
FROM generate_series(1101, 1117) AS movie_id;

INSERT INTO public.user_blocks (blocker_id, blocked_id)
VALUES (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000205'
);

INSERT INTO public.likes (user_id, liked_user_id)
VALUES (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000206'
);

INSERT INTO public.matches (user1_id, user2_id, status)
VALUES (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000207',
  'active'
);

INSERT INTO public.likes (user_id, liked_user_id, hidden_by_liked_user)
VALUES (
  '00000000-0000-0000-0000-000000000208',
  '00000000-0000-0000-0000-000000000201',
  TRUE
);

SELECT is(
  public.calculate_discovery_compatibility_score(4, 4, 4, 2, 2, 2),
  100,
  'identical libraries produce a score of 100'
);

SELECT is(
  public.calculate_discovery_compatibility_score(4, 19, 3, 2, 0, 0),
  10,
  'high raw overlap can still produce a low Jaccard score'
);

SELECT is(
  public.calculate_discovery_compatibility_score(4, 0, 0, 2, 1, 1),
  18,
  'low raw overlap can outrank a diluted high-overlap library'
);

SELECT is(
  public.calculate_discovery_compatibility_score(0, 0, 0, 0, 0, 0),
  0,
  'empty libraries produce a score of zero'
);

SELECT results_eq(
  $$SELECT user_id FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000201', NULL, NULL, 3
  )$$,
  $$VALUES
    ('00000000-0000-0000-0000-000000000202'::UUID),
    ('00000000-0000-0000-0000-000000000203'::UUID),
    ('00000000-0000-0000-0000-000000000204'::UUID)$$,
  'final score and UUID tie-breaker define the global order'
);

SELECT results_eq(
  $$SELECT compatibility_score FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000201', NULL, NULL, 3
  )$$,
  $$VALUES (18), (18), (9)$$,
  'the authoritative read model returns the final score used by the client'
);

SELECT is(
  (SELECT COUNT(*) FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000201', NULL, NULL, 2
  )),
  2::BIGINT,
  'exactly pageSize eligible rows are returned when requested'
);

SELECT is(
  (SELECT COUNT(*) FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000201', NULL, NULL, 3
  )),
  3::BIGINT,
  'pageSize plus one can be requested for accurate hasMore calculation'
);

SELECT is(
  (SELECT user_id FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000201',
    18,
    '00000000-0000-0000-0000-000000000202',
    1
  )),
  '00000000-0000-0000-0000-000000000203'::UUID,
  'equal-score cursor advances by immutable UUID without duplicates'
);

SELECT is(
  (SELECT user_id FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000201',
    18,
    '00000000-0000-0000-0000-000000000203',
    1
  )),
  '00000000-0000-0000-0000-000000000204'::UUID,
  'cursor reaches the lower-scored next page without missing an item'
);

SELECT is_empty(
  $$SELECT * FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000201',
    9,
    '00000000-0000-0000-0000-000000000204',
    3
  )$$,
  'pagination terminates after the last eligible ranked candidate'
);

SELECT is_empty(
  $$SELECT user_id FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000201', NULL, NULL, 20
  ) WHERE user_id BETWEEN
    '00000000-0000-0000-0000-000000000205'::UUID AND
    '00000000-0000-0000-0000-000000000213'::UUID$$,
  'blocked, liked, matched, hidden, unconfirmed, bilateral-filtered, private-location and unrelated users are excluded before paging'
);

INSERT INTO public.currently_watching (
  user_id,
  movie_id,
  media_type,
  state,
  remaining_ms,
  expires_at,
  updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000205', 3001, 'movie', 'active', 3600000, NOW() + INTERVAL '1 day', '2026-08-19T12:10:00Z'),
  ('00000000-0000-0000-0000-000000000208', 3001, 'movie', 'active', 3600000, NOW() + INTERVAL '1 day', '2026-08-19T12:09:00Z'),
  ('00000000-0000-0000-0000-000000000209', 3001, 'movie', 'active', 3600000, NOW() + INTERVAL '1 day', '2026-08-19T12:08:00Z'),
  ('00000000-0000-0000-0000-000000000211', 3001, 'movie', 'active', 3600000, NOW() + INTERVAL '1 day', '2026-08-19T12:07:00Z'),
  ('00000000-0000-0000-0000-000000000214', 3001, 'movie', 'active', 3600000, NOW() - INTERVAL '1 day', '2026-08-19T12:06:00Z'),
  ('00000000-0000-0000-0000-000000000202', 3001, 'movie', 'active', 3600000, NOW() + INTERVAL '1 day', '2026-08-19T12:05:00Z'),
  ('00000000-0000-0000-0000-000000000203', 3001, 'movie', 'active', 3600000, NOW() + INTERVAL '1 day', '2026-08-19T12:05:00Z'),
  ('00000000-0000-0000-0000-000000000204', 3001, 'movie', 'active', 3600000, NOW() + INTERVAL '1 day', '2026-08-19T12:04:00Z');

SELECT is(
  (SELECT COUNT(*) FROM public.get_watch_discovery_candidate_page(
    '00000000-0000-0000-0000-000000000201', 3001, 'movie', NULL, NULL, 3
  )),
  3::BIGINT,
  'watch discovery fills the page after filtering newer ineligible rows'
);

SELECT results_eq(
  $$SELECT user_id FROM public.get_watch_discovery_candidate_page(
    '00000000-0000-0000-0000-000000000201', 3001, 'movie', NULL, NULL, 3
  )$$,
  $$VALUES
    ('00000000-0000-0000-0000-000000000203'::UUID),
    ('00000000-0000-0000-0000-000000000202'::UUID),
    ('00000000-0000-0000-0000-000000000204'::UUID)$$,
  'watch discovery uses updated_at and UUID as a deterministic tuple'
);

SELECT is(
  (SELECT user_id FROM public.get_watch_discovery_candidate_page(
    '00000000-0000-0000-0000-000000000201',
    3001,
    'movie',
    '2026-08-19T12:05:00Z',
    '00000000-0000-0000-0000-000000000203',
    1
  )),
  '00000000-0000-0000-0000-000000000202'::UUID,
  'watch cursor advances within an equal timestamp by UUID'
);

SELECT is(
  (SELECT user_id FROM public.get_watch_discovery_candidate_page(
    '00000000-0000-0000-0000-000000000201',
    3001,
    'movie',
    '2026-08-19T12:05:00Z',
    '00000000-0000-0000-0000-000000000202',
    1
  )),
  '00000000-0000-0000-0000-000000000204'::UUID,
  'watch cursor reaches the next timestamp without a missing item'
);

SELECT is_empty(
  $$SELECT * FROM public.get_watch_discovery_candidate_page(
    '00000000-0000-0000-0000-000000000201',
    3001,
    'movie',
    '2026-08-19T12:04:00Z',
    '00000000-0000-0000-0000-000000000204',
    3
  )$$,
  'expired and filtered watch rows cannot create a false hasMore page'
);

SELECT is_empty(
  $$SELECT * FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000214', NULL, NULL, 3
  )$$,
  'a user with no eligible overlap receives an empty compatibility page'
);

SELECT * FROM finish();
ROLLBACK;
