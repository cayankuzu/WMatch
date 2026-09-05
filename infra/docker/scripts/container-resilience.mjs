import { run } from './lib.mjs';

try {
  run('node', ['infra/docker/tests/resilience.contract.mjs']);
  run('npx', [
    '--no-install',
    'jest',
    '--config',
    'jest.config.js',
    '--runInBand',
    'tests/components/chat-outbox.test.tsx',
    'tests/components/network-faults.test.tsx',
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

