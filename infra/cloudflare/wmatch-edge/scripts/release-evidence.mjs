import { readFileSync } from "node:fs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;

function fail(message) {
  process.stderr.write(`release-evidence: ${message}\n`);
  process.exit(1);
}

function readJson(path) {
  const text = readFileSync(path, "utf8");
  if (text.length > 5_000_000) {
    fail("evidence JSON exceeds 5 MB");
  }

  try {
    return JSON.parse(text);
  } catch {
    fail(`cannot parse ${path} as JSON`);
  }
}

function requireUuid(value, label) {
  if (!UUID.test(value ?? "")) {
    fail(`${label} is not a Worker version UUID`);
  }
  return value;
}

function versionTag(version) {
  return version?.annotations?.["workers/tag"];
}

function commandResolveTag(path, expectedTag) {
  if (!SHA.test(expectedTag ?? "")) {
    fail("expected tag must be a full commit SHA");
  }
  const versions = readJson(path);
  if (!Array.isArray(versions)) {
    fail("versions list must be a JSON array");
  }

  const matches = versions.filter((version) => versionTag(version) === expectedTag);
  if (matches.length !== 1) {
    fail(`expected exactly one version tagged ${expectedTag}, found ${matches.length}`);
  }
  process.stdout.write(`${requireUuid(matches[0]?.id, "resolved version id")}\n`);
}

function commandFindTag(path, expectedTag) {
  if (!SHA.test(expectedTag ?? "")) {
    fail("expected tag must be a full commit SHA");
  }
  const versions = readJson(path);
  if (!Array.isArray(versions)) {
    fail("versions list must be a JSON array");
  }
  const matches = versions.filter((version) => versionTag(version) === expectedTag);
  if (matches.length > 1) {
    fail(`tag ${expectedTag} is ambiguous across ${matches.length} versions`);
  }
  if (matches.length === 1) {
    process.stdout.write(`${requireUuid(matches[0]?.id, "resolved version id")}\n`);
  }
}

function commandAssertVersion(path, expectedId, expectedTag) {
  requireUuid(expectedId, "expected version id");
  if (expectedTag && !SHA.test(expectedTag)) {
    fail("expected version tag must be a full commit SHA");
  }

  const version = readJson(path);
  if (version?.id !== expectedId) {
    fail(`version evidence id does not match ${expectedId}`);
  }
  if (expectedTag && versionTag(version) !== expectedTag) {
    fail(`version ${expectedId} is not tagged ${expectedTag}`);
  }
}

function deploymentVersions(path) {
  const deployment = readJson(path);
  if (!Array.isArray(deployment?.versions) || deployment.versions.length === 0) {
    fail("deployment evidence has no versions");
  }

  return deployment.versions.map((entry) => ({
    id: requireUuid(entry?.version_id, "deployment version id"),
    percentage: Number(entry?.percentage),
  }));
}

function assertTraffic(actual, expected) {
  if (actual.length !== expected.size) {
    fail(`deployment has ${actual.length} versions; expected ${expected.size}`);
  }

  for (const entry of actual) {
    const expectedPercentage = expected.get(entry.id);
    if (
      expectedPercentage === undefined ||
      !Number.isFinite(entry.percentage) ||
      Math.abs(entry.percentage - expectedPercentage) > 0.001
    ) {
      fail(`unexpected traffic allocation for ${entry.id}: ${entry.percentage}`);
    }
  }
}

function expectedTraffic(baselineId, targetId, percentage) {
  requireUuid(targetId, "target version id");
  if (percentage === 100) {
    return new Map([[targetId, 100]]);
  }
  requireUuid(baselineId, "baseline version id");
  if (baselineId === targetId) {
    fail("baseline and target version ids must differ");
  }
  return new Map([
    [baselineId, 100 - percentage],
    [targetId, percentage],
  ]);
}

function commandAssertDeployment(path, baselineId, targetId, rawPercentage) {
  const percentage = Number(rawPercentage);
  if (![5, 25, 50, 100].includes(percentage)) {
    fail("rollout percentage must be 5, 25, 50, or 100");
  }
  assertTraffic(deploymentVersions(path), expectedTraffic(baselineId, targetId, percentage));
}

function commandAssertPrevious(path, baselineId, targetId, rawNextPercentage) {
  const nextPercentage = Number(rawNextPercentage);
  const previousByNext = new Map([
    [5, 0],
    [25, 5],
    [50, 25],
    [100, 50],
  ]);
  const previousPercentage = previousByNext.get(nextPercentage);
  if (previousPercentage === undefined) {
    fail("next rollout percentage must be 5, 25, 50, or 100");
  }

  const expected =
    previousPercentage === 0
      ? new Map([[requireUuid(baselineId, "baseline version id"), 100]])
      : expectedTraffic(baselineId, targetId, previousPercentage);
  assertTraffic(deploymentVersions(path), expected);
}

function commandAssertRollback(path, baselineId) {
  assertTraffic(
    deploymentVersions(path),
    new Map([[requireUuid(baselineId, "baseline version id"), 100]]),
  );
}

function commandPrimary(path) {
  const versions = deploymentVersions(path).sort((left, right) => right.percentage - left.percentage);
  const primary = versions[0];
  if (!primary) {
    fail("deployment has no primary version");
  }
  process.stdout.write(`${primary.id}\n`);
}

function collectNames(value, names = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectNames(entry, names));
  } else if (value && typeof value === "object") {
    if (typeof value.name === "string") {
      names.add(value.name);
    }
    Object.values(value).forEach((entry) => collectNames(entry, names));
  }
  return names;
}

function commandAssertSecrets(path) {
  const names = collectNames(readJson(path));
  const required = [
    "ORIGIN_ANON_JWT",
    "ORIGIN_API_KEY",
    "ORIGIN_HMAC_SECRET",
    "RATE_LIMIT_HASH_SECRET",
  ];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length > 0) {
    fail(`missing deployed Worker secrets: ${missing.join(", ")}`);
  }
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "assert-deployment":
    commandAssertDeployment(...args);
    break;
  case "assert-previous":
    commandAssertPrevious(...args);
    break;
  case "assert-rollback":
    commandAssertRollback(...args);
    break;
  case "assert-secrets":
    commandAssertSecrets(...args);
    break;
  case "assert-version":
    commandAssertVersion(...args);
    break;
  case "find-tag":
    commandFindTag(...args);
    break;
  case "primary":
    commandPrimary(...args);
    break;
  case "resolve-tag":
    commandResolveTag(...args);
    break;
  default:
    fail(`unknown command: ${command ?? "<missing>"}`);
}
