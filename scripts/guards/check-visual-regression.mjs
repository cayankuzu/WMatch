import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const snapshotPath = resolve(repositoryRoot, 'quality/visual-regression.snapshot.json');
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const featureSnapshotPath = resolve(repositoryRoot, snapshot.featureSurfaceSnapshot);
const featureSnapshot = JSON.parse(readFileSync(featureSnapshotPath, 'utf8'));

function fail(message) {
  console.error(`Visual regression guard failed: ${message}`);
  process.exitCode = 1;
}

function readBaseline(path) {
  try {
    return execFileSync('git', ['show', `${snapshot.baselineCommit}:${path}`], {
      cwd: repositoryRoot,
      encoding: null,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    fail(`baseline file is unavailable at ${snapshot.baselineCommit}:${path}`);
    return null;
  }
}

function normalizeText(buffer) {
  return buffer.toString('utf8').replaceAll('\r\n', '\n').trimEnd();
}

function normalizeNonVisualImageCachePolicy(buffer) {
  return normalizeText(buffer)
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/cachePolicy=(?:"[^"]*"|\{[^\n]*\})/g, 'cachePolicy="<NON_VISUAL_CACHE_POLICY>"')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

function normalizeNonVisualChatOutboxCancellation(buffer) {
  return normalizeText(buffer)
    .replace(/^\s*cancelPendingChatMessage,\n/m, '')
    .replace(', purgeChatOutboxForPeer', '')
    .replace(
      'await cancelPendingChatMessage(currentUserId, message.id);',
      'await removePendingChatMessage(currentUserId, message.id);',
    )
    .replace(
      'threadChat.canSend && threadChat.settings.typingIndicator && isTypingForPresence',
      'threadChat.canSend && isTypingForPresence',
    )
    .replace(/^\s*await purgeChatOutboxForPeer\(currentUserId, threadChat\.userId\);\n/gm, '')
    .replace(/^\s*await purgeChatOutboxForPeer\(currentUserId, targetUserId\);\n/gm, '')
    .replace(
      'const CHAT_BOTTOM_PROXIMITY_PX = 120;\nexport default function',
      'const CHAT_BOTTOM_PROXIMITY_PX = 120;\n\nexport default function',
    );
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

if (snapshot.schemaVersion !== 1) {
  fail(`unsupported snapshot schema ${String(snapshot.schemaVersion)}`);
}

if (snapshot.baselineCommit !== featureSnapshot.baseline?.commit) {
  fail('visual and feature-surface snapshots do not reference the same baseline commit');
}

try {
  execFileSync('git', ['merge-base', '--is-ancestor', snapshot.baselineCommit, 'HEAD'], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  });
} catch {
  fail(`baseline commit ${snapshot.baselineCommit} is not an ancestor of HEAD`);
}

const exactPaths = new Set(snapshot.exactPaths);
for (const group of snapshot.exactSurfaceGroups) {
  const paths = featureSnapshot.surface?.[group];
  if (!Array.isArray(paths) || paths.length === 0) {
    fail(`feature-surface group ${group} is missing or empty`);
    continue;
  }

  for (const path of paths) {
    exactPaths.add(path);
  }
}

for (const entry of snapshot.normalizedPaths) {
  exactPaths.delete(entry.path);
}

let checkedExact = 0;
for (const path of [...exactPaths].sort()) {
  const currentPath = resolve(repositoryRoot, path);
  if (!existsSync(currentPath)) {
    fail(`current visual surface file is missing: ${path}`);
    continue;
  }

  const baseline = readBaseline(path);
  if (baseline === null) {
    continue;
  }

  const current = readFileSync(currentPath);
  const isText = /\.(?:tsx?|json)$/.test(path);
  const baselineDigest = digest(isText ? normalizeText(baseline) : baseline);
  const currentDigest = digest(isText ? normalizeText(current) : current);

  if (baselineDigest !== currentDigest) {
    fail(`${path} differs from the immutable visual baseline`);
    continue;
  }

  checkedExact += 1;
}

let checkedNormalized = 0;
for (const entry of snapshot.normalizedPaths) {
  const normalizers = {
    nonVisualImageCachePolicy: normalizeNonVisualImageCachePolicy,
    nonVisualChatOutboxCancellation: normalizeNonVisualChatOutboxCancellation,
  };
  const normalize = normalizers[entry.normalizer];
  if (!normalize) {
    fail(`unknown normalizer ${String(entry.normalizer)} for ${entry.path}`);
    continue;
  }

  const currentPath = resolve(repositoryRoot, entry.path);
  if (!existsSync(currentPath)) {
    fail(`current normalized visual file is missing: ${entry.path}`);
    continue;
  }

  const baseline = readBaseline(entry.path);
  if (baseline === null) {
    continue;
  }

  const baselineDigest = digest(normalize(baseline));
  const currentDigest = digest(normalize(readFileSync(currentPath)));
  if (baselineDigest !== currentDigest) {
    fail(`${entry.path} contains a change beyond its documented non-visual normalization`);
    continue;
  }

  checkedNormalized += 1;
}

if (!process.exitCode) {
  console.log(
    `Visual regression guard passed: ${checkedExact} exact surfaces and ${checkedNormalized} normalized non-visual surface match ${snapshot.baselineCommit}.`,
  );
}
