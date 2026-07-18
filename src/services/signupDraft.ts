import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  LEGACY_SIGNUP_DRAFT_STORAGE_KEY,
  SIGNUP_DRAFT_SECURE_KEY,
  SIGNUP_DRAFT_STORAGE_KEY,
  SIGNUP_DRAFT_TTL_MS,
} from '../shared/constants';

export interface StoredSignupDraft {
  email?: string;
  photos?: string[];
  updatedAt: number;
}

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function parseDraft(rawValue: string, allowMissingTimestamp = false): StoredSignupDraft | null {
  const parsed = JSON.parse(rawValue) as { email?: unknown; photos?: unknown; updatedAt?: unknown };
  const updatedAt = Number(parsed.updatedAt);
  const normalizedUpdatedAt = Number.isFinite(updatedAt)
    ? updatedAt
    : allowMissingTimestamp
      ? Date.now()
      : Number.NaN;

  if (!Number.isFinite(normalizedUpdatedAt) || Date.now() - normalizedUpdatedAt > SIGNUP_DRAFT_TTL_MS) {
    return null;
  }

  return {
    email: typeof parsed.email === 'string' ? parsed.email : undefined,
    photos: Array.isArray(parsed.photos)
      ? parsed.photos.filter((photo): photo is string => typeof photo === 'string')
      : undefined,
    updatedAt: normalizedUpdatedAt,
  };
}

async function removeLegacyDrafts() {
  await AsyncStorage.multiRemove([
    SIGNUP_DRAFT_STORAGE_KEY,
    LEGACY_SIGNUP_DRAFT_STORAGE_KEY,
  ]);
}

export async function clearSignupDraft() {
  await Promise.all([
    SecureStore.deleteItemAsync(SIGNUP_DRAFT_SECURE_KEY, SECURE_STORE_OPTIONS).catch(() => undefined),
    removeLegacyDrafts().catch(() => undefined),
  ]);
}

export async function writeSignupDraft(draft: StoredSignupDraft) {
  if (!(await SecureStore.isAvailableAsync())) {
    await removeLegacyDrafts();
    return;
  }

  await SecureStore.setItemAsync(
    SIGNUP_DRAFT_SECURE_KEY,
    JSON.stringify(draft),
    SECURE_STORE_OPTIONS,
  );
  await removeLegacyDrafts();
}

export async function readSignupDraft(): Promise<StoredSignupDraft | null> {
  try {
    if (!(await SecureStore.isAvailableAsync())) {
      await removeLegacyDrafts();
      return null;
    }

    const secureDraft = await SecureStore.getItemAsync(
      SIGNUP_DRAFT_SECURE_KEY,
      SECURE_STORE_OPTIONS,
    );
    if (secureDraft) {
      const parsedDraft = parseDraft(secureDraft);
      if (!parsedDraft) {
        await clearSignupDraft();
      }
      return parsedDraft;
    }

    const legacyEntries = await AsyncStorage.multiGet([
      SIGNUP_DRAFT_STORAGE_KEY,
      LEGACY_SIGNUP_DRAFT_STORAGE_KEY,
    ]);
    const currentDraft = legacyEntries[0]?.[1];
    const legacyDraft = legacyEntries[1]?.[1];
    const migratedDraft = currentDraft
      ? parseDraft(currentDraft)
      : legacyDraft
        ? parseDraft(legacyDraft, true)
        : null;

    if (migratedDraft) {
      await writeSignupDraft(migratedDraft);
    } else {
      await removeLegacyDrafts();
    }

    return migratedDraft;
  } catch (error) {
    await clearSignupDraft();
    console.warn('Signup draft could not be read securely:', error);
    return null;
  }
}
