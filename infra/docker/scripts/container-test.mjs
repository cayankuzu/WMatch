import { run } from './lib.mjs';

const commands = [
  ['node', ['infra/docker/tests/tmdb-mock.contract.mjs']],
  ['node', ['infra/docker/tests/push-mock.contract.mjs']],
  ['node', ['infra/docker/tests/mailpit.contract.mjs']],
  ['npm', ['run', 'test:unit']],
  ['npm', ['run', 'test:contract']],
  ['npm', ['run', 'test:edge:hmac']],
  ['npm', ['run', 'test:edge:storage']],
  ['npm', ['run', 'test:edge:privacy']],
  ['npm', ['run', 'test:edge:account-deletion']],
  ['npm', ['run', 'check:edge']],
  ['npm', ['run', 'check:edge:type']],
  ['npm', ['run', 'check', '--prefix', 'infra/cloudflare/wmatch-edge']],
];

try {
  for (const [command, args] of commands) {
    run(command, args);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
