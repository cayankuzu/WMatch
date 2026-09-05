import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchWithRetry: vi.fn(),
  getAuthHeaders: vi.fn(),
  refreshAuthSessionSingleFlight: vi.fn(),
}));

vi.mock('../utils/supabase/client', () => ({
  fetchWithRetry: mocks.fetchWithRetry,
  getAuthHeaders: mocks.getAuthHeaders,
  refreshAuthSessionSingleFlight: mocks.refreshAuthSessionSingleFlight,
  resolveApiUrl: (path: string) => `https://api.example.test${path}`,
}));

vi.mock('../src/services/telemetry', () => ({
  telemetry: {
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    recordDuration: vi.fn(),
  },
}));

import {
  getHealthStatus,
  registerPushToken,
  SessionExpiredError,
} from '../src/services/api';

const healthPayload = {
  ok: true,
  schemaReady: true,
  apiVersion: 'v1',
  release: 'test-sha',
  requiredSchema: '20260831',
  serverTime: '2026-08-31T00:00:00.000Z',
  requestId: 'request-test-123',
};

describe('API authentication refresh replay', () => {
  beforeEach(() => {
    mocks.fetchWithRetry.mockReset();
    mocks.getAuthHeaders.mockReset();
    mocks.refreshAuthSessionSingleFlight.mockReset();
    mocks.getAuthHeaders
      .mockResolvedValueOnce({ Authorization: 'Bearer stale', 'X-WMatch-Install-Id': 'install' })
      .mockResolvedValue({ Authorization: 'Bearer fresh', 'X-WMatch-Install-Id': 'install' });
    mocks.refreshAuthSessionSingleFlight.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replays a safe request once with refreshed authorization and the same request ID', async () => {
    mocks.fetchWithRetry
      .mockResolvedValueOnce(new Response('{"error":"expired"}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(healthPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(getHealthStatus()).resolves.toMatchObject({ ok: true, release: 'test-sha' });

    expect(mocks.refreshAuthSessionSingleFlight).toHaveBeenCalledTimes(1);
    expect(mocks.fetchWithRetry).toHaveBeenCalledTimes(2);
    const firstHeaders = mocks.fetchWithRetry.mock.calls[0]?.[1]?.headers as Headers;
    const secondHeaders = mocks.fetchWithRetry.mock.calls[1]?.[1]?.headers as Headers;
    expect(firstHeaders.get('x-request-id')).toBe(secondHeaders.get('x-request-id'));
    expect(secondHeaders.get('Authorization')).toBe('Bearer fresh');
  });

  it('does not replay a non-idempotent POST without an idempotency key', async () => {
    mocks.fetchWithRetry.mockResolvedValueOnce(
      new Response('{"error":"expired"}', { status: 401 }),
    );

    await expect(registerPushToken('ExponentPushToken[test]', 'android'))
      .rejects.toBeInstanceOf(SessionExpiredError);

    expect(mocks.refreshAuthSessionSingleFlight).not.toHaveBeenCalled();
    expect(mocks.fetchWithRetry).toHaveBeenCalledTimes(1);
  });
});
