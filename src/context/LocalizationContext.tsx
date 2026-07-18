import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  DEFAULT_LOCALE,
  formatTranslation,
  isSupportedLocale,
  messages,
  type Locale,
  type TranslationKey,
  type TranslationValues,
} from '../shared/i18n/messages';

interface LocalizationContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
}

const LocalizationContext = createContext<LocalizationContextType | undefined>(undefined);
const LOCALE_STORAGE_KEY = 'wmatch:locale';

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    let cancelled = false;

    async function hydrateLocale() {
      try {
        const storedLocale = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);

        if (!cancelled && isSupportedLocale(storedLocale)) {
          setLocale(storedLocale);
        }
      } catch (error) {
        console.warn('Locale could not be restored:', error);
      }
    }

    void hydrateLocale();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(LOCALE_STORAGE_KEY, locale).catch((error) => {
      console.warn('Locale could not be persisted:', error);
    });
  }, [locale]);

  const value = useMemo<LocalizationContextType>(
    () => ({
      locale,
      setLocale,
      t: (key, values) =>
        formatTranslation(messages[locale][key] ?? messages.en[key] ?? key, values),
    }),
    [locale],
  );

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization() {
  const context = useContext(LocalizationContext);

  if (!context) {
    throw new Error('useLocalization must be used within LocalizationProvider');
  }

  return context;
}
