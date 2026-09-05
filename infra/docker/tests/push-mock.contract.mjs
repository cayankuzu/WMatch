import assert from 'node:assert/strict';

import { waitForHealth } from '../scripts/wait-for-health.mjs';

const baseUrl = (process.env.PUSH_MOCK_URL ?? '').replace(/\/$/, '');
assert.ok(baseUrl, 'PUSH_MOCK_URL is required');
await waitForHealth(`${baseUrl}/health`);

const validToken = 'ExponentPushToken[synthetic-device-token-01]';
const send = await fetch(`${baseUrl}/--/api/v2/push/send`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ to: validToken, title: 'Synthetic', body: 'No user data' }),
});
assert.equal(send.status, 200);
assert.match((await send.json()).data.id, /^ticket-[a-f0-9]{20}$/);

const invalid = await fetch(`${baseUrl}/--/api/v2/push/send`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ to: 'invalid' }),
});
assert.equal((await invalid.json()).data.details.error, 'DeviceNotRegistered');

const receipts = await fetch(`${baseUrl}/--/api/v2/push/getReceipts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ids: ['ticket-good', 'ticket-invalid'] }),
});
const receiptBody = await receipts.json();
assert.equal(receiptBody.data['ticket-good'].status, 'ok');
assert.equal(receiptBody.data['ticket-invalid'].details.error, 'DeviceNotRegistered');

for (const [scenario, expectedStatus] of [['rate-limited', 429], ['server-error', 503]]) {
  const response = await fetch(`${baseUrl}/--/api/v2/push/send?__scenario=${scenario}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: validToken }),
  });
  assert.equal(response.status, expectedStatus, scenario);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
}

const malformed = await fetch(`${baseUrl}/--/api/v2/push/send?__scenario=malformed`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ to: validToken }),
});
await assert.rejects(() => malformed.json(), SyntaxError);

await assert.rejects(
  () => fetch(`${baseUrl}/--/api/v2/push/send?__scenario=timeout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: validToken }),
    signal: AbortSignal.timeout(200),
  }),
  /abort|timeout/i,
);

process.stdout.write('Push deterministic upstream contract: PASS\n');

