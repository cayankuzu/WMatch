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
 * Canonicalises the source a reviewer has explicitly signed off, so the
 * baseline and the candidate are compared on equal terms. It runs over BOTH
 * sides, so it maps each side to the same canonical form rather than
 * translating one into the other.
 *
 * The exemptions are data, not code. Each entry in the path's `reviewedLines`
 * carries the exact baseline text, the exact current text, and the reason the
 * change was allowed. `baseline` and `current` accept either one line or an
 * array of contiguous lines, so a block that moved or was deleted can be
 * described precisely instead of by matching lines that repeat elsewhere in
 * the file. `current: null` means the block was removed.
 *
 * Everything outside these entries stays byte-frozen, so an unreviewed edit
 * anywhere else still fails.
 *
 * Adding an entry here is the review step. It should be uncomfortable, and it
 * should be readable a year from now without asking anyone what happened.
 */
function makeReviewedLinesNormalizer(entry) {
  const asLines = (value) =>
    value === null || value === undefined
      ? null
      : (Array.isArray(value) ? value : [value]).map((line) => line.trim());

  // A run is matched by its whole contiguous text, so a generic line such as a
  // closing brace only matches as part of the block it was declared in.
  const runs = [];
  (entry.reviewedLines ?? []).forEach((line, index) => {
    const baseline = asLines(line.baseline);
    const current = asLines(line.current);
    // A pure addition or a pure removal emits nothing on either side, because
    // only one side has anything to drop. A change that exists on both sides
    // emits one marker, so a rename or a length change stays aligned.
    const replacement =
      baseline === null || current === null ? null : '<REVIEWED ' + String(index) + '>';
    if (baseline) runs.push({ index, lines: baseline, replacement });
    if (current) runs.push({ index, lines: current, replacement });
  });
  // Longest first: a short run must never shadow a longer one that starts at
  // the same line.
  runs.sort((a, b) => b.lines.length - a.lines.length);

  return (buffer) => {
    const LF = String.fromCharCode(10);
    const source = normalizeText(buffer).split(LF);
    const trimmed = source.map((line) => line.trim());
    const out = [];
    const emitted = new Set();

    for (let position = 0; position < source.length; ) {
      const run = runs.find(
        (candidate) =>
          candidate.lines.length <= source.length - position &&
          candidate.lines.every((line, offset) => trimmed[position + offset] === line),
      );

      if (!run) {
        out.push(source[position]);
        position += 1;
        continue;
      }

      if (run.replacement !== null && !emitted.has(run.index)) {
        out.push(run.replacement);
        emitted.add(run.index);
      }
      position += run.lines.length;
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
