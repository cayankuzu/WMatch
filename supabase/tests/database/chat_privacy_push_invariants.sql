BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public, pg_catalog;

SELECT plan(49);

GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated;

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
    '00000000-0000-4000-8000-000000000901',
    'authenticated',
    'authenticated',
    'chat-security-a@example.test',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"name":"Chat Security A","username":"chat_sec_a","age":28}'::JSONB,
    NOW(),
    NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000902',
    'authenticated',
    'authenticated',
    'chat-security-b@example.test',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"name":"Chat Security B","username":"chat_sec_b","age":29}'::JSONB,
    NOW(),
    NOW()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8000-000000000903',
    'authenticated',
    'authenticated',
    'chat-security-c@example.test',
    '{"provider":"email","providers":["email"]}'::JSONB,
    '{"name":"Chat Security C","username":"chat_sec_c","age":30}'::JSONB,
    NOW(),
    NOW()
  );

UPDATE public.profiles
SET email_confirmed = TRUE
WHERE id BETWEEN
  '00000000-0000-4000-8000-000000000901'::UUID AND
  '00000000-0000-4000-8000-000000000903'::UUID;

SELECT is(
  (SELECT COUNT(*) FROM public.profiles WHERE id BETWEEN
    '00000000-0000-4000-8000-000000000901'::UUID AND
    '00000000-0000-4000-8000-000000000903'::UUID),
  3::BIGINT,
  'fixtures create three profiles'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.send_chat_message_atomic(uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticated cannot invoke atomic message send directly'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.send_chat_message_atomic(uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'service role can invoke atomic message send'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.authorize_push_delivery_job(uuid)',
    'EXECUTE'
  ),
  'authenticated cannot authorize push delivery jobs'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.authorize_push_delivery_job(uuid)',
    'EXECUTE'
  ),
  'service role can authorize push delivery jobs'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.register_device_push_token_atomic(uuid,text,text,integer,integer)',
    'EXECUTE'
  ),
  'authenticated cannot bypass push-token registration validation'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.register_device_push_token_atomic(uuid,text,text,integer,integer)',
    'EXECUTE'
  ),
  'service role can register validated push tokens'
);

INSERT INTO public.matches (user1_id, user2_id, status, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000902',
  'active',
  NOW(),
  NOW()
);

CREATE TEMP TABLE first_send ON COMMIT DROP AS
SELECT * FROM public.send_chat_message_atomic(
  '00000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000902',
  'atomic hello',
  'atomic-message-0001',
  repeat('a', 64)
);

SELECT is((SELECT outcome FROM first_send), 'sent', 'active pair sends atomically');
SELECT is(
  (SELECT COUNT(*) FROM public.messages WHERE client_message_id = 'atomic-message-0001'),
  1::BIGINT,
  'atomic send inserts exactly one message'
);

CREATE TEMP TABLE replay_send ON COMMIT DROP AS
SELECT * FROM public.send_chat_message_atomic(
  '00000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000902',
  'atomic hello',
  'atomic-message-0001',
  repeat('a', 64)
);

SELECT is((SELECT outcome FROM replay_send), 'replayed', 'same client id replays safely');
SELECT is(
  (SELECT message_id FROM replay_send),
  (SELECT message_id FROM first_send),
  'idempotent replay returns the original message'
);
SELECT is(
  (SELECT COUNT(*) FROM public.messages WHERE client_message_id = 'atomic-message-0001'),
  1::BIGINT,
  'idempotent replay never duplicates the message'
);
SELECT is(
  (SELECT outcome FROM public.send_chat_message_atomic(
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    'different payload',
    'atomic-message-0001',
    repeat('b', 64)
  )),
  'idempotency_conflict',
  'client id cannot be reused for different content'
);

INSERT INTO public.notification_events (
  id, user_id, actor_user_id, kind, route_kind, route_user_id, title, body
)
VALUES (
  '30000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000901',
  'message',
  'chat',
  '00000000-0000-4000-8000-000000000901',
  'Queued message',
  'Must be suppressed'
);

SELECT is(
  (SELECT outcome FROM public.update_pair_relationship_atomic(
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    'block'
  )),
  'blocked',
  'block commits through the pair-locked relationship RPC'
);
SELECT is(
  (SELECT push_status FROM public.notification_events
   WHERE id = '30000000-0000-4000-8000-000000000901'),
  'suppressed',
  'block suppresses pending paired push work'
);
SELECT ok(
  (SELECT push_suppressed_at IS NOT NULL FROM public.notification_events
   WHERE id = '30000000-0000-4000-8000-000000000901'),
  'push suppression records an audit timestamp'
);
SELECT is(
  (SELECT outcome FROM public.send_chat_message_atomic(
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    'blocked message',
    'atomic-message-0002',
    repeat('c', 64)
  )),
  'relationship_locked',
  'message insert fails closed after block'
);
SELECT is(
  (SELECT outcome FROM public.update_pair_relationship_atomic(
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    'unblock'
  )),
  'unblocked',
  'unblock removes only the current block row'
);
SELECT is(
  (SELECT push_status FROM public.notification_events
   WHERE id = '30000000-0000-4000-8000-000000000901'),
  'suppressed',
  'unblock never revives stale push work'
);

UPDATE public.matches
SET status = 'active', ended_at = NULL, ended_by_user_id = NULL
WHERE user1_id = '00000000-0000-4000-8000-000000000901'
  AND user2_id = '00000000-0000-4000-8000-000000000902';

INSERT INTO public.chat_settings (
  owner_user_id, other_user_id, notifications_enabled
)
VALUES (
  '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000901',
  FALSE
)
ON CONFLICT (owner_user_id, other_user_id) DO UPDATE
SET notifications_enabled = EXCLUDED.notifications_enabled;

INSERT INTO public.notification_events (
  id, user_id, actor_user_id, kind, route_kind, route_user_id, title, body
)
VALUES (
  '30000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000901',
  'message',
  'chat',
  '00000000-0000-4000-8000-000000000901',
  'Disabled notification',
  'Must not leave the outbox'
);

CREATE TEMP TABLE disabled_claim ON COMMIT DROP AS
SELECT * FROM public.claim_push_delivery_jobs(
  ARRAY['30000000-0000-4000-8000-000000000902'::UUID],
  1
);
SELECT is(
  (SELECT id FROM disabled_claim),
  '30000000-0000-4000-8000-000000000902'::UUID,
  'notification worker claims the pending job once'
);

CREATE TEMP TABLE disabled_authorization ON COMMIT DROP AS
SELECT * FROM public.authorize_push_delivery_job(
  '30000000-0000-4000-8000-000000000902'
);
SELECT is(
  (SELECT authorized FROM disabled_authorization),
  FALSE,
  'delivery revalidation denies disabled chat notifications'
);
SELECT is(
  (SELECT reason FROM disabled_authorization),
  'chat_notifications_disabled',
  'delivery denial preserves a bounded reason'
);
SELECT is(
  (SELECT push_status FROM public.notification_events
   WHERE id = '30000000-0000-4000-8000-000000000902'),
  'suppressed',
  'delivery denial terminally suppresses the claimed event'
);

UPDATE public.chat_settings
SET notifications_enabled = TRUE
WHERE owner_user_id = '00000000-0000-4000-8000-000000000902'
  AND other_user_id = '00000000-0000-4000-8000-000000000901';

INSERT INTO public.notification_events (
  id, user_id, actor_user_id, kind, route_kind, route_user_id, title, body
)
VALUES (
  '30000000-0000-4000-8000-000000000903',
  '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000901',
  'message',
  'chat',
  '00000000-0000-4000-8000-000000000901',
  'Allowed notification',
  'Current relationship'
);
CREATE TEMP TABLE active_claim ON COMMIT DROP AS
SELECT *
FROM public.claim_push_delivery_jobs(
  ARRAY['30000000-0000-4000-8000-000000000903'::UUID],
  1
);

SELECT is(
  (SELECT authorized FROM public.authorize_push_delivery_job(
    '30000000-0000-4000-8000-000000000903'
  )),
  TRUE,
  'current active relationship authorizes push delivery'
);
SELECT is(
  (SELECT push_status FROM public.notification_events
   WHERE id = '30000000-0000-4000-8000-000000000903'),
  'processing',
  'authorized delivery retains its active lease'
);
SELECT ok(
  public.complete_push_delivery_job(
    '30000000-0000-4000-8000-000000000903',
    'no_tokens',
    NULL,
    NULL
  ),
  'authorized delivery can complete normally'
);

INSERT INTO public.notification_events (
  id, user_id, actor_user_id, kind, route_kind, route_user_id, title, body
)
VALUES (
  '30000000-0000-4000-8000-000000000904',
  '00000000-0000-4000-8000-000000000902',
  '00000000-0000-4000-8000-000000000901',
  'message',
  'chat',
  '00000000-0000-4000-8000-000000000901',
  'Pending at unmatch',
  'Must be suppressed'
);
SELECT is(
  (SELECT outcome FROM public.update_pair_relationship_atomic(
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    'end'
  )),
  'ended',
  'unmatch commits through the pair lock'
);
SELECT is(
  (SELECT push_status FROM public.notification_events
   WHERE id = '30000000-0000-4000-8000-000000000904'),
  'suppressed',
  'unmatch suppresses pending paired push work'
);

SELECT is(
  public.register_device_push_token_atomic(
    '00000000-0000-4000-8000-000000000901',
    'ExpoPushToken[short]',
    'android',
    8,
    90
  ),
  FALSE,
  'malformed Expo token fails closed in the DB'
);
SELECT ok(
  public.register_device_push_token_atomic(
    '00000000-0000-4000-8000-000000000901',
    'ExpoPushToken[aaaaaaaaaaaaaaaaaaaa]',
    'android',
    8,
    90
  ),
  'valid Expo token registers idempotently'
);
DO $$
DECLARE
  i INTEGER;
BEGIN
  FOR i IN 2..10 LOOP
    PERFORM public.register_device_push_token_atomic(
      '00000000-0000-4000-8000-000000000901',
      format('ExpoPushToken[%s]', lpad(i::TEXT, 20, 'x')),
      'android',
      8,
      90
    );
  END LOOP;
END $$;
SELECT is(
  (SELECT COUNT(*) FROM public.device_push_tokens
   WHERE user_id = '00000000-0000-4000-8000-000000000901'),
  8::BIGINT,
  'token registration keeps a bounded newest-eight set'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.device_push_tokens
    WHERE token = 'ExpoPushToken[xxxxxxxxxxxxxxxxxx10]'
      AND user_id = '00000000-0000-4000-8000-000000000901'
  ),
  'newest registration survives cardinality pruning'
);
UPDATE public.device_push_tokens
SET last_seen_at = NOW() - INTERVAL '100 days'
WHERE token = 'ExpoPushToken[xxxxxxxxxxxxxxxxxx10]';
SELECT is(
  public.prune_device_push_tokens(
    '00000000-0000-4000-8000-000000000901',
    90,
    8
  ),
  1,
  'stale token cleanup deletes expired registrations'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.device_push_tokens
    WHERE token = 'ExpoPushToken[xxxxxxxxxxxxxxxxxx10]'
  ),
  'expired token cannot be selected for delivery'
);

UPDATE public.matches
SET status = 'active', ended_at = NULL, ended_by_user_id = NULL
WHERE user1_id = '00000000-0000-4000-8000-000000000901'
  AND user2_id = '00000000-0000-4000-8000-000000000902';
UPDATE public.chat_settings
SET
  notifications_enabled = TRUE,
  typing_indicator_enabled = FALSE,
  online_status_enabled = FALSE
WHERE owner_user_id = '00000000-0000-4000-8000-000000000902'
  AND other_user_id = '00000000-0000-4000-8000-000000000901';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
SELECT ok(
  NOT public.can_access_conversation_realtime(
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    'receive'
  ),
  'peer typing preference denies conversation receive'
);
SELECT ok(
  public.can_access_conversation_realtime(
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    'send'
  ),
  'default own typing preference permits conversation send'
);
SELECT ok(
  NOT public.can_access_presence_realtime(
    '00000000-0000-4000-8000-000000000902'
  ),
  'peer online preference denies app-presence receive'
);
RESET ROLE;

INSERT INTO public.chat_settings (
  owner_user_id,
  other_user_id,
  typing_indicator_enabled,
  online_status_enabled
)
VALUES (
  '00000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000902',
  FALSE,
  FALSE
)
ON CONFLICT (owner_user_id, other_user_id) DO UPDATE
SET
  typing_indicator_enabled = EXCLUDED.typing_indicator_enabled,
  online_status_enabled = EXCLUDED.online_status_enabled;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
SELECT ok(
  NOT public.can_access_conversation_realtime(
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    'send'
  ),
  'own typing preference denies conversation send'
);
SELECT ok(
  NOT public.can_publish_app_presence(),
  'all-disabled pair prevents app-presence publication'
);
RESET ROLE;

UPDATE public.chat_settings
SET typing_indicator_enabled = TRUE, online_status_enabled = TRUE
WHERE (owner_user_id, other_user_id) IN (
  (
    '00000000-0000-4000-8000-000000000901'::UUID,
    '00000000-0000-4000-8000-000000000902'::UUID
  ),
  (
    '00000000-0000-4000-8000-000000000902'::UUID,
    '00000000-0000-4000-8000-000000000901'::UUID
  )
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000901';
SELECT ok(
  public.can_access_conversation_realtime(
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    'receive'
  ),
  'enabled peer typing preference permits conversation receive'
);
SELECT ok(
  public.can_access_presence_realtime(
    '00000000-0000-4000-8000-000000000902'
  ),
  'enabled peer online preference permits app-presence receive'
);
SELECT ok(public.can_publish_app_presence(), 'enabled pair permits own app-presence send');
SELECT throws_ok(
  $$SELECT * FROM public.send_chat_message_atomic(
    '00000000-0000-4000-8000-000000000901',
    '00000000-0000-4000-8000-000000000902',
    'forged direct call',
    'atomic-message-9999',
    repeat('f', 64)
  )$$,
  '42501',
  'permission denied for function send_chat_message_atomic',
  'authenticated direct atomic send attack is denied'
);
RESET ROLE;

SELECT is(
  (
    SELECT COUNT(*) FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname LIKE 'WMatch private realtime %'
      AND COALESCE(qual, with_check, '') ILIKE '%can_access_conversation_realtime%'
  ),
  2::BIGINT,
  'both Realtime policies enforce pair-specific typing settings'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'WMatch private realtime select'
      AND qual ILIKE '%can_access_presence_realtime%'
  ),
  'Realtime SELECT enforces peer online-status settings'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'WMatch private realtime insert'
      AND with_check ILIKE '%can_publish_app_presence%'
  ),
  'Realtime SEND enforces own online-status settings'
);
SELECT ok(
  (
    WITH target_policies AS (
      SELECT qual, with_check
      FROM pg_policies
      WHERE (schemaname, tablename, policyname) IN (
        VALUES
          ('public', 'profiles', 'Users can view their own profile'),
          ('public', 'likes', 'Users can view their own outgoing likes'),
          ('public', 'matches', 'Users can view their own matches'),
          ('public', 'user_blocks', 'Users can manage their own blocked users'),
          ('public', 'hidden_chats', 'Users can manage their own hidden chats'),
          ('public', 'chat_settings', 'Users can manage their own chat settings'),
          ('public', 'device_push_tokens', 'Users can manage their own push tokens'),
          ('storage', 'objects', 'Users can upload their own profile photos'),
          ('storage', 'objects', 'Users can delete their own profile photos'),
          ('realtime', 'messages', 'WMatch private realtime select'),
          ('realtime', 'messages', 'WMatch private realtime insert')
      )
    )
    SELECT COUNT(*) = 11
      AND NOT EXISTS (
        SELECT 1
        FROM target_policies
        WHERE regexp_replace(
          COALESCE(qual, '') || ' ' || COALESCE(with_check, ''),
          '\([[:space:]]*SELECT[[:space:]]+(auth\.)?uid\(\)([[:space:]]+AS[[:space:]]+uid)?[[:space:]]*\)',
          '',
          'gi'
        ) ~* '(^|[^[:alnum:]_])(auth\.)?uid\(\)'
      )
    FROM target_policies
  ),
  'rewritten RLS policies keep every auth.uid call in an initplan'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.device_push_tokens'::REGCLASS
      AND conname = 'device_push_tokens_token_format_check'
  ),
  'database constrains the complete Expo token envelope'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.notification_events'::REGCLASS
      AND conname = 'notification_events_push_status_check'
      AND pg_get_constraintdef(oid) ILIKE '%suppressed%'
  ),
  'push status constraint includes terminal suppression'
);

SELECT * FROM finish();
ROLLBACK;
