import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localDb } from './db';
import { clearStoredEncryptionKeyMaterial } from './encryption';
import {
  clearStoredSession,
  getLoginHint,
  getOrCreateDevice,
  getStoredSession,
  getTheme,
  setDisplayName,
  setStoredSession,
  setTheme
} from './local-state';

vi.mock('./db', () => ({
  localDb: {
    devices: {
      get: vi.fn(),
      put: vi.fn()
    }
  }
}));

vi.mock('./encryption', () => ({
  clearStoredEncryptionKeyMaterial: vi.fn()
}));

class MemoryStorage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

const storage = new MemoryStorage();

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'device-id') });
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false }))
  );
  vi.mocked(localDb.devices.get).mockResolvedValue(undefined);
});

describe('local browser state', () => {
  it('creates and persists a browser device record once', async () => {
    await expect(getOrCreateDevice()).resolves.toEqual({
      id: 'device-id',
      name: 'This browser'
    });
    expect(localDb.devices.put).toHaveBeenCalledWith({
      id: 'device-id',
      name: 'This browser'
    });

    vi.mocked(localDb.devices.get).mockResolvedValue({
      id: 'device-id',
      name: 'This browser'
    });
    await getOrCreateDevice();

    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(localDb.devices.put).toHaveBeenCalledTimes(1);
  });

  it('stores, hints, and clears auth session fields without losing the login hint', () => {
    setStoredSession({
      token: 'session-token',
      user: { username: 'owner', displayName: 'Iv' },
      expiresAt: '2026-05-10T12:00:00.000Z'
    });

    expect(getStoredSession()).toEqual({
      token: 'session-token',
      user: { username: 'owner', displayName: 'Iv' },
      expiresAt: '2026-05-10T12:00:00.000Z'
    });
    expect(getLoginHint()).toBe('owner');

    clearStoredSession();

    expect(getStoredSession()).toBeNull();
    expect(getLoginHint()).toBe('owner');
    expect(clearStoredEncryptionKeyMaterial).toHaveBeenCalled();
  });

  it('removes blank display names and falls back to system theme safely', () => {
    setDisplayName('  ');
    expect(localStorage.getItem('author-display-name')).toBeNull();

    expect(getTheme()).toBe('light');
    localStorage.setItem('author-theme', 'dark-rose');
    expect(getTheme()).toBe('dark-rose');

    setTheme('light-mint');
    expect(document.documentElement.dataset.theme).toBe('light-mint');
  });
});
