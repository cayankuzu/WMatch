import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const fail = (message) => {
  console.error(`Migration check failed: ${message}`);
  process.exit(1);
};

const migrationsDir = 'supabase/migrations';
const expectedLatest = '20260819190000_push_delivery_receipts.sql';
const historicalNoopMigrations = new Set([
  '20260703131500_per_user_chat_deletion_state.sql',
]);
const migrations = readdirSync(migrationsDir)
  .filter((file) => /^\d{14}_.+\.sql$/.test(file))
  .sort();

if (migrations.at(-1) !== expectedLatest) {
  fail(`latest migration expected ${expectedLatest}, received ${migrations.at(-1) ?? '<none>'}`);
}

const latestSource = readFileSync(join(migrationsDir, expectedLatest), 'utf8');
const discoveryCorrectnessSource = readFileSync(
  join(migrationsDir, '20260819090000_discovery_correctness_read_models.sql'),
  'utf8',
);
const watchSessionSource = readFileSync(
  join(migrationsDir, '20260720012500_watch_session_media_type_ambiguity_fix.sql'),
  'utf8',
);
const appPresenceSource = readFileSync(
  join(migrationsDir, '20260719113000_app_presence_private_topics.sql'),
  'utf8',
);
const movieCollectionOrderSource = readFileSync(
  join(migrationsDir, '20260719234500_movie_collection_order_contract.sql'),
  'utf8',
);
const productionHardeningSource = readFileSync(
  join(migrationsDir, '20260718120000_production_integrity_hardening.sql'),
  'utf8',
);
const internalDenySource = readFileSync(
  join(migrationsDir, '20260610133000_internal_tables_explicit_deny_policies.sql'),
  'utf8',
);
const notificationEventsSource = readFileSync(
  join(migrationsDir, '20260702103000_notification_events.sql'),
  'utf8',
);
const allMigrationSource = migrations
  .map((migration) => readFileSync(join(migrationsDir, migration), 'utf8'))
  .join('\n');
const requiredTokens = [
  "required_version = EXCLUDED.required_version",
  "'20260718120000'",
  'CREATE TABLE IF NOT EXISTS public.notification_events',
  'CREATE OR REPLACE FUNCTION public.claim_push_delivery_jobs',
  'CREATE OR REPLACE FUNCTION public.complete_push_delivery_job',
  'CREATE OR REPLACE FUNCTION public.get_push_delivery_health',
  'CREATE TABLE IF NOT EXISTS public.push_delivery_receipts',
  'CREATE OR REPLACE FUNCTION public.claim_push_receipt_jobs',
  'CREATE OR REPLACE FUNCTION public.complete_push_receipt_job',
  'CREATE OR REPLACE FUNCTION public.undo_like_action_atomic',
  'CREATE OR REPLACE FUNCTION public.update_pair_relationship_atomic',
  'CREATE OR REPLACE FUNCTION public.delete_chat_for_user_atomic',
  'CREATE OR REPLACE FUNCTION public.get_chat_list_stats',
  'CREATE TABLE IF NOT EXISTS public.chat_pair_summaries',
  'CREATE OR REPLACE FUNCTION public.get_chat_directory_page',
  'CREATE OR REPLACE FUNCTION public.get_compatibility_candidate_page',
  'CREATE OR REPLACE FUNCTION public.get_watch_discovery_candidate_page',
  'CREATE OR REPLACE FUNCTION public.update_chat_pair_summary_on_insert',
  'CREATE TABLE IF NOT EXISTS public.account_deletion_jobs',
  'CREATE TABLE IF NOT EXISTS public.mutation_idempotency_records',
  'CREATE OR REPLACE FUNCTION public.process_like_action_idempotent',
  "SET public = FALSE\nWHERE id = 'profile-photos'",
  "ALTER PUBLICATION supabase_realtime DROP TABLE public.%I",
  'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_movies FROM PUBLIC, anon, authenticated',
  'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.currently_watching FROM PUBLIC, anon, authenticated',
  'DROP POLICY IF EXISTS "WMatch private realtime select" ON realtime.messages',
  "split_part(realtime.topic(), ':', 2) = (SELECT auth.uid())::TEXT",
  'CREATE OR REPLACE FUNCTION public.resolve_media_identity_repair',
  'CREATE OR REPLACE FUNCTION public.replace_user_movie_collections',
  'CREATE OR REPLACE FUNCTION public.apply_watch_session_transition',
  'CREATE OR REPLACE FUNCTION public.get_chat_message_peers',
  'CREATE TABLE IF NOT EXISTS public.media_identity_repair_history',
  'CREATE TABLE IF NOT EXISTS public.chat_repair_audit',
  'GRANT EXECUTE ON FUNCTION public.resolve_media_identity_repair(UUID, TEXT, TEXT) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.replace_user_movie_collections(UUID, INTEGER[], INTEGER[]) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.get_chat_message_peers(UUID, INTEGER) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.get_chat_list_stats(UUID, UUID[], JSONB)',
  'GRANT EXECUTE ON FUNCTION public.get_compatibility_candidate_page(UUID, BIGINT, UUID, INTEGER)',
  'GRANT EXECUTE ON FUNCTION public.get_watch_discovery_candidate_page(UUID, INTEGER, TEXT, TIMESTAMPTZ, UUID, INTEGER)',
  'GRANT EXECUTE ON FUNCTION public.claim_push_delivery_jobs(UUID[], INTEGER) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.complete_push_delivery_job(UUID, TEXT, TEXT, INTEGER) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.get_push_delivery_health() TO service_role',
  'GRANT EXECUTE ON FUNCTION public.claim_push_receipt_jobs(INTEGER) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.complete_push_receipt_job(TEXT, TEXT, TEXT, INTEGER) TO service_role',
  'GRANT EXECUTE ON FUNCTION public.update_pair_relationship_atomic(UUID, UUID, TEXT)',
  'GRANT EXECUTE ON FUNCTION public.delete_chat_for_user_atomic(UUID, UUID, TEXT)',
  'GRANT EXECUTE ON FUNCTION public.process_like_action_idempotent(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT)',
  'GRANT EXECUTE ON FUNCTION public.apply_watch_session_transition(UUID, TEXT, INTEGER, TEXT, INTEGER, INTEGER) TO service_role',
  'REVOKE ALL ON TABLE public.media_identity_repair_history FROM anon, authenticated, public',
  'REVOKE ALL ON TABLE public.chat_repair_audit FROM anon, authenticated, public',
];

for (const token of requiredTokens) {
  if (!allMigrationSource.includes(token)) {
    fail(`migration chain is missing contract token: ${token}`);
  }
}

if (!latestSource.includes("'20260819190000'")) {
  fail('latest migration does not advance the schema contract');
}

if (
  !watchSessionSource.includes('CREATE OR REPLACE FUNCTION public.apply_watch_session_transition')
  || !watchSessionSource.includes('#variable_conflict use_column')
  || !watchSessionSource.includes('cw.media_type::TEXT')
  || !watchSessionSource.includes('currently_watching.state::TEXT')
) {
  fail('watch session migration does not pin return types');
}

if (
  !discoveryCorrectnessSource.includes('CREATE OR REPLACE FUNCTION public.calculate_discovery_compatibility_score')
  || !discoveryCorrectnessSource.includes('CREATE FUNCTION public.get_compatibility_candidate_page')
  || !discoveryCorrectnessSource.includes('p_cursor_score INTEGER')
  || !discoveryCorrectnessSource.includes('ORDER BY eligible.compatibility_score DESC, eligible.user_id ASC')
  || !discoveryCorrectnessSource.includes('CREATE FUNCTION public.get_watch_discovery_candidate_page')
  || !discoveryCorrectnessSource.includes('ORDER BY eligible.updated_at DESC, eligible.user_id DESC')
) {
  fail('latest migration does not enforce eligible, authoritative discovery pagination');
}

if (
  !movieCollectionOrderSource.includes('CREATE OR REPLACE FUNCTION public.replace_user_media_collections')
  || !movieCollectionOrderSource.includes('ON CONFLICT (user_id, media_type, movie_id, type) DO UPDATE')
  || !movieCollectionOrderSource.includes("SET created_at = EXCLUDED.created_at")
) {
  fail('movie collection order migration does not preserve movie collection order');
}

if (
  !appPresenceSource.includes("realtime.topic() = 'presence:' || (SELECT auth.uid())::TEXT")
  || !appPresenceSource.includes('FROM public.matches AS match')
) {
  fail('app presence migration does not secure app presence topics to owners and active matches');
}

if (!productionHardeningSource.includes("'20260718120000'")) {
  fail('production hardening migration contract is missing');
}

for (const table of ['request_rate_limits', 'kv_store_d962235e']) {
  if (!internalDenySource.includes(`to_regclass('public.${table}') IS NOT NULL`)) {
    fail(`internal deny migration must tolerate a missing ${table} table`);
  }
}

if (!notificationEventsSource.includes('CREATE TABLE IF NOT EXISTS public.notification_events')) {
  fail('notification events must exist before public API hardening references the table');
}

for (const migration of migrations) {
  const file = join(migrationsDir, migration);

  if (!existsSync(file)) {
    continue;
  }

  const source = readFileSync(file, 'utf8');
  if (
    source.replace(/--.*$/gm, '').trim().replace(/;/g, '').trim().length === 0 &&
    !historicalNoopMigrations.has(migration)
  ) {
    fail(`${migration} is empty`);
  }
  const catastrophicPatterns = [
    /DROP\s+SCHEMA\s+public\b/i,
    /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?public\.(profiles|user_movies|likes|matches|messages)\b/i,
    /TRUNCATE\s+TABLE\s+public\.(profiles|user_movies|likes|matches|messages)\b/i,
    /DELETE\s+FROM\s+auth\.users\b/i,
  ];

  const matchedPattern = catastrophicPatterns.find((pattern) => pattern.test(source));
  if (matchedPattern) {
    fail(`${migration} contains a catastrophic migration pattern: ${matchedPattern}`);
  }
}

console.log(`Migration check passed. migrations=${migrations.length}, latest=${expectedLatest}`);
