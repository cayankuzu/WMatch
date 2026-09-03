import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? '8788');
const MAX_DELAY_MS = 2_000;

function sendJson(response, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': status === 200 ? 'public, max-age=60, s-maxage=300' : 'no-store',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(payload);
}

function scenarioFor(request, url) {
  return (request.headers['x-wmatch-mock-scenario'] ?? url.searchParams.get('__scenario') ?? 'success')
    .toString()
    .toLowerCase();
}

function successPayload(pathname) {
  if (pathname === '/3/search/movie') {
    return {
      page: 1,
      total_pages: 1,
      total_results: 1,
      results: [{ id: 550, media_type: 'movie', title: 'Synthetic Movie', overview: 'Deterministic fixture.' }],
    };
  }

  if (pathname === '/3/search/tv') {
    return {
      page: 1,
      total_pages: 1,
      total_results: 1,
      results: [{ id: 1399, media_type: 'tv', name: 'Synthetic Series', overview: 'Deterministic fixture.' }],
    };
  }

  if (pathname === '/3/movie/550') {
    return { id: 550, media_type: 'movie', title: 'Synthetic Movie', runtime: 120 };
  }

  if (pathname === '/3/tv/1399') {
    return { id: 1399, media_type: 'tv', name: 'Synthetic Series', episode_run_time: [50] };
  }

  if (pathname === '/3/movie/550/translations') {
    return { id: 550, translations: [{ iso_639_1: 'tr', data: { overview: 'Deterministik açıklama.' } }] };
  }

  if (pathname === '/3/movie/550/watch/providers') {
    return { id: 550, results: { TR: { link: 'https://www.themoviedb.org/movie/550/watch' } } };
  }

  return null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const requestId = request.headers['x-request-id']?.toString() ?? 'tmdb-mock-request';

  if (url.pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'tmdb-mock' }, { 'cache-control': 'no-store' });
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { status_code: 405, status_message: 'Method not allowed' }, {
      allow: 'GET, HEAD',
      'x-request-id': requestId,
    });
    return;
  }

  const scenario = scenarioFor(request, url);

  if (scenario === 'timeout') {
    await new Promise((resolve) => setTimeout(resolve, MAX_DELAY_MS));
  }

  if (scenario === 'malformed') {
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': requestId,
    });
    response.end('{"invalid":');
    return;
  }

  const scenarioStatuses = new Map([
    ['unauthorized', 401],
    ['not-found', 404],
    ['rate-limited', 429],
    ['server-error', 503],
  ]);
  const forcedStatus = scenarioStatuses.get(scenario);

  if (forcedStatus) {
    sendJson(response, forcedStatus, {
      status_code: forcedStatus,
      status_message: `Synthetic ${scenario}`,
    }, {
      ...(forcedStatus === 429 ? { 'retry-after': '1' } : {}),
      'x-request-id': requestId,
    });
    return;
  }

  const payload = successPayload(url.pathname);
  if (!payload) {
    sendJson(response, 404, { status_code: 404, status_message: 'Unknown deterministic fixture path' }, {
      'x-request-id': requestId,
    });
    return;
  }

  if (request.method === 'HEAD') {
    response.writeHead(200, {
      'cache-control': 'public, max-age=60, s-maxage=300',
      'x-request-id': requestId,
    });
    response.end();
    return;
  }

  sendJson(response, 200, payload, { 'x-request-id': requestId });
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`tmdb-mock ready on ${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

