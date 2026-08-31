import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { dependencyDirectionViolation } from '../scripts/guards/check-dependency-direction.mjs';

describe('architecture dependency direction guard', () => {
  it('allows composition layers to depend on services and shared contracts', () => {
    expect(dependencyDirectionViolation(
      'src/app/components/WatchScreen.tsx',
      'src/services/api.ts',
    )).toBeNull();
    expect(dependencyDirectionViolation(
      'src/context/AuthContext.tsx',
      'src/shared/types/index.ts',
    )).toBeNull();
  });

  it('rejects lower mobile layers importing UI or contexts', () => {
    expect(dependencyDirectionViolation(
      'src/services/api.ts',
      'src/app/App.tsx',
    )).toContain('Services');
    expect(dependencyDirectionViolation(
      'src/shared/utils/validation.ts',
      'src/context/AuthContext.tsx',
    )).toContain('Shared');
    expect(dependencyDirectionViolation(
      'utils/supabase/client.ts',
      'src/services/api.ts',
    )).toContain('Base utilities');
  });

  it('freezes the two reviewed shared-to-service legacy edges exactly', () => {
    expect(dependencyDirectionViolation(
      'src/shared/utils/mediaPrefetchQueue.ts',
      'src/services/connectivity.ts',
    )).toBeNull();
    expect(dependencyDirectionViolation(
      'src/shared/utils/mediaPrefetchQueue.ts',
      'src/services/newDependency.ts',
    )).toContain('Shared');
  });

  it('prevents server implementation dependencies crossing either direction', () => {
    expect(dependencyDirectionViolation(
      'supabase/functions/make-server-d962235e/runtime.ts',
      'src/services/api.ts',
    )).toContain('Edge code');
    expect(dependencyDirectionViolation(
      'src/services/api.ts',
      'supabase/functions/make-server-d962235e/runtime.ts',
    )).toContain('Mobile code');
  });

  it('keeps the guard release-blocking in package scripts and CI', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');

    expect(packageJson.scripts['verify:release']).toContain('npm run check:architecture');
    expect(packageJson.scripts.check).toContain('npm run check:architecture');
    expect(packageJson.scripts['verify:release']).toContain('npm run check:visual-regression');
    expect(packageJson.scripts.check).toContain('npm run check:visual-regression');
    expect(ciWorkflow).toContain('run: npm run check:architecture');
  });
});
