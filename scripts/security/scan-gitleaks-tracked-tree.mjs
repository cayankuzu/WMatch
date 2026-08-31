import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const repositoryRoot = resolve('.');
const scanRoot = mkdtempSync(join(tmpdir(), 'wmatch-gitleaks-'));

function fail(message) {
  throw new Error(`Tracked-tree secret scan failed: ${message}`);
}

try {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  ).split('\0').filter(Boolean);

  for (const file of files) {
    const normalized = file.replaceAll('\\', '/');

    if (isAbsolute(normalized) || normalized.split('/').includes('..')) {
      fail(`unsafe Git path: ${normalized}`);
    }

    const source = resolve(repositoryRoot, normalized);

    if (source !== repositoryRoot && !source.startsWith(`${repositoryRoot}${sep}`)) {
      fail(`path escaped the repository: ${normalized}`);
    }

    if (lstatSync(source).isSymbolicLink()) {
      fail(`tracked symbolic links require explicit review: ${normalized}`);
    }

    const destination = join(scanRoot, ...normalized.split('/'));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }

  const result = spawnSync(
    'gitleaks',
    [
      'dir',
      scanRoot,
      '--config',
      join(repositoryRoot, '.gitleaks.toml'),
      '--redact=100',
      '--no-banner',
      '--verbose',
    ],
    { encoding: 'utf8', stdio: 'inherit' },
  );

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  } else {
    console.log(`Tracked-tree secret scan passed for ${files.length} files.`);
  }
} finally {
  rmSync(scanRoot, { recursive: true, force: true });
}
