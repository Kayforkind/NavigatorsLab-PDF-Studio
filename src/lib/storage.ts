/**
 * Central registry of every localStorage key PDF Studio writes.
 *
 * Privacy contract: the app stores data ONLY in these keys, and the
 * one-click wipe (`clearAppStorage`) removes all of them. If you add a new
 * localStorage key anywhere in the app, add it here too — otherwise the
 * wipe will leave data behind and the "private by design" claim breaks.
 */

export const SESSION_KEY = 'nl-pdf-studio.session.v1'; // autosaved document bytes + annotations
export const SETTINGS_KEY = 'nl-pdf-studio.settings.v1'; // tool settings (color, width, opacity, font size)
export const OCR_LANG_KEY = 'pdfstudio.ocrLang'; // last-used OCR language
export const EXPORT_RANGE_KEY = 'pdfstudio.export.range'; // last-used export page range
export const LANG_KEY = 'pdfstudio-lang'; // UI language choice (see src/i18n.ts)

export const APP_STORAGE_KEYS = [SESSION_KEY, SETTINGS_KEY, OCR_LANG_KEY, EXPORT_RANGE_KEY, LANG_KEY] as const;

/**
 * Remove every PDF Studio key from localStorage.
 * @returns the keys that were actually present and removed.
 */
export function clearAppStorage(): string[] {
  const removed: string[] = [];
  for (const k of APP_STORAGE_KEYS) {
    try {
      if (localStorage.getItem(k) !== null) {
        localStorage.removeItem(k);
        removed.push(k);
      }
    } catch {
      /* private mode / storage unavailable — nothing to clear */
    }
  }
  return removed;
}
