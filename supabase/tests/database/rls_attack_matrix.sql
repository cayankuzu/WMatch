BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public, pg_catalog;

SELECT plan(70);

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
SELECT ok(NOT has_table_privilege('authenticated', 'public.edge_origin_hmac_nonces', 'SELECT'), 'authenticated cannot read origin replay nonces');
SELECT ok(has_table_privilege('service_role', 'public.edge_origin_hmac_nonces', 'SELECT'), 'service role can maintain origin replay nonces');

SELECT ok(
  NOT has_function_privilege('anon', 'public.check_email_availability(text)', 'EXECUTE'),
  'anon cannot enumerate email availability'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.check_email_availability(text)', 'EXECUTE'),
  'authenticated cannot enumerate email availability'
);
SELECT ok(
  has_function_privilege('service_role', 'public.check_email_availability(text)', 'EXECUTE'),
  'service role retains email availability compatibility access'
);
SELECT ok(NOT has_table_privilege('authenticated', 'public.messages', 'SELECT'), 'authenticated cannot bypass chat visibility through messages');
SELECT ok(NOT has_table_privilege('authenticated', 'public.messages', 'INSERT'), 'authenticated cannot bypass message validation');
SELECT ok(has_table_privilege('service_role', 'public.messages', 'SELECT'), 'service role can read messages through Edge');
SELECT ok(has_table_privilege('service_role', 'public.messages', 'INSERT'), 'service role can write validated messages');
SELECT ok(NOT has_table_privilege('authenticated', 'public.moderation_reports', 'SELECT'), 'authenticated cannot read moderation cases');
SELECT ok(NOT has_table_privilege('authenticated', 'public.moderation_reports', 'INSERT'), 'authenticated cannot bypass report validation');
SELECT ok(NOT has_table_privilege('authenticated', 'public.moderation_reports', 'UPDATE'), 'authenticated cannot mass-assign moderation state');
SELECT ok(has_table_privilege('service_role', 'public.moderation_reports', 'SELECT'), 'service role can read moderation cases');
SELECT ok(NOT has_table_privilege('authenticated', 'public.moderation_report_audit_events', 'SELECT'), 'authenticated cannot read moderation audit events');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.transition_moderation_report_ops(uuid,text,text,text)', 'EXECUTE'),
  'authenticated cannot transition moderation cases'
);
SELECT ok(
  has_function_privilege('service_role', 'public.transition_moderation_report_ops(uuid,text,text,text)', 'EXECUTE'),
  'service role can transition moderation cases'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.claim_edge_origin_hmac_nonce(text,uuid,bigint,integer)', 'EXECUTE'),
  'authenticated cannot claim trusted-origin nonces'
);
SELECT ok(
  has_function_privilege('service_role', 'public.claim_edge_origin_hmac_nonce(text,uuid,bigint,integer)', 'EXECUTE'),
  'service role can atomically claim trusted-origin nonces'
);

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
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'edge_origin_hmac_nonces'
      AND policyname = 'Service boundary origin HMAC nonces'
      AND qual IN ('false', '(false)') AND with_check IN ('false', '(false)')
  ),
  'origin HMAC replay nonces are service-boundary only'
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
SELECT is(
  (
    SELECT COUNT(*)
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname LIKE 'WMatch private realtime %'
      AND COALESCE(qual, with_check, '') ILIKE '%matches%'
      AND COALESCE(qual, with_check, '') ILIKE '%user_blocks%'
      AND COALESCE(qual, with_check, '') ILIKE '%active%'
  ),
  2::BIGINT,
  'both Realtime policies require active matches and bilateral block checks'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'chat_repair_audit'
      AND policyname = 'No direct chat repair audit reads'
  ),
  'chat repair audit has one non-overlapping service-boundary policy'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'media_identity_repair_history'
      AND policyname = 'No direct media identity repair history reads'
  ),
  'media repair history has one non-overlapping service-boundary policy'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'media_identity_repair_queue'
      AND policyname = 'No direct media identity repair reads'
  ),
  'media repair queue has one non-overlapping service-boundary policy'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_entitlements'
      AND policyname = 'No direct entitlement reads'
  ),
  'entitlements have one non-overlapping service-boundary policy'
);
SELECT ok(
  to_regclass('public.idx_currently_watching_movie_updated_at') IS NOT NULL
    AND to_regclass('public.idx_currently_watching_movie_id') IS NULL,
  'watch discovery keeps only the canonical movie/update keyset index'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT * FROM public.user_movies LIMIT 1', '42501', 'permission denied for table user_movies', 'authenticated raw media attack is denied');
SELECT throws_ok('SELECT * FROM public.currently_watching LIMIT 1', '42501', 'permission denied for table currently_watching', 'authenticated raw watch attack is denied');
SELECT throws_ok('SELECT * FROM public.mutation_idempotency_records LIMIT 1', '42501', 'permission denied for table mutation_idempotency_records', 'authenticated idempotency attack is denied');
SELECT throws_ok('SELECT * FROM public.messages LIMIT 1', '42501', 'permission denied for table messages', 'authenticated raw message attack is denied');
SELECT throws_ok('SELECT * FROM public.moderation_reports LIMIT 1', '42501', 'permission denied for table moderation_reports', 'authenticated moderation read attack is denied');
SELECT throws_ok('SELECT * FROM public.edge_origin_hmac_nonces LIMIT 1', '42501', 'permission denied for table edge_origin_hmac_nonces', 'authenticated origin nonce read attack is denied');
SELECT throws_ok(
  $$SELECT * FROM public.check_email_availability('target@example.com')$$,
  '42501',
  'permission denied for function check_email_availability',
  'authenticated email enumeration attack is denied'
);
SELECT throws_ok(
  $$SELECT * FROM public.transition_moderation_report_ops(
    '00000000-0000-4000-8000-000000000001', 'resolved', 'forged', 'attacker'
  )$$,
  '42501',
  'permission denied for function transition_moderation_report_ops',
  'authenticated moderation transition attack is denied'
);
SELECT throws_ok(
  $$SELECT public.claim_edge_origin_hmac_nonce(
    'attack-v1', '00000000-0000-4000-8000-000000000019', EXTRACT(EPOCH FROM NOW())::BIGINT, 60
  )$$,
  '42501',
  'permission denied for function claim_edge_origin_hmac_nonce',
  'authenticated origin nonce claim attack is denied'
);
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

SET LOCAL ROLE service_role;
SELECT ok(
  public.claim_edge_origin_hmac_nonce(
    'pgtap-v1', '00000000-0000-4000-8000-000000000020', EXTRACT(EPOCH FROM NOW())::BIGINT, 60
  ),
  'service role can claim a fresh trusted-origin nonce'
);
SELECT ok(
  NOT public.claim_edge_origin_hmac_nonce(
    'pgtap-v1', '00000000-0000-4000-8000-000000000020', EXTRACT(EPOCH FROM NOW())::BIGINT, 60
  ),
  'trusted-origin nonce replay is rejected atomically'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
