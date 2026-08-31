import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const OTA_CLASSIFICATIONS = {
  safe: 'OTA_SAFE',
  native: 'NATIVE_BUILD_REQUIRED',
  review: 'MANUAL_REVIEW_REQUIRED',
};

const NATIVE_PATH_PATTERNS = [
  /^(android|ios)\//,
  /^app\.(json|config\.(js|mjs|cjs|ts))$/,
  /^eas\.json$/,
  /^(package|package-lock)\.json$/,
  /^(pnpm-lock\.yaml|yarn\.lock)$/,
  /^(firebase|credentials|plugins)\//,
  /^assets\/branding\//,
  /(^|\/)(GoogleService-Info\.plist|google-services\.json)$/i,
];

const OTA_SAFE_PATH_PATTERNS = [
  /^(App|index)\.(ts|tsx|js|jsx)$/,
  /^(src|utils)\/.+\.(ts|tsx|js|jsx|json)$/,
  /^assets\/(?!branding\/).+\.(png|jpe?g|webp|gif|svg|ttf|otf|mp3|wav|json)$/i,
  /^(docs|quality|release-evidence|tests)\//,
  /^\.(gitignore|easignore|gitleaksignore)$/,
  /^(README|DEPLOYMENT|ATTRIBUTIONS|ERROR_HELP|PRIVATE_REPO_BOOTSTRAP|PUSH_NOTIFICATIONS_SETUP)(_.+)?\.md$/i,
];

const MANUAL_REVIEW_PATH_PATTERNS = [
  /^(supabase|infra|\.github|scripts)\//,
  /^\.env\.example$/,
  /^(babel|metro)\.config\.(js|mjs|cjs|ts)$/,
  /^tsconfig\.json$/,
  /^jest(\.setup|\.config)?\.(js|mjs|cjs|ts)$/,
  /^vitest\.config\.(js|mjs|mts|cjs|ts)$/,
];

function normalizePath(file) {
  return file.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

export function classifyChangedFile(file) {
  const path = normalizePath(file);

  if (!path) {
    return null;
  }

  if (NATIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return {
      path,
      classification: OTA_CLASSIFICATIONS.native,
      reason: 'The file can change the native runtime, build identity, signing, or embedded assets.',
    };
  }

  if (MANUAL_REVIEW_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return {
      path,
      classification: OTA_CLASSIFICATIONS.review,
      reason: 'The file changes a deployment boundary or toolchain and requires explicit compatibility and release-order review.',
    };
  }

  if (OTA_SAFE_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return {
      path,
      classification: OTA_CLASSIFICATIONS.safe,
      reason: 'The file does not alter the installed native runtime.',
    };
  }

  return {
    path,
    classification: OTA_CLASSIFICATIONS.review,
    reason: 'Unknown paths fail closed until their runtime impact is classified.',
  };
}

export function classifyChangedFiles(files) {
  const entries = [...new Set(files.map(normalizePath).filter(Boolean))]
    .sort()
    .map(classifyChangedFile)
    .filter(Boolean);
  const classifications = new Set(entries.map((entry) => entry.classification));
  const classification = entries.length === 0
    ? OTA_CLASSIFICATIONS.review
    : classifications.has(OTA_CLASSIFICATIONS.native)
    ? OTA_CLASSIFICATIONS.native
    : classifications.has(OTA_CLASSIFICATIONS.review)
      ? OTA_CLASSIFICATIONS.review
      : OTA_CLASSIFICATIONS.safe;

  return {
    classification,
    otaPublishAllowed: classification === OTA_CLASSIFICATIONS.safe,
    files: entries,
  };
}

function readGitDiff(baseRef, headRef) {
  return execFileSync('git', [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    '--end-of-options',
    baseRef,
    headRef,
  ], {
    encoding: 'utf8',
  }).split('\0').filter(Boolean);
}

function parseArguments(argv) {
  const options = {
    assertSafe: false,
    baseRef: null,
    filesPath: null,
    paths: [],
    headRef: 'HEAD',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--assert-ota-safe') {
      options.assertSafe = true;
    } else if (argument === '--base') {
      options.baseRef = argv[index += 1] ?? null;
    } else if (argument === '--head') {
      options.headRef = argv[index += 1] ?? 'HEAD';
    } else if (argument === '--files') {
      options.filesPath = argv[index += 1] ?? null;
    } else if (argument === '--path') {
      options.paths.push(argv[index += 1] ?? '');
    } else {
      throw new Error(`Unknown OTA classifier argument: ${argument}`);
    }
  }

  return options;
}

function runCli() {
  const options = parseArguments(process.argv.slice(2));
  let files;

  if (options.filesPath && options.paths.length > 0) {
    throw new Error('--files and --path cannot be combined.');
  }

  if (options.paths.length > 0) {
    files = options.paths;
  } else if (options.filesPath) {
    files = readFileSync(options.filesPath, 'utf8').split(/\r?\n/).filter(Boolean);
  } else {
    if (!options.baseRef) {
      throw new Error('--base is required unless --files or --path is provided.');
    }
    files = readGitDiff(options.baseRef, options.headRef);
  }

  const result = {
    baseRef: options.baseRef,
    headRef: options.headRef,
    ...classifyChangedFiles(files),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (options.assertSafe && !result.otaPublishAllowed) {
    process.exitCode = result.classification === OTA_CLASSIFICATIONS.native ? 2 : 3;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    runCli();
  } catch (error) {
    console.error(`OTA classification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
