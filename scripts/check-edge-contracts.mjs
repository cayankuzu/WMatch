import { readdirSync, readFileSync, statSync } from 'node:fs';

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

const listSourceFiles = (path) => {
  if (statSync(path).isFile()) {
    return /\.tsx?$/.test(path) ? [path] : [];
  }

  return readdirSync(path)
    .flatMap((entry) => listSourceFiles(`${path}/${entry}`))
    .sort();
};

const packageJson = JSON.parse(read('package.json'));
const appConfig = JSON.parse(read('app.json')).expo;
const buildGradle = read('android/app/build.gradle');
const edgeRoot = 'supabase/functions/make-server-d962235e';
const edgeFiles = listSourceFiles(edgeRoot);
const edgeSource = edgeFiles.map(read).join('\n');
const edgeEntrypoint = read(`${edgeRoot}/index.ts`);
const routeSnapshot = JSON.parse(read('quality/edge-route-contract.snapshot.json'));

const gradleVersionCode = buildGradle.match(/\bversionCode\s+(\d+)/)?.[1];
const gradleVersionName = buildGradle.match(/\bversionName\s+["']([^"']+)["']/)?.[1];
const edgeReleaseVersion = edgeSource.match(/RELEASE_VERSION\s*=\s*"([^"]+)"/)?.[1];
const requiredSchemaVersion = edgeSource.match(/REQUIRED_SCHEMA_VERSION\s*=\s*"([^"]+)"/)?.[1];
const registeredRoutes = [...edgeSource.matchAll(
  /\bapp\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g,
)].map((match) => ({
  method: match[1].toUpperCase(),
  path: match[2],
}));
const routeKeys = registeredRoutes.map((route) => `${route.method} ${route.path}`).sort();
const registryRouteKeys = [...edgeSource.matchAll(
  /\{\s*method:\s*["'](GET|POST|PUT|PATCH|DELETE)["'],\s*path:\s*["']([^"']+)["'],\s*domain:\s*["'][^"']+["']\s*,?\s*\}/g,
)].map((match) => `${match[1]} ${match[2]}`).sort();
const snapshotRouteKeys = routeSnapshot.routes
  .map((route) => `${route.method} ${route.path}`)
  .sort();
const routeCount = registeredRoutes.length;

assertEqual(appConfig?.version, packageJson.version, 'Expo version');
assertEqual(gradleVersionName, packageJson.version, 'Android Gradle versionName');
assertEqual(edgeReleaseVersion, packageJson.version, 'Edge release version');
assertEqual(String(appConfig?.android?.versionCode), gradleVersionCode, 'Android versionCode');
assertEqual(requiredSchemaVersion, '20260830120000', 'required schema version');

if (!appConfig?.ios?.buildNumber || !/^\d+$/.test(String(appConfig.ios.buildNumber))) {
  fail('iOS buildNumber must be numeric and present');
}

if (!edgeSource.includes('app.get("/make-server-d962235e/health"')) {
  fail('health route is missing');
}

for (const domainFile of [
  'auth.ts',
  'profileDiscovery.ts',
  'swipe.ts',
  'match.ts',
  'chat.ts',
  'notification.ts',
  'moderation.ts',
  'storage.ts',
  'tmdb.ts',
]) {
  if (!edgeFiles.includes(`${edgeRoot}/domains/${domainFile}`)) {
    fail(`required Edge domain module is missing: ${domainFile}`);
  }
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

for (const token of [
  'REQUIRE_CLOUDFLARE_ORIGIN_HMAC',
  'createOriginHmacMiddleware',
  'claim_edge_origin_hmac_nonce',
]) {
  if (!edgeSource.includes(token)) {
    fail(`origin HMAC contract is missing ${token}`);
  }
}

if (/\.select\(\s*(["'`]\*["'`])?\s*\)/.test(edgeSource)) {
  fail('wildcard or empty Supabase select detected in Edge source');
}

assertEqual(routeSnapshot.schemaVersion, 1, 'route snapshot schema version');
assertEqual(routeSnapshot.routeCount, 41, 'route snapshot count');
assertEqual(routeCount, 41, 'registered Edge route count');

if (new Set(routeKeys).size !== routeKeys.length) {
  fail('duplicate Edge route registration detected');
}

if (JSON.stringify(routeKeys) !== JSON.stringify(snapshotRouteKeys)) {
  fail('registered Edge routes do not match quality/edge-route-contract.snapshot.json');
}

if (JSON.stringify(registryRouteKeys) !== JSON.stringify(snapshotRouteKeys)) {
  fail('machine-readable Edge route registry does not match the route contract snapshot');
}

const serveCount = (edgeSource.match(/\bDeno\.serve\s*\(/g) ?? []).length;
assertEqual(serveCount, 1, 'Deno.serve entrypoint count');

if (!edgeEntrypoint.includes('Deno.serve(app.fetch)')) {
  fail('single deploy entrypoint is missing Deno.serve(app.fetch)');
}

console.log(`Edge contract check passed. version=${packageJson.version}, schema=${requiredSchemaVersion}, routes=${routeCount}`);
