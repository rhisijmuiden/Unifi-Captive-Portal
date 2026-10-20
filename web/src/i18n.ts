import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import nl, { type Messages } from './locales/nl';

/** Supported languages. To add one: create locales/<code>.ts typed as Messages and list it here (and in the server's i18n). */
export const languages = [
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
] as const;
export type Locale = (typeof languages)[number]['code'];

const resources: Record<Locale, { translation: Messages }> = {
  nl: { translation: nl },
  en: { translation: en },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: languages.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: 'locale', caches: ['localStorage'] },
  });

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.resolvedLanguage ?? 'en';

export const currentLocale = (): Locale => (i18n.resolvedLanguage as Locale) ?? 'en';

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: Messages };
  }
}

export default i18n;
