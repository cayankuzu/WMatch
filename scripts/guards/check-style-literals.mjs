/**
 * Style literals that duplicate a token's value.
 *
 * A bare `fontSize: 12` renders the same as `theme.typography.caption` today
 * and stops matching it the moment the scale moves. That is not theoretical:
 * when the control role went 12 -> 13, every hardcoded 12 stayed behind.
 *
 * The rule is narrow on purpose. A literal is only a finding when the token
 * system already has that exact value under a name. A number no token carries
 * is a bespoke value, and inventing a token to absorb one call site would be
 * worse than the literal.
 *
 * Known remaining sites are listed in ALLOWED below, each with a reason. The
 * list may shrink; adding to it is a review step.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const themeSource = readFileSync(join(repositoryRoot, 'src/shared/theme/index.ts'), 'utf8');

/** Pull the value ladders the guard checks against out of the token file. */
function readLadder(block, pattern) {
  const start = themeSource.indexOf(block);
  if (start === -1) throw new Error(`Cannot find ${block} in the theme`);
  const slice = themeSource.slice(start, themeSource.indexOf('\n  },', start));
  const values = new Map();
  for (const match of slice.matchAll(pattern)) {
    values.set(Number(match[2]), match[1]);
  }
  return values;
}

const typeScale = readLadder('typography: {', /(\w+):\s*(\d+),/g);
const radiusScale = readLadder('radius: {', /(\w+):\s*(\d+),/g);

for (const match of themeSource.matchAll(/(\w+): \{ fontFamily: '[^']+', fontSize: (\d+)/g)) {
  if (!typeScale.has(Number(match[2]))) typeScale.set(Number(match[2]), `roles.${match[1]}`);
}

const PROPERTIES = [
  { name: 'fontSize', scale: typeScale, hint: 'theme.typography' },
  { name: 'borderRadius', scale: radiusScale, hint: 'theme.radius' },
];

/**
 * Sites that still carry a literal, with the reason each one is still here.
 * Every entry is a debt, not an exemption in principle: the visual-regression
 * guard freezes these files byte for byte, and a mechanical substitution is
 * not worth an exemption on a frozen screen. They come out when it lifts.
 */
const ALLOWED = new Map([
  ['src/app/components/BlockedUsersModal.tsx', 'frozen surface; two caption-sized labels'],
  ['src/app/components/ChatScreen.tsx', 'frozen surface; one body-sized label'],
  ['src/app/components/ChatSettingsModal.tsx', 'frozen surface; one section-sized title'],
  ['src/app/components/CompatibilitySheet.tsx', 'frozen surface; caption and a bespoke 20'],
  ['src/app/components/MatchContextSheet.tsx', 'frozen surface; section, title and caption sizes'],
  ['src/app/components/MatchSuccessModal.tsx', 'frozen surface; caption sizes and card radii'],
  ['src/app/components/ProfileModal.tsx', 'frozen surface; section and caption sizes, lg radii'],
  ['src/app/components/ResetPasswordModal.tsx', 'frozen surface; one caption-sized label'],
  ['src/app/components/SettingsModal.tsx', 'frozen surface; caption size, lg and card radii'],
  ['src/app/components/ChatModal.tsx', 'normalized surface; changing it would invalidate its normalizer'],
  ['src/app/components/DiscoveryFiltersModal.tsx', 'normalized surface; changing it would invalidate its normalizer'],
]);

function collect(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const child = join(directory, entry);
    return statSync(child).isDirectory()
      ? collect(child)
      : child.endsWith('.tsx')
        ? [child]
        : [];
  });
}

const findings = [];
const allowedHits = new Set();

for (const file of collect(join(repositoryRoot, 'src'))) {
  const path = relative(repositoryRoot, file).split('\\').join('/');
  if (path.includes('shared/theme')) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const property of PROPERTIES) {
      const match = line.match(new RegExp(property.name + ':\\s*(\\d+)'));
      if (!match) continue;
      const token = property.scale.get(Number(match[1]));
      if (!token) continue;

      if (ALLOWED.has(path)) {
        allowedHits.add(path);
        continue;
      }
      findings.push({ path, line: index + 1, property: property.name, value: match[1], token, hint: property.hint });
    }
  });
}

for (const finding of findings) {
  process.stderr.write(
    `${finding.path}:${finding.line} ${finding.property}: ${finding.value} ` +
      `duplicates ${finding.hint}.${finding.token}\n`,
  );
}

const stale = [...ALLOWED.keys()].filter((path) => !allowedHits.has(path));
for (const path of stale) {
  process.stderr.write(`${path} is on the allowlist but no longer carries a token-valued literal\n`);
}

if (findings.length > 0 || stale.length > 0) {
  process.stderr.write(
    `\nStyle literal guard failed: ${findings.length} literal(s) duplicate a token, ` +
      `${stale.length} stale allowlist entr(ies).\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Style literal guard passed. type values=${typeScale.size} radius values=${radiusScale.size} ` +
    `allowlisted files=${allowedHits.size}\n`,
);
