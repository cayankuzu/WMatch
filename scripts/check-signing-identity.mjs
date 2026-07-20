import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EXPECTED_ANDROID_PACKAGE = 'com.wmatch.app';
const EXPECTED_IOS_BUNDLE_ID = 'com.wmatch.app';
const EXPECTED_EAS_PROJECT_ID = '5aab8659-db24-4152-aa79-142f210e16d1';
const EXPECTED_EAS_OWNER = 'cayann';
const EXPECTED_RELEASE_SHA1 = 'E4:E0:3B:26:E1:7E:D9:1E:5C:26:EC:4A:71:22:0B:CF:E9:15:0C:34';

const fail = (message) => {
  console.error(`Signing identity check failed: ${message}`);
  process.exit(1);
};

const assertEqual = (actual, expected, label) => {
  if (actual !== expected) {
    fail(`${label} expected ${expected}, received ${actual ?? '<missing>'}`);
  }
};

const appConfig = JSON.parse(readFileSync('app.json', 'utf8')).expo;

assertEqual(appConfig?.android?.package, EXPECTED_ANDROID_PACKAGE, 'Android package');
assertEqual(appConfig?.ios?.bundleIdentifier, EXPECTED_IOS_BUNDLE_ID, 'iOS bundle identifier');
assertEqual(appConfig?.extra?.eas?.projectId, EXPECTED_EAS_PROJECT_ID, 'EAS projectId');
assertEqual(appConfig?.owner, EXPECTED_EAS_OWNER, 'EAS owner');

const buildGradle = readFileSync('android/app/build.gradle', 'utf8');
if (!buildGradle.includes(`namespace '${EXPECTED_ANDROID_PACKAGE}'`)) {
  fail('android namespace changed or missing');
}

if (!buildGradle.includes(`applicationId '${EXPECTED_ANDROID_PACKAGE}'`)) {
  fail('android applicationId changed or missing');
}

if (!buildGradle.includes(EXPECTED_RELEASE_SHA1)) {
  fail('release signing SHA-1 guard changed or missing');
}

const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
if (!manifest.includes('android:allowBackup="false"')) {
  fail('android allowBackup must remain false');
}

if (!manifest.includes('android:fullBackupContent="false"')) {
  fail('android fullBackupContent must remain false');
}

const trackedFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'));

const forbiddenTrackedPatterns = [
  /^\.env$/i,
  /^\.env\.(?!example$).+/i,
  /(^|\/)keystore\.properties$/i,
  /(^|\/)android\/keystores\//i,
  /\.(jks|keystore|p12|mobileprovision)$/i,
  /(^|\/)credentials\.json$/i,
  /(^|\/)GoogleService-Info\.plist$/i,
  /(^|\/)google-services\.json$/i,
];

const forbiddenTrackedFile = trackedFiles.find((file) =>
  forbiddenTrackedPatterns.some((pattern) => pattern.test(file)),
);

if (forbiddenTrackedFile) {
  fail(`credential-like file is tracked by Git: ${forbiddenTrackedFile}`);
}

console.log('Signing identity check passed.');
