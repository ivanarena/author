import { describe, expect, it } from 'vitest';
import {
  assertSafeRemoteTestTarget,
  remoteTestTargetFromEnv,
  remoteTestWorkerName
} from './remote-test-target';

describe('remote test target config', () => {
  it('reads staging-specific environment values', () => {
    const target = remoteTestTargetFromEnv(
      {
        STAGING_AUTHOR_API_URL: 'https://author-staging.example.test',
        STAGING_TURSO_DATABASE_URL: 'libsql://author-staging.turso.io',
        STAGING_TURSO_AUTH_TOKEN: 'token',
        AUTHOR_REMOTE_TEST_PASSWORD: 'test-password-1234',
        AUTHOR_REMOTE_TEST_EMAIL: 'remote@example.invalid'
      },
      { requireApiUrl: true }
    );

    expect(target).toMatchObject({
      apiUrl: 'https://author-staging.example.test',
      databaseUrl: 'libsql://author-staging.turso.io',
      authToken: 'token',
      username: 'author-remote-test',
      password: 'test-password-1234',
      email: 'remote@example.invalid',
      allowNonTestTarget: false
    });
  });

  it('fails closed when required remote test secrets are missing', () => {
    expect(() => remoteTestTargetFromEnv({}, { requireApiUrl: true })).toThrow(
      'Missing remote test configuration: AUTHOR_REMOTE_TEST_API_URL, AUTHOR_REMOTE_TEST_DATABASE_URL, AUTHOR_REMOTE_TEST_AUTH_TOKEN, AUTHOR_REMOTE_TEST_PASSWORD'
    );
  });

  it('rejects production-looking targets unless explicitly allowed', () => {
    const target = remoteTestTargetFromEnv({
      AUTHOR_REMOTE_TEST_API_URL: 'https://author.example.com',
      AUTHOR_REMOTE_TEST_DATABASE_URL: 'libsql://author.turso.io',
      AUTHOR_REMOTE_TEST_AUTH_TOKEN: 'token',
      AUTHOR_REMOTE_TEST_PASSWORD: 'test-password-1234'
    });

    expect(() => assertSafeRemoteTestTarget(target)).toThrow(
      'Remote test target must look like a test/staging target'
    );
  });

  it('requires the dedicated test account username', () => {
    const target = remoteTestTargetFromEnv({
      AUTHOR_REMOTE_TEST_API_URL: 'https://author-staging.example.com',
      AUTHOR_REMOTE_TEST_DATABASE_URL: 'libsql://author-staging.turso.io',
      AUTHOR_REMOTE_TEST_AUTH_TOKEN: 'token',
      AUTHOR_REMOTE_TEST_USERNAME: 'owner',
      AUTHOR_REMOTE_TEST_PASSWORD: 'test-password-1234'
    });

    expect(() => assertSafeRemoteTestTarget(target)).toThrow(
      'AUTHOR_REMOTE_TEST_USERNAME must be a dedicated author-remote-test account'
    );
  });

  it('allows an explicitly acknowledged isolated non-test target', () => {
    const target = remoteTestTargetFromEnv({
      AUTHOR_REMOTE_TEST_API_URL: 'https://author.example.com',
      AUTHOR_REMOTE_TEST_DATABASE_URL: 'libsql://author.turso.io',
      AUTHOR_REMOTE_TEST_AUTH_TOKEN: 'token',
      AUTHOR_REMOTE_TEST_PASSWORD: 'test-password-1234',
      AUTHOR_REMOTE_TEST_ALLOW_NON_TEST_TARGET: 'true'
    });

    expect(() => assertSafeRemoteTestTarget(target)).not.toThrow();
  });

  it('does not let the default test username make a production database safe', () => {
    const target = remoteTestTargetFromEnv({
      AUTHOR_REMOTE_TEST_DATABASE_URL: 'libsql://author.turso.io',
      AUTHOR_REMOTE_TEST_AUTH_TOKEN: 'token',
      AUTHOR_REMOTE_TEST_PASSWORD: 'test-password-1234'
    });

    expect(() => assertSafeRemoteTestTarget(target)).toThrow(
      'Remote test target must look like a test/staging target'
    );
  });

  it('defaults the staging worker name', () => {
    expect(remoteTestWorkerName({})).toBe('author-staging');
    expect(
      remoteTestWorkerName({
        STAGING_CLOUDFLARE_WORKER_NAME: 'author-preview'
      })
    ).toBe('author-preview');
  });
});
