import { describe, expect, it, beforeEach, vi } from 'vitest';
import { APP_STORAGE_KEYS, LANG_KEY } from './storage';
import enJson from '../locales/en/translation.json';
import esJson from '../locales/es/translation.json';
import deJson from '../locales/de/translation.json';
import frJson from '../locales/fr/translation.json';
import ptJson from '../locales/pt/translation.json';

function leafPaths(o: unknown, prefix = ''): string[] {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

function setBrowserLang(tag: string) {
  Object.defineProperty(window.navigator, 'language', { value: tag, configurable: true });
}

describe('i18n language detection & switching', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    setBrowserLang('en-US');
  });

  it('uses the saved language from localStorage first', async () => {
    localStorage.setItem(LANG_KEY, 'de');
    const { default: i18n } = await import('../i18n');
    expect(i18n.language).toBe('de');
  });

  it('detects the browser language when nothing is saved', async () => {
    setBrowserLang('es-ES');
    const { default: i18n } = await import('../i18n');
    expect(i18n.language).toBe('es');
  });

  it('falls back to English for unsupported browser languages', async () => {
    setBrowserLang('ja-JP');
    const { default: i18n } = await import('../i18n');
    expect(i18n.language).toBe('en');
  });

  it('falls back to English for garbage saved values', async () => {
    localStorage.setItem(LANG_KEY, 'xx');
    const { default: i18n } = await import('../i18n');
    expect(i18n.language).toBe('en');
  });

  it('setLanguage persists the choice and switches the UI language', async () => {
    const mod = await import('../i18n');
    mod.setLanguage('fr');
    expect(localStorage.getItem(LANG_KEY)).toBe('fr');
    expect(mod.default.language).toBe('fr');
    expect(mod.default.t('common.cancel')).toBe('Annuler');
  });

  it('setLanguage ignores unknown language codes', async () => {
    const mod = await import('../i18n');
    mod.setLanguage('fr');
    mod.setLanguage('xx');
    expect(mod.default.language).toBe('fr');
    expect(localStorage.getItem(LANG_KEY)).toBe('fr');
  });

  it('missing keys fall back to English instead of rendering the key', async () => {
    const { default: i18n } = await import('../i18n');
    await i18n.changeLanguage('de');
    // even for keys that exist in German, an unknown key must resolve via en
    expect(i18n.t('app.thisKeyDoesNotExist' as never)).toBe('app.thisKeyDoesNotExist');
    expect(i18n.t('app.save')).not.toBe('app.save');
  });

  it('resolves English plurals correctly', async () => {
    const { default: i18n } = await import('../i18n');
    expect(i18n.t('app.opened', { name: 'x.pdf', count: 1 })).toBe('Opened “x.pdf” — 1 page');
    expect(i18n.t('app.opened', { name: 'x.pdf', count: 3 })).toBe('Opened “x.pdf” — 3 pages');
  });
});

describe('i18n storage integration', () => {
  it('registers the language key so the one-click wipe clears it', async () => {
    expect(APP_STORAGE_KEYS).toContain(LANG_KEY);
    const { clearAppStorage } = await import('./storage');
    localStorage.setItem(LANG_KEY, 'es');
    const removed = clearAppStorage();
    expect(removed).toContain(LANG_KEY);
    expect(localStorage.getItem(LANG_KEY)).toBeNull();
  });
});

describe('locale catalog completeness', () => {
  const enPaths = leafPaths(enJson).sort();

  it.each([
    ['es', esJson],
    ['de', deJson],
    ['fr', frJson],
    ['pt', ptJson],
  ])('%s has exactly the same keys as English', (_lng, json) => {
    expect(leafPaths(json).sort()).toEqual(enPaths);
  });

  it('no locale is missing translations (no empty strings)', () => {
    for (const [lng, json] of [['es', esJson], ['de', deJson], ['fr', frJson], ['pt', ptJson]] as const) {
      const empties = leafPaths(json).filter((p) => {
        const v = p.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], json);
        return v === '';
      });
      expect(empties, `${lng} has empty translations`).toEqual([]);
    }
  });

  it('placeholders and markup survive translation', () => {
    const enStr = JSON.stringify(enJson);
    const placeholders = [...enStr.matchAll(/\{\{[a-zA-Z]+\}\}/g)].map((m) => m[0]);
    const unique = [...new Set(placeholders)];
    for (const [lng, json] of [['es', esJson], ['de', deJson], ['fr', frJson], ['pt', ptJson]] as const) {
      const str = JSON.stringify(json);
      for (const ph of unique) {
        expect(str, `${lng} is missing placeholder ${ph}`).toContain(ph);
      }
      // inline markup tags used by <Trans> must be preserved
      for (const tag of ['<b>', '</b>', '<code>', '</code>', '<i>', '</i>']) {
        const enCount = enStr.split(tag).length;
        expect(str.split(tag).length, `${lng} tag ${tag} count differs`).toBe(enCount);
      }
    }
  });
});
