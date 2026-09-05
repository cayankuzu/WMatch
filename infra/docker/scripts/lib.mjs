import { spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptsDirectory, "../../..");
export const composeFile = resolve(repositoryRoot, "infra/docker/compose.yaml");
export const composeEnvFile = resolve(
  repositoryRoot,
  "infra/docker/env/.env.example",
);
const explicitRunScope = String(process.env.WMATCH_DOCKER_RUN_ID ?? "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 32);

function printable(command, args) {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function invocation(command, args) {
  if (
    process.platform === "win32" &&
    ["npm", "npx"].includes(command) &&
    process.env.npm_execpath
  ) {
    const cliPath =
      command === "npm"
        ? process.env.npm_execpath
        : resolve(dirname(process.env.npm_execpath), "npx-cli.js");
    return { command: process.execPath, args: [cliPath, ...args] };
  }
  return { command, args };
}

export function run(command, args = [], options = {}) {
  const display = printable(command, args);
  if (!options.quiet) {
    process.stdout.write(`> ${display}\n`);
  }

  const resolvedInvocation = invocation(command, args);
  const result = spawnSync(
    resolvedInvocation.command,
    resolvedInvocation.args,
    {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...options.env },
      encoding: options.capture ? "utf8" : undefined,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    },
  );

  if (result.error && !options.allowFailure) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0 && !options.allowFailure) {
    const details = options.capture
      ? `\n${result.stderr || result.stdout || ""}`
      : "";
    throw new Error(
      `Command failed (${result.status ?? "spawn"}): ${display}${details}`,
    );
  }

  return result;
}

export function gitSha() {
  const result = run("git", ["rev-parse", "HEAD"], {
    capture: true,
    quiet: true,
    allowFailure: true,
  });
  return result.status === 0
    ? result.stdout.trim()
    : (process.env.GITHUB_SHA ?? "unknown");
}

export function composeProjectName() {
  return `wmatch-${validationResourceSuffix()}`;
}

export function validationResourceSuffix() {
  const sha =
    gitSha()
      .slice(0, 12)
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase() || "local";
  return explicitRunScope ? `${sha}-${explicitRunScope}` : sha;
}

export function composeArgs(extra = []) {
  return [
    "compose",
    "--file",
    composeFile,
    "--env-file",
    composeEnvFile,
    ...extra,
  ];
}

export function composeEnvironment(overrides = {}) {
  return {
    COMPOSE_PROJECT_NAME: composeProjectName(),
    WMATCH_GIT_SHA: gitSha(),
    WMATCH_TOOLING_IMAGE: `wmatch-tooling:${gitSha().slice(0, 12) || "local"}`,
    ...overrides,
  };
}

function isProcessRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function acquireValidationLock() {
  if (explicitRunScope) {
    return () => {};
  }

  const lockDirectory = resolve(tmpdir(), "wmatch-docker-locks");
  mkdirSync(lockDirectory, { recursive: true });
  const lockPath = resolve(lockDirectory, `${validationResourceSuffix()}.lock`);
  let descriptor;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      let owner = null;
      try {
        owner = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch {
        // A malformed lock is stale and safe to replace.
      }
      if (isProcessRunning(Number(owner?.pid))) {
        throw new Error(
          `Another WMatch Docker validation is already active (pid ${owner.pid}).`,
        );
      }
      rmSync(lockPath, { force: true });
    }
  }

  if (descriptor === undefined) {
    throw new Error(
      `Unable to acquire WMatch Docker validation lock: ${lockPath}`,
    );
  }

  const lockRecord = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  writeFileSync(descriptor, lockRecord, { encoding: "utf8" });
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    closeSync(descriptor);
    try {
      if (readFileSync(lockPath, "utf8") === lockRecord) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      // A missing/replaced lock must not make resource cleanup fail.
    }
  };
}

function supabaseArgs(workdir, args) {
  return ["--no-install", "supabase", "--workdir", workdir, ...args];
}

export function isSupabaseRunning(workdir) {
  const result = run(
    "npx",
    supabaseArgs(workdir, ["status", "--output", "json"]),
    {
      capture: true,
      quiet: true,
      allowFailure: true,
    },
  );
  return result.status === 0;
}

export function startSupabaseIfNeeded(workdir) {
  if (isSupabaseRunning(workdir)) {
    process.stdout.write(
      "Supabase local stack was already running; it will be preserved.\n",
    );
    return false;
  }

  run(
    "npx",
    supabaseArgs(workdir, [
      "start",
      "--exclude",
      "analytics,imgproxy,studio,vector,functions,edge-runtime,inbucket,meta",
      "--yes",
    ]),
  );
  return true;
}

export function startSupabaseDatabaseIfNeeded(context) {
  const containerName = `supabase_db_${context.projectId}`;
  const existing = run(
    "docker",
    ["inspect", "--format={{.State.Running}}", containerName],
    {
      capture: true,
      quiet: true,
      allowFailure: true,
    },
  );
  if (existing.status === 0 && existing.stdout.trim() === "true") {
    process.stdout.write(
      "Supabase local database was already running; it will be preserved.\n",
    );
    return false;
  }
  runSupabase(context.root, ["db", "start"]);
  return true;
}

function listDockerResourceIds(resource, projectId) {
  const args =
    resource === "container"
      ? [
          "ps",
          "--all",
          "--quiet",
          "--filter",
          `label=com.supabase.cli.project=${projectId}`,
        ]
      : [
          resource,
          "ls",
          "--quiet",
          "--filter",
          `label=com.supabase.cli.project=${projectId}`,
        ];
  const result = run("docker", args, {
    capture: true,
    quiet: true,
    allowFailure: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `Unable to inspect Supabase ${resource} resources for ${projectId}.`,
    );
  }
  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function assertOwnedSupabaseContext(context) {
  const allowedRoot = resolve(tmpdir(), "wmatch-docker-supabase");
  const rootIsOwned =
    context?.root?.startsWith(`${allowedRoot}\\`) ||
    context?.root?.startsWith(`${allowedRoot}/`);
  if (
    !rootIsOwned ||
    !/^wmatch_docker_[a-z0-9_]+$/.test(context?.projectId ?? "")
  ) {
    throw new Error(
      `Refusing to manage non-WMatch Supabase resources: ${context?.projectId ?? "unknown"}`,
    );
  }
}

export function ensureNoSupabaseResources(context) {
  assertOwnedSupabaseContext(context);
  const leftovers = {
    containers: listDockerResourceIds("container", context.projectId),
    networks: listDockerResourceIds("network", context.projectId),
    volumes: listDockerResourceIds("volume", context.projectId),
  };
  if (Object.values(leftovers).some((ids) => ids.length > 0)) {
    throw new Error(
      `Supabase cleanup left resources behind for ${context.projectId}: ${JSON.stringify(leftovers)}`,
    );
  }
}

export function cleanupOwnedSupabaseResources(context) {
  assertOwnedSupabaseContext(context);
  const containers = listDockerResourceIds("container", context.projectId);
  if (containers.length > 0) {
    run("docker", ["rm", "--force", ...containers]);
  }
  const networks = listDockerResourceIds("network", context.projectId);
  if (networks.length > 0) {
    run("docker", ["network", "rm", ...networks]);
  }
  const volumes = listDockerResourceIds("volume", context.projectId);
  if (volumes.length > 0) {
    run("docker", ["volume", "rm", "--force", ...volumes]);
  }
}

export function stopSupabaseIfOwned(startedByThisRun, context) {
  if (!startedByThisRun) {
    return;
  }
  const result = run(
    "npx",
    supabaseArgs(context.root, ["stop", "--no-backup"]),
    {
      allowFailure: true,
      capture: true,
    },
  );
  if (result.status !== 0) {
    process.stderr.write(
      result.stderr ||
        result.stdout ||
        "Supabase CLI stop failed; applying exact-label cleanup.\n",
    );
  }
  try {
    ensureNoSupabaseResources(context);
  } catch {
    cleanupOwnedSupabaseResources(context);
    ensureNoSupabaseResources(context);
  }
}

export function runSupabase(workdir, args, options = {}) {
  return run("npx", supabaseArgs(workdir, args), options);
}

function acquireFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error || !port) {
          reject(error ?? new Error("Unable to allocate a local test port."));
        } else {
          resolvePort(port);
        }
      });
    });
  });
}

export async function prepareIsolatedSupabase() {
  const { resourceSuffix, root, projectId } = isolatedSupabaseContext();
  const allowedRoot = resolve(tmpdir(), "wmatch-docker-supabase");
  if (
    !root.startsWith(`${allowedRoot}\\`) &&
    !root.startsWith(`${allowedRoot}/`)
  ) {
    throw new Error(`Unsafe isolated Supabase path: ${root}`);
  }
  cleanupOwnedSupabaseResources({ root, projectId });
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const source = resolve(repositoryRoot, "supabase");
  const destination = resolve(root, "supabase");
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => !path.replaceAll("\\", "/").includes("/.temp/"),
  });

  const [apiPort, dbPort, shadowPort] = await Promise.all([
    acquireFreePort(),
    acquireFreePort(),
    acquireFreePort(),
  ]);
  const configPath = resolve(destination, "config.toml");
  const updatedConfig = readFileSync(configPath, "utf8")
    .replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`)
    .replace(/(\[api\][\s\S]*?^port\s*=\s*)\d+/m, `$1${apiPort}`)
    .replace(/(\[db\][\s\S]*?^port\s*=\s*)\d+/m, `$1${dbPort}`)
    .replace(/(^shadow_port\s*=\s*)\d+/m, `$1${shadowPort}`);
  writeFileSync(configPath, updatedConfig, { encoding: "utf8", mode: 0o600 });

  return { root, apiPort, dbPort, shadowPort, projectId };
}

export function isolatedSupabaseContext() {
  const resourceSuffix = validationResourceSuffix();
  return {
    resourceSuffix,
    root: resolve(tmpdir(), "wmatch-docker-supabase", resourceSuffix),
    projectId: `wmatch_docker_${resourceSuffix.replaceAll("-", "_")}`,
  };
}

export function cleanupIsolatedSupabase(context) {
  if (!context) {
    return;
  }
  const allowedRoot = resolve(tmpdir(), "wmatch-docker-supabase");
  if (
    !context.root.startsWith(`${allowedRoot}\\`) &&
    !context.root.startsWith(`${allowedRoot}/`)
  ) {
    throw new Error(`Refusing to remove unsafe Supabase path: ${context.root}`);
  }
  rmSync(context.root, { recursive: true, force: true });
}

export function recordEvidence(profile, startedAt, status, details = {}) {
  const sha = gitSha();
  const relativeRoot = process.env.WMATCH_EVIDENCE_DIR ?? "tmp/docker-evidence";
  const evidenceDirectory = resolve(repositoryRoot, relativeRoot, sha);
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidence = {
    schemaVersion: 1,
    profile,
    commitSha: sha,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    ...details,
  };
  const path = resolve(evidenceDirectory, `${profile}.json`);
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  process.stdout.write(`Evidence: ${path}\n`);
}

export function normalizeSupabaseSchemaDiff(output) {
  const trimmed = String(output ?? "").trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && !Array.isArray(parsed) && typeof parsed.diff === "string") {
      return parsed.diff.trim();
    }
  } catch {
    // Older CLI releases return the SQL diff directly.
  }

  return trimmed;
}

export function ensureNoComposeResources() {
  const environment = composeEnvironment();
  const containers = run("docker", composeArgs(["ps", "--all", "--quiet"]), {
    capture: true,
    quiet: true,
    allowFailure: true,
    env: environment,
  });
  const networks = run(
    "docker",
    [
      "network",
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${environment.COMPOSE_PROJECT_NAME}`,
    ],
    { capture: true, quiet: true, allowFailure: true },
  );
  const volumes = run(
    "docker",
    [
      "volume",
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${environment.COMPOSE_PROJECT_NAME}`,
    ],
    { capture: true, quiet: true, allowFailure: true },
  );
  if ([containers, networks, volumes].some((result) => result.status !== 0)) {
    throw new Error(
      `Unable to verify Compose cleanup for ${environment.COMPOSE_PROJECT_NAME}.`,
    );
  }
  if ([containers, networks, volumes].some((result) => result.stdout.trim())) {
    throw new Error(
      `Compose cleanup left resources behind for ${environment.COMPOSE_PROJECT_NAME}.`,
    );
  }
}
