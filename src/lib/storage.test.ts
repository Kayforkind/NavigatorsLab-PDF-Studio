import { describe, expect, it, beforeEach } from 'vitest';
import {
  APP_STORAGE_KEYS,
  SESSION_KEY,
  SETTINGS_KEY,
  clearAppStorage,
  persistedMemoryOnly,
  persistMemoryOnly,
  sessionAutosaveAllowed,
} from './storage';

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

describe('memory-only mode', () => {
  it('defaults to off when nothing is persisted', () => {
    expect(persistedMemoryOnly()).toBe(false);
    expect(sessionAutosaveAllowed()).toBe(true);
  });

  it('defaults to off on corrupt settings JSON', () => {
    localStorage.setItem(SETTINGS_KEY, 'not-json{{{');
    expect(persistedMemoryOnly()).toBe(false);
  });

  it('enabling clears any existing SESSION_KEY immediately', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ name: 'doc.pdf' }));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ color: '#fff', width: 1 }));
    persistMemoryOnly(true);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(persistedMemoryOnly()).toBe(true);
    expect(sessionAutosaveAllowed()).toBe(false);
  });

  it('enabling preserves the other persisted settings', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ color: '#abc', width: 3, fontSize: 12 }));
    persistMemoryOnly(true);
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) as string);
    expect(raw.memoryOnly).toBe(true);
    expect(raw.color).toBe('#abc');
    expect(raw.width).toBe(3);
    expect(raw.fontSize).toBe(12);
  });

  it('disabling does not touch the saved session', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ name: 'doc.pdf' }));
    persistMemoryOnly(false);
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
    expect(persistedMemoryOnly()).toBe(false);
    expect(sessionAutosaveAllowed()).toBe(true);
  });

  it('treats truthy non-boolean memoryOnly as off', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ memoryOnly: 'yes' }));
    expect(persistedMemoryOnly()).toBe(false);
    expect(sessionAutosaveAllowed()).toBe(true);
  });

  it('survives a round trip', () => {
    persistMemoryOnly(true);
    expect(persistedMemoryOnly()).toBe(true);
    persistMemoryOnly(false);
    expect(persistedMemoryOnly()).toBe(false);
  });
});
