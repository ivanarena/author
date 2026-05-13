import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pbkdf2Sync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fixtureDevice,
  fixtureNote,
  fixtureNotebook
} from '@author/test-fixtures';
import { setUserPassword } from './auth';
import { openConfiguredDatabase, openDatabase } from './db';
import { api } from './hono';
import { getNote, pushChanges, setSyncMeta } from './repository';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'author-api-'));
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.AUTHOR_API_URL;
  delete process.env.AUTHOR_SYNC_API_URL;
  delete process.env.ANDROID_SYNC_API_URL;
  delete process.env.ANDROID_SYNC_SERVER_URL;
  delete process.env.NOTES_SYNC_SERVER_URL;
  delete process.env.NOTES_SIGNUP_INVITE_CODES;
  process.env.NOTES_DB_PATH = join(tempDir, 'notes.sqlite');
  process.env.NOTES_REMOTE_SYNC_ENABLED = 'false';
  process.env.NOTES_LOGIN_USERNAME = 'owner';
  process.env.NOTES_LOGIN_PASSWORD = 'test-password';
});

afterEach(() => {
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
  delete process.env.NOTES_SIGNUP_INVITE_CODES;
  delete process.env.NOTES_LOGIN_USERNAME;
  delete process.env.NOTES_LOGIN_PASSWORD;
  delete process.env.NOTES_AUTH_TOKEN;
  delete process.env.NOTES_LEGACY_AUTH_TOKEN_ENABLED;
});

async function loginToken(
  username = 'owner',
  password = 'test-password'
): Promise<string> {
  const login = await api.fetch(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, device: fixtureDevice })
    })
  );
  expect(login.status).toBe(200);
  return ((await login.json()) as { token: string }).token;
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

describe('Hono API', () => {
  it('serves health and rejects unauthorized sync requests', async () => {
    const health = await api.fetch(new Request('http://localhost/api/health'));
    expect(health.status).toBe(200);
    expect((await health.json()).service).toBe('author');

    const metrics = await api.fetch(
      new Request('http://localhost/api/metrics')
    );
    expect(metrics.status).toBe(200);
    await expect(metrics.text()).resolves.toContain('author_up 1');

    const token = await loginToken();
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
        inviteRequired: true
      }
    });
    expect(JSON.stringify(body)).not.toContain('super-secret-token');
    expect(JSON.stringify(body)).not.toContain('libsql://');
    expect(JSON.stringify(body)).not.toContain('author.example.turso.io');
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

    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'new-user',
          password: 'new-user-password',
          displayName: 'New User',
          inviteCode: 'authorprivatefriendsonly',
          device: fixtureDevice
        })
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
        sql: 'SELECT username, display_name FROM users WHERE username = ?',
        args: ['new-user']
      });
      expect(user.rows[0]).toMatchObject({
        username: 'new-user',
        display_name: 'New User'
      });
      const invite = await remote.execute({
        sql: 'SELECT code, disabled_at FROM invitation_codes WHERE code = ?',
        args: ['authorprivatefriendsonly']
      });
      expect(invite.rows[0]).toMatchObject({
        code: 'authorprivatefriendsonly',
        disabled_at: null
      });
    } finally {
      remote.close();
    }

    const local = await openDatabase();
    try {
      const invite = await local.execute({
        sql: 'SELECT code, disabled_at FROM invitation_codes WHERE code = ?',
        args: ['authorprivatefriendsonly']
      });
      expect(invite.rows[0]).toMatchObject({
        code: 'authorprivatefriendsonly',
        disabled_at: null
      });
    } finally {
      local.close();
    }

    const duplicate = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'new-user',
          password: 'new-user-password',
          inviteCode: 'authorprivatefriendsonly',
          device: fixtureDevice
        })
      })
    );
    expect(duplicate.status).toBe(409);
  });

  it('uses Turso as the primary database when running with Worker env', async () => {
    const primaryPath = join(tempDir, 'worker-primary.sqlite');
    const workerEnv = {
      NOTES_DB_PROVIDER: 'turso',
      TURSO_DATABASE_URL: `file:${primaryPath}`,
      TURSO_AUTH_TOKEN: 'test-token',
      NOTES_REMOTE_SYNC_ENABLED: 'false',
      NOTES_LOGIN_USERNAME: 'owner',
      NOTES_LOGIN_PASSWORD: 'test-password'
    };

    const config = await api.fetch(
      new Request('http://localhost/api/config'),
      workerEnv
    );
    expect(config.status).toBe(200);
    await expect(config.json()).resolves.toMatchObject({
      remote: { enabled: false, configured: false },
      signup: { enabled: true, inviteRequired: true }
    });

    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'worker-user',
          password: 'worker-user-password',
          displayName: 'Worker User',
          inviteCode: 'authorprivatefriendsonly',
          device: fixtureDevice
        })
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
        sql: 'SELECT username, display_name, password_iterations FROM users WHERE username = ?',
        args: ['worker-user']
      });
      expect(user.rows[0]).toMatchObject({
        username: 'worker-user',
        display_name: 'Worker User',
        password_iterations: 100_000
      });
    } finally {
      primary.close();
    }
  });

  it('rehashes an older bootstrap password row to the Worker PBKDF2 ceiling', async () => {
    const primaryPath = join(tempDir, 'worker-old-password.sqlite');
    const workerEnv = {
      NOTES_DB_PROVIDER: 'turso',
      TURSO_DATABASE_URL: `file:${primaryPath}`,
      TURSO_AUTH_TOKEN: 'test-token',
      NOTES_REMOTE_SYNC_ENABLED: 'false',
      NOTES_LOGIN_USERNAME: 'owner',
      NOTES_LOGIN_PASSWORD: 'test-password'
    };
    const oldSalt = 'old-worker-password-salt';
    const oldIterations = 210_000;
    const oldHash = pbkdf2Sync(
      'test-password',
      oldSalt,
      oldIterations,
      32,
      'sha256'
    ).toString('base64url');

    const primary = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${primaryPath}`, authToken: 'test-token' }
    });
    try {
      const now = new Date().toISOString();
      await primary.execute({
        sql: `INSERT INTO users (
          username, display_name, password_hash, password_salt, password_iterations, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: ['owner', 'Owner', oldHash, oldSalt, oldIterations, now, now]
      });
    } finally {
      primary.close();
    }

    const originalDeriveBits = crypto.subtle.deriveBits.bind(
      crypto.subtle
    ) as SubtleCrypto['deriveBits'];
    const deriveBitsSpy = vi
      .spyOn(crypto.subtle, 'deriveBits')
      .mockImplementation(
        async (...args: Parameters<SubtleCrypto['deriveBits']>) => {
          const [algorithm] = args;
          if (
            typeof algorithm !== 'string' &&
            algorithm.name === 'PBKDF2' &&
            'iterations' in algorithm &&
            Number(algorithm.iterations) > 100_000
          ) {
            throw new DOMException(
              'Pbkdf2 failed: iteration counts above 100000 are not supported (requested 210000).',
              'NotSupportedError'
            );
          }
          return await originalDeriveBits(...args);
        }
      );
    try {
      const login = await api.fetch(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username: 'owner',
            password: 'test-password',
            device: fixtureDevice
          })
        }),
        workerEnv
      );
      expect(login.status).toBe(200);
    } finally {
      deriveBitsSpy.mockRestore();
    }

    const updated = await openConfiguredDatabase({
      provider: 'turso',
      client: { url: `file:${primaryPath}`, authToken: 'test-token' }
    });
    try {
      const user = await updated.execute({
        sql: 'SELECT password_iterations FROM users WHERE username = ?',
        args: ['owner']
      });
      expect(user.rows[0]).toMatchObject({
        password_iterations: 100_000
      });
    } finally {
      updated.close();
    }
  });

  it('requires the seeded invite code by default when Turso is configured', async () => {
    const remotePath = join(tempDir, 'remote-seeded-invite-signup.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';

    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'disabled-user',
          password: 'new-user-password',
          device: fixtureDevice
        })
      })
    );

    expect(signup.status).toBe(403);
    await expect(signup.json()).resolves.toMatchObject({
      error: 'Invalid signup invite code'
    });
  });

  it('requires a valid invite code when invite-only signup is configured', async () => {
    const remotePath = join(tempDir, 'remote-invite-signup.sqlite');
    process.env.TURSO_DATABASE_URL = `file:${remotePath}`;
    process.env.TURSO_AUTH_TOKEN = 'test-token';
    process.env.NOTES_REMOTE_SYNC_ENABLED = 'true';
    process.env.NOTES_SIGNUP_INVITE_CODES = 'alpha,beta';

    const missingInvite = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'invite-user',
          password: 'new-user-password',
          device: fixtureDevice
        })
      })
    );
    expect(missingInvite.status).toBe(403);

    const invited = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'invite-user',
          password: 'new-user-password',
          inviteCode: 'alpha',
          device: fixtureDevice
        })
      })
    );
    expect(invited.status).toBe(200);
    await expect(invited.json()).resolves.toMatchObject({
      user: { username: 'invite-user' }
    });
  });

  it('requires remote database access for signup', async () => {
    const signup = await api.fetch(
      new Request('http://localhost/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'remote-required-user',
          password: 'new-user-password',
          inviteCode: 'authorprivatefriendsonly',
          device: fixtureDevice
        })
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

    const oldLocalPassword = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          password: 'old-local-password',
          device: fixtureDevice
        })
      })
    );
    expect(oldLocalPassword.status).toBe(401);

    const remotePassword = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          password: 'remote-password',
          device: fixtureDevice
        })
      })
    );
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

    const response = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          password: 'remote-password',
          device: fixtureDevice
        })
      })
    );
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
  }, 10_000);

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

    const oldPassword = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          password: 'test-password',
          device: fixtureDevice
        })
      })
    );
    expect(oldPassword.status).toBe(401);

    await expect(loginToken('owner', 'new-test-password')).resolves.toEqual(
      expect.any(String)
    );
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
    const password = await post(
      '/api/account/password',
      {
        currentPassword: 'test-password',
        newPassword: 'new-test-password'
      },
      token
    );
    expect(password.status).toBe(200);
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
        body: JSON.stringify({ password: 'new-test-password' })
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

    const missing = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          password: 'new-test-password',
          device: fixtureDevice
        })
      })
    );
    expect(missing.status).toBe(401);
  }, 10_000);

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
    const login = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'owner',
          password: 'test-password',
          device: fixtureDevice
        })
      })
    );
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

  it('pulls configured remote database changes before responding to client pulls', async () => {
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
    expect(body.notes).toEqual(
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
