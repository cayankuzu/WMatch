import { rmSync } from "node:fs";
import { resolve } from "node:path";

import {
  cleanupIsolatedSupabase,
  cleanupOwnedSupabaseResources,
  composeArgs,
  composeEnvironment,
  ensureNoComposeResources,
  ensureNoSupabaseResources,
  isolatedSupabaseContext,
  repositoryRoot,
  run,
} from "./lib.mjs";

const confirmed =
  process.argv.includes("--confirm") ||
  process.env.WMATCH_DOCKER_CLEAN_CONFIRM === "DELETE_TEST_ARTIFACTS";

if (!confirmed) {
  console.error(
    "Refusing destructive cleanup. Pass --confirm or set WMATCH_DOCKER_CLEAN_CONFIRM=DELETE_TEST_ARTIFACTS.",
  );
  process.exitCode = 2;
} else {
  const environment = composeEnvironment();
  run(
    "docker",
    composeArgs([
      "--profile",
      "test",
      "--profile",
      "resilience",
      "--profile",
      "load",
      "--profile",
      "mail",
      "down",
      "--remove-orphans",
      "--volumes",
    ]),
    { env: environment, allowFailure: true },
  );
  ensureNoComposeResources();
  const supabaseContext = isolatedSupabaseContext();
  cleanupOwnedSupabaseResources(supabaseContext);
  ensureNoSupabaseResources(supabaseContext);
  cleanupIsolatedSupabase(supabaseContext);
  const evidencePath = resolve(repositoryRoot, "tmp/docker-evidence");
  if (evidencePath.startsWith(resolve(repositoryRoot, "tmp"))) {
    rmSync(evidencePath, { recursive: true, force: true });
  }
  process.stdout.write(
    "Removed only WMatch Compose test resources and tmp/docker-evidence.\n",
  );
}
