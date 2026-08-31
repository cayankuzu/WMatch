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
let runtimeConsoleCalls = 0;
let runtimeExplicitAny = 0;
let edgeExplicitAny = 0;
const LEGACY_COMPONENT_LINE_BUDGETS = new Map([
  ['src/app/components/ChatModal.tsx', 1020],
  ['src/app/components/ChatScreen.tsx', 900],
]);
const LEGACY_SOURCE_LINE_BUDGETS = new Map([
  ['src/services/api.ts', 1060],
  ['src/context/AuthContext.tsx', 800],
  ['src/context/AppContext.tsx', 875],
]);
const EDGE_SOURCE_BUDGETS = new Map([
  ['supabase/functions/make-server-d962235e/index.ts', { lines: 40, routes: 0 }],
  ['supabase/functions/make-server-d962235e/routeRegistry.ts', { lines: 100, routes: 0 }],
  ['supabase/functions/make-server-d962235e/runtime.ts', { lines: 3750, routes: 0 }],
  ['supabase/functions/make-server-d962235e/sharedMiddleware.ts', { lines: 180, routes: 0 }],
  ['supabase/functions/make-server-d962235e/domains/auth.ts', { lines: 330, routes: 5 }],
  ['supabase/functions/make-server-d962235e/domains/chat.ts', { lines: 830, routes: 8 }],
  ['supabase/functions/make-server-d962235e/domains/match.ts', { lines: 320, routes: 5 }],
  ['supabase/functions/make-server-d962235e/domains/moderation.ts', { lines: 430, routes: 1 }],
  ['supabase/functions/make-server-d962235e/domains/notification.ts', { lines: 230, routes: 4 }],
  ['supabase/functions/make-server-d962235e/domains/profileDiscovery.ts', { lines: 1100, routes: 6 }],
  ['supabase/functions/make-server-d962235e/domains/storage.ts', { lines: 700, routes: 0 }],
  ['supabase/functions/make-server-d962235e/domains/swipe.ts', { lines: 720, routes: 9 }],
  ['supabase/functions/make-server-d962235e/domains/system.ts', { lines: 80, routes: 1 }],
  ['supabase/functions/make-server-d962235e/domains/tmdb.ts', { lines: 260, routes: 2 }],
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

  const sourceLineBudget = LEGACY_SOURCE_LINE_BUDGETS.get(file);
  if (sourceLineBudget && source.split(/\r?\n/).length > sourceLineBudget) {
    oversizedFiles.push(`${file} (${source.split(/\r?\n/).length}/${sourceLineBudget})`);
  }

  const edgeBudget = EDGE_SOURCE_BUDGETS.get(file);
  if (edgeBudget) {
    const lineCount = source.split(/\r?\n/).length;
    const routeCount = (source.match(/\bapp\.(get|post|put|patch|delete)\s*\(/g) ?? []).length;

    if (lineCount > edgeBudget.lines) {
      oversizedFiles.push(`${file} (${lineCount}/${edgeBudget.lines})`);
    }

    if (routeCount > edgeBudget.routes) {
      oversizedFiles.push(`${file} route complexity (${routeCount}/${edgeBudget.routes})`);
    }
  }

  const fileConsoleCalls = (source.match(/\bconsole\.(log|debug|info|warn|error)\s*\(/g) ?? []).length;
  const fileExplicitAny = (source.match(/\bany\b/g) ?? []).length;
  consoleCalls += fileConsoleCalls;
  explicitAny += fileExplicitAny;

  if (/^(src|utils)\//.test(file)) {
    runtimeConsoleCalls += fileConsoleCalls;
    runtimeExplicitAny += fileExplicitAny;
  }

  if (file.startsWith('supabase/functions/make-server-d962235e/')) {
    edgeExplicitAny += fileExplicitAny;
  }
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

if (runtimeExplicitAny > 0) {
  fail(`runtime explicit any usage is forbidden: ${runtimeExplicitAny}`);
}

if (runtimeConsoleCalls > 64) {
  fail(`runtime console calls exceeded the shrinking legacy budget: ${runtimeConsoleCalls}/64`);
}

if (edgeExplicitAny > 2) {
  fail(`Edge explicit any usage exceeded the centralized schema boundary: ${edgeExplicitAny}/2`);
}

const babelConfig = readFileSync('babel.config.js', 'utf8');
if (!babelConfig.includes('transform-remove-console') || !babelConfig.includes("NODE_ENV === 'production'")) {
  fail('production console stripping is not configured');
}

console.log(`Source quality check passed. rawModalImports=${rawModalImports}, rawExpoImageImports=${rawExpoImageImports}, consoleCalls=${consoleCalls}, runtimeConsoleCalls=${runtimeConsoleCalls}, explicitAny=${explicitAny}, runtimeExplicitAny=${runtimeExplicitAny}`);
