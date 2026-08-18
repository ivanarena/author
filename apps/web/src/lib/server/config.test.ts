import { afterEach, describe, expect, it } from 'vitest';
import {
  hasHttpsPublicApiBaseUrl,
  getLoginPassword,
  getRecordLimitConfig,
  getServerSecret,
  shouldEnforceRecordLimits
} from './config';

const ENV_KEYS = [
  'NODE_ENV',
  'NOTES_LOGIN_PASSWORD',
  'NOTES_SERVER_SECRET',
  'NOTES_TOTP_SECRET_KEY',
  'AUTHOR_API_URL',
  'NOTES_DB_PROVIDER',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'NOTES_RECORD_LIMITS_ENABLED',
  'NOTES_RECORD_LIMIT_STORAGE_BYTES',
  'NOTES_RECORD_LIMIT_SAFETY_RATIO',
  'NOTES_RECORD_LIMIT_NOTE_BYTES',
  'NOTES_RECORD_LIMIT_NOTEBOOK_BYTES'
];

const previousEnv = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (!previousEnv.has(key)) continue;
    const value = previousEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previousEnv.clear();
});

function setEnv(key: string, value: string | undefined): void {
  if (!previousEnv.has(key)) previousEnv.set(key, process.env[key]);
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe('server config', () => {
  it('requires an independent server secret in production', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('NOTES_LOGIN_PASSWORD', 'test-password-2026');
    setEnv('NOTES_SERVER_SECRET', undefined);
    setEnv('NOTES_TOTP_SECRET_KEY', undefined);

    expect(() => getServerSecret()).toThrow(
      'NOTES_SERVER_SECRET is required in production'
    );
  });

  it('uses the configured server secret in production', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('NOTES_LOGIN_PASSWORD', 'test-password-2026');
    setEnv('NOTES_SERVER_SECRET', 'server-secret-with-at-least-32-chars');

    expect(getServerSecret()).toBe('server-secret-with-at-least-32-chars');
  });

  it('rejects a production server secret that matches the login password', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('NOTES_LOGIN_PASSWORD', 'same-password-and-secret-value-2026');
    setEnv('NOTES_SERVER_SECRET', 'same-password-and-secret-value-2026');

    expect(() => getServerSecret()).toThrow(
      'NOTES_SERVER_SECRET must not match NOTES_LOGIN_PASSWORD in production'
    );
  });

  it('rejects placeholder server secrets in production', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('NOTES_SERVER_SECRET', 'change-this-server-secret');

    expect(() => getServerSecret()).toThrow(
      'NOTES_SERVER_SECRET must be changed before production use'
    );
  });

  it('rejects placeholder bootstrap passwords in production', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('NOTES_LOGIN_PASSWORD', 'change-this-login-password');

    expect(() => getLoginPassword()).toThrow(
      'NOTES_LOGIN_PASSWORD must be changed before production use'
    );
  });

  it('enables record limits automatically for Turso-backed deployments', () => {
    setEnv('TURSO_DATABASE_URL', 'libsql://author.example.turso.io');
    setEnv('TURSO_AUTH_TOKEN', 'token');

    expect(shouldEnforceRecordLimits()).toBe(true);

    setEnv('NOTES_RECORD_LIMITS_ENABLED', 'false');
    expect(shouldEnforceRecordLimits()).toBe(false);
  });

  it('parses record limit estimates with safe defaults', () => {
    setEnv('NOTES_RECORD_LIMITS_ENABLED', 'true');
    setEnv('NOTES_RECORD_LIMIT_STORAGE_BYTES', '1000');
    setEnv('NOTES_RECORD_LIMIT_SAFETY_RATIO', '1.5');
    setEnv('NOTES_RECORD_LIMIT_NOTE_BYTES', '450');
    setEnv('NOTES_RECORD_LIMIT_NOTEBOOK_BYTES', '50');

    expect(getRecordLimitConfig()).toEqual({
      enabled: true,
      storageBudgetBytes: 1000,
      safetyRatio: 1,
      estimatedNoteBytes: 450,
      estimatedNotebookBytes: 50
    });
  });

  it('detects configured HTTPS public API URLs for proxy-safe hardening', () => {
    setEnv('AUTHOR_API_URL', 'https://author.example.com');
    expect(hasHttpsPublicApiBaseUrl()).toBe(true);

    setEnv('AUTHOR_API_URL', 'http://localhost:3000');
    expect(hasHttpsPublicApiBaseUrl()).toBe(false);

    setEnv('AUTHOR_API_URL', 'not a url');
    expect(hasHttpsPublicApiBaseUrl()).toBe(false);
  });
});
