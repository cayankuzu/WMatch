import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const fail = (message) => {
  console.error(`Dependency audit failed: ${message}`);
  process.exit(1);
};

const auditProcess = process.platform === 'win32'
  ? spawnSync(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', 'npm audit --omit=dev --json'],
      { encoding: 'utf8' },
    )
  : spawnSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8' });

if (!auditProcess.stdout?.trim()) {
  fail(auditProcess.stderr?.trim() || 'npm audit did not return a report');
}

let report;
try {
  report = JSON.parse(auditProcess.stdout);
} catch {
  fail('npm audit returned invalid JSON');
}

const vulnerabilityMap = report.vulnerabilities ?? {};
const vulnerabilities = Object.values(vulnerabilityMap);
if (vulnerabilities.length === 0) {
  console.log('Dependency audit passed with no known production vulnerabilities.');
  process.exit(0);
}

// image-size has no patched npm release as of this contract. Expo/RN use it only
// through Metro while processing repository-controlled assets at build time.
// Keep this exception narrow and fail if the advisory identity or reachability changes.
const verifiedBuildOnlyAdvisories = new Map([
  [1138808, 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr'],
  [1138809, 'https://github.com/advisories/GHSA-5p2g-fcmc-qvqq'],
]);
const advisories = vulnerabilities.flatMap((vulnerability) =>
  (vulnerability.via ?? []).filter((entry) => entry && typeof entry === 'object'),
);
const unexpectedAdvisory = advisories.find((advisory) =>
  verifiedBuildOnlyAdvisories.get(advisory.source) !== advisory.url ||
  advisory.name !== 'image-size' ||
  advisory.dependency !== 'image-size',
);

if (unexpectedAdvisory || advisories.length !== verifiedBuildOnlyAdvisories.size) {
  fail('npm audit contains a vulnerability outside the verified Metro image parser exception');
}

const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const imageSizePackagePaths = Object.entries(lockfile.packages ?? {})
  .filter(([packagePath, metadata]) =>
    packagePath.endsWith('node_modules/image-size') && metadata?.version,
  )
  .map(([packagePath]) => packagePath);

if (imageSizePackagePaths.length !== 1 || imageSizePackagePaths[0] !== 'node_modules/image-size') {
  fail('image-size is not installed at the single verified Metro dependency path');
}

const imageSizeParents = Object.entries(lockfile.packages ?? {})
  .filter(([, metadata]) => metadata?.dependencies?.['image-size'])
  .map(([packagePath]) => packagePath);
if (imageSizeParents.length !== 1 || imageSizeParents[0] !== 'node_modules/metro') {
  fail(`image-size escaped the verified Metro-only dependency boundary: ${imageSizeParents.join(', ')}`);
}

const runtimeExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const inspectRuntimeDirectory = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      inspectRuntimeDirectory(entryPath);
    } else if (
      runtimeExtensions.has(extname(entry.name)) &&
      readFileSync(entryPath, 'utf8').includes('image-size')
    ) {
      fail(`runtime source imports the vulnerable build-only parser: ${entryPath}`);
    }
  }
};

for (const runtimeRoot of ['src', 'utils']) {
  inspectRuntimeDirectory(runtimeRoot);
}
for (const runtimeEntry of ['App.tsx', 'index.ts']) {
  if (readFileSync(runtimeEntry, 'utf8').includes('image-size')) {
    fail(`runtime source imports the vulnerable build-only parser: ${runtimeEntry}`);
  }
}

const traceAdvisorySources = (name, visiting = new Set()) => {
  if (visiting.has(name)) {
    return { sources: new Set(), missing: false };
  }

  const vulnerability = vulnerabilityMap[name];
  if (!vulnerability || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
    return { sources: new Set(), missing: true };
  }

  const nextVisiting = new Set(visiting).add(name);
  const result = { sources: new Set(), missing: false };
  for (const entry of vulnerability.via) {
    if (entry && typeof entry === 'object') {
      result.sources.add(entry.source);
      continue;
    }

    const nested = traceAdvisorySources(entry, nextVisiting);
    nested.sources.forEach((source) => result.sources.add(source));
    result.missing ||= nested.missing;
  }
  return result;
};

for (const name of Object.keys(vulnerabilityMap)) {
  const trace = traceAdvisorySources(name);
  if (
    trace.missing ||
    trace.sources.size === 0 ||
    [...trace.sources].some((source) => !verifiedBuildOnlyAdvisories.has(source))
  ) {
    fail(`npm audit contains an unverified vulnerability chain at ${name}`);
  }
}

console.log(
  'Dependency audit passed with a constrained Metro-only image-size exception; no runtime import or alternate dependency path exists.',
);
