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
const oversizedFiles = [];
const tinyTypography = [];
let rawModalImports = 0;
let rawExpoImageImports = 0;
let consoleCalls = 0;
let explicitAny = 0;
const LEGACY_COMPONENT_LINE_BUDGETS = new Map([
  ['src/app/components/ChatModal.tsx', 1675],
  ['src/app/components/SignUpScreen.tsx', 1145],
  ['src/app/components/ChatScreen.tsx', 1045],
  ['src/app/components/ProfileCard.tsx', 965],
]);

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

  if (/^src\/app\/components\/.+\.tsx$/.test(file)) {
    const lineCount = source.split(/\r?\n/).length;
    const lineBudget = LEGACY_COMPONENT_LINE_BUDGETS.get(file) ?? 900;

    if (lineCount > lineBudget) {
      oversizedFiles.push(`${file} (${lineCount}/${lineBudget})`);
    }

    if (/fontSize:\s*(?:[0-9]|10|11)(?:\D|$)|letterSpacing:\s*-/.test(source)) {
      tinyTypography.push(file);
    }

    rawExpoImageImports += (source.match(/import\s*{\s*Image\s*}\s*from\s*['"]expo-image['"]/g) ?? []).length;
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

if (oversizedFiles.length > 0) {
  fail(`component line budgets exceeded: ${oversizedFiles.join(', ')}`);
}

if (tinyTypography.length > 0) {
  fail(`tiny or negatively tracked typography found: ${tinyTypography.join(', ')}`);
}

if (rawExpoImageImports > 2) {
  fail(`raw expo-image imports exceeded the branding-only budget: ${rawExpoImageImports}/2`);
}

if (rawModalImports > 1) {
  fail(`raw React Native Modal imports exceeded the primitive budget: ${rawModalImports}/1`);
}

console.log(`Source quality check passed. rawModalImports=${rawModalImports}, rawExpoImageImports=${rawExpoImageImports}, consoleCalls=${consoleCalls}, explicitAny=${explicitAny}`);
