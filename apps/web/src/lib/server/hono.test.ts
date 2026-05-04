import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fixtureDevice,
  fixtureNote,
  fixtureNotebook
} from '@author/test-fixtures';
import { setUserPassword } from './auth';
import { openDatabase } from './db';
import { api } from './hono';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'author-notes-api-'));
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
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
  delete process.env.NOTES_REMOTE_SYNC_ENABLED;
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

describe('Hono API', () => {
  it('serves health and rejects unauthorized sync requests', async () => {
    const health = await api.fetch(new Request('http://localhost/api/health'));
    expect(health.status).toBe(200);
    expect((await health.json()).service).toBe('author-notes');

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
});
