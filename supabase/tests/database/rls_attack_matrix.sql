BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public, pg_catalog;

SELECT plan(37);

GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated;

SELECT ok(NOT has_table_privilege('anon', 'public.user_movies', 'SELECT'), 'anon cannot read raw media collections');
SELECT ok(NOT has_table_privilege('authenticated', 'public.user_movies', 'SELECT'), 'authenticated cannot read raw media collections');
SELECT ok(NOT has_table_privilege('anon', 'public.currently_watching', 'SELECT'), 'anon cannot read raw watch sessions');
SELECT ok(NOT has_table_privilege('authenticated', 'public.currently_watching', 'SELECT'), 'authenticated cannot read raw watch sessions');
SELECT ok(NOT has_table_privilege('anon', 'public.mutation_idempotency_records', 'SELECT'), 'anon cannot read idempotency records');
SELECT ok(NOT has_table_privilege('authenticated', 'public.mutation_idempotency_records', 'SELECT'), 'authenticated cannot read idempotency records');
SELECT ok(NOT has_table_privilege('anon', 'public.account_deletion_jobs', 'SELECT'), 'anon cannot read deletion jobs');
SELECT ok(NOT has_table_privilege('authenticated', 'public.account_deletion_jobs', 'SELECT'), 'authenticated cannot read deletion jobs');
SELECT ok(NOT has_table_privilege('authenticated', 'public.chat_pair_summaries', 'SELECT'), 'authenticated cannot read chat summaries');

SELECT ok(has_table_privilege('service_role', 'public.user_movies', 'SELECT'), 'service role can read media collections');
SELECT ok(has_table_privilege('service_role', 'public.currently_watching', 'SELECT'), 'service role can read watch sessions');
SELECT ok(has_table_privilege('service_role', 'public.mutation_idempotency_records', 'SELECT'), 'service role can read idempotency records');
SELECT ok(has_table_privilege('service_role', 'public.account_deletion_jobs', 'SELECT'), 'service role can resume deletion jobs');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.process_like_action_idempotent(uuid,uuid,text,integer,integer,text,text)', 'EXECUTE'),
  'authenticated cannot invoke atomic like RPC directly'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.undo_like_action_atomic(uuid,uuid,integer,integer)', 'EXECUTE'),
  'authenticated cannot invoke atomic undo RPC directly'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.update_pair_relationship_atomic(uuid,uuid,text)', 'EXECUTE'),
  'authenticated cannot invoke relationship RPC directly'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.get_chat_list_stats(uuid,uuid[],jsonb)', 'EXECUTE'),
  'authenticated cannot invoke private chat stats RPC directly'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.get_chat_directory_page(uuid,timestamp with time zone,uuid,integer)', 'EXECUTE'),
  'authenticated cannot invoke private chat directory RPC directly'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.get_compatibility_candidate_page(uuid,integer,uuid,integer)', 'EXECUTE'),
  'authenticated cannot invoke private compatibility cursor RPC directly'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.get_watch_discovery_candidate_page(uuid,integer,text,timestamp with time zone,uuid,integer)', 'EXECUTE'),
  'authenticated cannot invoke private watch discovery cursor RPC directly'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.claim_push_delivery_jobs(uuid[],integer)', 'EXECUTE'),
  'authenticated cannot claim push outbox jobs'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.complete_push_delivery_job(uuid,text,text,integer)', 'EXECUTE'),
  'authenticated cannot complete push outbox jobs'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.delete_chat_for_user_atomic(uuid,uuid,text)', 'EXECUTE'),
  'authenticated cannot invoke atomic chat deletion directly'
);

SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_movies'::regclass), TRUE, 'media collection RLS is enabled');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.currently_watching'::regclass), TRUE, 'watch session RLS is enabled');
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_movies'
      AND policyname = 'Service boundary user movie reads' AND qual IN ('false', '(false)')
  ),
  'media collection policy denies direct reads'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'currently_watching'
      AND policyname = 'Service boundary currently watching reads' AND qual IN ('false', '(false)')
  ),
  'watch session policy denies direct reads'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mutation_idempotency_records'
      AND policyname = 'Service boundary mutation idempotency'
      AND qual IN ('false', '(false)') AND with_check IN ('false', '(false)')
  ),
  'idempotency records are service-boundary only'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_deletion_jobs'
      AND policyname = 'Service boundary account deletion jobs'
      AND qual IN ('false', '(false)') AND with_check IN ('false', '(false)')
  ),
  'deletion jobs are service-boundary only'
);

SELECT is((SELECT public FROM storage.buckets WHERE id = 'profile-photos'), FALSE, 'profile photo bucket is private');
SELECT is(
  (SELECT COUNT(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'),
  0::BIGINT,
  'public tables are not globally replicated through Realtime'
);
SELECT is(
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname LIKE 'WMatch private realtime %'),
  2::BIGINT,
  'Realtime has exactly the private read and write topic policies'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime' AND tablename = 'messages'
      AND policyname LIKE 'WMatch private realtime %'
      AND COALESCE(qual, with_check, '') LIKE '%POSITION%'
  ),
  'conversation authorization uses exact topic segments'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT * FROM public.user_movies LIMIT 1', '42501', 'permission denied for table user_movies', 'authenticated raw media attack is denied');
SELECT throws_ok('SELECT * FROM public.currently_watching LIMIT 1', '42501', 'permission denied for table currently_watching', 'authenticated raw watch attack is denied');
SELECT throws_ok('SELECT * FROM public.mutation_idempotency_records LIMIT 1', '42501', 'permission denied for table mutation_idempotency_records', 'authenticated idempotency attack is denied');
SELECT throws_ok(
  $$SELECT * FROM public.process_like_action_idempotent(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'like', 24, 100, 'test-key-00000001', repeat('a', 64)
  )$$,
  '42501',
  'permission denied for function process_like_action_idempotent',
  'authenticated direct mutation RPC attack is denied'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
