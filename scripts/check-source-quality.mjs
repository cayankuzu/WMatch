import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const fail = (message) => {
  console.error(`Source quality check failed: ${message}`);
  process.exit(1);
};

const trackedFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'));

const sourceFiles = trackedFiles.filter((file) =>
  /^(src|utils|supabase\/functions|scripts|tests)\//.test(file) &&
  /\.(ts|tsx|js|mjs)$/.test(file) &&
  existsSync(file) &&
  statSync(file).size < 1_000_000
);

const focusedTestPattern = /\b(describe|it|test)\.only\s*\(/;
const skippedTestPattern = /\b(describe|it|test)\.skip\s*\(/;
const focusedTests = [];
const skippedTests = [];
const unfinishedMarkers = [];
const debugConsoleCalls = [];
let rawModalImports = 0;
let consoleCalls = 0;
let explicitAny = 0;

for (const file of sourceFiles) {
  const source = readFileSync(file, 'utf8');

  if (focusedTestPattern.test(source)) {
    focusedTests.push(file);
  }

  if (skippedTestPattern.test(source)) {
    skippedTests.push(file);
  }

  if (file !== 'scripts/check-source-quality.mjs' && /\b(TODO|FIXME|HACK)\b/i.test(source)) {
    unfinishedMarkers.push(file);
  }

  if (/\bconsole\.debug\s*\(/.test(source)) {
    debugConsoleCalls.push(file);
  }

  if (/^src\/app\/components\/(?!ui\/AppModal\.tsx).+\.tsx$/.test(file)) {
    rawModalImports += (source.match(/import\s*{[^}]*\bModal\b[^}]*}\s*from\s*['"]react-native['"]/g) ?? []).length;
  }

  consoleCalls += (source.match(/\bconsole\.(log|debug|info|warn|error)\s*\(/g) ?? []).length;
  explicitAny += (source.match(/\bany\b/g) ?? []).length;
}

if (focusedTests.length > 0) {
  fail(`focused tests are committed: ${focusedTests.join(', ')}`);
}

if (skippedTests.length > 0) {
  fail(`skipped tests are committed: ${skippedTests.join(', ')}`);
}

if (unfinishedMarkers.length > 0) {
  fail(`unfinished implementation markers are committed: ${unfinishedMarkers.join(', ')}`);
}

if (debugConsoleCalls.length > 0) {
  fail(`debug console calls are committed: ${debugConsoleCalls.join(', ')}`);
}

if (rawModalImports > 1) {
  fail(`raw React Native Modal imports exceeded the primitive budget: ${rawModalImports}/1`);
}

console.log(`Source quality check passed. rawModalImports=${rawModalImports}, consoleCalls=${consoleCalls}, explicitAny=${explicitAny}`);
