import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Rate, Trend } from 'k6/metrics';

const profile = __ENV.LOAD_PROFILE || 'smoke';
const baseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const anonJwt = __ENV.SUPABASE_ANON_JWT || '';
const tokenFile = __ENV.LOAD_TOKENS_FILE || './staging-user-tokens.json';
const tokens = new SharedArray('staging access tokens', () => JSON.parse(open(tokenFile)));

const contractFailures = new Rate('contract_failures');
const healthDuration = new Trend('health_duration', true);
const liveNowDuration = new Trend('live_now_duration', true);
const compatibilityDuration = new Trend('compatibility_duration', true);
const matchesDuration = new Trend('matches_duration', true);
const chatsDuration = new Trend('chats_duration', true);

const profiles = {
  smoke: {
    executor: 'constant-vus',
    vus: 5,
    duration: '30s',
  },
  '1k': {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '5m', target: 1000 },
      { duration: '10m', target: 1000 },
      { duration: '3m', target: 0 },
    ],
    gracefulRampDown: '30s',
  },
};

if (!profiles[profile]) {
  throw new Error(`Unsupported LOAD_PROFILE: ${profile}`);
}

export const options = {
  discardResponseBodies: false,
  scenarios: { critical_reads: profiles[profile] },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<600'],
    contract_failures: ['rate<0.001'],
    health_duration: ['p(95)<300'],
    live_now_duration: ['p(95)<600'],
    compatibility_duration: ['p(95)<800'],
    matches_duration: ['p(95)<600'],
    chats_duration: ['p(95)<600'],
  },
};

export function setup() {
  if (__ENV.LOAD_TARGET_ACK !== 'staging-only') {
    throw new Error('Set LOAD_TARGET_ACK=staging-only; production load runs are forbidden.');
  }

  if (!baseUrl || !anonJwt || tokens.length === 0) {
    throw new Error('SUPABASE_URL, SUPABASE_ANON_JWT and LOAD_TOKENS_FILE are required.');
  }

  if (profile === '1k' && tokens.length < 100) {
    throw new Error('The 1k profile requires at least 100 isolated staging fixture tokens.');
  }
}

function request(path, token, metric, contractCheck) {
  const response = http.get(
    `${baseUrl}/functions/v1/make-server-d962235e${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonJwt,
        'X-WMatch-Install-Id': `0000000000000000${String(exec.vu.idInTest).padStart(16, '0')}`,
      },
      tags: { route: path.split('?')[0] },
      timeout: '10s',
    },
  );

  metric.add(response.timings.duration);
  const valid = check(response, {
    [`${path} status 200`]: (result) => result.status === 200,
    [`${path} contract`]: (result) => {
      try {
        return contractCheck(result.json());
      } catch {
        return false;
      }
    },
  });
  contractFailures.add(!valid);
}

export default function () {
  const token = tokens[(exec.vu.idInTest - 1) % tokens.length];

  request('/health', token, healthDuration, (body) => body?.ok === true && body?.schemaReady === true);
  request('/watch/live-now?limit=40', token, liveNowDuration, (body) => Array.isArray(body?.users));
  request('/discovery/compatibility?limit=40', token, compatibilityDuration, (body) => Array.isArray(body?.users));
  request('/matches', token, matchesDuration, (body) => Array.isArray(body?.matches));
  request('/chats?limit=40', token, chatsDuration, (body) => Array.isArray(body?.chats));

  sleep(0.5 + Math.random());
}
