import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildReleaseEvidenceManifest,
  validateReleaseEvidenceManifest,
} from '../scripts/build-release-evidence.mjs';

const COMMIT_SHA = '1234567890abcdef1234567890abcdef12345678';
const temporaryRoots: string[] = [];

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'wmatch-release-evidence-'));
  const evidenceRoot = join(root, 'evidence');
  temporaryRoots.push(root);
  mkdirSync(join(root, 'supabase', 'migrations'), { recursive: true });
  mkdirSync(join(evidenceRoot, 'repository'), { recursive: true });
  mkdirSync(join(evidenceRoot, 'ota'), { recursive: true });

  writeJson(join(root, 'app.json'), {
    expo: {
      version: '1.2.3',
      runtimeVersion: '1.2.3',
      android: { versionCode: 12 },
      ios: { buildNumber: '14' },
    },
  });
  writeFileSync(join(root, 'supabase', 'migrations', '20260101000000_first.sql'), 'SELECT 1;\n');
  writeFileSync(join(root, 'supabase', 'migrations', '20260202000000_second.sql'), 'SELECT 2;\n');

  const templatePath = join(root, 'manifest.template.json');
  writeFileSync(
    templatePath,
    readFileSync(resolve('release-evidence/manifest.template.json'), 'utf8'),
  );

  writeFileSync(join(evidenceRoot, 'repository', 'commit-sha.txt'), `${COMMIT_SHA}\n`);
  writeFileSync(join(evidenceRoot, 'repository', 'git-status.txt'), '');
  const commands = [
    ['npm ci', 'npm-ci.log'],
    ['npm ci --prefix infra/cloudflare/wmatch-edge', 'worker-npm-ci.log'],
    ['npm run verify:release', 'verify-release.log'],
    ['npm run check --prefix infra/cloudflare/wmatch-edge', 'worker-check.log'],
    ['npx expo export --platform android --source-maps external --dump-assetmap', 'expo-export-android.log'],
    ['npx expo export --platform ios --source-maps external --dump-assetmap', 'expo-export-ios.log'],
    ['npm sbom --sbom-format cyclonedx', 'sbom.log'],
    ['npm sbom --prefix infra/cloudflare/wmatch-edge --sbom-format cyclonedx', 'worker-sbom.log'],
  ] as const;
  writeJson(join(evidenceRoot, 'repository', 'commands.json'), commands.map(
    ([command, logName], index) => {
      const logPath = join(evidenceRoot, 'repository', logName);
      writeFileSync(logPath, `${command} passed\n`);
      return {
        command,
        toolVersion: 'node v22.0.0; npm 11.19.0',
        startedAtUtc: `2026-08-31T12:00:${String(index).padStart(2, '0')}.000Z`,
        endedAtUtc: `2026-08-31T12:00:${String(index + 1).padStart(2, '0')}.000Z`,
        exitCode: 0,
        logPath: `repository/${logName}`,
      };
    },
  ));
  writeJson(join(evidenceRoot, 'repository', 'sbom.cdx.json'), { bomFormat: 'CycloneDX' });
  writeJson(join(evidenceRoot, 'repository', 'worker-sbom.cdx.json'), {
    bomFormat: 'CycloneDX',
  });
  writeJson(join(evidenceRoot, 'repository', 'upstream-gates.json'), [
    {
      workflow: 'ci.yml',
      runId: 1,
      runAttempt: 1,
      status: 'completed',
      event: 'push',
      headBranch: 'main',
      headSha: COMMIT_SHA,
      conclusion: 'success',
      htmlUrl: 'https://github.com/owner/repository/actions/runs/1',
    },
    {
      workflow: 'quality.yml',
      runId: 2,
      runAttempt: 1,
      status: 'completed',
      event: 'push',
      headBranch: 'main',
      headSha: COMMIT_SHA,
      conclusion: 'success',
      htmlUrl: 'https://github.com/owner/repository/actions/runs/2',
    },
    {
      workflow: 'database-validation.yml',
      runId: 3,
      runAttempt: 1,
      status: 'completed',
      event: 'workflow_dispatch',
      headBranch: 'main',
      headSha: COMMIT_SHA,
      conclusion: 'success',
      htmlUrl: 'https://github.com/owner/repository/actions/runs/3',
    },
    {
      workflow: 'docker-validation.yml',
      runId: 4,
      runAttempt: 1,
      status: 'completed',
      event: 'workflow_dispatch',
      headBranch: 'main',
      headSha: COMMIT_SHA,
      conclusion: 'success',
      htmlUrl: 'https://github.com/owner/repository/actions/runs/4',
    },
  ]);
  writeFileSync(join(evidenceRoot, 'ota', 'expo-export.sha256'), 'fixture checksum list\n');

  return {
    root,
    evidenceRoot,
    templatePath,
    outputPath: join(evidenceRoot, 'manifest.json'),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('release evidence manifest', () => {
  it('derives immutable candidate identity and keeps external gates NO-GO', () => {
    const fixture = createFixture();
    const manifest = buildReleaseEvidenceManifest({
      repoRoot: fixture.root,
      evidenceRoot: fixture.evidenceRoot,
      templatePath: fixture.templatePath,
      outputPath: fixture.outputPath,
      repository: 'owner/repository',
      commitSha: COMMIT_SHA,
      refName: 'main',
      createdAtUtc: '2026-08-31T12:02:00.000Z',
    });

    expect(manifest.candidate).toMatchObject({
      repository: 'owner/repository',
      commitSha: COMMIT_SHA,
      branchOrTag: 'main',
      treeClean: true,
      appVersion: '1.2.3',
      runtimeVersion: '1.2.3',
      androidVersionCode: 12,
      iosBuildNumber: '14',
    });
    expect(manifest.databaseEvidence).toMatchObject({
      requiredMigration: '20260202000000',
      migrationCount: 2,
    });
    expect(manifest.repositoryEvidence.status).toBe('passed');
    expect(manifest.repositoryEvidence.commands[0].logSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.repositoryEvidence.logPath).toBe('repository/verify-release.log');
    expect(manifest.releaseDecision.status).toBe('NO-GO');
    expect(manifest.edgeEvidence.status).toBe('pending');
    expect(manifest.artifacts.android.status).toBe('missing');
    expect(readFileSync(fixture.outputPath, 'utf8')).not.toContain('REPLACE_WITH_');
  });

  it('rejects a dirty candidate before producing evidence', () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.evidenceRoot, 'repository', 'git-status.txt'), ' M app.json\n');

    expect(() => buildReleaseEvidenceManifest({
      repoRoot: fixture.root,
      evidenceRoot: fixture.evidenceRoot,
      templatePath: fixture.templatePath,
      outputPath: fixture.outputPath,
      repository: 'owner/repository',
      commitSha: COMMIT_SHA,
      refName: 'main',
      createdAtUtc: '2026-08-31T12:02:00.000Z',
    })).toThrow(/dirty/);
  });

  it('supports the checked-in manifest template without completing external evidence', () => {
    const fixture = createFixture();
    const manifest = buildReleaseEvidenceManifest({
      repoRoot: fixture.root,
      evidenceRoot: fixture.evidenceRoot,
      templatePath: resolve('release-evidence/manifest.template.json'),
      outputPath: fixture.outputPath,
      repository: 'owner/repository',
      commitSha: COMMIT_SHA,
      refName: 'main',
      createdAtUtc: '2026-08-31T12:02:00.000Z',
    });

    expect(manifest.releaseDecision.status).toBe('NO-GO');
    expect(manifest.edgeEvidence.status).toBe('pending');
    expect(manifest.restoreEvidence.localLogicalRestore.expectedSchemaContract).toBe(
      '20260202000000',
    );
    expect(Object.values(manifest.manualGates)).toEqual(
      expect.arrayContaining(['pending']),
    );
    expect(Object.values(manifest.manualGates).every((status) => status === 'pending')).toBe(true);
  });

  it('detects a command log changed after manifest generation', () => {
    const fixture = createFixture();
    const manifest = buildReleaseEvidenceManifest({
      repoRoot: fixture.root,
      evidenceRoot: fixture.evidenceRoot,
      templatePath: fixture.templatePath,
      outputPath: fixture.outputPath,
      repository: 'owner/repository',
      commitSha: COMMIT_SHA,
      refName: 'main',
      createdAtUtc: '2026-08-31T12:02:00.000Z',
    });
    writeFileSync(
      join(fixture.evidenceRoot, 'repository', 'verify-release.log'),
      'tampered after generation\n',
    );

    expect(() => validateReleaseEvidenceManifest(
      manifest,
      fixture.evidenceRoot,
      COMMIT_SHA,
    )).toThrow(/checksum does not match/);
  });

  it('rejects an incomplete required command set', () => {
    const fixture = createFixture();
    const commandsPath = join(fixture.evidenceRoot, 'repository', 'commands.json');
    const commands = JSON.parse(readFileSync(commandsPath, 'utf8')) as unknown[];
    writeJson(commandsPath, commands.slice(1));

    expect(() => buildReleaseEvidenceManifest({
      repoRoot: fixture.root,
      evidenceRoot: fixture.evidenceRoot,
      templatePath: fixture.templatePath,
      outputPath: fixture.outputPath,
      repository: 'owner/repository',
      commitSha: COMMIT_SHA,
      refName: 'main',
      createdAtUtc: '2026-08-31T12:02:00.000Z',
    })).toThrow(/exact required release command set/);
  });

  it('rejects missing manual gates and invented runtime evidence', () => {
    const fixture = createFixture();
    const manifest = buildReleaseEvidenceManifest({
      repoRoot: fixture.root,
      evidenceRoot: fixture.evidenceRoot,
      templatePath: fixture.templatePath,
      outputPath: fixture.outputPath,
      repository: 'owner/repository',
      commitSha: COMMIT_SHA,
      refName: 'main',
      createdAtUtc: '2026-08-31T12:02:00.000Z',
    });

    delete manifest.manualGates.realDeviceMatrix;
    expect(() => validateReleaseEvidenceManifest(
      manifest,
      fixture.evidenceRoot,
      COMMIT_SHA,
    )).toThrow(/every manual gate/);
  });
});

describe('production workflow evidence gates', () => {
  it('requires exact-SHA CI, Quality, and database runs before Cloudflare deployment', () => {
    const workflow = readFileSync('.github/workflows/cloudflare-production.yml', 'utf8');

    expect(workflow).toContain('actions: read');
    expect(workflow).toContain("require_successful_workflow ci.yml '[\"push\"]'");
    expect(workflow).toContain("require_successful_workflow quality.yml '[\"push\"]'");
    expect(workflow).toContain(
      "require_successful_workflow database-validation.yml '[\"push\", \"workflow_dispatch\"]'",
    );
    expect(workflow).toContain(
      "require_successful_workflow docker-validation.yml '[\"push\", \"workflow_dispatch\"]'",
    );
    expect(workflow).toContain('.head_branch == $branch');
    expect(workflow).toContain('sort_by([.run_number // 0, .run_attempt // 0');
    expect(workflow).not.toContain('&status=success');
    expect(workflow).toContain("if: ${{ inputs.operation != 'rollback' }}");
  });

  it('targets and proves the requested Worker version during canary smoke', () => {
    const workflow = readFileSync('.github/workflows/cloudflare-production.yml', 'utf8');

    expect(workflow).toContain('Cloudflare-Workers-Version-Overrides');
    expect(workflow).toContain('x-wmatch-edge-version');
    expect(workflow).toContain('.ok == true');
    expect(workflow).toContain('.schemaReady == true');
    expect(workflow).toContain('served_commit\" == \"$INPUT_TARGET_COMMIT_SHA');
    expect(workflow).toContain('production-smoke-target.json');
    expect(workflow).toContain('automatic rollback after target-version smoke failed');
  });

  it('builds a checksummed manifest only after same-SHA upstream evidence', () => {
    const workflow = readFileSync('.github/workflows/release-evidence.yml', 'utf8');

    expect(workflow).toContain('upstream-gates.json');
    expect(workflow).toContain('scripts/build-release-evidence.mjs build');
    expect(workflow).toContain('scripts/build-release-evidence.mjs verify');
    expect(workflow).toContain('sha256sum --check manifest.sha256');
    expect(workflow).toContain('test ! -s "${evidence_root}/repository/git-status.txt"');
  });

  it('runs Quality for direct pushes without a branch-name allowlist', () => {
    const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
    const pushBlock = workflow.slice(workflow.indexOf('  push:'), workflow.indexOf('\n\nconcurrency:'));

    expect(pushBlock.trim()).toBe('push:');
    expect(workflow).not.toContain('chore/aaa-mvp-feature-freeze-cloudflare-ota');
  });
});
