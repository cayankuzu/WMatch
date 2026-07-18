import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['diff', '--check'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  console.log('Format check passed.');
} catch (error) {
  const output = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
  console.error(output || error.message);
  process.exit(1);
}
