import { afterEach, describe, expect, it } from 'vitest';
import { getServerSecret } from './config';

const ENV_KEYS = [
  'NODE_ENV',
  'NOTES_LOGIN_PASSWORD',
  'NOTES_SERVER_SECRET',
  'NOTES_TOTP_SECRET_KEY'
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
    setEnv('NOTES_LOGIN_PASSWORD', 'test-password');
    setEnv('NOTES_SERVER_SECRET', undefined);
    setEnv('NOTES_TOTP_SECRET_KEY', undefined);

    expect(() => getServerSecret()).toThrow(
      'NOTES_SERVER_SECRET is required in production'
    );
  });

  it('uses the configured server secret in production', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('NOTES_LOGIN_PASSWORD', 'test-password');
    setEnv('NOTES_SERVER_SECRET', 'server-secret');

    expect(getServerSecret()).toBe('server-secret');
  });
});
