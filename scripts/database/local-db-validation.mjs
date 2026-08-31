import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parsePgTapOutput } from './pg-tap-output.mjs';

const configSource = readFileSync('supabase/config.toml', 'utf8');
const projectId = configSource.match(/^project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*$/m)?.[1];
const apiSchemasSource = configSource.match(/^schemas\s*=\s*(\[[^\r\n]+\])\s*$/m)?.[1];
const apiSchemas = apiSchemasSource ? JSON.parse(apiSchemasSource) : [];
const migrationVersions = readdirSync('supabase/migrations')
  .map((file) => file.match(/^(\d{14})_.+\.sql$/)?.[1])
  .filter(Boolean)
  .sort();
const expectedLatestMigration = migrationVersions.at(-1);

if (!projectId) {
  throw new Error('Local DB validation requires a safe project_id in supabase/config.toml.');
}

if (
  !Array.isArray(apiSchemas) ||
  apiSchemas.length < 1 ||
  apiSchemas.some((schema) => typeof schema !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema))
) {
  throw new Error('Local DB validation requires safe [api].schemas in supabase/config.toml.');
}

const defaultContainer = `supabase_db_${projectId}`;
const container = defaultContainer;

if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(container)) {
  throw new Error(`Unsafe Supabase DB container name: ${container}`);
}

function formatFailure(command, args, result) {
  const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return `${command} ${args.join(' ')} failed with exit ${result.status ?? 'unknown'}${
    detail ? `:\n${detail}` : ''
  }`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(formatFailure(command, args, result));
  }

  return result.stdout.trim();
}

function runDocker(args, options) {
  return run('docker', args, options);
}

function assertLocalContainer() {
  const running = runDocker(['inspect', '--format={{.State.Running}}', container]);

  if (running !== 'true') {
    throw new Error(`Supabase DB container is not running: ${container}`);
  }

  const projectLabel = runDocker([
    'inspect',
    '--format={{ index .Config.Labels "com.supabase.cli.project" }}',
    container,
  ]);

  if (projectLabel !== projectId) {
    throw new Error(
      `Refusing local DB container with project label ${projectLabel || '<missing>'}; expected ${projectId}`,
    );
  }

  const migrationState = JSON.parse(psql('postgres', String.raw`
    SELECT pg_catalog.json_build_object(
      'count', COUNT(*),
      'latest', MAX(version)
    )::text
    FROM supabase_migrations.schema_migrations;
  `));

  if (
    migrationState.count !== migrationVersions.length ||
    migrationState.latest !== expectedLatestMigration
  ) {
    throw new Error(
      `Local DB migration history differs from the repository: ` +
      `db=${migrationState.count}/${migrationState.latest}, ` +
      `repo=${migrationVersions.length}/${expectedLatestMigration}`,
    );
  }
}

function psql(database, sql, options = {}) {
  return runDocker([
    'exec',
    ...(options.stdin ? ['-i'] : []),
    container,
    'psql',
    '-X',
    '-qAt',
    '-U',
    'supabase_admin',
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    ...(sql ? ['-c', sql] : []),
  ], options.stdin ? { input: options.stdin } : undefined);
}

const apiSchemaSql = apiSchemas.map((schema) => `'${schema}'`).join(', ');
const exposureSql = String.raw`
WITH api_relations AS (
  SELECT n.nspname, c.relname, c.relkind, c.relrowsecurity, c.reloptions
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = ANY (ARRAY[${apiSchemaSql}]::name[])
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (
      pg_catalog.has_table_privilege('anon', c.oid, 'SELECT')
      OR pg_catalog.has_table_privilege('anon', c.oid, 'INSERT')
      OR pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE')
      OR pg_catalog.has_table_privilege('anon', c.oid, 'DELETE')
      OR pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
      OR pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT')
      OR pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE')
      OR pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE')
    )
), violations AS (
  SELECT 'rls_disabled_in_public' AS issue, nspname || '.' || relname AS object_name
  FROM api_relations
  WHERE relkind IN ('r', 'p') AND NOT relrowsecurity
  UNION ALL
  SELECT 'security_definer_view', nspname || '.' || relname
  FROM api_relations
  WHERE relkind = 'v'
    AND NOT COALESCE(reloptions @> ARRAY['security_invoker=true'], FALSE)
  UNION ALL
  SELECT 'materialized_view_in_api', nspname || '.' || relname
  FROM api_relations
  WHERE relkind = 'm'
  UNION ALL
  SELECT 'foreign_table_in_api', nspname || '.' || relname
  FROM api_relations
  WHERE relkind = 'f'
)
SELECT issue || E'\t' || object_name
FROM violations
ORDER BY issue, object_name;
`;

function checkExposure() {
  const violations = psql('postgres', exposureSql);

  if (violations) {
    throw new Error(`Local Data API exposure advisor violations:\n${violations}`);
  }

  console.log('Local Data API exposure guard passed.');
}

function postgresApiSchemaSetting() {
  return psql('postgres', String.raw`
    SELECT COALESCE(
      (
        SELECT substring(setting FROM length('pgrst.db_schemas=') + 1)
        FROM pg_catalog.pg_roles AS role,
        LATERAL unnest(role.rolconfig) AS setting
        WHERE role.rolname = 'postgres'
          AND setting LIKE 'pgrst.db_schemas=%'
      ),
      ''
    );
  `);
}

function setPostgresApiSchemaSetting(value) {
  if (value === null) {
    psql('postgres', 'ALTER ROLE postgres RESET pgrst.db_schemas;');
    return;
  }

  const escapedValue = value.replaceAll("'", "''");
  psql('postgres', `ALTER ROLE postgres SET pgrst.db_schemas = '${escapedValue}';`);
}

function checkAdvisors() {
  const previousSetting = postgresApiSchemaSetting();
  const expectedSetting = apiSchemas.join(',');
  let primaryError;

  try {
    setPostgresApiSchemaSetting(expectedSetting);

    if (postgresApiSchemaSetting() !== expectedSetting) {
      throw new Error('Could not establish the local Data API schema context for advisors.');
    }

    const output = run(process.execPath, [
      join('node_modules', 'supabase', 'dist', 'supabase.js'),
      'db',
      'advisors',
      '--local',
      '--type',
      'all',
      '--level',
      'warn',
      '--fail-on',
      'warn',
    ]);

    if (output) {
      console.log(output);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      setPostgresApiSchemaSetting(previousSetting || null);

      if (postgresApiSchemaSetting() !== previousSetting) {
        throw new Error('Could not restore the postgres Data API schema setting after advisors.');
      }
    } catch (cleanupError) {
      if (primaryError) {
        throw new AggregateError(
          [primaryError, cleanupError],
          'Local advisors and role-setting cleanup both failed.',
        );
      }
      throw cleanupError;
    }
  }

  if (primaryError) {
    throw primaryError;
  }
}

function runAsync(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function checkNonceConcurrency() {
  const keyId = 'ci-concurrency-v1';
  const nonce = '00000000-0000-4000-8000-00000000c032';
  const cleanupSql = `DELETE FROM public.edge_origin_hmac_nonces WHERE key_id = '${keyId}' AND nonce = '${nonce}'::uuid;`;
  const claimSql = `SET ROLE service_role; SELECT public.claim_edge_origin_hmac_nonce('${keyId}', '${nonce}'::uuid, EXTRACT(EPOCH FROM clock_timestamp())::bigint, 300);`;
  psql('postgres', cleanupSql);

  try {
    const attempts = await Promise.all(Array.from({ length: 32 }, () => runAsync('docker', [
      'exec',
      container,
      'psql',
      '-X',
      '-qAt',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      claimSql,
    ])));
    const failed = attempts.filter((attempt) => attempt.status !== 0);

    if (failed.length > 0) {
      throw new Error(`Nonce concurrency had ${failed.length} failed transactions:\n${
        failed.map((attempt) => attempt.stderr.trim()).filter(Boolean).join('\n')
      }`);
    }

    const results = attempts.map((attempt) => attempt.stdout.trim().split(/\r?\n/).at(-1));
    const trueCount = results.filter((result) => result === 't').length;
    const falseCount = results.filter((result) => result === 'f').length;
    const rowCount = Number(psql(
      'postgres',
      `SELECT COUNT(*) FROM public.edge_origin_hmac_nonces WHERE key_id = '${keyId}' AND nonce = '${nonce}'::uuid;`,
    ));

    if (trueCount !== 1 || falseCount !== 31 || rowCount !== 1) {
      throw new Error(
        `Nonce claim was not atomic: true=${trueCount}, false=${falseCount}, rows=${rowCount}`,
      );
    }

    console.log('Atomic nonce concurrency passed. transactions=32 true=1 false=31 rows=1');
  } finally {
    psql('postgres', cleanupSql);
  }
}

const fingerprintSql = String.raw`
WITH relations AS (
  SELECT
    n.nspname,
    c.relname,
    c.relkind,
    c.relrowsecurity,
    pg_catalog.pg_get_userbyid(c.relowner) AS owner_name,
    COALESCE((
      SELECT string_agg(
        pg_catalog.pg_get_userbyid(acl.grantor) || '>' ||
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END || ':' ||
        acl.privilege_type || ':' || acl.is_grantable::text,
        ',' ORDER BY acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      )
      FROM pg_catalog.aclexplode(COALESCE(
        c.relacl,
        pg_catalog.acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner)
      )) AS acl
    ), '') AS acl
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('auth', 'public', 'realtime', 'storage', 'vault')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S', 'i')
), routines AS (
  SELECT
    n.nspname,
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
    p.prosecdef,
    pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
    COALESCE((
      SELECT string_agg(
        pg_catalog.pg_get_userbyid(acl.grantor) || '>' ||
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END || ':' ||
        acl.privilege_type || ':' || acl.is_grantable::text,
        ',' ORDER BY acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
      )
      FROM pg_catalog.aclexplode(COALESCE(
        p.proacl,
        pg_catalog.acldefault('f'::"char", p.proowner)
      )) AS acl
    ), '') AS acl
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('auth', 'public', 'realtime', 'storage', 'vault')
)
SELECT pg_catalog.json_build_object(
  'latestMigration', (SELECT MAX(version) FROM supabase_migrations.schema_migrations),
  'migrationCount', (SELECT COUNT(*) FROM supabase_migrations.schema_migrations),
  'publicTables', (SELECT COUNT(*) FROM relations WHERE nspname = 'public' AND relkind IN ('r', 'p')),
  'publicIndexes', (SELECT COUNT(*) FROM relations WHERE nspname = 'public' AND relkind = 'i'),
  'publicRlsTables', (SELECT COUNT(*) FROM relations WHERE nspname = 'public' AND relkind IN ('r', 'p') AND relrowsecurity),
  'relationDigest', (
    SELECT md5(COALESCE(string_agg(
      nspname || '.' || relname || '|' || relkind::text || '|' || relrowsecurity::text || '|' || owner_name || '|' || acl,
      E'\n' ORDER BY nspname, relname, relkind
    ), '')) FROM relations
  ),
  'routineDigest', (
    SELECT md5(COALESCE(string_agg(
      nspname || '.' || proname || '(' || identity_args || ')|' || prosecdef::text || '|' || owner_name || '|' || acl,
      E'\n' ORDER BY nspname, proname, identity_args
    ), '')) FROM routines
  )
)::text;
`;

function runPgTap(database) {
  const testDir = 'supabase/tests/database';
  const tests = readdirSync(testDir).filter((file) => file.endsWith('.sql')).sort();
  let assertionCount = 0;

  if (tests.length < 1) {
    throw new Error(`Restored pgTAP test directory is empty: ${testDir}`);
  }

  for (const test of tests) {
    const output = psql(database, null, { stdin: readFileSync(join(testDir, test), 'utf8') });
    assertionCount += parsePgTapOutput(output, test);
  }

  return { files: tests.length, assertions: assertionCount };
}

function checkDumpRestore() {
  const suffix = String(process.pid);
  const restoreDatabase = `${projectId}_ci_restore_${suffix}`.toLowerCase();
  const dumpFile = `/tmp/${restoreDatabase}.dump`;

  if (!/^[a-z0-9_]+$/.test(restoreDatabase) || restoreDatabase.length > 63) {
    throw new Error(`Unsafe restore database name: ${restoreDatabase}`);
  }

  let restoreCreated = false;
  let primaryError;

  try {
    const sourceFingerprint = JSON.parse(psql('postgres', fingerprintSql));
    runDocker([
      'exec',
      container,
      'pg_dump',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '--format=custom',
      `--file=${dumpFile}`,
    ]);
    const checksum = runDocker(['exec', container, 'sha256sum', dumpFile]).split(/\s+/)[0];
    psql(
      'postgres',
      `CREATE DATABASE ${restoreDatabase} WITH TEMPLATE template0 OWNER supabase_admin;`,
    );
    restoreCreated = true;
    runDocker([
      'exec',
      container,
      'pg_restore',
      '-U',
      'supabase_admin',
      '-d',
      restoreDatabase,
      '--role=supabase_admin',
      '--single-transaction',
      '--exit-on-error',
      dumpFile,
    ]);
    const restoredFingerprint = JSON.parse(psql(restoreDatabase, fingerprintSql));

    if (JSON.stringify(restoredFingerprint) !== JSON.stringify(sourceFingerprint)) {
      throw new Error(
        `Restored DB fingerprint differs from source:\nsource=${JSON.stringify(sourceFingerprint)}\nrestore=${JSON.stringify(restoredFingerprint)}`,
      );
    }

    const tap = runPgTap(restoreDatabase);
    console.log(
      `Local logical dump/restore passed. checksum=${checksum} migrations=${sourceFingerprint.migrationCount} ` +
      `tables=${sourceFingerprint.publicTables} indexes=${sourceFingerprint.publicIndexes} ` +
      `rls=${sourceFingerprint.publicRlsTables} pgTAP=${tap.assertions}/${tap.assertions} files=${tap.files}`,
    );
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];

    if (restoreCreated) {
      try {
        psql(
          'postgres',
          `SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE datname = '${restoreDatabase}' AND pid <> pg_catalog.pg_backend_pid();`,
        );
        runDocker([
          'exec',
          container,
          'dropdb',
          '-U',
          'supabase_admin',
          '--if-exists',
          restoreDatabase,
        ]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    try {
      runDocker(['exec', container, 'rm', '-f', dumpFile]);
    } catch (error) {
      cleanupErrors.push(error);
    }

    if (primaryError) {
      throw primaryError;
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Local logical restore cleanup failed.');
    }
  }
}

async function main() {
  assertLocalContainer();
  const command = process.argv[2];

  if (command === 'exposure') {
    checkExposure();
  } else if (command === 'advisors') {
    checkAdvisors();
  } else if (command === 'nonce-concurrency') {
    await checkNonceConcurrency();
  } else if (command === 'dump-restore') {
    checkDumpRestore();
  } else {
    throw new Error('Usage: node scripts/database/local-db-validation.mjs <advisors|exposure|nonce-concurrency|dump-restore>');
  }
}

main().catch((error) => {
  console.error(`Local DB validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
