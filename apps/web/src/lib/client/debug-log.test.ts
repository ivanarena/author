import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDebugLog,
  formatDebugLogEntries,
  loadDebugLogEntries,
  recordDebugLog
} from './debug-log';

class MemoryStorage implements Storage {
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
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();

function installStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  });
}

describe('debug log', () => {
  beforeEach(() => {
    installStorage();
    storage.clear();
  });

  it('stores and formats local diagnostic entries', () => {
    recordDebugLog({
      level: 'warn',
      source: 'Sync',
      message: 'Remote worker reported an error',
      detail: 'timeout'
    });

    const entries = loadDebugLogEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'warn',
      source: 'Sync',
      message: 'Remote worker reported an error',
      detail: 'timeout'
    });
    expect(formatDebugLogEntries(entries)).toContain(
      'Sync | Remote worker reported an error'
    );
  });

  it('redacts common secret fields before storing entries', () => {
    recordDebugLog({
      level: 'error',
      source: 'API',
      message: 'Request failed',
      detail: {
        token: 'session-token',
        authorization: 'Bearer bearer-token',
        e2eeKeyring: 'wrapped-keyring-secret',
        recoveryCode: 'recovery-code-secret',
        keyMaterial: 'key-material-secret',
        deviceTrustSecret: 'device-trust-secret',
        message: 'password=plain-text'
      }
    });

    const log = formatDebugLogEntries(loadDebugLogEntries());
    expect(log).not.toContain('session-token');
    expect(log).not.toContain('bearer-token');
    expect(log).not.toContain('plain-text');
    expect(log).not.toContain('wrapped-keyring-secret');
    expect(log).not.toContain('recovery-code-secret');
    expect(log).not.toContain('key-material-secret');
    expect(log).not.toContain('device-trust-secret');
    expect(log).toContain('[redacted]');
  });

  it('clears local diagnostic entries', () => {
    recordDebugLog({ source: 'App', message: 'Opening workspace' });

    clearDebugLog();

    expect(loadDebugLogEntries()).toEqual([]);
  });

  it('does not throw when browser storage access is denied', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('Storage access denied');
      }
    });

    expect(() =>
      recordDebugLog({ source: 'App', message: 'Opening workspace' })
    ).not.toThrow();
    expect(() => clearDebugLog()).not.toThrow();
    expect(loadDebugLogEntries()).toEqual([]);
  });
});
