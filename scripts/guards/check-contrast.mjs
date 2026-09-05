/**
 * WCAG 2.2 contrast guard for the single WMatch token set.
 *
 * The app ships one dark theme, so every semantic pair below is a real
 * foreground/background combination the UI can render. Alpha foregrounds and
 * alpha surfaces are composited onto their opaque base before measuring —
 * measuring an rgba() value in isolation is meaningless.
 *
 * Thresholds follow WCAG 2.2 SC 1.4.3 (text) and 1.4.11 (non-text contrast):
 *   - normal text  >= 4.5:1
 *   - large text   >= 3.0:1   (>=18.66px bold or >=24px regular)
 *   - UI component / state boundary >= 3.0:1
 */
import { readFileSync } from 'node:fs';

const THEME_PATH = new URL('../../src/shared/theme/index.ts', import.meta.url);
const source = readFileSync(THEME_PATH, 'utf8');

function parseColor(value) {
  const raw = String(value).trim();
  if (raw.startsWith('#')) {
    const hex = raw.slice(1).length === 3 ? raw.slice(1).replace(/./g, (c) => c + c) : raw.slice(1);
    return { rgb: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)), alpha: 1 };
  }
  const match = raw.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.slice(0, 3).some(Number.isNaN)) return null;
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

function composite(color, baseRgb) {
  return color.rgb.map((channel, index) => channel * color.alpha + baseRgb[index] * (1 - color.alpha));
}

function relativeLuminance(rgb) {
  const linear = rgb.map((channel) => {
    const normalised = channel / 255;
    return normalised <= 0.03928
      ? normalised / 12.92
      : Math.pow((normalised + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(foregroundRgb, backgroundRgb) {
  const a = relativeLuminance(foregroundRgb);
  const b = relativeLuminance(backgroundRgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readTokens() {
  const tokens = new Map();
  const pattern = /(['"]?)([A-Za-z0-9_$]+)\1\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))['"]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (!tokens.has(match[2])) tokens.set(match[2], match[3]);
  }
  return tokens;
}

const tokens = readTokens();
const APP_BASE = 'background';

function resolve(name) {
  const value = tokens.get(name);
  if (!value) throw new Error(`Unknown theme token referenced by the contrast guard: ${name}`);
  const parsed = parseColor(value);
  if (!parsed) throw new Error(`Theme token ${name} is not a parseable colour: ${value}`);
  return parsed;
}

/** Resolve a background token down to opaque RGB, compositing over the app base. */
function backgroundRgb(name) {
  const color = resolve(name);
  if (color.alpha === 1) return color.rgb;
  return composite(color, resolve(APP_BASE).rgb);
}

function measure(foreground, background) {
  const base = backgroundRgb(background);
  return ratio(composite(resolve(foreground), base), base);
}

/**
 * `kind` selects the WCAG threshold:
 *   text  -> 4.5   large -> 3.0   ui -> 3.0
 * Every entry names the surface the pair is actually rendered on, so a token
 * rename or palette drift fails here rather than in a user's hands.
 */
const SURFACES = ['background', 'backgroundElevated', 'surface', 'surfaceMuted', 'surfaceStrong'];

const pairs = [
  // Body and secondary copy across every container the app renders text in.
  ...SURFACES.flatMap((surface) => [
    { foreground: 'textPrimary', background: surface, kind: 'text' },
    { foreground: 'textSecondary', background: surface, kind: 'text' },
    { foreground: 'textTertiary', background: surface, kind: 'text' },
  ]),

  // Status copy sits on its own tinted surface, never on the raw background.
  { foreground: 'successText', background: 'successSurface', kind: 'text' },
  { foreground: 'warningText', background: 'warningSurface', kind: 'text' },
  { foreground: 'dangerText', background: 'dangerSurface', kind: 'text' },
  { foreground: 'infoText', background: 'infoSurface', kind: 'text' },
  { foreground: 'accentText', background: 'primarySurface', kind: 'text' },

  // Filled controls: the label colour on every brand/status fill.
  { foreground: 'onAccent', background: 'primary', kind: 'text' },
  { foreground: 'onAccent', background: 'primaryStrong', kind: 'text' },
  { foreground: 'onAccent', background: 'danger', kind: 'text' },
  { foreground: 'onAccent', background: 'notificationAccent', kind: 'text' },

  // Non-text contrast: a state boundary a user must be able to see.
  ...['surface', 'surfaceMuted', 'surfaceStrong'].map((surface) => ({
    foreground: 'borderFocus',
    background: surface,
    kind: 'ui',
  })),

  // Selected state on chips, photo tiles and the swipe rail is carried by a
  // brand-coloured outline. SC 1.4.11 covers the state boundary, so the
  // outline is held to 3:1 against every surface a selectable control sits on.
  ...['background', 'backgroundElevated', 'surface', 'surfaceMuted'].map((surface) => ({
    foreground: 'primary',
    background: surface,
    kind: 'ui',
  })),

  // Disabled copy is exempt from SC 1.4.3 but must still stay legible enough
  // to read the label of a control the user is trying to understand.
  { foreground: 'disabledText', background: 'disabledSurface', kind: 'large' },
];

const THRESHOLDS = { text: 4.5, large: 3, ui: 3 };

/**
 * Measured but not enforced, with the reason recorded next to the number.
 *
 * `border` / `borderStrong` are hairlines that refine a container which is
 * already identified by its fill, its icon and its text label. SC 1.4.11
 * applies to information *required* to identify a component, so a decorative
 * outline is out of scope. The ratios are still printed on every run: if a
 * future change makes one of these the sole affordance for a control, the
 * number is already on screen rather than hidden behind a deleted assertion.
 */
const REPORTED = [
  { foreground: 'border', background: 'surface' },
  { foreground: 'borderStrong', background: 'surface' },
  { foreground: 'borderStrong', background: 'background' },
];

const failures = [];
const rows = [];

for (const pair of pairs) {
  const value = measure(pair.foreground, pair.background);
  const required = THRESHOLDS[pair.kind];
  const ok = value >= required;
  rows.push({ ...pair, value, required, ok });
  if (!ok) failures.push({ ...pair, value, required });
}

for (const row of rows) {
  const status = row.ok ? 'PASS' : 'FAIL';
  process.stdout.write(
    `${status} ${row.foreground} on ${row.background} = ${row.value.toFixed(2)}:1 ` +
      `(needs ${row.required.toFixed(1)}:1, ${row.kind})\n`,
  );
}

for (const entry of REPORTED) {
  const value = measure(entry.foreground, entry.background);
  process.stdout.write(
    `INFO ${entry.foreground} on ${entry.background} = ${value.toFixed(2)}:1 ` +
      '(decorative hairline, not an identifying boundary)\n',
  );
}

if (failures.length > 0) {
  process.stderr.write(`\nContrast guard failed for ${failures.length} semantic pair(s).\n`);
  for (const failure of failures) {
    process.stderr.write(
      `  ${failure.foreground} on ${failure.background}: ` +
        `${failure.value.toFixed(2)}:1 < ${failure.required.toFixed(1)}:1\n`,
    );
  }
  process.exit(1);
}

process.stdout.write(`\nContrast guard passed. pairs=${rows.length}\n`);
