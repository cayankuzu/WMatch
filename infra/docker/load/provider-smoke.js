import http from 'k6/http';
import { check, sleep } from 'k6';

const tmdbBaseUrl = __ENV.TMDB_MOCK_URL;
const pushBaseUrl = __ENV.PUSH_MOCK_URL;

export const options = {
  scenarios: {
    deterministic_provider_smoke: {
      executor: 'constant-vus',
      vus: 4,
      duration: '10s',
    },
  },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<500'],
  },
};

export function setup() {
  if (!tmdbBaseUrl || !pushBaseUrl) {
    throw new Error('TMDB_MOCK_URL and PUSH_MOCK_URL are required.');
  }
}

export default function () {
  const media = http.get(`${tmdbBaseUrl}/3/movie/550?language=tr-TR`, {
    headers: { 'x-request-id': `k6-${__VU}-${__ITER}` },
    tags: { upstream: 'tmdb-mock' },
  });
  check(media, {
    'TMDB fixture status': (result) => result.status === 200,
    'TMDB fixture schema': (result) => result.json('id') === 550,
    'TMDB fixture cache policy': (result) => result.headers['Cache-Control']?.includes('s-maxage=300'),
  });

  const push = http.post(`${pushBaseUrl}/--/api/v2/push/send`, JSON.stringify({
    to: `ExponentPushToken[synthetictoken${String(__VU).padStart(2, '0')}]`,
    title: 'Synthetic',
    body: 'No user data',
  }), {
    headers: { 'content-type': 'application/json' },
    tags: { upstream: 'push-mock' },
  });
  check(push, {
    'push fixture status': (result) => result.status === 200,
    'push fixture ticket': (result) => result.json('data.status') === 'ok',
  });

  sleep(0.1);
}

