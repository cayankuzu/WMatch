import { existsSync, readFileSync } from 'node:fs';

const fail = (message) => {
  console.error(`Native config parity check failed: ${message}`);
  process.exit(1);
};

const expect = (condition, message) => {
  if (!condition) fail(message);
};

const app = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const eas = JSON.parse(readFileSync('eas.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const gradle = readFileSync('android/app/build.gradle', 'utf8');
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const strings = readFileSync('android/app/src/main/res/values/strings.xml', 'utf8');

const projectId = app?.extra?.eas?.projectId;
const expectedUpdateUrl = `https://u.expo.dev/${projectId}`;
const runtimeVersion = app?.runtimeVersion?.policy === 'appVersion'
  ? app.version
  : app?.runtimeVersion;
const androidScheme = Array.isArray(app.scheme) ? app.scheme[0] : app.scheme;
const manifestPermissionEntries = [...manifest.matchAll(/<uses-permission\b([^>]*)\/?\s*>/g)]
  .map((match) => ({
    name: match[1].match(/android:name="([^"]+)"/)?.[1],
    removed: /tools:node="remove"/.test(match[1]),
  }))
  .filter((entry) => entry.name);
const activeManifestPermissions = new Set(
  manifestPermissionEntries.filter((entry) => !entry.removed).map((entry) => entry.name),
);
const expectedActiveManifestPermissions = new Set([
  ...(app.android?.permissions ?? []),
  'android.permission.INTERNET',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.VIBRATE',
]);
const notificationPlugin = app.plugins
  ?.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications')?.[1];

expect(app.version === pkg.version, 'app.json version must equal package.json version');
expect(pkg.dependencies?.['expo-updates'], 'expo-updates must remain an explicit dependency');
expect(typeof app.android?.versionCode === 'number', 'Android versionCode must be numeric');
expect(/^\d+$/.test(app.ios?.buildNumber ?? ''), 'iOS buildNumber must be numeric');
expect(runtimeVersion === app.version, 'runtimeVersion must resolve to the app version');
expect(app.updates?.enabled === true, 'Expo Updates must be enabled');
expect(app.updates?.url === expectedUpdateUrl, 'Expo Updates URL must match the EAS project ID');
expect(app.updates?.checkAutomatically === 'ON_LOAD', 'updates must check on launch');
expect(app.updates?.fallbackToCacheTimeout === 0, 'updates launch wait must remain zero');
expect(app.updates?.useEmbeddedUpdate === true, 'the verified embedded fallback must remain enabled');
expect(
  app.updates?.disableAntiBrickingMeasures !== true,
  'Expo Updates anti-bricking measures must not be disabled',
);

expect(gradle.includes(`applicationId '${app.android.package}'`), 'Android applicationId differs from app.json');
expect(gradle.includes(`versionCode ${app.android.versionCode}`), 'Android versionCode differs from app.json');
expect(gradle.includes(`versionName "${app.version}"`), 'Android versionName differs from app.json');
expect(strings.includes(`<string name="expo_runtime_version">${runtimeVersion}</string>`), 'Android runtime version differs from app.json');
expect(manifest.includes('expo.modules.updates.ENABLED" android:value="true"'), 'Android native OTA support is disabled');
expect(manifest.includes('expo.modules.updates.ENABLE_BSDIFF_PATCH_SUPPORT" android:value="true"'), 'Android native OTA patch support differs from the Expo default');
expect(manifest.includes('android:value="@string/expo_runtime_version"'), 'Android manifest runtimeVersion is missing');
expect(manifest.includes('expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH" android:value="ALWAYS"'), 'Android update check policy differs from ON_LOAD');
expect(manifest.includes('expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS" android:value="0"'), 'Android update launch wait differs from app.json');
expect(manifest.includes(`expo.modules.updates.EXPO_UPDATE_URL" android:value="${expectedUpdateUrl}"`), 'Android update URL differs from app.json');
expect(!manifest.includes('expo.modules.updates.HAS_EMBEDDED_UPDATE" android:value="false"'), 'Android embedded update fallback is disabled');
expect(!manifest.includes('expo.modules.updates.DISABLE_ANTI_BRICKING_MEASURES'), 'Android anti-bricking measures are disabled');
expect(
  Boolean(app.updates?.codeSigningCertificate) ===
    manifest.includes('expo.modules.updates.CODE_SIGNING_CERTIFICATE'),
  'Android update-certificate presence differs from app.json',
);

expect(androidScheme && manifest.includes(`<data android:scheme="${androidScheme}"/>`), 'Android custom scheme differs from app.json');
expect(manifest.includes('android:allowBackup="false"'), 'Android backups must remain disabled');
expect(manifest.includes('android:fullBackupContent="false"'), 'Android full backups must remain disabled');
expect(
  manifest.includes(`android:enableOnBackInvokedCallback="${String(app.android?.predictiveBackGestureEnabled === true)}"`),
  'Android predictive-back configuration differs from app.json',
);
expect(
  [...activeManifestPermissions].every((permission) => expectedActiveManifestPermissions.has(permission)) &&
    [...expectedActiveManifestPermissions].every((permission) => activeManifestPermissions.has(permission)),
  `Android active permission set differs from app.json/approved implicit permissions: ${[...activeManifestPermissions].sort().join(', ')}`,
);

for (const intentFilter of app.android?.intentFilters ?? []) {
  for (const data of intentFilter.data ?? []) {
    const attributes = [
      data.scheme && `android:scheme="${data.scheme}"`,
      data.host && `android:host="${data.host}"`,
      data.pathPrefix && `android:pathPrefix="${data.pathPrefix}"`,
    ].filter(Boolean);
    expect(attributes.every((attribute) => manifest.includes(attribute)), `Android intent filter differs from app.json: ${attributes.join(' ')}`);
  }
}

if (notificationPlugin?.defaultChannel) {
  expect(
    manifest.includes(`com.google.firebase.messaging.default_notification_channel_id" android:value="${notificationPlugin.defaultChannel}"`),
    'Android notification channel differs from the Expo notifications plugin',
  );
}

expect(eas?.cli?.version === '22.0.0', 'eas.json must pin the audited EAS CLI version');
for (const channel of ['development', 'preview', 'production']) {
  expect(eas?.build?.[channel]?.channel === channel, `EAS ${channel} channel is missing or mismatched`);
  expect(eas?.build?.[channel]?.environment === channel, `EAS ${channel} environment is missing or mismatched`);
}
expect(eas?.build?.development?.distribution === 'internal', 'development builds must remain internal');
expect(eas?.build?.preview?.distribution === 'internal', 'preview builds must remain internal');
expect(eas?.build?.production?.distribution !== 'internal', 'production builds must not use internal distribution');

if (pkg.expo?.doctor?.appConfigFieldsNotSyncedCheck?.enabled === false) {
  expect(
    pkg.scripts?.['verify:release']?.includes('check:native-parity'),
    'the non-CNG Expo Doctor advisory may be disabled only while the explicit parity guard is release-blocking',
  );
}

if (existsSync('ios')) {
  fail('An iOS native directory exists but this guard has not been extended to verify its Info.plist/Expo.plist parity');
}

console.log(
  `Native config parity check passed. runtime=${runtimeVersion} android=${app.android.versionCode} ios=${app.ios.buildNumber} updateUrl=${expectedUpdateUrl}`,
);
