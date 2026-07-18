jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  const api = {
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    multiGet: jest.fn(async (keys: string[]) => keys.map((key) => [key, store.get(key) ?? null])),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => store.delete(key));
    }),
  };

  return { __esModule: true, default: api, __store: store };
});

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    isAvailableAsync: jest.fn(async () => true),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __store: store,
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { readSignupDraft, writeSignupDraft } from '../../src/services/signupDraft';
import {
  LEGACY_SIGNUP_DRAFT_STORAGE_KEY,
  SIGNUP_DRAFT_SECURE_KEY,
} from '../../src/shared/constants';

type MockedStoreModule = { __store: Map<string, string> };

describe('private signup draft persistence', () => {
  beforeEach(() => {
    (jest.requireMock('expo-secure-store') as MockedStoreModule).__store.clear();
    (jest.requireMock('@react-native-async-storage/async-storage') as MockedStoreModule).__store.clear();
    jest.clearAllMocks();
  });

  it('stores email and local photo paths only in SecureStore', async () => {
    const draft = {
      email: 'private@example.test',
      photos: ['file:///private/photo.jpg'],
      updatedAt: Date.now(),
    };

    await writeSignupDraft(draft);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      SIGNUP_DRAFT_SECURE_KEY,
      JSON.stringify(draft),
      expect.any(Object),
    );
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    await expect(readSignupDraft()).resolves.toEqual(draft);
  });

  it('migrates and removes a valid legacy plaintext draft', async () => {
    const legacyDraft = JSON.stringify({
      email: 'legacy@example.test',
      photos: ['file:///legacy/photo.jpg'],
    });
    await AsyncStorage.setItem(LEGACY_SIGNUP_DRAFT_STORAGE_KEY, legacyDraft);

    const restored = await readSignupDraft();

    expect(restored).toMatchObject({
      email: 'legacy@example.test',
      photos: ['file:///legacy/photo.jpg'],
    });
    expect(SecureStore.setItemAsync).toHaveBeenCalled();
    await expect(AsyncStorage.getItem(LEGACY_SIGNUP_DRAFT_STORAGE_KEY)).resolves.toBeNull();
  });
});
