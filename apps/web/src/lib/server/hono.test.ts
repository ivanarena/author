import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureDevice, fixtureNote, fixtureNotebook } from '@author/test-fixtures';
import { api } from './hono';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'author-notes-api-'));
  process.env.NOTES_DB_PROVIDER = 'local';
  process.env.NOTES_DB_PATH = join(tempDir, 'notes.sqlite');
  process.env.NOTES_AUTH_TOKEN = 'test-token';
  process.env.NOTES_LOGIN_PASSWORD = 'test-password';
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.NOTES_DB_PROVIDER;
  delete process.env.NOTES_DB_PATH;
  delete process.env.NOTES_AUTH_TOKEN;
  delete process.env.NOTES_LOGIN_PASSWORD;
});

async function post(path: string, body: unknown, token = 'test-token'): Promise<Response> {
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

    const pull = await post('/api/sync/pull', { since: null }, 'bad-token');
    expect(pull.status).toBe(401);
  });

  it('logs in, pushes a note, and pulls it back', async () => {
    const login = await api.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'test-password', device: fixtureDevice })
      })
    );
    expect(login.status).toBe(200);

    const push = await post('/api/sync/push', {
      device: fixtureDevice,
      notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
      notes: [{ record: fixtureNote, baseVersion: 0 }]
    });
    expect(push.status).toBe(200);
    expect((await push.json()).accepted).toHaveLength(2);

    const pull = await post('/api/sync/pull', { since: null });
    expect(pull.status).toBe(200);
    expect((await pull.json()).notes[0].body).toBe(fixtureNote.body);
  });
});
