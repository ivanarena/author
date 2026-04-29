import type {
  AuthLoginRequest,
  AuthLoginResponse,
  HealthResponse,
  PullRequest,
  PushRequest
} from '@author/api-types';
import { Hono } from 'hono';
import { isAuthorized } from './auth';
import { getAuthToken, getLoginPassword } from './config';
import { openDatabase } from './db';
import {
  cleanupTrash,
  listNotes,
  listNotebooks,
  pullChangesSince,
  pushChanges,
  upsertDevice
} from './repository';

export const api = new Hono();

function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'content-type': 'application/json'
    }
  });
}

function requireAuth(request: Request): Response | null {
  return isAuthorized(request) ? null : unauthorized();
}

api.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'author-notes',
    time: new Date().toISOString()
  } satisfies HealthResponse)
);

api.post('/api/auth/login', async (c) => {
  const body = (await c.req.json().catch(() => null)) as AuthLoginRequest | null;

  if (!body?.device?.id || body.password !== getLoginPassword()) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  const db = await openDatabase();
  try {
    await upsertDevice(db, body.device);
  } finally {
    db.close();
  }

  return c.json({
    token: getAuthToken(),
    device: body.device
  } satisfies AuthLoginResponse);
});

api.get('/api/auth/validate', (c) => {
  const authError = requireAuth(c.req.raw);
  if (authError) return authError;
  return c.json({ ok: true });
});

api.get('/api/notes', async (c) => {
  const authError = requireAuth(c.req.raw);
  if (authError) return authError;

  const db = await openDatabase();
  try {
    return c.json({ notes: await listNotes(db) });
  } finally {
    db.close();
  }
});

api.get('/api/notebooks', async (c) => {
  const authError = requireAuth(c.req.raw);
  if (authError) return authError;

  const db = await openDatabase();
  try {
    return c.json({ notebooks: await listNotebooks(db) });
  } finally {
    db.close();
  }
});

api.post('/api/sync/pull', async (c) => {
  const authError = requireAuth(c.req.raw);
  if (authError) return authError;

  const body = (await c.req.json().catch(() => ({}))) as PullRequest;
  const db = await openDatabase();
  try {
    return c.json(await pullChangesSince(db, body.since));
  } finally {
    db.close();
  }
});

api.post('/api/sync/push', async (c) => {
  const authError = requireAuth(c.req.raw);
  if (authError) return authError;

  const body = (await c.req.json().catch(() => null)) as PushRequest | null;
  if (!body?.device?.id || !Array.isArray(body.notes) || !Array.isArray(body.notebooks)) {
    return c.json({ error: 'Invalid push payload' }, 400);
  }

  const db = await openDatabase();
  try {
    return c.json(await pushChanges(db, body));
  } finally {
    db.close();
  }
});

api.post('/api/cleanup-trash', async (c) => {
  const authError = requireAuth(c.req.raw);
  if (authError) return authError;

  const db = await openDatabase();
  try {
    return c.json(await cleanupTrash(db));
  } finally {
    db.close();
  }
});
