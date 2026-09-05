import assert from 'node:assert/strict';

import { waitForHealth } from '../scripts/wait-for-health.mjs';

const baseUrl = (process.env.TMDB_MOCK_URL ?? '').replace(/\/$/, '');
assert.ok(baseUrl, 'TMDB_MOCK_URL is required');
await waitForHealth(`${baseUrl}/health`);

const success = await fetch(`${baseUrl}/3/search/movie?query=synthetic&language=tr-TR`, {
  headers: { 'x-request-id': 'tmdb-contract-success' },
});
assert.equal(success.status, 200);
assert.match(success.headers.get('cache-control') ?? '', /s-maxage=300/);
assert.equal(success.headers.get('x-request-id'), 'tmdb-contract-success');
assert.deepEqual((await success.json()).results.map((item) => item.id), [550]);

for (const [scenario, expectedStatus] of [
  ['unauthorized', 401],
  ['not-found', 404],
  ['rate-limited', 429],
  ['server-error', 503],
]) {
  const response = await fetch(`${baseUrl}/3/movie/550?__scenario=${scenario}`);
  assert.equal(response.status, expectedStatus, scenario);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  if (expectedStatus === 429) {
    assert.equal(response.headers.get('retry-after'), '1');
  }
}

const malformed = await fetch(`${baseUrl}/3/movie/550?__scenario=malformed`);
await assert.rejects(() => malformed.json(), SyntaxError);

await assert.rejects(
  () => fetch(`${baseUrl}/3/movie/550?__scenario=timeout`, { signal: AbortSignal.timeout(200) }),
  /abort|timeout/i,
);

const methodRejected = await fetch(`${baseUrl}/3/movie/550`, { method: 'POST' });
assert.equal(methodRejected.status, 405);

process.stdout.write('TMDB deterministic upstream contract: PASS\n');

