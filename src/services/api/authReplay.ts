import {
  fetchWithRetry,
  getAuthHeaders,
  refreshAuthSessionSingleFlight,
} from '../../../utils/supabase/client';

function canReplayAfterAuthRefresh(method: string, headers: Headers) {
  return method === 'GET'
    || method === 'HEAD'
    || method === 'OPTIONS'
    || method === 'PUT'
    || method === 'DELETE'
    || headers.has('Idempotency-Key');
}

export async function fetchWithAuthRefresh(
  url: string,
  init: RequestInit,
  requestHeaders: Headers,
) {
  let response = await fetchWithRetry(url, { ...init, headers: requestHeaders });
  const method = (init.method ?? 'GET').toUpperCase();

  if (
    response.status !== 401
    || init.signal?.aborted
    || !canReplayAfterAuthRefresh(method, requestHeaders)
  ) {
    return response;
  }

  try {
    await refreshAuthSessionSingleFlight();
    const refreshedHeaders = new Headers(await getAuthHeaders());
    refreshedHeaders.forEach((value, key) => requestHeaders.set(key, value));
    response = await fetchWithRetry(url, { ...init, headers: requestHeaders });
  } catch {
    // The original 401 remains authoritative when refresh is unavailable.
  }

  return response;
}
