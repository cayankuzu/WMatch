import {
  acquireValidationLock,
  composeArgs,
  composeEnvironment,
  cleanupIsolatedSupabase,
  ensureNoComposeResources,
  prepareIsolatedSupabase,
  recordEvidence,
  run,
  startSupabaseDatabaseIfNeeded,
  startSupabaseIfNeeded,
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
  const fullStack = process.env.WMATCH_DOCKER_FULL_SUPABASE === "true";
  environment = composeEnvironment({
    WMATCH_SUPABASE_API_PORT: String(supabaseContext.apiPort),
    WMATCH_SUPABASE_DB_PORT: String(supabaseContext.dbPort),
    WMATCH_SUPABASE_MODE: fullStack ? "full" : "database",
  });
  run("docker", composeArgs(["--profile", "resilience", "config", "--quiet"]), {
    env: environment,
  });
  supabaseStarted = fullStack
    ? startSupabaseIfNeeded(supabaseContext.root)
    : startSupabaseDatabaseIfNeeded(supabaseContext);
  run(
    "docker",
    composeArgs([
      "--profile",
      "resilience",
      "up",
      "--build",
      "--abort-on-container-exit",
      "--exit-code-from",
      "tooling-resilience",
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
    composeArgs(["--profile", "resilience", "down", "--remove-orphans"]),
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
    recordEvidence("docker-resilience", startedAt, status, {
      composeProject: environment.COMPOSE_PROJECT_NAME,
      faultProvider: "toxiproxy",
      productionDataUsed: false,
    });
  } finally {
    releaseValidationLock();
  }
}
