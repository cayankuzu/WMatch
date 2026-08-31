import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectFeatureSurface,
  compareFeatureSurfaces,
  validateSnapshot,
} from '../scripts/guards/check-no-new-product-surface.mjs';

const repositoryRoot = process.cwd();
const snapshot = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'quality/feature-surface.snapshot.json'), 'utf8'),
);

describe('feature-freeze guard', () => {
  it('matches the b8ff52ac product surface plus reviewed internal allowlist entries', () => {
    const currentSurface = collectFeatureSurface(repositoryRoot);

    expect(compareFeatureSurfaces(snapshot, currentSurface)).toEqual([]);
  });

  it('rejects added infrastructure/product surface and removed existing surface by default', () => {
    const currentSurface = collectFeatureSurface(repositoryRoot);
    const expandedSurface = {
      ...currentSurface,
      tabs: [...currentSurface.tabs, 'calendar'].sort(),
      screenEntrypoints: currentSurface.screenEntrypoints.filter(
        (entrypoint) => entrypoint !== 'src/app/components/WatchScreen.tsx',
      ),
      apiRoutes: [...currentSurface.apiRoutes, 'GET /make-server-d962235e/calendar'].sort(),
      databaseTables: [...currentSurface.databaseTables, 'calendar_events'].sort(),
    };

    expect(compareFeatureSurfaces(snapshot, expandedSurface)).toEqual(
      expect.arrayContaining([
        'new apiRoutes: GET /make-server-d962235e/calendar',
        'new databaseTables: calendar_events',
        'new tabs: calendar',
        'removed screenEntrypoints: src/app/components/WatchScreen.tsx',
      ]),
    );
  });

  it('does not permit product fields in the infrastructure allowlist', () => {
    const invalidSnapshot = structuredClone(snapshot);
    invalidSnapshot.allowlistedInfrastructureChanges.push({
      surface: 'tabs',
      change: 'add',
      value: 'calendar',
      classification: 'internal-security-ops',
      reason: 'This intentionally invalid entry attempts to bypass the product freeze.',
      existingFlow: 'none',
      paths: ['src/app/App.tsx'],
    });

    expect(() => validateSnapshot(invalidSnapshot)).toThrow(/cannot target product surface tabs/);
  });
});
