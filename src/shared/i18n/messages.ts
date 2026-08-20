import { tr } from './locales/tr';

export const messages = tr;
export type TranslationValues = Record<string, string | number>;
export type TranslationKey = keyof typeof tr;
export type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export function formatTranslation(template: string, values?: TranslationValues) {
  if (!values) {
    return template;
  }

  return Object.entries(values).reduce((result, [key, value]) => {
    return result.replaceAll(`{${key}}`, String(value));
  }, template);
}

export function translateMessage(key: TranslationKey, values?: TranslationValues) {
  return formatTranslation(messages[key] ?? key, values);
}
