import assert from 'node:assert/strict';
import { createConnection } from 'node:net';

const apiUrl = (process.env.TOXIPROXY_API_URL ?? '').replace(/\/$/, '');
assert.ok(apiUrl, 'TOXIPROXY_API_URL is required');
const supabaseApiPort = Number(process.env.SUPABASE_LOCAL_API_PORT ?? '54321');
const supabaseDbPort = Number(process.env.SUPABASE_LOCAL_DB_PORT ?? '54322');
const supabaseMode = process.env.SUPABASE_LOCAL_MODE === 'full' ? 'full' : 'database';
assert.ok(Number.isInteger(supabaseApiPort) && supabaseApiPort > 1024 && supabaseApiPort < 65_536);
assert.ok(Number.isInteger(supabaseDbPort) && supabaseDbPort > 1024 && supabaseDbPort < 65_536);

async function api(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Toxiproxy API ${path} returned ${response.status}`);
  }
  return response;
}

async function recreateProxy(name, listen, upstream) {
  await api(`/proxies/${name}`, { method: 'DELETE' });
  const response = await api('/proxies', {
    method: 'POST',
    body: JSON.stringify({ name, listen, upstream, enabled: true }),
  });
  assert.equal(response.status, 201);
}

async function addToxic(proxy, toxic) {
  const response = await api(`/proxies/${proxy}/toxics`, {
    method: 'POST',
    body: JSON.stringify(toxic),
  });
  assert.equal(response.status, 200);
}

async function removeToxic(proxy, name) {
  const response = await api(`/proxies/${proxy}/toxics/${name}`, { method: 'DELETE' });
  assert.ok(response.status === 204 || response.status === 200 || response.status === 404);
}

const proxies = [
  ['tmdb', '0.0.0.0:8666', 'tmdb-mock:8788'],
  ['push', '0.0.0.0:8667', 'push-mock:8789'],
  ...(supabaseMode === 'full'
    ? [
        ['supabase-http', '0.0.0.0:8668', `host.docker.internal:${supabaseApiPort}`],
        ['supabase-storage', '0.0.0.0:8669', `host.docker.internal:${supabaseApiPort}`],
        ['supabase-realtime', '0.0.0.0:8670', `host.docker.internal:${supabaseApiPort}`],
      ]
    : [['supabase-db', '0.0.0.0:8668', `host.docker.internal:${supabaseDbPort}`]]),
];

function assertTcpConnect(host, port) {
  return new Promise((resolveConnection, reject) => {
    const socket = createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP connect timeout: ${host}:${port}`));
    }, 2_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolveConnection();
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

try {
  for (const [name, listen, upstream] of proxies) {
    await recreateProxy(name, listen, upstream);
  }

  assert.equal((await fetch('http://toxiproxy:8666/3/movie/550')).status, 200);
  assert.equal((await fetch('http://toxiproxy:8667/health')).status, 200);

  if (supabaseMode === 'full') {
    const authHealth = await fetch('http://toxiproxy:8668/auth/v1/health');
    assert.ok(authHealth.status < 500, `Supabase Auth proxy returned ${authHealth.status}`);
    const storageHealth = await fetch('http://toxiproxy:8669/storage/v1/status');
    assert.ok(storageHealth.status < 500, `Supabase Storage proxy returned ${storageHealth.status}`);
    const realtimeReachability = await fetch('http://toxiproxy:8670/realtime/v1/');
    assert.ok(realtimeReachability.status < 500, `Supabase Realtime proxy returned ${realtimeReachability.status}`);
  } else {
    await assertTcpConnect('toxiproxy', 8668);
  }

  await addToxic('tmdb', {
    name: 'bounded-latency',
    type: 'latency',
    stream: 'downstream',
    toxicity: 1,
    attributes: { latency: 250, jitter: 0 },
  });
  const startedAt = Date.now();
  assert.equal((await fetch('http://toxiproxy:8666/3/movie/550')).status, 200);
  assert.ok(Date.now() - startedAt >= 200, 'TMDB latency toxic was not observed');
  await removeToxic('tmdb', 'bounded-latency');

  await addToxic('push', {
    name: 'connection-reset',
    type: 'reset_peer',
    stream: 'downstream',
    toxicity: 1,
    attributes: { timeout: 0 },
  });
  await assert.rejects(
    () => fetch('http://toxiproxy:8667/health', { signal: AbortSignal.timeout(1_000) }),
    /fetch|socket|reset|abort|terminated/i,
  );
  await removeToxic('push', 'connection-reset');

  const supabaseProxy = supabaseMode === 'full' ? 'supabase-http' : 'supabase-db';
  await addToxic(supabaseProxy, {
    name: 'supabase-latency',
    type: 'latency',
    stream: 'downstream',
    toxicity: 1,
    attributes: { latency: 200, jitter: 25 },
  });
  if (supabaseMode === 'full') {
    const supabaseStartedAt = Date.now();
    await fetch('http://toxiproxy:8668/auth/v1/health');
    assert.ok(Date.now() - supabaseStartedAt >= 150, 'Supabase latency toxic was not observed');
  } else {
    await assertTcpConnect('toxiproxy', 8668);
  }
  await removeToxic(supabaseProxy, 'supabase-latency');

  process.stdout.write('Toxiproxy Supabase/TMDB/push resilience contract: PASS\n');
} finally {
  await Promise.all(proxies.map(([name]) => api(`/proxies/${name}`, { method: 'DELETE' }).catch(() => null)));
}
