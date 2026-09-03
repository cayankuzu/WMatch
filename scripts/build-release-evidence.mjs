#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MIGRATION_PATTERN = /^(\d{14})_[a-z0-9_]+\.sql$/;
const AGGREGATE_COMMAND = 'npm run verify:release';
const DOCKER_WORKFLOW = '.github/workflows/docker-validation.yml';
const DOCKER_ARTIFACT_ROOT = 'docker/artifact';
const DOCKER_ARTIFACT_METADATA_PATH = 'docker/artifact-metadata.json';
const DOCKER_ARTIFACT_ARCHIVE_PATH = 'docker/artifact.zip';
const DOCKER_CHECKSUM_PATH = `${DOCKER_ARTIFACT_ROOT}/SHA256SUMS`;
const EXPO_EXPORT_ROOT = 'ota/expo-export';
const REQUIRED_COMMANDS = [
  'npm ci',
  'npm ci --prefix infra/cloudflare/wmatch-edge',
  AGGREGATE_COMMAND,
  'npm run check --prefix infra/cloudflare/wmatch-edge',
  'npx expo export --platform android --source-maps external --dump-assetmap',
  'npx expo export --platform ios --source-maps external --dump-assetmap',
  'npm sbom --sbom-format cyclonedx',
  'npm sbom --prefix infra/cloudflare/wmatch-edge --sbom-format cyclonedx',
];
const REQUIRED_DOCKER_GATES = [
  'initialize',
  'dependencies',
  'pinnedTools',
  'composeAndHadolint',
  'reproducibleBuildA',
  'reproducibleBuildB',
  'reproducibilityAndSmoke',
  'dockerTest',
  'resilience',
  'loadSmoke',
  'imageScanAndSbom',
  'provenance',
  'cleanup',
];
const REQUIRED_MANUAL_GATES = [
  'cloudflareAccountAndToken',
  'stableDnsAndApiHost',
  'wafRateLimitAccess',
  'supabaseSecretsAndOriginHmac',
  'easProjectChannelsEnvironments',
  'otaSigningPlan',
  'androidIosSigning',
  'sentryDashboardAndAlert',
  'providerCredentials',
  'stagingDeploy',
  'realDeviceMatrix',
  'testFlightAndInternalTrack',
  'storePrivacyAndUgcForms',
  'backupPitrAndRestore',
  'canaryAndRollbackApproval',
];

function fail(message) {
  throw new Error(`Release evidence: ${message}`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`cannot read valid JSON from ${path}: ${error.message}`);
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function resolveEvidenceFile(evidenceRoot, logicalPath) {
  const normalizedPath = requireNonEmptyString(logicalPath, 'evidence path').replaceAll('\\', '/');

  if (isAbsolute(normalizedPath) || normalizedPath.split('/').includes('..')) {
    fail(`evidence path must stay inside the evidence root: ${logicalPath}`);
  }

  const root = resolve(evidenceRoot);
  const target = resolve(root, normalizedPath);
  const relativeTarget = relative(root, target);

  if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`)) {
    fail(`evidence path escapes the evidence root: ${logicalPath}`);
  }

  if (!existsSync(target)) {
    fail(`referenced evidence file is missing: ${logicalPath}`);
  }

  if (!lstatSync(target).isFile()) {
    fail(`referenced evidence path is not a regular file: ${logicalPath}`);
  }

  return { logicalPath: normalizedPath, target };
}

function resolveEvidenceDirectory(evidenceRoot, logicalPath) {
  const normalizedPath = requireNonEmptyString(logicalPath, 'evidence directory')
    .replaceAll('\\', '/');

  if (isAbsolute(normalizedPath) || normalizedPath.split('/').includes('..')) {
    fail(`evidence directory must stay inside the evidence root: ${logicalPath}`);
  }

  const root = resolve(evidenceRoot);
  const target = resolve(root, normalizedPath);
  const relativeTarget = relative(root, target);
  if (
    relativeTarget === '..'
    || relativeTarget.startsWith(`..${sep}`)
    || !existsSync(target)
    || !lstatSync(target).isDirectory()
  ) {
    fail(`referenced evidence directory is missing or invalid: ${logicalPath}`);
  }

  return { logicalPath: normalizedPath, target };
}

function listRegularFiles(root) {
  const files = [];

  function visit(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const logicalPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(`evidence trees must not contain symbolic links: ${logicalPath}`);
      }
      if (entry.isDirectory()) {
        visit(target, logicalPath);
      } else if (entry.isFile()) {
        files.push({ logicalPath, target });
      } else {
        fail(`evidence trees must contain only regular files: ${logicalPath}`);
      }
    }
  }

  visit(root);
  return files.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath, 'en'));
}

function validateChecksumTree(
  evidenceRoot,
  checksumLogicalPath,
  treeLogicalPath,
  ignoredTreePaths = [],
) {
  const checksumFile = resolveEvidenceFile(evidenceRoot, checksumLogicalPath);
  const tree = resolveEvidenceDirectory(evidenceRoot, treeLogicalPath);
  const checksumLines = readFileSync(checksumFile.target, 'utf8')
    .split(/\r?\n/u)
    .filter(Boolean);

  if (checksumLines.length === 0) {
    fail(`${checksumLogicalPath} must contain at least one file checksum`);
  }

  const seenPaths = new Set();
  const files = checksumLines.map((line, index) => {
    const match = /^([0-9a-f]{64}) [ *](.+)$/u.exec(line);
    if (!match) {
      fail(`${checksumLogicalPath} line ${index + 1} is not strict sha256sum output`);
    }

    const digest = match[1];
    const rawPath = match[2].replaceAll('\\', '/');
    const normalizedPath = rawPath.startsWith('./') ? rawPath.slice(2) : rawPath;
    if (
      !normalizedPath
      || isAbsolute(normalizedPath)
      || normalizedPath.split('/').includes('..')
      || seenPaths.has(normalizedPath)
    ) {
      fail(`${checksumLogicalPath} contains a duplicate or unsafe path: ${rawPath}`);
    }
    seenPaths.add(normalizedPath);

    const target = resolve(tree.target, normalizedPath);
    const relativeTarget = relative(tree.target, target);
    if (
      relativeTarget === '..'
      || relativeTarget.startsWith(`..${sep}`)
      || !existsSync(target)
      || !lstatSync(target).isFile()
    ) {
      fail(`${checksumLogicalPath} references a missing or invalid file: ${normalizedPath}`);
    }
    if (sha256(target) !== digest) {
      fail(`${checksumLogicalPath} checksum does not match ${normalizedPath}`);
    }

    return {
      relativePath: normalizedPath,
      logicalPath: `${tree.logicalPath}/${normalizedPath}`,
      sha256: digest,
    };
  });

  const ignored = new Set(ignoredTreePaths);
  const actualPaths = listRegularFiles(tree.target)
    .map((file) => file.logicalPath)
    .filter((logicalPath) => !ignored.has(logicalPath));
  const listedPaths = files.map((file) => file.relativePath).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(listedPaths)) {
    fail(`${checksumLogicalPath} must cover the exact artifact file tree`);
  }

  return { checksumFile, tree, files };
}

function validateRequiredCommandSet(commands, context) {
  if (!Array.isArray(commands) || commands.length !== REQUIRED_COMMANDS.length) {
    fail(`${context} must contain the exact required release command set`);
  }

  for (const requiredCommand of REQUIRED_COMMANDS) {
    if (commands.filter((entry) => entry?.command === requiredCommand).length !== 1) {
      fail(`${context} must contain exactly one ${requiredCommand}`);
    }
  }
}

function parseExplicitRuntimeVersion(expo) {
  if (typeof expo.runtimeVersion !== 'string' || !expo.runtimeVersion.trim()) {
    fail('app.json must contain one explicit string expo.runtimeVersion');
  }

  return expo.runtimeVersion.trim();
}

function readMigrationIdentity(repoRoot) {
  const migrationsRoot = resolve(repoRoot, 'supabase/migrations');
  const migrations = readdirSync(migrationsRoot)
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort();

  if (migrations.length === 0) {
    fail('no timestamped Supabase migrations were found');
  }

  return {
    count: migrations.length,
    latestVersion: migrations.at(-1).match(MIGRATION_PATTERN)[1],
  };
}

function readSuccessfulCommands(evidenceRoot, commandsPath) {
  const commandsFile = resolveEvidenceFile(evidenceRoot, commandsPath);
  const commands = readJson(commandsFile.target);

  if (!Array.isArray(commands) || commands.length === 0) {
    fail('commands evidence must be a non-empty array');
  }

  const validatedCommands = commands.map((command, index) => {
    const commandText = requireNonEmptyString(command.command, `commands[${index}].command`);
    const toolVersion = requireNonEmptyString(
      command.toolVersion,
      `commands[${index}].toolVersion`,
    );
    const startedAtUtc = requireNonEmptyString(
      command.startedAtUtc,
      `commands[${index}].startedAtUtc`,
    );
    const endedAtUtc = requireNonEmptyString(
      command.endedAtUtc,
      `commands[${index}].endedAtUtc`,
    );
    const log = resolveEvidenceFile(evidenceRoot, command.logPath);

    if (command.exitCode !== 0) {
      fail(`commands[${index}] did not pass`);
    }

    const startedAt = Date.parse(startedAtUtc);
    const endedAt = Date.parse(endedAtUtc);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
      fail(`commands[${index}] has an invalid UTC time range`);
    }

    return {
      command: commandText,
      toolVersion,
      startedAtUtc,
      endedAtUtc,
      exitCode: 0,
      logPath: log.logicalPath,
      logSha256: sha256(log.target),
    };
  });

  if (validatedCommands.length !== REQUIRED_COMMANDS.length) {
    fail('commands evidence must contain the exact required release command set');
  }

  for (const requiredCommand of REQUIRED_COMMANDS) {
    if (validatedCommands.filter((entry) => entry.command === requiredCommand).length !== 1) {
      fail(`commands evidence must contain exactly one ${requiredCommand}`);
    }
  }

  return validatedCommands;
}

function validateDigest(value, name) {
  if (!SHA256_PATTERN.test(value ?? '')) {
    fail(`${name} must be a lowercase SHA-256 digest`);
  }
}

function validateUpstreamGates(evidenceRoot, logicalPath, expectedSha, expectedBranch) {
  const file = resolveEvidenceFile(evidenceRoot, logicalPath);
  const records = readJson(file.target);
  const requiredWorkflows = new Map([
    ['ci.yml', new Set(['push'])],
    ['quality.yml', new Set(['push'])],
    ['database-validation.yml', new Set(['push', 'workflow_dispatch'])],
    ['docker-validation.yml', new Set(['push', 'workflow_dispatch'])],
  ]);

  if (!Array.isArray(records)) {
    fail('upstream gate evidence must be an array');
  }

  for (const [workflow, allowedEvents] of requiredWorkflows) {
    const matchingRecords = records.filter((record) => record?.workflow === workflow);
    if (matchingRecords.length !== 1) {
      fail(`upstream gate evidence must contain exactly one ${workflow} record`);
    }

    const [record] = matchingRecords;
    if (
      record.headSha !== expectedSha
      || record.headBranch !== expectedBranch
      || record.status !== 'completed'
      || record.conclusion !== 'success'
      || !allowedEvents.has(record.event)
      || !Number.isSafeInteger(record.runId)
      || record.runId <= 0
      || !Number.isSafeInteger(record.runAttempt)
      || record.runAttempt <= 0
      || !/^https:\/\/github\.com\//.test(record.htmlUrl ?? '')
    ) {
      fail(`${workflow} upstream gate identity is invalid`);
    }
  }

  return file;
}

export function validateReleaseEvidenceManifest(manifest, evidenceRoot, expectedSha) {
  if (!SHA_PATTERN.test(expectedSha)) {
    fail('expected commit SHA must be a lowercase full SHA');
  }

  if (manifest?.templateStatus !== 'generated-from-immutable-candidate') {
    fail('manifest was not generated as immutable candidate evidence');
  }

  if (
    manifest?.candidate?.commitSha !== expectedSha
    || manifest?.candidate?.treeClean !== true
    || manifest?.repositoryEvidence?.status !== 'passed'
  ) {
    fail('candidate identity or repository evidence status is invalid');
  }

  if (JSON.stringify(manifest).includes('REPLACE_WITH_')) {
    fail('manifest still contains a template placeholder');
  }

  const commands = manifest.repositoryEvidence.commands;
  if (!Array.isArray(commands) || commands.length === 0) {
    fail('manifest has no command evidence');
  }

  for (const [index, command] of commands.entries()) {
    if (command.exitCode !== 0) {
      fail(`manifest command ${index} is not successful`);
    }

    validateDigest(command.logSha256, `commands[${index}].logSha256`);
    const log = resolveEvidenceFile(evidenceRoot, command.logPath);
    if (sha256(log.target) !== command.logSha256) {
      fail(`manifest command ${index} log checksum does not match`);
    }
  }

  const aggregateCommand = commands.find((command) => command.command === AGGREGATE_COMMAND);
  if (
    !aggregateCommand
    || manifest.repositoryEvidence.aggregateCommand !== AGGREGATE_COMMAND
    || manifest.repositoryEvidence.logPath !== aggregateCommand.logPath
    || manifest.repositoryEvidence.logSha256 !== aggregateCommand.logSha256
  ) {
    fail('aggregate repository evidence must exactly reference npm run verify:release');
  }

  const evidenceFiles = [
    ['repositoryEvidence.sbomPath', manifest.repositoryEvidence.sbomPath, manifest.repositoryEvidence.sbomSha256],
    [
      'repositoryEvidence.workerSbomPath',
      manifest.repositoryEvidence.workerSbomPath,
      manifest.repositoryEvidence.workerSbomSha256,
    ],
    [
      'repositoryEvidence.expoExportChecksumPath',
      manifest.repositoryEvidence.expoExportChecksumPath,
      manifest.repositoryEvidence.expoExportChecksumSha256,
    ],
    [
      'repositoryEvidence.upstreamGatesPath',
      manifest.repositoryEvidence.upstreamGatesPath,
      manifest.repositoryEvidence.upstreamGatesSha256,
    ],
  ];

  for (const [name, logicalPath, digest] of evidenceFiles) {
    validateDigest(digest, `${name} digest`);
    const file = resolveEvidenceFile(evidenceRoot, logicalPath);
    if (sha256(file.target) !== digest) {
      fail(`${name} checksum does not match`);
    }
  }

  validateUpstreamGates(
    evidenceRoot,
    manifest.repositoryEvidence.upstreamGatesPath,
    expectedSha,
    manifest.candidate.branchOrTag,
  );

  if (
    manifest.releaseDecision?.status !== 'NO-GO'
    || manifest.edgeEvidence?.status !== 'pending'
    || manifest.artifacts?.android?.status !== 'missing'
    || manifest.artifacts?.ios?.status !== 'missing'
  ) {
    fail('repository-only evidence must not claim provider or signed artifact completion');
  }

  const manualGateKeys = Object.keys(manifest.manualGates ?? {}).sort();
  if (
    JSON.stringify(manualGateKeys) !== JSON.stringify([...REQUIRED_MANUAL_GATES].sort())
    || Object.values(manifest.manualGates).some((status) => status !== 'pending')
  ) {
    fail('repository-only evidence must contain every manual gate exactly once and pending');
  }

  const pendingExternalStatuses = [
    ['dockerEvidence.status', manifest.dockerEvidence?.status],
    ['databaseEvidence.firstLocalReplayStatus', manifest.databaseEvidence?.firstLocalReplayStatus],
    ['databaseEvidence.secondLocalReplayStatus', manifest.databaseEvidence?.secondLocalReplayStatus],
    ['databaseEvidence.pgTapStatus', manifest.databaseEvidence?.pgTapStatus],
    ['databaseEvidence.migrationReplayStatus', manifest.databaseEvidence?.migrationReplayStatus],
    ['databaseEvidence.databaseLintPublicStorageStatus', manifest.databaseEvidence?.databaseLintPublicStorageStatus],
    ['databaseEvidence.databaseLintFullStatus', manifest.databaseEvidence?.databaseLintFullStatus],
    ['databaseEvidence.databaseAdvisorWarnStatus', manifest.databaseEvidence?.databaseAdvisorWarnStatus],
    ['databaseEvidence.atomicNonceConcurrency.status', manifest.databaseEvidence?.atomicNonceConcurrency?.status],
    ['databaseEvidence.schemaDiffStatus', manifest.databaseEvidence?.schemaDiffStatus],
    ['databaseEvidence.rlsIdorAttackStatus', manifest.databaseEvidence?.rlsIdorAttackStatus],
    ['databaseEvidence.accountDeletionDrillStatus', manifest.databaseEvidence?.accountDeletionDrillStatus],
    ['databaseEvidence.moderationDrillStatus', manifest.databaseEvidence?.moderationDrillStatus],
    ['databaseEvidence.productionApplyStatus', manifest.databaseEvidence?.productionApplyStatus],
    ['restoreEvidence.status', manifest.restoreEvidence?.status],
    ['restoreEvidence.localLogicalRestore.status', manifest.restoreEvidence?.localLogicalRestore?.status],
    ['restoreEvidence.providerPitrRestoreStatus', manifest.restoreEvidence?.providerPitrRestoreStatus],
    ['restoreEvidence.storageObjectRestoreStatus', manifest.restoreEvidence?.storageObjectRestoreStatus],
    ['otaEvidence.classifierStatus', manifest.otaEvidence?.classifierStatus],
    ['otaEvidence.preview.status', manifest.otaEvidence?.preview?.status],
    ['otaEvidence.production.status', manifest.otaEvidence?.production?.status],
    ['otaEvidence.codeSigning.invalidSignatureTestStatus', manifest.otaEvidence?.codeSigning?.invalidSignatureTestStatus],
    ['runtimeEvidence.accessibilityStatus', manifest.runtimeEvidence?.accessibilityStatus],
    ['runtimeEvidence.offlineProcessKillStatus', manifest.runtimeEvidence?.offlineProcessKillStatus],
    ['runtimeEvidence.loadStatus', manifest.runtimeEvidence?.loadStatus],
    ['runtimeEvidence.observabilityStatus', manifest.runtimeEvidence?.observabilityStatus],
    ['runtimeEvidence.alertDeliveryStatus', manifest.runtimeEvidence?.alertDeliveryStatus],
    ['runtimeEvidence.restoreDrillStatus', manifest.runtimeEvidence?.restoreDrillStatus],
    ['runtimeEvidence.storeReviewStatus', manifest.runtimeEvidence?.storeReviewStatus],
  ];
  const completedExternalStatus = pendingExternalStatuses.find(([, status]) => status !== 'pending');
  if (completedExternalStatus) {
    fail(`repository-only evidence must leave ${completedExternalStatus[0]} pending`);
  }

  if (
    manifest.restoreEvidence.localLogicalRestore.expectedSchemaContract
      !== manifest.databaseEvidence.requiredMigration
    || manifest.artifacts.android.versionCode !== manifest.candidate.androidVersionCode
    || manifest.artifacts.ios.buildNumber !== manifest.candidate.iosBuildNumber
    || manifest.otaEvidence.preview.runtimeVersion !== manifest.candidate.runtimeVersion
    || manifest.otaEvidence.production.runtimeVersion !== manifest.candidate.runtimeVersion
    || manifest.runtimeEvidence.androidDevices.length !== 0
    || manifest.runtimeEvidence.iosDevices.length !== 0
    || manifest.scorecard?.areasAtOrAbove9_80 !== 0
    || manifest.scorecard?.allAreasSameShaEvidenceComplete !== false
    || manifest.scorecard?.average !== null
    || !Array.isArray(manifest.riskAcceptance)
    || manifest.riskAcceptance.length !== 0
  ) {
    fail('repository-only evidence contains inconsistent candidate or external evidence claims');
  }

  return true;
}

export function buildReleaseEvidenceManifest(options) {
  const repoRoot = resolve(options.repoRoot);
  const evidenceRoot = resolve(options.evidenceRoot);
  const template = readJson(resolve(options.templatePath));
  const appConfig = readJson(resolve(repoRoot, 'app.json'));
  const expo = appConfig.expo;

  if (!expo || typeof expo !== 'object') {
    fail('app.json has no expo configuration');
  }

  const commitSha = requireNonEmptyString(options.commitSha, 'commit SHA');
  if (!SHA_PATTERN.test(commitSha)) {
    fail('commit SHA must be a lowercase full SHA');
  }

  const repository = requireNonEmptyString(options.repository, 'repository');
  const refName = requireNonEmptyString(options.refName, 'ref name');
  const createdAtUtc = requireNonEmptyString(options.createdAtUtc, 'createdAtUtc');
  if (!Number.isFinite(Date.parse(createdAtUtc))) {
    fail('createdAtUtc must be an ISO-8601 timestamp');
  }

  const commitFile = resolveEvidenceFile(evidenceRoot, 'repository/commit-sha.txt');
  if (readFileSync(commitFile.target, 'utf8').trim() !== commitSha) {
    fail('commit-sha.txt does not match the requested candidate');
  }

  const statusFile = resolveEvidenceFile(evidenceRoot, 'repository/git-status.txt');
  if (readFileSync(statusFile.target, 'utf8').trim()) {
    fail('git-status.txt proves that the candidate tree was dirty');
  }

  const commands = readSuccessfulCommands(
    evidenceRoot,
    options.commandsPath ?? 'repository/commands.json',
  );
  const sbom = resolveEvidenceFile(evidenceRoot, 'repository/sbom.cdx.json');
  const workerSbom = resolveEvidenceFile(evidenceRoot, 'repository/worker-sbom.cdx.json');
  const expoExportChecksum = resolveEvidenceFile(evidenceRoot, 'ota/expo-export.sha256');
  const upstreamGates = validateUpstreamGates(
    evidenceRoot,
    'repository/upstream-gates.json',
    commitSha,
    refName,
  );
  const migrationIdentity = readMigrationIdentity(repoRoot);
  const runtimeVersion = parseExplicitRuntimeVersion(expo);
  if (template.repositoryEvidence?.aggregateCommand !== AGGREGATE_COMMAND) {
    fail(`manifest template aggregateCommand must be ${AGGREGATE_COMMAND}`);
  }
  const aggregateCommand = commands.find((command) => command.command === AGGREGATE_COMMAND);

  if (!Number.isInteger(expo.android?.versionCode) || expo.android.versionCode <= 0) {
    fail('app.json Android versionCode must be a positive integer');
  }

  if (!/^\d+$/.test(expo.ios?.buildNumber ?? '')) {
    fail('app.json iOS buildNumber must be a numeric string');
  }

  const manifest = structuredClone(template);
  manifest.templateStatus = 'generated-from-immutable-candidate';
  manifest.candidate = {
    ...manifest.candidate,
    repository,
    commitSha,
    branchOrTag: refName,
    treeClean: true,
    appVersion: requireNonEmptyString(expo.version, 'app version'),
    runtimeVersion,
    androidVersionCode: expo.android.versionCode,
    iosBuildNumber: expo.ios.buildNumber,
    createdAtUtc,
  };
  manifest.sourceContract = {
    ...manifest.sourceContract,
    featureGuardStatus: 'passed',
    newProductSurface: false,
  };
  manifest.repositoryEvidence = {
    ...manifest.repositoryEvidence,
    status: 'passed',
    logPath: aggregateCommand.logPath,
    logSha256: aggregateCommand.logSha256,
    sbomPath: sbom.logicalPath,
    sbomSha256: sha256(sbom.target),
    workerSbomPath: workerSbom.logicalPath,
    workerSbomSha256: sha256(workerSbom.target),
    expoExportChecksumPath: expoExportChecksum.logicalPath,
    expoExportChecksumSha256: sha256(expoExportChecksum.target),
    upstreamGatesPath: upstreamGates.logicalPath,
    upstreamGatesSha256: sha256(upstreamGates.target),
    commands,
  };
  manifest.databaseEvidence = {
    ...manifest.databaseEvidence,
    requiredMigration: migrationIdentity.latestVersion,
    migrationCount: migrationIdentity.count,
  };
  if (manifest.restoreEvidence?.localLogicalRestore) {
    manifest.restoreEvidence = {
      ...manifest.restoreEvidence,
      localLogicalRestore: {
        ...manifest.restoreEvidence.localLogicalRestore,
        expectedSchemaContract: migrationIdentity.latestVersion,
      },
    };
  }
  manifest.artifacts = {
    ...manifest.artifacts,
    android: {
      ...manifest.artifacts.android,
      versionCode: expo.android.versionCode,
    },
    ios: {
      ...manifest.artifacts.ios,
      buildNumber: expo.ios.buildNumber,
    },
  };
  manifest.otaEvidence = {
    ...manifest.otaEvidence,
    preview: {
      ...manifest.otaEvidence.preview,
      runtimeVersion,
    },
    production: {
      ...manifest.otaEvidence.production,
      runtimeVersion,
    },
  };
  manifest.releaseDecision = {
    ...manifest.releaseDecision,
    status: 'NO-GO',
    approvedBy: [],
    approvedAtUtc: null,
    statement:
      'AUTOMATED REPOSITORY EVIDENCE PASSED; RELEASE REMAINS NO-GO UNTIL SAME-SHA DATABASE, PROVIDER, SIGNED ARTIFACT, DEVICE, AND MANUAL EVIDENCE IS ATTACHED.',
  };

  validateReleaseEvidenceManifest(manifest, evidenceRoot, commitSha);

  const outputPath = resolve(options.outputPath);
  const outputParent = dirname(outputPath);
  if (outputParent !== evidenceRoot) {
    fail('manifest output must be written directly inside the evidence root');
  }

  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function parseOptions(argumentsList) {
  const options = {};

  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];

    if (!key?.startsWith('--') || value === undefined) {
      fail(`invalid CLI argument near ${key ?? '<end>'}`);
    }

    options[key.slice(2)] = value;
  }

  return options;
}

function requireOption(options, name) {
  return requireNonEmptyString(options[name], `--${name}`);
}

function runCli() {
  const [command, ...argumentsList] = process.argv.slice(2);
  const options = parseOptions(argumentsList);

  if (command === 'build') {
    const manifest = buildReleaseEvidenceManifest({
      repoRoot: requireOption(options, 'repo-root'),
      evidenceRoot: requireOption(options, 'evidence-root'),
      templatePath: requireOption(options, 'template'),
      outputPath: requireOption(options, 'output'),
      repository: requireOption(options, 'repository'),
      commitSha: requireOption(options, 'commit-sha'),
      refName: requireOption(options, 'ref-name'),
      createdAtUtc: requireOption(options, 'created-at-utc'),
      commandsPath: options['commands-path'],
    });
    console.log(`Generated NO-GO release evidence for ${manifest.candidate.commitSha}.`);
    return;
  }

  if (command === 'verify') {
    const evidenceRoot = requireOption(options, 'evidence-root');
    const manifestPath = requireOption(options, 'manifest');
    const commitSha = requireOption(options, 'commit-sha');
    validateReleaseEvidenceManifest(readJson(manifestPath), evidenceRoot, commitSha);
    console.log(`Verified release evidence manifest for ${commitSha}.`);
    return;
  }

  fail('first argument must be build or verify');
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
