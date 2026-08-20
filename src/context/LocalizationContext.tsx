import { createContext, useContext, type ReactNode } from 'react';

import {
  formatTranslation,
  messages,
  type TranslationKey,
  type TranslationValues,
} from '../shared/i18n/messages';

interface LocalizationContextType {
  t: (key: TranslationKey, values?: TranslationValues) => string;
}

const LocalizationContext = createContext<LocalizationContextType | undefined>(undefined);
const localizationValue: LocalizationContextType = {
  t: (key, values) => formatTranslation(messages[key] ?? key, values),
};

export function LocalizationProvider({ children }: { children: ReactNode }) {
  return <LocalizationContext.Provider value={localizationValue}>{children}</LocalizationContext.Provider>;
}

export function useLocalization() {
  const context = useContext(LocalizationContext);

  if (!context) {
    throw new Error('useLocalization must be used within LocalizationProvider');
  }

  return context;
}
