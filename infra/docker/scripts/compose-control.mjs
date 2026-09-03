import {
  composeArgs,
  composeEnvironment,
  ensureNoComposeResources,
  run,
} from './lib.mjs';

const action = process.argv[2];
const environment = composeEnvironment();

try {
  if (action === 'config') {
    run('docker', composeArgs(['--profile', 'test', '--profile', 'resilience', '--profile', 'load', 'config', '--quiet']), {
      env: environment,
    });
  } else if (action === 'up-test') {
    run('docker', composeArgs(['--profile', 'test', 'up', '--detach', '--build', '--wait', 'tmdb-mock', 'push-mock', 'mailpit']), {
      env: environment,
    });
  } else if (action === 'down') {
    run('docker', composeArgs([
      '--profile', 'test',
      '--profile', 'resilience',
      '--profile', 'load',
      '--profile', 'mail',
      'down',
      '--remove-orphans',
    ]), { env: environment, allowFailure: true });
    ensureNoComposeResources();
  } else {
    throw new Error('Usage: node compose-control.mjs <config|up-test|down>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
