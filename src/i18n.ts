/**
 * Internationalization for PDF Studio (react-i18next).
 *
 * - English is the source language; en/translation.json holds every UI string.
 * - Translations live next to the source so the app works offline / as a PWA
 *   with no runtime locale fetching (privacy: no network calls for i18n).
 * - The user's choice persists in localStorage under LANG_KEY, which is
 *   registered in src/lib/storage.ts so the one-click wipe clears it.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANG_KEY } from './lib/storage';

import en from './locales/en/translation.json';
import es from './locales/es/translation.json';
import de from './locales/de/translation.json';
import fr from './locales/fr/translation.json';

export { LANG_KEY };

/** Where "Help translate" links point: the README section (hosts the Crowdin link once the project exists). */
export const TRANSLATE_URL = 'https://github.com/Kayforkind/NavigatorsLab-PDF-Studio#help-translate';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];
const CODES = LANGUAGES.map((l) => l.code);

function detectLanguage(): string {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && (CODES as string[]).includes(saved)) return saved;
  } catch {
    /* storage unavailable — fall through to navigator */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  const short = nav.split('-')[0].toLowerCase();
  if ((CODES as string[]).includes(short)) return short;
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    de: { translation: de },
    fr: { translation: fr },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React escapes by default
  returnEmptyString: false,
});

export function setLanguage(code: string): void {
  if (!(CODES as string[]).includes(code)) return;
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* ignore — language still applies for this session */
  }
  void i18n.changeLanguage(code);
}

export default i18n;
