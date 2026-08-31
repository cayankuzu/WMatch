#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE_COMMIT = 'b8ff52ac41eda5f6ef1e43472784d794328f7050';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '..', '..');
const SNAPSHOT_RELATIVE_PATH = 'quality/feature-surface.snapshot.json';
const EXCLUDED_SURFACE_PRIMITIVES = new Set([
  'src/app/components/ui/AccessibleModal.tsx',
  'src/app/components/ui/AppModal.tsx',
  'src/app/components/ui/Screen.tsx',
]);
const ALLOWLISTABLE_SURFACES = new Set([
  'androidNativePermissions',
  'apiRoutes',
  'databaseTables',
  'deepLinkHosts',
  'deepLinkPaths',
  'deepLinkSchemes',
  'expoPermissions',
  'iosUsageDescriptionKeys',
  'nativeCapabilities',
  'publicApiContracts',
  'storageBuckets',
]);

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function sortedUnique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))].sort();
}

function readRequired(repositoryRoot, relativePath) {
  const absolutePath = resolve(repositoryRoot, relativePath);

  if (!existsSync(absolutePath)) {
    throw new Error(`required feature-surface source is missing: ${relativePath}`);
  }

  return readFileSync(absolutePath, 'utf8');
}

function listFiles(repositoryRoot, relativeDirectory, predicate = () => true) {
  const absoluteDirectory = resolve(repositoryRoot, relativeDirectory);

  if (!existsSync(absoluteDirectory)) {
    throw new Error(`required feature-surface directory is missing: ${relativeDirectory}`);
  }

  const results = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);

      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && predicate(absolutePath)) {
        results.push(normalizePath(relative(repositoryRoot, absolutePath)));
      }
    }
  };

  visit(absoluteDirectory);
  return results.sort();
}

function collectQuotedUnion(source, typeName) {
  const values = [];
  const typePattern = new RegExp(`(?:export\\s+)?type\\s+${typeName}\\s*=\\s*([^;]+);`, 'g');

  for (const typeMatch of source.matchAll(typePattern)) {
    for (const valueMatch of typeMatch[1].matchAll(/['\"]([^'\"]+)['\"]/g)) {
      values.push(valueMatch[1]);
    }
  }

  return sortedUnique(values);
}

function collectInterfaceFields(source, interfaceName) {
  const interfaceMatch = source.match(new RegExp(`export\\s+interface\\s+${interfaceName}\\s*\\{([^}]+)\\}`));

  if (!interfaceMatch) {
    return [];
  }

  return sortedUnique(
    [...interfaceMatch[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map((match) => match[1]),
  );
}

function collectSettingsKeys(componentSource, pattern) {
  return sortedUnique([...componentSource.matchAll(pattern)].map((match) => match[0]));
}

function collectAndroidPermissions(manifestSource) {
  const permissions = [];

  for (const match of manifestSource.matchAll(/<uses-permission\b([^>]+)>/g)) {
    const attributes = match[1];

    if (/tools:node=["']remove["']/.test(attributes)) {
      continue;
    }

    const name = attributes.match(/android:name=["']([^"']+)["']/)?.[1];

    if (!name) {
      continue;
    }

    const maxSdkVersion = attributes.match(/android:maxSdkVersion=["']([^"']+)["']/)?.[1];
    permissions.push(maxSdkVersion ? `${name}@maxSdkVersion=${maxSdkVersion}` : name);
  }

  return sortedUnique(permissions);
}

function collectDatabaseTables(repositoryRoot) {
  const generatedTypes = readRequired(repositoryRoot, 'supabase/types/database.generated.ts');
  const tablesBlock = generatedTypes.match(/\n\s{4}Tables:\s*\{([\s\S]*?)\n\s{4}Views:\s*\{/i)?.[1] ?? '';
  const tableNames = [...tablesBlock.matchAll(/^\s{6}([a-z][a-z0-9_]+):\s*\{/gm)].map((match) => match[1]);
  const migrationFiles = listFiles(repositoryRoot, 'supabase/migrations', (file) => file.endsWith('.sql'));

  for (const file of migrationFiles) {
    const migration = readRequired(repositoryRoot, file);

    for (const match of migration.matchAll(
      /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:public|storage)\.)?["']?([a-z][a-z0-9_]*)["']?/gim,
    )) {
      tableNames.push(match[1].toLowerCase());
    }
  }

  return sortedUnique(tableNames);
}

function collectApiRoutes(edgeSource) {
  return sortedUnique(
    [...edgeSource.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)].map(
      (match) => `${match[1].toUpperCase()} ${match[2]}`,
    ),
  );
}

function collectPublicApiContracts(supabaseClientSource, publicWebSource, tmdbSource) {
  const contracts = [];
  const supabaseOrigin = supabaseClientSource.match(/export const SUPABASE_URL\s*=\s*`([^`]+)`/)?.[1];
  const edgePath = supabaseClientSource.match(/export const API_BASE\s*=\s*`\$\{SUPABASE_URL\}([^`]+)`/)?.[1];
  const publicWeb = publicWebSource.match(/PUBLIC_WEB_BASE_URL\s*=\s*["']([^"']+)["']/)?.[1];
  const tmdbImages = tmdbSource.match(/IMAGE_BASE_URL\s*=\s*["']([^"']+)["']/)?.[1];

  if (supabaseOrigin) {
    contracts.push(
      `supabase-origin:${supabaseOrigin.replace('${projectId}', '{EXPO_PUBLIC_SUPABASE_PROJECT_ID}')}`,
    );
  }

  if (edgePath) {
    contracts.push(`edge-path:${edgePath}`);
  }

  if (publicWeb) {
    contracts.push(`public-web:${publicWeb}`);
  }

  if (tmdbImages) {
    contracts.push(`tmdb-images:${tmdbImages}`);
  }

  return sortedUnique(contracts);
}

function collectNativeCapabilities(appConfig) {
  const capabilities = [];
  const plugins = Array.isArray(appConfig.plugins) ? appConfig.plugins : [];

  if (appConfig.android?.predictiveBackGestureEnabled === true) {
    capabilities.push('android:predictive-back');
  }

  if (Array.isArray(appConfig.ios?.associatedDomains) && appConfig.ios.associatedDomains.length > 0) {
    capabilities.push('ios:associated-domains');
  }

  if (appConfig.ios?.supportsTablet === true) {
    capabilities.push('ios:supports-tablet');
  }

  for (const plugin of plugins) {
    const pluginName = typeof plugin === 'string' ? plugin : plugin?.[0];
    const pluginOptions = Array.isArray(plugin) ? plugin[1] : null;

    if (pluginName === 'expo-secure-store') {
      capabilities.push('secure-store');
    }

    if (pluginName === 'expo-notifications' && pluginOptions?.enableBackgroundRemoteNotifications === true) {
      capabilities.push('ios:background-remote-notifications');
    }
  }

  return sortedUnique(capabilities);
}

export function collectFeatureSurface(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const appJson = JSON.parse(readRequired(repositoryRoot, 'app.json'));
  const appConfig = appJson.expo ?? {};
  const sharedTypes = readRequired(repositoryRoot, 'src/shared/types/index.ts');
  const discoverySource = readRequired(repositoryRoot, 'src/shared/utils/discovery.ts');
  const appSource = readRequired(repositoryRoot, 'src/app/App.tsx');
  const translationSource = readRequired(repositoryRoot, 'src/shared/i18n/locales/tr.ts');
  const manifestSource = readRequired(repositoryRoot, 'android/app/src/main/AndroidManifest.xml');
  const supabaseClientSource = readRequired(repositoryRoot, 'utils/supabase/client.ts');
  const publicWebSource = readRequired(repositoryRoot, 'src/shared/config/publicWeb.ts');
  const tmdbSource = readRequired(repositoryRoot, 'src/services/tmdb.ts');
  const storageSource = readRequired(repositoryRoot, 'src/services/storage.ts');
  const componentFiles = listFiles(repositoryRoot, 'src/app/components', (file) => file.endsWith('.tsx'));
  const componentSource = componentFiles.map((file) => readRequired(repositoryRoot, file)).join('\n');
  const edgeFiles = listFiles(
    repositoryRoot,
    'supabase/functions/make-server-d962235e',
    (file) => file.endsWith('.ts') || file.endsWith('.tsx'),
  );
  const edgeSource = edgeFiles.map((file) => readRequired(repositoryRoot, file)).join('\n');
  const authRoutes = collectQuotedUnion(sharedTypes, 'AuthScreen');
  const tabs = collectQuotedUnion(sharedTypes, 'AppTab');
  const navigationRoutes = [
    ...authRoutes.map((route) => `auth:${route}`),
    ...tabs.map((route) => `tab:${route}`),
  ];

  if (appSource.includes('<PasswordRecoveryScreen')) {
    navigationRoutes.push('auth:password-recovery');
  }

  if (appSource.includes('<VerifyEmailScreen')) {
    navigationRoutes.push('auth:verify-email');
  }

  const deepLinkSchemes = [appConfig.scheme];
  const deepLinkHosts = [];
  const deepLinkPaths = [];

  for (const intentFilter of appConfig.android?.intentFilters ?? []) {
    for (const data of intentFilter.data ?? []) {
      deepLinkSchemes.push(data.scheme);
      deepLinkHosts.push(data.host);
      deepLinkPaths.push(data.pathPrefix);
    }
  }

  for (const associatedDomain of appConfig.ios?.associatedDomains ?? []) {
    const [, host] = String(associatedDomain).split(':', 2);
    deepLinkHosts.push(host);
  }

  for (const match of manifestSource.matchAll(/<data\b([^>]+)>/g)) {
    deepLinkSchemes.push(match[1].match(/android:scheme=["']([^"']+)["']/)?.[1]);
    deepLinkHosts.push(match[1].match(/android:host=["']([^"']+)["']/)?.[1]);
    deepLinkPaths.push(match[1].match(/android:pathPrefix=["']([^"']+)["']/)?.[1]);
  }

  const publicGenders = discoverySource.match(/PUBLIC_USER_GENDERS\s*=\s*\[([^\]]+)\]/)?.[1] ?? '';
  const discoveryGenderFilters = [
    'random',
    ...[...publicGenders.matchAll(/['\"]([^'\"]+)['\"]/g)].map((match) => match[1]),
  ];
  const storageBuckets = [
    ...storageSource.matchAll(/(?:^|\s)[A-Z][A-Z0-9_]*_BUCKET\s*=\s*["']([^"']+)["']/gm),
    ...edgeSource.matchAll(/(?:^|\s)[A-Z][A-Z0-9_]*_BUCKET\s*=\s*["']([^"']+)["']/gm),
  ].map((match) => match[1]);

  return {
    authRoutes,
    tabs,
    navigationRoutes: sortedUnique(navigationRoutes),
    screenEntrypoints: componentFiles.filter(
      (file) => file.endsWith('Screen.tsx') && !EXCLUDED_SURFACE_PRIMITIVES.has(file),
    ),
    modalEntrypoints: componentFiles.filter(
      (file) => file.endsWith('Modal.tsx') && !EXCLUDED_SURFACE_PRIMITIVES.has(file),
    ),
    sheetEntrypoints: componentFiles.filter((file) => file.endsWith('Sheet.tsx')),
    chatFilterTypes: collectQuotedUnion(sharedTypes, 'FilterType'),
    discoveryFilterFields: collectInterfaceFields(discoverySource, 'DiscoveryPreferences'),
    discoveryGenderFilters: sortedUnique(discoveryGenderFilters),
    notificationTypes: collectQuotedUnion(edgeSource, 'NotificationEventKind'),
    notificationRouteKinds: collectQuotedUnion(edgeSource, 'NotificationRouteKind'),
    settingsGroupKeys: collectSettingsKeys(componentSource, /settings\.group\.[A-Za-z0-9]+/g),
    visibleSettingsCtaKeys: collectSettingsKeys(
      componentSource,
      /settings\.(?:row\.[A-Za-z0-9]+\.title|about\.legal\.(?:privacy|terms)|about\.tmdb\.link)/g,
    ),
    settingsToggleKeys: collectSettingsKeys(componentSource, /settings\.toggle\.[A-Za-z0-9]+\.title/g),
    translationNamespaces: sortedUnique(
      [...translationSource.matchAll(/'([A-Za-z0-9_-]+)\.[^']+'\s*:/g)].map((match) => match[1]),
    ),
    expoPermissions: sortedUnique(appConfig.android?.permissions ?? []),
    androidNativePermissions: collectAndroidPermissions(manifestSource),
    iosUsageDescriptionKeys: sortedUnique(
      Object.keys(appConfig.ios?.infoPlist ?? {}).filter((key) => key.endsWith('UsageDescription')),
    ),
    deepLinkSchemes: sortedUnique(deepLinkSchemes),
    deepLinkHosts: sortedUnique(deepLinkHosts),
    deepLinkPaths: sortedUnique(deepLinkPaths),
    nativeCapabilities: collectNativeCapabilities(appConfig),
    publicApiContracts: collectPublicApiContracts(
      supabaseClientSource,
      publicWebSource,
      tmdbSource,
    ),
    apiRoutes: collectApiRoutes(edgeSource),
    databaseTables: collectDatabaseTables(repositoryRoot),
    storageBuckets: sortedUnique(storageBuckets),
  };
}

function validateAllowlistEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`allowlist entry ${index} must be an object`);
  }

  if (!ALLOWLISTABLE_SURFACES.has(entry.surface)) {
    throw new Error(`allowlist entry ${index} cannot target product surface ${entry.surface ?? '<missing>'}`);
  }

  if (!['add', 'remove'].includes(entry.change) || typeof entry.value !== 'string' || !entry.value) {
    throw new Error(`allowlist entry ${index} must define change=add|remove and a non-empty value`);
  }

  if (entry.classification !== 'internal-security-ops') {
    throw new Error(`allowlist entry ${index} must be classified as internal-security-ops`);
  }

  if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
    throw new Error(`allowlist entry ${index} needs a concrete reason of at least 20 characters`);
  }

  if (typeof entry.existingFlow !== 'string' || entry.existingFlow.trim().length < 3) {
    throw new Error(`allowlist entry ${index} must name the existing flow it hardens`);
  }

  if (!Array.isArray(entry.paths) || entry.paths.length === 0 || entry.paths.some((path) => typeof path !== 'string')) {
    throw new Error(`allowlist entry ${index} must list the implementation paths`);
  }
}

export function validateSnapshot(snapshot) {
  if (snapshot?.schemaVersion !== 1) {
    throw new Error('feature-surface snapshot schemaVersion must be 1');
  }

  if (snapshot?.baseline?.commit !== BASELINE_COMMIT) {
    throw new Error(`feature-surface baseline commit must remain ${BASELINE_COMMIT}`);
  }

  if (!snapshot.surface || typeof snapshot.surface !== 'object') {
    throw new Error('feature-surface snapshot is missing surface');
  }

  for (const [name, values] of Object.entries(snapshot.surface)) {
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
      throw new Error(`feature-surface field ${name} must be a string array`);
    }

    const normalized = sortedUnique(values);

    if (JSON.stringify(values) !== JSON.stringify(normalized)) {
      throw new Error(`feature-surface field ${name} must be sorted and duplicate-free`);
    }
  }

  if (!Array.isArray(snapshot.allowlistedInfrastructureChanges)) {
    throw new Error('allowlistedInfrastructureChanges must be an array');
  }

  snapshot.allowlistedInfrastructureChanges.forEach(validateAllowlistEntry);
}

function buildAllowedChanges(snapshot) {
  return new Set(
    snapshot.allowlistedInfrastructureChanges.map(
      (entry) => `${entry.surface}\u0000${entry.change}\u0000${entry.value}`,
    ),
  );
}

export function compareFeatureSurfaces(snapshot, currentSurface) {
  validateSnapshot(snapshot);
  const errors = [];
  const allowedChanges = buildAllowedChanges(snapshot);

  for (const [surfaceName, baselineValues] of Object.entries(snapshot.surface)) {
    const currentValues = currentSurface[surfaceName];

    if (!Array.isArray(currentValues)) {
      errors.push(`collector did not produce ${surfaceName}`);
      continue;
    }

    const baselineSet = new Set(baselineValues);
    const currentSet = new Set(currentValues);

    for (const value of currentValues) {
      if (!baselineSet.has(value) && !allowedChanges.has(`${surfaceName}\u0000add\u0000${value}`)) {
        errors.push(`new ${surfaceName}: ${value}`);
      }
    }

    for (const value of baselineValues) {
      if (!currentSet.has(value) && !allowedChanges.has(`${surfaceName}\u0000remove\u0000${value}`)) {
        errors.push(`removed ${surfaceName}: ${value}`);
      }
    }
  }

  for (const surfaceName of Object.keys(currentSurface)) {
    if (!(surfaceName in snapshot.surface)) {
      errors.push(`snapshot does not govern collected surface ${surfaceName}`);
    }
  }

  return errors.sort();
}

export function loadSnapshot(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  return JSON.parse(readRequired(repositoryRoot, SNAPSHOT_RELATIVE_PATH));
}

export function runGuard(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const snapshot = loadSnapshot(repositoryRoot);
  const currentSurface = collectFeatureSurface(repositoryRoot);
  const errors = compareFeatureSurfaces(snapshot, currentSurface);

  if (errors.length > 0) {
    throw new Error(
      [
        'Feature-freeze guard failed.',
        ...errors.map((error) => `- ${error}`),
        'Do not add product surface. Internal security/ops changes require a narrow, reviewed allowlist entry.',
      ].join('\n'),
    );
  }

  return {
    baselineCommit: snapshot.baseline.commit,
    tabs: currentSurface.tabs.length,
    screens: currentSurface.screenEntrypoints.length,
    modals: currentSurface.modalEntrypoints.length,
    sheets: currentSurface.sheetEntrypoints.length,
    apiRoutes: currentSurface.apiRoutes.length,
    databaseTables: currentSurface.databaseTables.length,
  };
}

const invokedAsCli = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;

if (invokedAsCli) {
  try {
    const result = runGuard();
    console.log(
      `Feature-freeze guard passed. baseline=${result.baselineCommit} tabs=${result.tabs} screens=${result.screens} modals=${result.modals} sheets=${result.sheets} apiRoutes=${result.apiRoutes} databaseTables=${result.databaseTables}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
