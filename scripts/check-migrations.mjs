import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const fail = (message) => {
  console.error(`Migration check failed: ${message}`);
  process.exit(1);
};

const migrationsDir = 'supabase/migrations';
const expectedLatest = '20260718120000_production_integrity_hardening.sql';
const historicalNoopMigrations = new Set([
  '20260702103000_notification_events.sql',
  '20260703131500_per_user_chat_deletion_state.sql',
]);
const migrations = readdirSync(migrationsDir)
  .filter((file) => /^\d{14}_.+\.sql$/.test(file))
  .sort();

if (migrations.at(-1) !== expectedLatest) {
  fail(`latest migration expected ${expectedLatest}, received ${migrations.at(-1) ?? '<none>'}`);
}

const latestSource = readFileSync(join(migrationsDir, expectedLatest), 'utf8');
const allMigrationSource = migrations
  .map((migration) => readFileSync(join(migrationsDir, migration), 'utf8'))
  .join('\n');
const requiredTokens = [
  "required_version = EXCLUDED.required_version",
  "'20260718120000'",
  'CREATE TABLE IF NOT EXISTS public.notification_events',
  'CREATE OR REPLACE FUNCTION public.claim_push_delivery_jobs',
  'CREATE OR REPLACE FUNCTION public.complete_push_delivery_job',
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

if (!latestSource.includes("'20260718120000'")) {
  fail('latest migration does not advance the schema contract');
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
