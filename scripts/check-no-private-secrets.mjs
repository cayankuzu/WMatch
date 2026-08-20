import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const fail = (message) => {
  console.error(`Secret check failed: ${message}`);
  process.exit(1);
};

const easIgnore = readFileSync('.easignore', 'utf8');
const easIgnoreLines = easIgnore
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

for (const requiredPattern of ['.env', '.env.*', '.secrets/', 'credentials.json']) {
  if (!easIgnoreLines.includes(requiredPattern)) {
    fail(`.easignore must exclude ${requiredPattern}`);
  }
}

if (easIgnoreLines.some((line) => /^!\.env(?:$|\.)/i.test(line) && !/^!\.env\.(?:example|sample)$/i.test(line))) {
  fail('.easignore must not re-include a private environment file');
}

if (easIgnoreLines.some((line) => /^!\.secrets(?:\/|$)/i.test(line))) {
  fail('.easignore must not re-include the private secrets directory');
}

const trackedFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'));
const indexedFiles = new Set(
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((file) => file.replaceAll('\\', '/')),
);

const readTextFile = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (!indexedFiles.has(file)) {
      throw error;
    }

    // Some Windows workspaces expose tracked files to Git while temporarily
    // denying direct reads. The index is still the exact committed payload.
    return execFileSync('git', ['show', `:${file}`], { encoding: 'utf8' });
  }
};

const forbiddenTrackedFiles = [
  /^\.env$/i,
  /^\.env\.(?!example$).+/i,
  /(^|\/)android\/keystores\//i,
  /(^|\/)keystore\.properties$/i,
  /\.(jks|keystore|p12|mobileprovision)$/i,
  /(^|\/)credentials\.json$/i,
];

const forbiddenFile = trackedFiles.find((file) => forbiddenTrackedFiles.some((pattern) => pattern.test(file)));
if (forbiddenFile) {
  fail(`credential-like file is tracked by Git: ${forbiddenFile}`);
}

const textFilePattern =
  /\.(cjs|cts|env\.example|gradle|js|json|jsonc|jsx|md|mjs|ps1|sql|ts|tsx|txt|yml|yaml)$/i;
const sourcePathPattern = /^(src|utils|supabase\/functions|app\.json$)/i;

for (const file of trackedFiles) {
  if (!textFilePattern.test(file)) {
    continue;
  }

  if (!existsSync(file)) {
    continue;
  }

  const { size } = statSync(file);
  if (size > 1_000_000) {
    continue;
  }

  const content = readTextFile(file);

  if (/const\s+API_KEY\s*=\s*['"][a-f0-9]{32}['"]/i.test(content)) {
    fail(`hardcoded API key constant is present in ${file}`);
  }

  if (/TMDB[^\r\n]{0,120}['"][a-f0-9]{32}['"]/i.test(content)) {
    fail(`hardcoded TMDB-like API key is present in ${file}`);
  }

  if (sourcePathPattern.test(file) && /api_key=/.test(content)) {
    fail(`direct TMDB api_key query is present in ${file}`);
  }

  if (/SUPABASE_(SERVICE_ROLE|SECRET)_KEY[^\S\r\n]*=[^\S\r\n]*(?!$|<)[^\s]+/im.test(content)) {
    fail(`Supabase service secret value appears to be committed in ${file}`);
  }

  if (/TMDB_API_KEY[^\S\r\n]*=[^\S\r\n]*(?!$|<)[^\s]+/im.test(content)) {
    fail(`TMDB secret value appears to be committed in ${file}`);
  }
}

console.log('Private secret check passed.');
