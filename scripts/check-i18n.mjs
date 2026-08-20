import { readdirSync, readFileSync } from 'node:fs';

const fail = (message) => {
  console.error(`i18n check failed: ${message}`);
  process.exit(1);
};

const extractKeys = (file) => {
  const content = readFileSync(file, 'utf8');
  const keys = [];
  const keyPattern = /^\s*'([^']+)'\s*:/gm;
  let match;

  while ((match = keyPattern.exec(content)) !== null) {
    keys.push(match[1]);
  }

  return keys;
};

const assertNoDuplicates = (keys, label) => {
  const seen = new Set();
  const duplicates = keys.filter((key) => {
    if (seen.has(key)) {
      return true;
    }

    seen.add(key);
    return false;
  });

  if (duplicates.length > 0) {
    fail(`${label} has duplicate keys: ${duplicates.join(', ')}`);
  }
};

const trKeys = extractKeys('src/shared/i18n/locales/tr.ts');
assertNoDuplicates(trKeys, 'tr');

const localeFiles = readdirSync('src/shared/i18n/locales').filter((file) => file.endsWith('.ts'));
if (localeFiles.length !== 1 || localeFiles[0] !== 'tr.ts') {
  fail(`the mobile product must ship only the Turkish locale; found: ${localeFiles.join(', ')}`);
}

console.log(`Turkish locale integrity check passed. keys=${trKeys.length}`);
