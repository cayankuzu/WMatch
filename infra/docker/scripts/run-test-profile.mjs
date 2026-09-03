import { resolve } from "node:path";

import {
  acquireValidationLock,
  composeArgs,
  composeEnvironment,
  cleanupIsolatedSupabase,
  ensureNoComposeResources,
  normalizeSupabaseSchemaDiff,
  prepareIsolatedSupabase,
  recordEvidence,
  repositoryRoot,
  run,
  runSupabase,
  startSupabaseDatabaseIfNeeded,
  stopSupabaseIfOwned,
} from "./lib.mjs";

const releaseValidationLock = acquireValidationLock();
const startedAt = new Date().toISOString();
let environment = composeEnvironment();
let supabaseStarted = false;
let supabaseContext = null;
let status = "failed";

try {
  supabaseContext = await prepareIsolatedSupabase();
  environment = composeEnvironment({
    WMATCH_SUPABASE_API_PORT: String(supabaseContext.apiPort),
  });
  run("docker", composeArgs(["--profile", "test", "config", "--quiet"]), {
    env: environment,
  });
  supabaseStarted = startSupabaseDatabaseIfNeeded(supabaseContext);
  runSupabase(supabaseContext.root, ["db", "reset", "--local", "--no-seed"]);
  runSupabase(supabaseContext.root, [
    "test",
    "db",
    resolve(repositoryRoot, "supabase/tests/database"),
  ]);
  runSupabase(supabaseContext.root, ["db", "reset", "--local", "--no-seed"]);
  runSupabase(supabaseContext.root, [
    "test",
    "db",
    resolve(repositoryRoot, "supabase/tests/database"),
  ]);
  runSupabase(supabaseContext.root, [
    "db",
    "lint",
    "--local",
    "--schema",
    "public,storage",
    "--level",
    "warning",
    "--fail-on",
    "error",
  ]);
  const databaseEnvironment = { WMATCH_SUPABASE_WORKDIR: supabaseContext.root };
  run("npm", ["run", "check:db:advisors"], { env: databaseEnvironment });
  run("npm", ["run", "check:db:exposure"], { env: databaseEnvironment });
  run("npm", ["run", "test:db:nonce"], { env: databaseEnvironment });
  run("npm", ["run", "test:db:restore"], { env: databaseEnvironment });
  const schemaDiff = runSupabase(
    supabaseContext.root,
    [
      "db",
      "diff",
      "--from",
      "migrations",
      "--to",
      "local",
      "--schema",
      "public,storage,realtime",
    ],
    { capture: true },
  );
  const schemaDrift = normalizeSupabaseSchemaDiff(schemaDiff.stdout);
  if (schemaDrift) {
    throw new Error(`Isolated Supabase schema drift detected:\n${schemaDrift}`);
  }
  run(
    "docker",
    composeArgs([
      "--profile",
      "test",
      "up",
      "--build",
      "--abort-on-container-exit",
      "--exit-code-from",
      "tooling-test",
    ]),
    { env: environment },
  );
  status = "passed";
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  run(
    "docker",
    composeArgs(["--profile", "test", "down", "--remove-orphans"]),
    { env: environment, allowFailure: true },
  );
  if (supabaseContext) {
    try {
      stopSupabaseIfOwned(supabaseStarted, supabaseContext);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      status = "failed";
      process.exitCode = 1;
    }
  }
  try {
    ensureNoComposeResources();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    status = "failed";
    process.exitCode = 1;
  }
  try {
    cleanupIsolatedSupabase(supabaseContext);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    status = "failed";
    process.exitCode = 1;
  }
  try {
    recordEvidence("docker-test", startedAt, status, {
      composeProject: environment.COMPOSE_PROJECT_NAME,
      mobileRuntimeContainerized: false,
      productionDataUsed: false,
    });
  } finally {
    releaseValidationLock();
  }
}
