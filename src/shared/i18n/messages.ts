import { en } from './locales/en';
import { tr } from './locales/tr';

export const DEFAULT_LOCALE = 'tr' as const;
export const FALLBACK_LOCALE = 'en' as const;

export const messages = {
  tr,
  en,
} as const;

export type Locale = keyof typeof messages;
export type TranslationValues = Record<string, string | number>;
export type TranslationKey = keyof typeof tr;
export type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export const SUPPORTED_LOCALES = Object.keys(messages) as Locale[];

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return Boolean(value && value in messages);
}

export function formatTranslation(template: string, values?: TranslationValues) {
  if (!values) {
    return template;
  }

  return Object.entries(values).reduce((result, [key, value]) => {
    return result.replaceAll(`{${key}}`, String(value));
  }, template);
}

export function translateMessage(locale: Locale, key: TranslationKey, values?: TranslationValues) {
  return formatTranslation(messages[locale][key] ?? messages[FALLBACK_LOCALE][key] ?? key, values);
}
