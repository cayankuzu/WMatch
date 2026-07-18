import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { projectId, publicAnonKey } from './info';

export const SUPABASE_URL = `https://${projectId}.supabase.co`;

const NETWORK_RETRY_DELAYS_MS = [500, 1200, 2500];
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const RETRIABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SECURE_STORE_OPTIONS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  keychainService: 'wmatch.auth',
} satisfies SecureStore.SecureStoreOptions;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function getRetryDelay(attempt: number, response?: Response) {
  const retryAfterMs = response ? getRetryAfterMs(response) : null;

  if (retryAfterMs != null) {
    return Math.min(retryAfterMs, 8000);
  }

  const baseDelay = NETWORK_RETRY_DELAYS_MS[attempt] ?? NETWORK_RETRY_DELAYS_MS.at(-1) ?? 1000;
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

export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown = null;
  const retryAllowed = canRetryRequest(init);

  for (let attempt = 0; attempt <= NETWORK_RETRY_DELAYS_MS.length; attempt += 1) {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
    const callerSignal = init?.signal;
    const abortFromCaller = () => timeoutController.abort();

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
        attempt === NETWORK_RETRY_DELAYS_MS.length
      ) {
        return response;
      }

      await wait(getRetryDelay(attempt, response));
    } catch (error) {
      lastError = error;

      if (
        isAbortError(error) ||
        !retryAllowed ||
        !isTransientNetworkError(error) ||
        attempt === NETWORK_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }

      await wait(getRetryDelay(attempt));
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Network request failed.');
}

const secureAuthStorage = {
  async getItem(key: string) {
    if (Platform.OS === 'web') {
      return AsyncStorage.getItem(key);
    }

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
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem(key, value);
      return;
    }

    if (!(await SecureStore.isAvailableAsync())) {
      await AsyncStorage.removeItem(key).catch(() => undefined);
      throw new Error('Secure auth storage is unavailable on this device.');
    }

    await SecureStore.setItemAsync(key, value, SECURE_STORE_OPTIONS);
    await AsyncStorage.removeItem(key).catch(() => undefined);
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key).catch(() => undefined);

    if (Platform.OS !== 'web' && (await SecureStore.isAvailableAsync())) {
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
    autoRefreshToken: true,
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
  };
}
