import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthProofPurpose } from '@author/api-types';
import {
  fixtureDevice,
  fixtureNote,
  fixtureNotebook
} from '@author/test-fixtures';
import { setUserPassword, updateUserProfile } from './auth';
import { get, openConfiguredDatabase, openDatabase } from './db';
import { api, resetHonoStateForTests } from './hono';
import { getNote, pushChanges, setSyncMeta } from './repository';
import {
  authProofFromPassword,
  passwordVerifierFromPassword,
  randomAuthNonce
} from '../shared/auth-proof';

let tempDir: string;
const fixtureDeviceTrustSecret = 'test-device-trust-secret-0123456789';

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'author-api-'));
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.AUTHOR_API_URL;
  delete process.env.AUTHOR_SYNC_API_URL;
  delete process.env.ANDROID_SYNC_API_URL;
  delete process.env.ANDROID_SYNC_SERVER_URL;
  delete process.env.NOTES_SYNC_SERVER_URL;
  delete process.env.NOTES_SIGNUP_ALLOWED_EMAILS;
  process.env.NOTES_DB_PATH = join(tempDir, 'notes.sqlite');
  process.env.NOTES_REMOTE_SYNC_ENABLED = 'false';
  process.env.NOTES_LOGIN_USERNAME = 'owner';
  process.env.NOTES_LOGIN_PASSWORD = 'test-password';
});

afterEach(async () => {
  await resetHonoStateForTests();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.NOTES_DB_PROVIDER;
  delete process.env.NOTES_DB_PATH;
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.AUTHOR_API_URL;
  delete process.env.AUTHOR_SYNC_API_URL;
  delete process.env.ANDROID_SYNC_API_URL;
  delete process.env.ANDROID_SYNC_SERVER_URL;
  delete process.env.NOTES_SYNC_SERVER_URL;
  delete process.env.NOTES_REMOTE_SYNC_ENABLED;
  delete process.env.NOTES_SIGNUP_ALLOWED_EMAILS;
  delete process.env.NOTES_LOGIN_USERNAME;
  delete process.env.NOTES_LOGIN_PASSWORD;
  delete process.env.NOTES_AUTH_TOKEN;
  delete process.env.NOTES_LEGACY_AUTH_TOKEN_ENABLED;
  delete process.env.NOTES_METRICS_PUBLIC;
  delete process.env.NOTES_METRICS_TOKEN;
  delete process.env.NOTES_SERVER_SECRET;
});

async function loginToken(
  username = 'owner',
  password = 'test-password'
): Promise<string> {
  const login = await loginResponse(username, password);
  expect(login.status).toBe(200);
  return ((await login.json()) as { token: string }).token;
}

async function authChallenge(
  username: string | null,
  purpose: AuthProofPurpose,
  token?: string
) {
  const challenge = await api.fetch(
    new Request('http://localhost/api/auth/challenge', {
      method: 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        username,
        purpose,
        clientNonce: randomAuthNonce()
      })
    })
  );
  expect(challenge.status).toBe(200);
  return await challenge.json();
}

async function loginResponse(
  username = 'owner',
  password = 'test-password',
  totpCode: string | null = null
): Promise<Response> {
  const challenge = await authChallenge(username, 'login');
  const body =
    challenge.mode === 'bootstrap'
      ? {
          username,
          bootstrapPassword: password,
          passwordVerifier: await passwordVerifierFromPassword(password),
          totpCode,
          device: fixtureDevice,
          deviceTrustSecret: fixtureDeviceTrustSecret
        }
      : {
          username,
          proof: (await authProofFromPassword(password, challenge)).proof,
          totpCode,
          device: fixtureDevice,
          deviceTrustSecret: fixtureDeviceTrustSecret
        };
  return await api.fetch(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
}

async function passwordProof(
  token: string,
  password: string,
  purpose: Exclude<AuthProofPurpose, 'login'>
) {
  const challenge = await authChallenge(null, purpose, token);
  return (await authProofFromPassword(password, challenge)).proof;
}

async function signupBody(
  username: string,
  email: string,
  password: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    username,
    email,
    passwordVerifier: await passwordVerifierFromPassword(password),
    device: fixtureDevice,
    deviceTrustSecret: fixtureDeviceTrustSecret,
    ...overrides
  };
}

async function post(
  path: string,
  body: unknown,
  token: string
): Promise<Response> {
  return await api.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function base32Decode(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of value.toUpperCase().replaceAll(/\s|=/g, '')) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / 30);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret))
    .update(counterBytes)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(truncated % 1_000_000).padStart(6, '0');
}

describe('Hono API', () => {
  it('serves health and rejects unauthorized sync requests', async () => {
    const health = await api.fetch(new Request('http://localhost/api/health'));
    expect(health.status).toBe(200);
    expect((await health.json()).service).toBe('author');

    const metrics = await api.fetch(
      new Request('http://localhost/api/metrics')
    );
    expect(metrics.status).toBe(401);

    const token = await loginToken();
    const authorizedMetrics = await api.fetch(
      new Request('http://localhost/api/metrics', {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    expect(authorizedMetrics.status).toBe(200);
    await expect(authorizedMetrics.text()).resolves.toContain('author_up 1');

    const pull = await post('/api/sync/pull', { since: null }, 'bad-token');
    expect(pull.status).toBe(401);

    const emptyBearer = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { authorization: 'Bearer ' }
      })
    );
    expect(emptyBearer.status).toBe(401);

    const validPull = await post('/api/sync/pull', { since: null }, token);
    expect(validPull.status).toBe(200);

    const status = await api.fetch(
      new Request('http://localhost/api/sync/status', {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      remote: { enabled: false, state: 'disabled' }
    });
  });

  it('serves non-secret public sync configuration', async () => {
    process.env.AUTHOR_API_URL = 'https://author.example.com';
    process.env.TURSO_DATABASE_URL = 'libsql://author.example.turso.io';
    process.env.TURSO_AUTH_TOKEN = 'super-secret-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';
    process.env.NOTES_SIGNUP_ALLOWED_EMAILS = 'new@example.com';

    const response = await api.fetch(
      new Request('http://localhost/api/config')
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      apiBaseUrl: 'https://author.example.com',
      remote: {
        enabled: true,
        configured: true
      },
      signup: {
        enabled: true,
        emailRequired: true,
        emailAllowListRequired: true
      }
    });
    expect(JSON.stringify(body)).not.toContain('super-secret-token');
    expect(JSON.stringify(body)).not.toContain('libsql://');
    expect(JSON.stringify(body)).not.toContain('author.example.turso.io');
  });

  it('allows metrics only with an explicit metrics token when configured', async () => {
    process.env.NOTES_METRICS_TOKEN = 'metrics-secret';

    const unauthorized = await api.fetch(
      new Request('http://localhost/api/metrics')
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await api.fetch(
      new Request('http://localhost/api/metrics', {
        headers: { 'x-author-metrics-token': 'metrics-secret' }
      })
    );
    expect(authorized.status).toBe(200);
    await expect(authorized.text()).resolves.toContain('author_up 1');
  });

  it('sets an HttpOnly auth cookie and accepts cookie-backed sessions', async () => {
    const login = await loginResponse();
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('author_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const cookiePair = cookie.split(';')[0];

    const validate = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { cookie: cookiePair }
      })
    );
    expect(validate.status).toBe(200);

    const logout = await api.fetch(
      new Request('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { cookie: cookiePair }
      })
    );
    expect(logout.status).toBe(200);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('validates active auth tokens without accepting invalid ones', async () => {
    const token = await loginToken();
    const valid = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({
      ok: true,
      user: { username: 'owner' }
    });

    const invalid = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { authorization: 'Bearer wrong-token' }
      })
    );
    expect(invalid.status).toBe(401);
  });

  it('rejects mutating requests with a mismatched origin header', async () => {
    const response = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://evil.example'
        },
        body: JSON.stringify({
          username: 'owner',
          password: 'test-password',
          device: fixtureDevice
        })
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request origin'
    });
  });

  it('persists and clears login throttle attempts', async () => {
    const badLogin = await loginResponse('owner', 'wrong-password');
    expect(badLogin.status).toBe(401);

    let db = await openDatabase();
    try {
      await expect(
        get(db, 'SELECT count FROM auth_rate_limits')
      ).resolves.toMatchObject({ count: 1 });
    } finally {
      db.close();
    }

    await loginToken();
    db = await openDatabase();
    try {
      await expect(
        get(db, 'SELECT count FROM auth_rate_limits')
      ).resolves.toBeNull();
    } finally {
      db.close();
    }
  });

  it('does not reveal account existence through login challenge salt stability', async () => {
    await loginToken();

    const existingOne = await authChallenge('owner', 'login');
    const existingTwo = await authChallenge('owner', 'login');
    const missingOne = await authChallenge('missing-user', 'login');
    const missingTwo = await authChallenge('missing-user', 'login');

    expect(existingOne).toMatchObject({ mode: 'proof', username: 'owner' });
    expect(missingOne).toMatchObject({
      mode: 'proof',
      username: 'missing-user'
    });
    expect(existingOne.salt).toBe(existingTwo.salt);
    expect(missingOne.salt).toBe(missingTwo.salt);
    expect(missingOne.salt).not.toBe(existingOne.salt);
  });

  it('rejects malformed login challenge nonces', async () => {
    const response = await api.fetch(
      new Request('http://localhost/api/auth/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          purpose: 'login',
          clientNonce: 'AA!!'
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid auth challenge payload'
    });
  });

  it('rejects oversized JSON bodies even without content-length', async () => {
    const response = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          password: 'x'.repeat(20_000),
          device: fixtureDevice
        })
      })
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: 'Login payload too large'
    });
  });

  it('creates new users through signup and rejects duplicate usernames', async () => {
    const remotePath = join(tempDir, 'remote.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';
    process.env.NOTES_SERVER_SECRET = 'test-server-secret';
    process.env.NOTES_SIGNUP_ALLOWED_EMAILS = 'new@example.com';

    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          await signupBody('new-user', 'new@example.com', 'new-user-password', {
            displayName: 'New User'
          })
        )
      })
    );
    expect(signup.status).toBe(200);
    await expect(signup.json()).resolves.toMatchObject({
      token: expect.any(String),
      user: { username: 'new-user', displayName: 'New User' }
    });

    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      const user = await remote.execute({
        sql: 'SELECT username, email, display_name FROM users WHERE username = ?',
        args: ['new-user']
      });
      expect(user.rows[0]).toMatchObject({
        username: 'new-user',
        email: 'new@example.com',
        display_name: 'New User'
      });
    } finally {
      remote.close();
    }

    const duplicate = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          await signupBody('new-user', 'new@example.com', 'new-user-password')
        )
      })
    );
    expect(duplicate.status).toBe(409);
  });

  it('rejects signup payloads without a client password verifier', async () => {
    const remotePath = join(tempDir, 'short-password-remote.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';
    process.env.NOTES_SIGNUP_ALLOWED_EMAILS = 'short@example.com';

    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'short-user',
          email: 'short@example.com',
          password: 'short',
          device: fixtureDevice
        })
      })
    );

    expect(signup.status).toBe(400);
    await expect(signup.json()).resolves.toEqual({
      error: 'Invalid signup payload'
    });
  });

  it('trusts a remote-backed signup device for later OTP login', async () => {
    const remotePath = join(tempDir, 'remote-signup-trusted.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';
    process.env.NOTES_SIGNUP_ALLOWED_EMAILS = 'new@example.com';

    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          await signupBody('new-user', 'new@example.com', 'new-user-password')
        )
      })
    );
    expect(signup.status).toBe(200);
    const session = (await signup.json()) as { token: string };

    const account = await api.fetch(
      new Request('http://localhost/api/account', {
        headers: { authorization: `Bearer ${session.token}` }
      })
    );
    expect(account.status).toBe(200);
    await expect(account.json()).resolves.toMatchObject({
      trustedDevices: [
        {
          deviceId: fixtureDevice.id,
          deviceName: fixtureDevice.name,
          current: true
        }
      ]
    });

    const revokeTrust = await api.fetch(
      new Request(
        `http://localhost/api/account/trusted-devices/${fixtureDevice.id}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${session.token}` }
        }
      )
    );
    expect(revokeTrust.status).toBe(200);
    await expect(revokeTrust.json()).resolves.toMatchObject({
      trustedDevices: []
    });

    const setup = await post('/api/account/totp/setup', {}, session.token);
    expect(setup.status).toBe(200);
    const setupBody = (await setup.json()) as { secret: string };
    const enable = await post(
      '/api/account/totp',
      {
        proof: await passwordProof(session.token, 'new-user-password', 'totp'),
        secret: setupBody.secret,
        totpCode: totpCode(setupBody.secret)
      },
      session.token
    );
    expect(enable.status).toBe(200);

    const trustedDeviceCode = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'new-user',
          totpCode: totpCode(setupBody.secret),
          device: fixtureDevice
        })
      })
    );
    expect(trustedDeviceCode.status).toBe(401);
  });

  it('uses Turso as the primary database when running with Worker env', async () => {
    const primaryPath = join(tempDir, 'worker-primary.sqlite');
    const workerEnv = {
      NOTES_DB_PROVIDER: 'turso',
      TURSO_DATABASE_URL: `file:${primaryPath}`,
      TURSO_AUTH_TOKEN: 'test-token',
      NOTES_REMOTE_SYNC_ENABLED: 'false',
      NOTES_LOGIN_USERNAME: 'owner',
      NOTES_LOGIN_PASSWORD: 'test-password',
      NOTES_SIGNUP_ALLOWED_EMAILS: 'worker@example.com'
    };

    const config = await api.fetch(
      new Request('http://localhost/api/config'),
      workerEnv
    );
    expect(config.status).toBe(200);
    await expect(config.json()).resolves.toMatchObject({
      remote: { enabled: false, configured: false },
      signup: {
        enabled: true,
        emailRequired: true,
        emailAllowListRequired: true
      }
    });

    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          await signupBody(
            'worker-user',
            'worker@example.com',
            'worker-user-password',
            { displayName: 'Worker User' }
          )
        )
      }),
      workerEnv
    );
    expect(signup.status).toBe(200);

    const primary = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${primaryPath}`, authToken: 'test-token' }
    });
    try {
      const user = await primary.execute({
        sql: 'SELECT username, display_name, password_hash FROM users WHERE username = ?',
        args: ['worker-user']
      });
      expect(user.rows[0]).toMatchObject({
        username: 'worker-user',
        display_name: 'Worker User'
      });
      expect(String(user.rows[0].password_hash)).toMatch(
        /^argon2id-scram-sha256:v1:/
      );
    } finally {
      primary.close();
    }
  });

  it('keeps signup disabled until an email allow list is configured', async () => {
    const remotePath = join(tempDir, 'remote-disabled-signup.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          await signupBody(
            'disabled-user',
            'disabled@example.com',
            'new-user-password'
          )
        )
      })
    );

    expect(signup.status).toBe(403);
    await expect(signup.json()).resolves.toMatchObject({
      error: 'Signup is disabled. Add an allowed email first.'
    });
  });

  it('requires an allowed email when signup is configured', async () => {
    const remotePath = join(tempDir, 'remote-email-signup.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';
    process.env.NOTES_SIGNUP_ALLOWED_EMAILS = 'invite@example.com';

    const deniedEmail = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          await signupBody(
            'denied-user',
            'denied@example.com',
            'new-user-password'
          )
        )
      })
    );
    expect(deniedEmail.status).toBe(403);

    const allowed = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          await signupBody(
            'invite-user',
            'invite@example.com',
            'new-user-password'
          )
        )
      })
    );
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({
      user: { username: 'invite-user', email: 'invite@example.com' }
    });
  });

  it('allows signup from database-backed allowed emails', async () => {
    const remotePath = join(tempDir, 'remote-db-email-signup.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await remote.execute({
        sql: `INSERT INTO signup_allowed_emails (email, created_at)
              VALUES (?, ?)`,
        args: ['db-invite@example.com', new Date().toISOString()]
      });
    } finally {
      remote.close();
    }

    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          await signupBody(
            'db-invite-user',
            'db-invite@example.com',
            'new-user-password'
          )
        )
      })
    );

    expect(signup.status).toBe(200);
    await expect(signup.json()).resolves.toMatchObject({
      user: { username: 'db-invite-user', email: 'db-invite@example.com' }
    });
  });

  it('requires remote database access for signup', async () => {
    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          await signupBody(
            'remote-required-user',
            'remote-required@example.com',
            'new-user-password'
          )
        )
      })
    );

    expect(signup.status).toBe(503);
    await expect(signup.json()).resolves.toMatchObject({
      error: 'Signup requires remote database access'
    });
  });

  it('authenticates remote-backed users through Turso before local session creation', async () => {
    const remotePath = join(tempDir, 'remote-login.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const local = await openDatabase();
    try {
      await setUserPassword(local, 'owner', 'old-local-password');
    } finally {
      local.close();
    }

    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(remote, 'owner', 'remote-password');
    } finally {
      remote.close();
    }

    const oldLocalPassword = await loginResponse('owner', 'old-local-password');
    expect(oldLocalPassword.status).toBe(401);

    const remotePassword = await loginResponse('owner', 'remote-password');
    expect(remotePassword.status).toBe(200);
    await expect(remotePassword.json()).resolves.toMatchObject({
      user: { username: 'owner' },
      token: expect.any(String)
    });
  });

  it('creates a local session for a remote-backed user when mirror sync is busy', async () => {
    const remotePath = join(tempDir, 'remote-login-busy.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(remote, 'owner', 'remote-password');
    } finally {
      remote.close();
    }

    const local = await openDatabase();
    try {
      await setSyncMeta(
        local,
        'mirror.lock.v1',
        JSON.stringify({
          owner: 'another-process',
          expiresAt: new Date(Date.now() + 1_000).toISOString()
        })
      );
    } finally {
      local.close();
    }

    const response = await loginResponse('owner', 'remote-password');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    expect(body.token).toEqual(expect.any(String));

    const valid = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { authorization: `Bearer ${body.token}` }
      })
    );
    expect(valid.status).toBe(200);

    await sleep(5_200);
  });

  it('revokes existing sessions when a password is reset', async () => {
    const token = await loginToken();

    const db = await openDatabase();
    try {
      await setUserPassword(db, 'owner', 'new-test-password');
    } finally {
      db.close();
    }

    const oldSession = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    expect(oldSession.status).toBe(401);

    const oldPassword = await loginResponse('owner', 'test-password');
    expect(oldPassword.status).toBe(401);

    await expect(loginToken('owner', 'new-test-password')).resolves.toEqual(
      expect.any(String)
    );
  });

  it('revokes trusted device OTP login when a password is reset', async () => {
    const remotePath = join(tempDir, 'trusted-reset-remote.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const seededRemote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(seededRemote, 'owner', 'test-password');
    } finally {
      seededRemote.close();
    }

    const token = await loginToken();
    const setup = await post('/api/account/totp/setup', {}, token);
    expect(setup.status).toBe(200);
    const setupBody = (await setup.json()) as { secret: string };
    const enable = await post(
      '/api/account/totp',
      {
        proof: await passwordProof(token, 'test-password', 'totp'),
        secret: setupBody.secret,
        totpCode: totpCode(setupBody.secret)
      },
      token
    );
    expect(enable.status).toBe(200);

    const trustedBeforeReset = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          totpCode: totpCode(setupBody.secret),
          deviceTrustSecret: fixtureDeviceTrustSecret,
          device: fixtureDevice
        })
      })
    );
    expect(trustedBeforeReset.status).toBe(200);

    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(remote, 'owner', 'new-test-password');
    } finally {
      remote.close();
    }

    const trustedAfterReset = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          totpCode: totpCode(setupBody.secret),
          deviceTrustSecret: fixtureDeviceTrustSecret,
          device: fixtureDevice
        })
      })
    );
    expect(trustedAfterReset.status).toBe(401);
  });

  it('rejects account mutations when remote sync revokes the local session', async () => {
    const remotePath = join(tempDir, 'revoked-session-remote.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(remote, 'owner', 'test-password');
    } finally {
      remote.close();
    }

    const token = await loginToken();
    await resetHonoStateForTests();

    const updatedRemote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(updatedRemote, 'owner', 'new-test-password');
    } finally {
      updatedRemote.close();
    }

    const profile = await api.fetch(
      new Request('http://localhost/api/account', {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ displayName: 'Stale session edit' })
      })
    );
    expect(profile.status).toBe(401);
  });

  it('returns clear account errors for invalid or duplicate emails', async () => {
    const remotePath = join(tempDir, 'account-email-errors.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(remote, 'owner', 'test-password');
      await setUserPassword(remote, 'other', 'other-password');
      await updateUserProfile(remote, 'other', null, 'taken@example.com');
    } finally {
      remote.close();
    }

    const token = await loginToken();
    const invalid = await api.fetch(
      new Request('http://localhost/api/account', {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ displayName: 'Owner', email: 'not-an-email' })
      })
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: 'A valid email address is required'
    });

    const duplicate = await api.fetch(
      new Request('http://localhost/api/account', {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          displayName: 'Owner',
          email: 'taken@example.com'
        })
      })
    );
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: 'Email is already taken'
    });
  });

  it('updates profile, logs out, changes password, and deletes account', async () => {
    const remotePath = join(tempDir, 'account-remote.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';
    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(remote, 'owner', 'test-password');
    } finally {
      remote.close();
    }

    let token = await loginToken();

    const profile = await api.fetch(
      new Request('http://localhost/api/account', {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ displayName: 'Iv' })
      })
    );
    expect(profile.status).toBe(200);
    await expect(profile.json()).resolves.toMatchObject({
      user: { username: 'owner', displayName: 'Iv' }
    });

    const logout = await post('/api/auth/logout', {}, token);
    expect(logout.status).toBe(200);
    const loggedOut = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    expect(loggedOut.status).toBe(401);

    token = await loginToken();
    const shortPassword = await post(
      '/api/account/password',
      {
        proof: await passwordProof(token, 'test-password', 'password_change')
      },
      token
    );
    expect(shortPassword.status).toBe(400);
    await expect(shortPassword.json()).resolves.toEqual({
      error: 'Invalid password payload'
    });

    const password = await post(
      '/api/account/password',
      {
        proof: await passwordProof(token, 'test-password', 'password_change'),
        newPasswordVerifier:
          await passwordVerifierFromPassword('new-test-password')
      },
      token
    );
    expect(password.status).toBe(200);
    const passwordBody = (await password.json()) as {
      session?: { token: string; expiresAt: string };
    };
    expect(passwordBody.session?.token).toEqual(expect.any(String));
    const oldTokenValidate = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    expect(oldTokenValidate.status).toBe(401);
    const replacementValidate = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { authorization: `Bearer ${passwordBody.session?.token}` }
      })
    );
    expect(replacementValidate.status).toBe(200);
    await expect(loginToken('owner', 'new-test-password')).resolves.toEqual(
      expect.any(String)
    );

    const remoteWithData = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await pushChanges(
        remoteWithData,
        {
          device: fixtureDevice,
          notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
          notes: [{ record: fixtureNote, baseVersion: 0 }]
        },
        'owner'
      );
    } finally {
      remoteWithData.close();
    }

    token = await loginToken('owner', 'new-test-password');
    const deleted = await api.fetch(
      new Request('http://localhost/api/account', {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          proof: await passwordProof(
            token,
            'new-test-password',
            'delete_account'
          )
        })
      })
    );
    expect(deleted.status).toBe(200);

    const countSql = `
      SELECT
        (SELECT count(*) FROM users WHERE username = ?) AS users,
        (SELECT count(*) FROM notes WHERE owner_username = ?) AS notes,
        (SELECT count(*) FROM notebooks WHERE owner_username = ?) AS notebooks,
        (SELECT count(*) FROM entity_changes WHERE owner_username = ?) AS entity_changes,
        (SELECT count(*) FROM entity_tombstones WHERE owner_username = ?) AS tombstones,
        (SELECT count(*) FROM note_versions WHERE owner_username = ?) AS note_versions,
        (SELECT count(*) FROM notebook_versions WHERE owner_username = ?) AS notebook_versions
    `;
    const countArgs = Array(7).fill('owner');
    const deletedRemote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      const counts = await deletedRemote.execute({
        sql: countSql,
        args: countArgs
      });
      expect(counts.rows[0]).toMatchObject({
        users: 0,
        notes: 0,
        notebooks: 0,
        entity_changes: 0,
        tombstones: 0,
        note_versions: 0,
        notebook_versions: 0
      });
    } finally {
      deletedRemote.close();
    }

    const local = await openDatabase();
    try {
      const counts = await local.execute({ sql: countSql, args: countArgs });
      expect(counts.rows[0]).toMatchObject({
        users: 0,
        notes: 0,
        notebooks: 0,
        entity_changes: 0,
        tombstones: 0,
        note_versions: 0,
        notebook_versions: 0
      });
    } finally {
      local.close();
    }

    const missing = await loginResponse('owner', 'new-test-password');
    expect(missing.status).toBe(401);
  }, 180_000);

  it('enables TOTP and requires a valid code on login', async () => {
    const remotePath = join(tempDir, 'totp-remote.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(remote, 'owner', 'test-password');
    } finally {
      remote.close();
    }

    const token = await loginToken();
    const setup = await post('/api/account/totp/setup', {}, token);
    expect(setup.status).toBe(200);
    const setupBody = (await setup.json()) as { secret: string };
    const enable = await post(
      '/api/account/totp',
      {
        proof: await passwordProof(token, 'test-password', 'totp'),
        secret: setupBody.secret,
        totpCode: totpCode(setupBody.secret)
      },
      token
    );
    expect(enable.status).toBe(200);
    await expect(enable.json()).resolves.toMatchObject({
      user: { username: 'owner', twoFactorEnabled: true }
    });
    const storedRemote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      const row = (await get(
        storedRemote,
        'SELECT totp_secret FROM users WHERE username = ?',
        ['owner']
      )) as { totp_secret: unknown } | null;
      const storedSecret = String(row?.totp_secret ?? '');
      expect(storedSecret).toMatch(/^srvenc:v1:/);
      expect(storedSecret).not.toBe(setupBody.secret);
    } finally {
      storedRemote.close();
    }

    const withoutCode = await loginResponse('owner', 'test-password');
    expect(withoutCode.status).toBe(401);

    const trustedDeviceCode = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          totpCode: totpCode(setupBody.secret),
          deviceTrustSecret: fixtureDeviceTrustSecret,
          device: fixtureDevice
        })
      })
    );
    expect(trustedDeviceCode.status).toBe(200);

    const trustedDeviceWithoutSecret = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          totpCode: totpCode(setupBody.secret),
          device: fixtureDevice
        })
      })
    );
    expect(trustedDeviceWithoutSecret.status).toBe(401);

    const unknownDeviceCode = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          totpCode: totpCode(setupBody.secret),
          device: { id: 'unknown-device', name: 'Unknown device' }
        })
      })
    );
    expect(unknownDeviceCode.status).toBe(401);

    const withCode = await loginResponse(
      'owner',
      'test-password',
      totpCode(setupBody.secret)
    );
    expect(withCode.status).toBe(200);
  });

  it('does not accept legacy static tokens unless explicitly enabled', async () => {
    process.env.NOTES_AUTH_TOKEN = 'legacy-test-token';

    const disabled = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { authorization: 'Bearer legacy-test-token' }
      })
    );
    expect(disabled.status).toBe(401);

    process.env.NOTES_LEGACY_AUTH_TOKEN_ENABLED = 'true';
    const enabled = await api.fetch(
      new Request('http://localhost/api/auth/validate', {
        headers: { authorization: 'Bearer legacy-test-token' }
      })
    );
    expect(enabled.status).toBe(200);
  });

  it('does not bootstrap the development password in production', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.NOTES_LOGIN_PASSWORD;

    try {
      const login = await api.fetch(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username: 'owner',
            password: 'local-dev-password',
            device: fixtureDevice
          })
        })
      );
      expect(login.status).toBe(401);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      process.env.NOTES_LOGIN_PASSWORD = 'test-password';
    }
  });

  it('logs in, pushes a note, and pulls it back', async () => {
    const login = await loginResponse();
    expect(login.status).toBe(200);
    const token = ((await login.json()) as { token: string }).token;

    const push = await post(
      '/api/sync/push',
      {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: fixtureNote, baseVersion: 0 }]
      },
      token
    );
    expect(push.status).toBe(200);
    expect((await push.json()).accepted).toHaveLength(2);

    const pull = await post('/api/sync/pull', { since: null }, token);
    expect(pull.status).toBe(200);
    expect((await pull.json()).notes[0].body).toBe(fixtureNote.body);
  });

  it('queues authenticated local pushes to the configured remote database', async () => {
    const remotePath = join(tempDir, 'queued-push-remote.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(remote, 'owner', 'test-password');
    } finally {
      remote.close();
    }

    const token = await loginToken();
    const push = await post(
      '/api/sync/push',
      {
        device: fixtureDevice,
        notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
        notes: [{ record: fixtureNote, baseVersion: 0 }]
      },
      token
    );
    expect(push.status).toBe(200);

    const syncedRemote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      let mirroredBody: string | null = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        mirroredBody =
          (await getNote(syncedRemote, fixtureNote.id, 'owner'))?.body ?? null;
        if (mirroredBody === fixtureNote.body) break;
        await sleep(50);
      }

      expect(mirroredBody).toBe(fixtureNote.body);
    } finally {
      syncedRemote.close();
    }
  });

  it('queues configured remote database changes without blocking client pulls', async () => {
    const remotePath = join(tempDir, 'pull-before-response-remote.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const remote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await setUserPassword(remote, 'owner', 'test-password');
    } finally {
      remote.close();
    }

    const token = await loginToken();
    const changedRemote = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${remotePath}`, authToken: 'test-token' }
    });
    try {
      await pushChanges(
        changedRemote,
        {
          device: { id: 'remote-device', name: 'Remote device' },
          notebooks: [],
          notes: [
            {
              record: {
                ...fixtureNote,
                id: 'remote-after-login-note',
                title: 'Remote after login',
                body: 'Pulled before client response',
                deviceId: 'remote-device',
                updatedAt: '2026-05-06T12:00:00.000Z',
                syncStatus: 'pending' as const
              },
              baseVersion: 0
            }
          ]
        },
        'owner'
      );
    } finally {
      changedRemote.close();
    }

    const pull = await post(
      '/api/sync/pull',
      { since: null, sinceRevision: 0 },
      token
    );
    expect(pull.status).toBe(200);
    const body = (await pull.json()) as {
      notes: Array<{ id: string; body: string }>;
    };
    expect(body.notes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'remote-after-login-note' })
      ])
    );

    let mirroredNotes: Array<{ id: string; body: string }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(25);
      const retry = await post(
        '/api/sync/pull',
        { since: null, sinceRevision: 0 },
        token
      );
      const retryBody = (await retry.json()) as {
        notes: Array<{ id: string; body: string }>;
      };
      mirroredNotes = retryBody.notes;
      if (mirroredNotes.some((note) => note.id === 'remote-after-login-note')) {
        break;
      }
    }
    expect(mirroredNotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'remote-after-login-note',
          body: 'Pulled before client response'
        })
      ])
    );
  });

  it('rejects malformed authenticated push payloads with a client error', async () => {
    const token = await loginToken();
    const push = await post(
      '/api/sync/push',
      {
        device: fixtureDevice,
        notebooks: [{ record: { id: 'bad-notebook' }, baseVersion: 0 }],
        notes: []
      },
      token
    );

    expect(push.status).toBe(400);
    await expect(push.json()).resolves.toMatchObject({
      error: 'Invalid push payload'
    });
  });

  it('rejects oversized sync push batches before they hit storage', async () => {
    const token = await loginToken();
    const notes = Array.from({ length: 21 }, (_, index) => ({
      record: {
        ...fixtureNote,
        id: `bulk-note-${index}`,
        deviceId: fixtureDevice.id
      },
      baseVersion: 0
    }));

    const push = await post(
      '/api/sync/push',
      {
        device: fixtureDevice,
        notebooks: [],
        notes
      },
      token
    );

    expect(push.status).toBe(413);
    await expect(push.json()).resolves.toMatchObject({
      error: 'Too many changes in one sync push; refresh Author and try again.'
    });
  });

  it('rejects pushes that spoof a different record device id', async () => {
    const token = await loginToken();
    const push = await post(
      '/api/sync/push',
      {
        device: fixtureDevice,
        notebooks: [],
        notes: [
          {
            record: { ...fixtureNote, deviceId: 'not-the-request-device' },
            baseVersion: 0
          }
        ]
      },
      token
    );

    expect(push.status).toBe(400);
    await expect(push.json()).resolves.toMatchObject({
      error: 'Invalid push payload'
    });
  });
});
