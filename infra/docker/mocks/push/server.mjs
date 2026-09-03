import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? '8789');
const MAX_BODY_BYTES = 128 * 1024;

function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'private, no-store',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(payload);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('body_too_large');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function ticketIdFor(token) {
  return `ticket-${createHash('sha256').update(token).digest('hex').slice(0, 20)}`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const scenario = (request.headers['x-wmatch-mock-scenario'] ?? url.searchParams.get('__scenario') ?? 'success')
    .toString()
    .toLowerCase();

  if (url.pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'push-mock' });
    return;
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { errors: [{ code: 'METHOD_NOT_ALLOWED' }] }, { allow: 'POST' });
    return;
  }

  if (scenario === 'timeout') {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  if (scenario === 'rate-limited') {
    sendJson(response, 429, { errors: [{ code: 'RATE_LIMITED' }] }, { 'retry-after': '1' });
    return;
  }

  if (scenario === 'server-error') {
    sendJson(response, 503, { errors: [{ code: 'PROVIDER_UNAVAILABLE' }] });
    return;
  }

  if (scenario === 'malformed') {
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json' });
    response.end('{"data":');
    return;
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'body_too_large';
    sendJson(response, tooLarge ? 413 : 400, { errors: [{ code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON' }] });
    return;
  }

  if (url.pathname === '/--/api/v2/push/send') {
    const token = typeof body?.to === 'string' ? body.to : '';
    if (!/^ExponentPushToken\[[A-Za-z0-9_-]{8,128}\]$/.test(token)) {
      sendJson(response, 200, {
        data: { status: 'error', message: 'Invalid token', details: { error: 'DeviceNotRegistered' } },
      });
      return;
    }
    sendJson(response, 200, { data: { status: 'ok', id: ticketIdFor(token) } });
    return;
  }

  if (url.pathname === '/--/api/v2/push/getReceipts') {
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string').slice(0, 300) : [];
    const data = Object.fromEntries(ids.map((id) => [id, id.includes('invalid')
      ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
      : { status: 'ok' }]));
    sendJson(response, 200, { data });
    return;
  }

  sendJson(response, 404, { errors: [{ code: 'UNKNOWN_PATH' }] });
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`push-mock ready on ${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

