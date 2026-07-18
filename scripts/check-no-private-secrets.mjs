import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const fail = (message) => {
  console.error(`Secret check failed: ${message}`);
  process.exit(1);
};

const trackedFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'));

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

  const content = readFileSync(file, 'utf8');

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
