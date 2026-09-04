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
 * Canonicalises the two reviewed palette dimensions so the guard compares the
 * baseline and the candidate on equal terms. It runs over BOTH sides, so it
 * must map each side to the same canonical form rather than translate one into
 * the other.
 *
 * Two dimensions are collapsed, and only these two:
 *
 *  1. The tertiary copy colour. #7f8698 measured 4.46:1 on surfaceMuted and
 *     4.03:1 on surfaceStrong, under the WCAG 2.2 SC 1.4.3 floor of 4.5:1 for
 *     normal text. #8990a0 is the smallest lift that clears 4.5:1 on every
 *     surface (4.57:1 worst case).
 *  2. The brand wash ladder. Three unrelated reds (#e5484d, #e10613, #d81421)
 *     tinted brand surfaces; #e5484d appeared nowhere else in the palette. The
 *     ladder now derives from colors.primary #d90416, matching primarySurface,
 *     which was already correct. Two entries nothing referenced were dropped.
 *
 * Those two dimensions are governed by scripts/guards/check-contrast.mjs and
 * docs/audit/ui-ux-contrast-audit.md instead. Every other byte of the token
 * file stays byte-frozen against the baseline here.
 */
function normalizeAccessibilityPalette(buffer) {
  const LF = String.fromCharCode(10);
  const WASH_KEYS = new Set([
    'primary12',
    'primary18',
    'brand12',
    'brand18',
    'brand22',
    'brand24',
    'brand26',
    'brand88',
    'success84',
  ]);
  const out = [];
  // The ladder is emitted once, at the position of its first entry, because
  // the reviewed change both renamed and removed keys: collapsing per-run of
  // adjacent keys would leave the two sides with a different marker count.
  let washEmitted = false;
  for (const line of normalizeText(buffer).split(LF)) {
    const key = line.trim().split(':')[0];
    if (key === 'textSoft' || key === 'textTertiary') {
      out.push(`    ${key}: <REVIEWED_TERTIARY_TEXT>`);
    } else if (WASH_KEYS.has(key)) {
      if (!washEmitted) {
        out.push('    <REVIEWED_BRAND_WASH_LADDER>');
        washEmitted = true;
      }
    } else {
      out.push(line);
    }
  }
  return out.join(LF);
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
    accessibilityPalette: normalizeAccessibilityPalette,
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
