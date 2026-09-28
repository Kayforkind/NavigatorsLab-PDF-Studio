import { describe, expect, it, beforeEach } from 'vitest';
import { APP_STORAGE_KEYS, clearAppStorage } from './storage';

beforeEach(() => {
  localStorage.clear();
});

describe('clearAppStorage (one-click wipe)', () => {
  it('removes every registered app key', () => {
    for (const k of APP_STORAGE_KEYS) localStorage.setItem(k, 'x');
    const removed = clearAppStorage();
    expect(removed.sort()).toEqual([...APP_STORAGE_KEYS].sort());
    for (const k of APP_STORAGE_KEYS) expect(localStorage.getItem(k)).toBeNull();
  });

  it('leaves unrelated keys alone', () => {
    localStorage.setItem('some-other-app', 'keep');
    localStorage.setItem(APP_STORAGE_KEYS[0], 'x');
    clearAppStorage();
    expect(localStorage.getItem('some-other-app')).toBe('keep');
    expect(localStorage.getItem(APP_STORAGE_KEYS[0])).toBeNull();
  });

  it('reports only keys that were present', () => {
    localStorage.setItem(APP_STORAGE_KEYS[1], 'x');
    expect(clearAppStorage()).toEqual([APP_STORAGE_KEYS[1]]);
  });

  it('is a no-op on empty storage', () => {
    expect(clearAppStorage()).toEqual([]);
  });
});
