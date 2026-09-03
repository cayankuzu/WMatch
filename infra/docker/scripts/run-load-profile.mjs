import {
  acquireValidationLock,
  composeArgs,
  composeEnvironment,
  ensureNoComposeResources,
  recordEvidence,
  run,
} from "./lib.mjs";

const releaseValidationLock = acquireValidationLock();
const startedAt = new Date().toISOString();
const environment = composeEnvironment();
let status = "failed";

try {
  run("docker", composeArgs(["--profile", "load", "config", "--quiet"]), {
    env: environment,
  });
  run(
    "docker",
    composeArgs([
      "--profile",
      "load",
      "up",
      "--abort-on-container-exit",
      "--exit-code-from",
      "k6-provider-smoke",
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
    composeArgs(["--profile", "load", "down", "--remove-orphans"]),
    { env: environment, allowFailure: true },
  );
  try {
    ensureNoComposeResources();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    status = "failed";
    process.exitCode = 1;
  }
  try {
    recordEvidence("docker-load-smoke", startedAt, status, {
      composeProject: environment.COMPOSE_PROJECT_NAME,
      scope: "deterministic-provider-infrastructure-smoke-only",
      applicationPerformanceClaim: false,
      productionDataUsed: false,
    });
  } finally {
    releaseValidationLock();
  }
}
