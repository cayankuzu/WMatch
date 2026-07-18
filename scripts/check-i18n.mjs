import { readFileSync } from 'node:fs';

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
const enKeys = extractKeys('src/shared/i18n/locales/en.ts');

assertNoDuplicates(trKeys, 'tr');
assertNoDuplicates(enKeys, 'en');

const trSet = new Set(trKeys);
const enSet = new Set(enKeys);
const missingInEn = trKeys.filter((key) => !enSet.has(key));
const missingInTr = enKeys.filter((key) => !trSet.has(key));

if (missingInEn.length > 0 || missingInTr.length > 0) {
  fail(
    [
      missingInEn.length ? `missing in en: ${missingInEn.join(', ')}` : null,
      missingInTr.length ? `missing in tr: ${missingInTr.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('; '),
  );
}

console.log('i18n key parity check passed.');
