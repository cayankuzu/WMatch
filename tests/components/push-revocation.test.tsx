const mockAsyncValues = new Map<string, string>();
const mockSecureValues = new Map<string, string>();
const mockRegisterPushToken = jest.fn();
const mockUnregisterPushToken = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncValues.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncValues.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockAsyncValues.delete(key);
  }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureValues.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureValues.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureValues.delete(key);
  }),
}));

jest.mock('expo-device', () => ({ isDevice: false }));
jest.mock('expo-application', () => ({ applicationId: 'com.wmatch.app' }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: {}, easConfig: {} },
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
}));

jest.mock('../../src/services/api', () => ({
  registerPushToken: (...args: unknown[]) => mockRegisterPushToken(...args),
  unregisterPushToken: (...args: unknown[]) => mockUnregisterPushToken(...args),
}));
jest.mock('../../src/services/userEventBus', () => ({
  subscribeToUserEvent: jest.fn(() => () => undefined),
}));
jest.mock('../../src/shared/utils/appLifecycle', () => ({
  isAppActive: jest.fn(() => false),
}));

import {
  clearPushNotifications,
  resetPushNotificationSyncState,
  syncPushNotifications,
} from '../../src/services/notifications';

const USER_ID = 'user-00000001';
const TOKEN = 'ExponentPushToken[test-token]';
const REGISTRATION_KEY = 'wmatch.push-registration.v2';
const REVOCATION_KEY = 'wmatch.push-revocations.v1';

describe('push token revocation durability', () => {
  beforeEach(() => {
    mockAsyncValues.clear();
    mockSecureValues.clear();
    mockRegisterPushToken.mockReset();
    mockUnregisterPushToken.mockReset();
    resetPushNotificationSyncState();
  });

  it('moves a failed logout revocation into secure storage and retries it later', async () => {
    mockSecureValues.set(REGISTRATION_KEY, JSON.stringify({ token: TOKEN, userId: USER_ID }));
    mockUnregisterPushToken.mockRejectedValueOnce(new Error('offline'));

    await clearPushNotifications();

    expect(mockSecureValues.has(REGISTRATION_KEY)).toBe(false);
    expect(JSON.parse(mockSecureValues.get(REVOCATION_KEY) ?? '[]')).toEqual([
      expect.objectContaining({ token: TOKEN, userId: USER_ID, attempts: 0 }),
    ]);

    mockUnregisterPushToken.mockResolvedValue(undefined);
    await expect(syncPushNotifications(USER_ID)).resolves.toEqual({ status: 'skipped' });

    expect(mockUnregisterPushToken).toHaveBeenLastCalledWith(TOKEN);
    expect(mockSecureValues.has(REVOCATION_KEY)).toBe(false);
  });

  it('migrates a legacy unencrypted registration before cleanup', async () => {
    mockAsyncValues.set('@wmatch/push-registration-v1', JSON.stringify({
      token: TOKEN,
      userId: USER_ID,
    }));
    mockUnregisterPushToken.mockResolvedValue(undefined);

    await clearPushNotifications();

    expect(mockUnregisterPushToken).toHaveBeenCalledWith(TOKEN);
    expect(mockAsyncValues.size).toBe(0);
    expect(mockSecureValues.has(REGISTRATION_KEY)).toBe(false);
  });
});
