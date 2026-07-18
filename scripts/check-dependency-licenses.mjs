import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const fail = (message) => {
  console.error(`Dependency license check failed: ${message}`);
  process.exit(1);
};

const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'FSL-1.1-MIT',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
]);

const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const violations = [];
let checkedPackages = 0;

const normalizeLicenseCandidates = (license) =>
  String(license)
    .replaceAll('(', '')
    .replaceAll(')', '')
    .split(/\s+OR\s+/i)
    .map((candidate) => candidate.trim())
    .filter(Boolean);

for (const [packagePath, metadata] of Object.entries(packageLock.packages ?? {})) {
  if (!packagePath || metadata?.link) {
    continue;
  }

  checkedPackages += 1;

  if (metadata?.resolved) {
    if (!String(metadata.resolved).startsWith('https://')) {
      violations.push(`${packagePath}: dependency source is not HTTPS`);
    }
    if (!metadata.integrity) {
      violations.push(`${packagePath}: dependency source has no lockfile integrity hash`);
    }
  }

  let license = metadata?.license;

  if (!license) {
    const packageJsonPath = join(packagePath, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      license = packageJson.license ?? packageJson.licenses?.[0]?.type;
    }
  }

  const candidates = normalizeLicenseCandidates(license ?? '');
  if (candidates.length === 0 || !candidates.some((candidate) => allowedLicenses.has(candidate))) {
    violations.push(`${packagePath}: unapproved or missing license ${license ?? '<missing>'}`);
  }
}

if (violations.length > 0) {
  fail(violations.slice(0, 20).join('; '));
}

console.log(`Dependency license check passed. packages=${checkedPackages}`);
