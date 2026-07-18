BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public, pg_catalog;

SELECT plan(29);

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000101',
    'authenticated',
    'authenticated',
    'read-model-1@example.test',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"name":"Read One","username":"read_one","age":28}'::JSONB,
    NOW(),
    NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000102',
    'authenticated',
    'authenticated',
    'read-model-2@example.test',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"name":"Read Two","username":"read_two","age":29}'::JSONB,
    NOW(),
    NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000103',
    'authenticated',
    'authenticated',
    'read-model-3@example.test',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"name":"Read Three","username":"read_three","age":30}'::JSONB,
    NOW(),
    NOW()
  );

SELECT is(
  (SELECT COUNT(*) FROM public.profiles WHERE id BETWEEN
    '00000000-0000-0000-0000-000000000101'::UUID AND
    '00000000-0000-0000-0000-000000000103'::UUID),
  3::BIGINT,
  'auth trigger creates all read-model profiles'
);

INSERT INTO public.notification_events (
  id,
  user_id,
  kind,
  route_kind,
  title,
  body,
  payload
)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101',
  'message',
  'chat',
  'Read model push',
  'Durable delivery',
  '{}'::JSONB
);

SELECT is(
  (SELECT push_status FROM public.notification_events WHERE id = '20000000-0000-0000-0000-000000000001'),
  'pending',
  'new notification events enter the durable push outbox'
);

CREATE TEMP TABLE first_push_claim ON COMMIT DROP AS
SELECT * FROM public.claim_push_delivery_jobs(
  ARRAY['20000000-0000-0000-0000-000000000001'::UUID],
  1
);

SELECT is(
  (SELECT id FROM first_push_claim),
  '20000000-0000-0000-0000-000000000001'::UUID,
  'worker atomically claims the requested push event'
);

SELECT is(
  (SELECT attempt_count FROM first_push_claim),
  1,
  'first push claim records exactly one attempt'
);

SELECT is_empty(
  $$SELECT * FROM public.claim_push_delivery_jobs(
    ARRAY['20000000-0000-0000-0000-000000000001'::UUID],
    1
  )$$,
  'an active push lease cannot be claimed twice'
);

SELECT ok(
  public.complete_push_delivery_job(
    '20000000-0000-0000-0000-000000000001',
    'retry',
    'fault injection',
    30
  ),
  'retry completion releases the push lease'
);

SELECT is(
  (SELECT push_status FROM public.notification_events WHERE id = '20000000-0000-0000-0000-000000000001'),
  'retry',
  'retryable push failure remains durable'
);

UPDATE public.notification_events
SET push_next_attempt_at = NOW()
WHERE id = '20000000-0000-0000-0000-000000000001';

CREATE TEMP TABLE second_push_claim ON COMMIT DROP AS
SELECT * FROM public.claim_push_delivery_jobs(
  ARRAY['20000000-0000-0000-0000-000000000001'::UUID],
  1
);

SELECT is(
  (SELECT attempt_count FROM second_push_claim),
  2,
  'retry claim increments the durable attempt counter once'
);

SELECT ok(
  public.complete_push_delivery_job(
    '20000000-0000-0000-0000-000000000001',
    'submitted',
    NULL,
    NULL
  ),
  'submitted completion closes the push lease'
);

SELECT is(
  (SELECT push_status FROM public.notification_events WHERE id = '20000000-0000-0000-0000-000000000001'),
  'submitted',
  'submitted push events are terminal'
);

SELECT is_empty(
  $$SELECT * FROM public.claim_push_delivery_jobs(
    ARRAY['20000000-0000-0000-0000-000000000001'::UUID],
    1
  )$$,
  'submitted push event is never delivered twice'
);

INSERT INTO public.matches (user1_id, user2_id, status, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000103',
  'active',
  '2026-01-01T10:00:00Z',
  '2026-01-01T10:00:00Z'
);

INSERT INTO public.messages (id, sender_id, receiver_id, text, read, created_at, client_message_id)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102',
    'older',
    FALSE,
    '2026-01-02T10:00:00Z',
    'read-model-message-1'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102',
    'newer',
    FALSE,
    '2026-01-03T10:00:00Z',
    'read-model-message-2'
  );

SELECT is(
  (SELECT last_message FROM public.chat_pair_summaries WHERE
    user1_id = '00000000-0000-0000-0000-000000000101' AND
    user2_id = '00000000-0000-0000-0000-000000000102'),
  'newer',
  'chat summary keeps the latest message'
);

SELECT is(
  (SELECT unread_user2 FROM public.chat_pair_summaries WHERE
    user1_id = '00000000-0000-0000-0000-000000000101' AND
    user2_id = '00000000-0000-0000-0000-000000000102'),
  2,
  'chat summary increments recipient unread count'
);

UPDATE public.messages
SET read = TRUE
WHERE id = '10000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT unread_user2 FROM public.chat_pair_summaries WHERE
    user1_id = '00000000-0000-0000-0000-000000000101' AND
    user2_id = '00000000-0000-0000-0000-000000000102'),
  1,
  'read transition decrements the summary exactly once'
);

SELECT is(
  (SELECT other_user_id FROM public.get_chat_directory_page(
    '00000000-0000-0000-0000-000000000101', NULL, NULL, 2
  ) LIMIT 1),
  '00000000-0000-0000-0000-000000000102'::UUID,
  'message activity ranks ahead of an older match'
);

SELECT is(
  (SELECT other_user_id FROM public.get_chat_directory_page(
    '00000000-0000-0000-0000-000000000101',
    '2026-01-03T10:00:00Z',
    '00000000-0000-0000-0000-000000000102',
    2
  ) LIMIT 1),
  '00000000-0000-0000-0000-000000000103'::UUID,
  'chat directory cursor advances without duplicating the first peer'
);

INSERT INTO public.hidden_chats (user_id, other_user_id)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000103'
);

SELECT is_empty(
  $$SELECT * FROM public.get_chat_directory_page(
    '00000000-0000-0000-0000-000000000101',
    '2026-01-03T10:00:00Z',
    '00000000-0000-0000-0000-000000000102',
    2
  )$$,
  'hidden peers do not reappear on later chat pages'
);

DELETE FROM public.hidden_chats
WHERE user_id = '00000000-0000-0000-0000-000000000101'
  AND other_user_id = '00000000-0000-0000-0000-000000000103';

DELETE FROM public.matches
WHERE user1_id = '00000000-0000-0000-0000-000000000101'
  AND user2_id = '00000000-0000-0000-0000-000000000103';

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
  (
    '00000000-0000-0000-0000-000000000102',
    9201,
    'tv',
    'active',
    3600000,
    NOW() + INTERVAL '1 day',
    NOW() - INTERVAL '1 minute'
  ),
  (
    '00000000-0000-0000-0000-000000000103',
    9201,
    'tv',
    'active',
    3600000,
    NOW() + INTERVAL '1 day',
    NOW() - INTERVAL '2 minutes'
  );

SELECT is(
  (SELECT user_id FROM public.get_watch_discovery_candidate_page(
    '00000000-0000-0000-0000-000000000101', 9201, 'tv', NULL, NULL, 2
  ) LIMIT 1),
  '00000000-0000-0000-0000-000000000102'::UUID,
  'watch discovery orders candidates with a deterministic tuple'
);

SELECT is(
  (SELECT user_id FROM public.get_watch_discovery_candidate_page(
    '00000000-0000-0000-0000-000000000101',
    9201,
    'tv',
    (SELECT updated_at FROM public.currently_watching WHERE user_id = '00000000-0000-0000-0000-000000000102'),
    '00000000-0000-0000-0000-000000000102',
    2
  ) LIMIT 1),
  '00000000-0000-0000-0000-000000000103'::UUID,
  'watch discovery cursor advances without duplicating a candidate'
);

INSERT INTO public.user_blocks (blocker_id, blocked_id)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000103'
);

SELECT is_empty(
  $$SELECT * FROM public.get_watch_discovery_candidate_page(
    '00000000-0000-0000-0000-000000000101',
    9201,
    'tv',
    (SELECT updated_at FROM public.currently_watching WHERE user_id = '00000000-0000-0000-0000-000000000102'),
    '00000000-0000-0000-0000-000000000102',
    2
  )$$,
  'blocked peers never appear on later watch discovery pages'
);

DELETE FROM public.user_blocks
WHERE blocker_id = '00000000-0000-0000-0000-000000000101'
  AND blocked_id = '00000000-0000-0000-0000-000000000103';

INSERT INTO public.user_movies (user_id, movie_id, media_type, type)
VALUES
  ('00000000-0000-0000-0000-000000000101', 9101, 'movie', 'favorite'),
  ('00000000-0000-0000-0000-000000000101', 9102, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000102', 9101, 'movie', 'favorite'),
  ('00000000-0000-0000-0000-000000000102', 9102, 'tv', 'watched'),
  ('00000000-0000-0000-0000-000000000103', 9101, 'movie', 'favorite');

SELECT is(
  (SELECT user_id FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000101', NULL, NULL, 2
  ) LIMIT 1),
  '00000000-0000-0000-0000-000000000102'::UUID,
  'compatibility candidates are ranked by deterministic media overlap'
);

SELECT is(
  (SELECT overlap_count FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000101', NULL, NULL, 2
  ) LIMIT 1),
  2::BIGINT,
  'compatibility overlap keeps movie and TV identities distinct'
);

SELECT is(
  (SELECT user_id FROM public.get_compatibility_candidate_page(
    '00000000-0000-0000-0000-000000000101',
    2,
    '00000000-0000-0000-0000-000000000102',
    2
  ) LIMIT 1),
  '00000000-0000-0000-0000-000000000103'::UUID,
  'compatibility cursor advances to the next ranked user'
);

INSERT INTO public.matches (user1_id, user2_id, status, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  'active',
  NOW(),
  NOW()
);

CREATE TEMP TABLE first_chat_deletion ON COMMIT DROP AS
SELECT * FROM public.delete_chat_for_user_atomic(
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  'end'
);

SELECT is(
  (SELECT outcome FROM first_chat_deletion),
  'deleted_for_self',
  'the first chat deletion is committed for only the requesting user'
);

SELECT ok(
  (SELECT status = 'ended' AND user1_chat_deleted_at IS NOT NULL
   FROM public.matches
   WHERE user1_id = '00000000-0000-0000-0000-000000000101'
     AND user2_id = '00000000-0000-0000-0000-000000000102'),
  'ending and deleting a chat updates relationship and visibility atomically'
);

CREATE TEMP TABLE second_chat_deletion ON COMMIT DROP AS
SELECT * FROM public.delete_chat_for_user_atomic(
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000101',
  'end'
);

SELECT is(
  (SELECT deleted_for_everyone FROM second_chat_deletion),
  TRUE,
  'the second user deletion removes the shared chat for everyone'
);

SELECT is(
  (SELECT COUNT(*) FROM public.messages
   WHERE sender_id IN (
     '00000000-0000-0000-0000-000000000101',
     '00000000-0000-0000-0000-000000000102'
   )
     AND receiver_id IN (
       '00000000-0000-0000-0000-000000000101',
       '00000000-0000-0000-0000-000000000102'
     )),
  0::BIGINT,
  'two-sided deletion removes pair messages in the same transaction'
);

SELECT is(
  (SELECT COUNT(*) FROM public.matches
   WHERE user1_id = '00000000-0000-0000-0000-000000000101'
     AND user2_id = '00000000-0000-0000-0000-000000000102'),
  0::BIGINT,
  'two-sided deletion removes the pair match'
);

SELECT is(
  (SELECT COUNT(*) FROM public.chat_pair_summaries
   WHERE user1_id = '00000000-0000-0000-0000-000000000101'
     AND user2_id = '00000000-0000-0000-0000-000000000102'),
  0::BIGINT,
  'two-sided deletion removes the chat summary read model'
);

SELECT * FROM finish();
ROLLBACK;
