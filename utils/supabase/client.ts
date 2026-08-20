import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { projectId, publicAnonKey } from './info';

export const SUPABASE_URL = `https://${projectId}.supabase.co`;

const REQUEST_POLICIES = {
  interactive: { retryDelaysMs: [250, 650], timeoutMs: 6_000 },
  mutation: { retryDelaysMs: [500, 1_200, 2_500], timeoutMs: 10_000 },
  background: { retryDelaysMs: [800, 2_000, 4_000], timeoutMs: 15_000 },
} as const;
export type RequestPolicy = keyof typeof REQUEST_POLICIES;
const RETRIABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const IS_TEST_RUNTIME = process.env.NODE_ENV === 'test';
const INSTALLATION_ID_KEY = 'wmatch.installation-id.v1';
const SECURE_STORE_OPTIONS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  keychainService: 'wmatch.auth',
} satisfies SecureStore.SecureStoreOptions;
let installationIdPromise: Promise<string> | null = null;

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms.`);
    this.name = 'TimeoutError';
  }
}

function createInstallationId() {
  const bytes = new Uint8Array(16);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadInstallationId() {
  if (!(await SecureStore.isAvailableAsync())) {
    return createInstallationId();
  }

  const storedId = await SecureStore.getItemAsync(INSTALLATION_ID_KEY, SECURE_STORE_OPTIONS);

  if (storedId && /^[a-f0-9]{32}$/.test(storedId)) {
    return storedId;
  }

  const installationId = createInstallationId();
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, installationId, SECURE_STORE_OPTIONS);
  return installationId;
}

export function getInstallationId() {
  installationIdPromise ??= loadInstallationId().catch(() => createInstallationId());
  return installationIdPromise;
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      const error = new Error('Request aborted.');
      error.name = 'AbortError';
      reject(error);
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

function getRequestMethod(init?: RequestInit) {
  return (init?.method ?? 'GET').toUpperCase();
}

function getHeaderValue(headers: HeadersInit | undefined, name: string) {
  if (!headers) {
    return null;
  }

  if (headers instanceof Headers) {
    return headers.get(name);
  }

  if (Array.isArray(headers)) {
    const entry = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return entry?.[1] ?? null;
  }

  return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null;
}

function canRetryRequest(init?: RequestInit) {
  const method = getRequestMethod(init);
  return IDEMPOTENT_METHODS.has(method) || Boolean(getHeaderValue(init?.headers, 'Idempotency-Key'));
}

function getRetryAfterMs(response: Response) {
  const retryAfter = response.headers.get('Retry-After');

  if (!retryAfter) {
    return null;
  }

  const numericDelay = Number(retryAfter);

  if (Number.isFinite(numericDelay)) {
    return Math.max(0, numericDelay * 1000);
  }

  const retryAt = new Date(retryAfter).getTime();
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
}

function getRetryDelay(retryDelaysMs: readonly number[], attempt: number, response?: Response) {
  const retryAfterMs = response ? getRetryAfterMs(response) : null;

  if (retryAfterMs != null) {
    return Math.min(retryAfterMs, 8000);
  }

  const baseDelay = retryDelaysMs[attempt] ?? retryDelaysMs.at(-1) ?? 1000;
  return baseDelay + Math.round(Math.random() * 180);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

function isTransientNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes('unknownhostexception') ||
    message.includes('unable to resolve host') ||
    message.includes('failed to connect') ||
    message.includes('network request failed') ||
    message.includes('fetch failed') ||
    message.includes('software caused connection abort')
  );
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  requestedPolicy?: RequestPolicy,
): Promise<Response> {
  let lastError: unknown = null;
  const retryAllowed = canRetryRequest(init);
  const method = getRequestMethod(init);
  const policyName = requestedPolicy ?? (IDEMPOTENT_METHODS.has(method) ? 'interactive' : 'mutation');
  const policy = REQUEST_POLICIES[policyName];

  for (let attempt = 0; attempt <= policy.retryDelaysMs.length; attempt += 1) {
    const timeoutController = new AbortController();
    let timedOut = false;
    let callerAborted = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, policy.timeoutMs);
    const callerSignal = init?.signal;
    const abortFromCaller = () => {
      callerAborted = true;
      timeoutController.abort();
    };

    if (callerSignal) {
      if (callerSignal.aborted) {
        timeoutController.abort();
      } else {
        callerSignal.addEventListener('abort', abortFromCaller, { once: true });
      }
    }

    try {
      const response = await fetch(input, {
        ...init,
        signal: timeoutController.signal,
      });

      if (
        !retryAllowed ||
        !RETRIABLE_HTTP_STATUSES.has(response.status) ||
        attempt === policy.retryDelaysMs.length
      ) {
        return response;
      }

      await wait(getRetryDelay(policy.retryDelaysMs, attempt, response), callerSignal ?? undefined);
    } catch (error) {
      const requestError = timedOut && isAbortError(error)
        ? new RequestTimeoutError(policy.timeoutMs)
        : error;
      lastError = requestError;

      if (
        callerAborted ||
        callerSignal?.aborted ||
        !retryAllowed ||
        (!timedOut && !isTransientNetworkError(error)) ||
        attempt === policy.retryDelaysMs.length
      ) {
        throw requestError;
      }

      await wait(getRetryDelay(policy.retryDelaysMs, attempt), callerSignal ?? undefined);
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Network request failed.');
}

const secureAuthStorage = {
  async getItem(key: string) {
    if (!(await SecureStore.isAvailableAsync())) {
      await AsyncStorage.removeItem(key).catch(() => undefined);
      return null;
    }

    const secureValue = await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS);

    if (secureValue != null) {
      return secureValue;
    }

    const legacyValue = await AsyncStorage.getItem(key);

    if (legacyValue != null) {
      await SecureStore.setItemAsync(key, legacyValue, SECURE_STORE_OPTIONS);
      await AsyncStorage.removeItem(key).catch(() => undefined);
    }

    return legacyValue;
  },
  async setItem(key: string, value: string) {
    if (!(await SecureStore.isAvailableAsync())) {
      await AsyncStorage.removeItem(key).catch(() => undefined);
      throw new Error('Secure auth storage is unavailable on this device.');
    }

    await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
    await AsyncStorage.removeItem(key).catch(() => undefined);
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key).catch(() => undefined);

    if (await SecureStore.isAvailableAsync()) {
      await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
    }
  },
};

export const supabase = createClient(SUPABASE_URL, publicAnonKey, {
  global: {
    fetch: fetchWithRetry,
  },
  auth: {
    storage: secureAuthStorage,
    persistSession: true,
    autoRefreshToken: !IS_TEST_RUNTIME,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

export const API_BASE = `${SUPABASE_URL}/functions/v1/make-server-d962235e`;

export async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token ?? ''}`,
    'X-WMatch-Install-Id': await getInstallationId(),
  };
}

export async function getPublicApiHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token ?? publicAnonKey}`,
    'X-WMatch-Install-Id': await getInstallationId(),
  };
}
