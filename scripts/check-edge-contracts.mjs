import { readFileSync } from 'node:fs';

const fail = (message) => {
  console.error(`Edge contract check failed: ${message}`);
  process.exit(1);
};

const assertEqual = (actual, expected, label) => {
  if (actual !== expected) {
    fail(`${label} expected ${expected}, received ${actual ?? '<missing>'}`);
  }
};

const read = (file) => readFileSync(file, 'utf8');

const packageJson = JSON.parse(read('package.json'));
const appConfig = JSON.parse(read('app.json')).expo;
const buildGradle = read('android/app/build.gradle');
const edgeSource = read('supabase/functions/make-server-d962235e/index.ts');

const gradleVersionCode = buildGradle.match(/\bversionCode\s+(\d+)/)?.[1];
const gradleVersionName = buildGradle.match(/\bversionName\s+["']([^"']+)["']/)?.[1];
const edgeReleaseVersion = edgeSource.match(/RELEASE_VERSION\s*=\s*"([^"]+)"/)?.[1];
const requiredSchemaVersion = edgeSource.match(/REQUIRED_SCHEMA_VERSION\s*=\s*"([^"]+)"/)?.[1];
const routeCount = (edgeSource.match(/app\.(get|post|put|patch|delete)\(/g) ?? []).length;

assertEqual(appConfig?.version, packageJson.version, 'Expo version');
assertEqual(gradleVersionName, packageJson.version, 'Android Gradle versionName');
assertEqual(edgeReleaseVersion, packageJson.version, 'Edge release version');
assertEqual(String(appConfig?.android?.versionCode), gradleVersionCode, 'Android versionCode');
assertEqual(requiredSchemaVersion, '20260819190000', 'required schema version');

if (!appConfig?.ios?.buildNumber || !/^\d+$/.test(String(appConfig.ios.buildNumber))) {
  fail('iOS buildNumber must be numeric and present');
}

if (!edgeSource.includes('app.get("/make-server-d962235e/health"')) {
  fail('health route is missing');
}

for (const token of ['process_like_action_atomic', 'undo_like_action_atomic', 'consume_swipe_quota_atomic']) {
  if (!edgeSource.includes(token)) {
    fail(`atomic mutation contract is missing ${token}`);
  }
}

for (const token of ['schemaReady', 'requiredSchema', 'serverTime', 'release']) {
  if (!edgeSource.includes(token)) {
    fail(`health contract is missing ${token}`);
  }
}

if (/\.select\(\s*(["'`]\*["'`])?\s*\)/.test(edgeSource)) {
  fail('wildcard or empty Supabase select detected in Edge source');
}

if (routeCount < 30) {
  fail(`unexpectedly low Edge route count: ${routeCount}`);
}

console.log(`Edge contract check passed. version=${packageJson.version}, schema=${requiredSchemaVersion}, routes=${routeCount}`);
