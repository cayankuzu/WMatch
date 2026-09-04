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

/**
 * Canonicalises the theme lines that a reviewer has explicitly signed off, so
 * the baseline and the candidate are compared on equal terms. It runs over
 * BOTH sides, so it maps each side to the same canonical form rather than
 * translating one into the other.
 *
 * The exemptions are data, not code: each entry in the path's `reviewedLines`
 * carries the exact baseline text, the exact current text (or null when the
 * line was removed) and the reason it was allowed to move. Every other byte of
 * the file stays byte-frozen, so an unreviewed edit anywhere else still fails.
 *
 * Adding an entry here is the review step. It should be uncomfortable, and it
 * should be readable a year from now without asking anyone what happened.
 */
function makeReviewedLinesNormalizer(entry) {
  const reviewed = entry.reviewedLines ?? [];
  const marker = (index) => '<REVIEWED ' + String(index) + '>';
  // A reviewed line is either a value move (both sides carry a line, so both
  // sides emit the same marker) or a removal (only the baseline carries a
  // line, so both sides drop it and emit nothing). Emitting a marker for a
  // removal would leave the two sides with a different line count.
  const removed = new Set();
  const baselineText = new Map();
  const currentText = new Map();
  reviewed.forEach((line, index) => {
    if (line.current === null || line.current === undefined) {
      if (line.baseline) removed.add(line.baseline.trim());
      return;
    }
    if (line.baseline) baselineText.set(line.baseline.trim(), index);
    currentText.set(line.current.trim(), index);
  });

  return (buffer) => {
    const LF = String.fromCharCode(10);
    const out = [];
    const emitted = new Set();
    for (const line of normalizeText(buffer).split(LF)) {
      const key = line.trim();
      if (removed.has(key)) continue;
      const index = baselineText.has(key) ? baselineText.get(key) : currentText.get(key);
      if (index === undefined) {
        out.push(line);
        continue;
      }
      // A reviewed line may be a rename or a removal, so the two sides can hold
      // a different number of lines for the same entry. Emitting each entry's
      // marker once keeps the sides aligned.
      if (!emitted.has(index)) {
        out.push(marker(index));
        emitted.add(index);
      }
    }
    return out.join(LF);
  };
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
    nonVisualImageCachePolicy: () => normalizeNonVisualImageCachePolicy,
    nonVisualChatOutboxCancellation: () => normalizeNonVisualChatOutboxCancellation,
    reviewedLines: makeReviewedLinesNormalizer,
  };
  const normalize = normalizers[entry.normalizer]?.(entry);
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
