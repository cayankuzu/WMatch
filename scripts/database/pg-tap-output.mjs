export function parsePgTapOutput(output, testFile) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const plans = lines.filter((line) => /^1\.\.\d+$/.test(line));
  const assertions = lines.filter((line) => /^(?:not )?ok\s+\d+\b/.test(line));
  const bailouts = lines.filter((line) => /^Bail out!/i.test(line));

  if (bailouts.length > 0) {
    throw new Error(`Restored pgTAP bailed out for ${testFile}:\n${output}`);
  }

  if (plans.length !== 1) {
    throw new Error(
      `Restored pgTAP must emit exactly one plan for ${testFile}; received ${plans.length}:\n${output}`,
    );
  }

  const planned = Number(plans[0].slice(3));
  if (planned < 1 || assertions.length < 1) {
    throw new Error(`Restored pgTAP emitted no assertions for ${testFile}:\n${output}`);
  }

  const failed = assertions.filter((line) => line.startsWith('not ok '));
  if (failed.length > 0) {
    throw new Error(`Restored pgTAP failed for ${testFile}:\n${output}`);
  }

  if (planned !== assertions.length) {
    throw new Error(
      `Restored pgTAP plan mismatch for ${testFile}: planned=${planned}, assertions=${assertions.length}`,
    );
  }

  const assertionNumbers = assertions.map((line) => Number(line.match(/^ok\s+(\d+)\b/)?.[1]));
  if (assertionNumbers.some((number, index) => number !== index + 1)) {
    throw new Error(`Restored pgTAP assertion numbering is invalid for ${testFile}:\n${output}`);
  }

  return assertions.length;
}
