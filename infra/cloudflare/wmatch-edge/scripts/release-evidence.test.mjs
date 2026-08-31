import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = join(dirname(fileURLToPath(import.meta.url)), "release-evidence.mjs");
const baseline = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const sha = "0123456789abcdef0123456789abcdef01234567";

function withFixture(value, callback) {
  const directory = mkdtempSync(join(tmpdir(), "wmatch-release-evidence-"));
  const path = join(directory, "evidence.json");
  try {
    writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
    return callback(path);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function assertSuccess(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("resolves one immutable version by full commit tag", () => {
  withFixture([{ id: target, annotations: { "workers/tag": sha } }], (path) => {
    const result = run("resolve-tag", path, sha);
    assertSuccess(result);
    assert.equal(result.stdout.trim(), target);
  });
});

test("rejects ambiguous immutable version tags", () => {
  withFixture(
    [
      { id: target, annotations: { "workers/tag": sha } },
      { id: baseline, annotations: { "workers/tag": sha } },
    ],
    (path) => {
      const result = run("find-tag", path, sha);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ambiguous/);
    },
  );
});

test("asserts version id and commit metadata", () => {
  withFixture({ id: target, annotations: { "workers/tag": sha } }, (path) => {
    assertSuccess(run("assert-version", path, target, sha));
    assert.notEqual(run("assert-version", path, target, "f".repeat(40)).status, 0);
  });
});

test("enforces each exact rollout predecessor and resulting split", () => {
  const stages = [
    { next: 5, previous: [{ version_id: baseline, percentage: 100 }] },
    {
      next: 25,
      previous: [
        { version_id: baseline, percentage: 95 },
        { version_id: target, percentage: 5 },
      ],
    },
    {
      next: 50,
      previous: [
        { version_id: baseline, percentage: 75 },
        { version_id: target, percentage: 25 },
      ],
    },
    {
      next: 100,
      previous: [
        { version_id: baseline, percentage: 50 },
        { version_id: target, percentage: 50 },
      ],
    },
  ];

  for (const stage of stages) {
    withFixture({ versions: stage.previous }, (path) => {
      assertSuccess(run("assert-previous", path, baseline, target, String(stage.next)));
    });

    const expected =
      stage.next === 100
        ? [{ version_id: target, percentage: 100 }]
        : [
            { version_id: baseline, percentage: 100 - stage.next },
            { version_id: target, percentage: stage.next },
          ];
    withFixture({ versions: expected }, (path) => {
      assertSuccess(run("assert-deployment", path, baseline, target, String(stage.next)));
    });
  }
});

test("rejects a skipped rollout gate", () => {
  withFixture(
    {
      versions: [
        { version_id: baseline, percentage: 75 },
        { version_id: target, percentage: 25 },
      ],
    },
    (path) => {
      assert.notEqual(run("assert-previous", path, baseline, target, "100").status, 0);
    },
  );
});

test("asserts a complete rollback and selects the primary deployment", () => {
  withFixture({ versions: [{ version_id: baseline, percentage: 100 }] }, (path) => {
    assertSuccess(run("assert-rollback", path, baseline));
    const primary = run("primary", path);
    assertSuccess(primary);
    assert.equal(primary.stdout.trim(), baseline);
  });
});

test("requires every deployed secret binding by name", () => {
  withFixture(
    [
      { name: "ORIGIN_ANON_JWT" },
      { name: "ORIGIN_API_KEY" },
      { name: "ORIGIN_HMAC_SECRET" },
      { name: "RATE_LIMIT_HASH_SECRET" },
    ],
    (path) => assertSuccess(run("assert-secrets", path)),
  );

  withFixture([{ name: "ORIGIN_API_KEY" }], (path) => {
    const result = run("assert-secrets", path);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing deployed Worker secrets/);
  });
});
