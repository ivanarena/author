import type {
  AuthLoginRequest,
  AuthLoginResponse,
  AuthValidateResponse,
  HealthResponse,
  PullRequest,
  PushRequest
} from '@author/api-types';
import type { Note, Notebook, SyncStatus } from '@author/schema';
import { Hono } from 'hono';
import {
  authenticateUser,
  createAuthSession,
  normalizeUsername,
  requireAuth,
  sessionFromRequest,
  unauthorized
} from './auth';
import { shouldTrustProxyHeaders } from './config';
import { openLocalDatabase, type NotesDb } from './db';
import {
  cleanupTrash,
  listNotes,
  listNotebooks,
  pullChangesSince,
  pushChanges,
  upsertDevice
} from './repository';
import { syncRemoteDatabase } from './remote-sync';

export const api = new Hono();

const LOGIN_ATTEMPT_WINDOW_MS = 60_000;
const MAX_FAILED_LOGIN_ATTEMPTS = 8;
const MAX_LOGIN_ATTEMPT_KEYS = 500;
const MAX_LOGIN_BODY_BYTES = 16 * 1024;
const MAX_SYNC_BODY_BYTES = 5 * 1024 * 1024;
const SYNC_STATUSES = new Set<SyncStatus>([
  'synced',
  'pending',
  'conflict',
  'deleted'
]);
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

async function syncRemoteBestEffort(db: NotesDb): Promise<void> {
  try {
    await syncRemoteDatabase(db);
  } catch (error) {
    console.warn(
      'Remote database sync failed:',
      error instanceof Error ? error.message : error
    );
  }
}

function loginAttemptKey(
  request: Request,
  username: string | null | undefined
): string {
  const forwardedFor = shouldTrustProxyHeaders()
    ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    : null;
  const realIp = shouldTrustProxyHeaders()
    ? request.headers.get('x-real-ip')?.trim()
    : null;
  const ip = forwardedFor || realIp || 'local';
  return `${ip}:${normalizeUsername(username) ?? 'unknown'}`;
}

function pruneLoginAttempts(now = Date.now()): void {
  for (const [key, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(key);
  }

  while (loginAttempts.size > MAX_LOGIN_ATTEMPT_KEYS) {
    const oldestKey = loginAttempts.keys().next().value as string | undefined;
    if (!oldestKey) return;
    loginAttempts.delete(oldestKey);
  }
}

function isLoginRateLimited(key: string, now = Date.now()): boolean {
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.delete(key);
    return false;
  }
  return attempt.count >= MAX_FAILED_LOGIN_ATTEMPTS;
}

function recordFailedLogin(key: string, now = Date.now()): void {
  pruneLoginAttempts(now);
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, {
      count: 1,
      resetAt: now + LOGIN_ATTEMPT_WINDOW_MS
    });
    return;
  }

  attempt.count += 1;
}

function clearFailedLogins(key: string): void {
  loginAttempts.delete(key);
}

function hasDevicePayload(
  device: unknown
): device is AuthLoginRequest['device'] {
  if (!device || typeof device !== 'object') return false;
  const candidate = device as { id?: unknown; name?: unknown };
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0
  );
}

function requestBodyTooLarge(request: Request, maxBytes: number): boolean {
  const contentLength = request.headers.get('content-length');
  if (!contentLength) return false;
  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes > maxBytes;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableIsoDate(value: unknown): value is string | null {
  if (value === null) return true;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function hasNoteRecord(record: unknown): record is Note {
  if (!record || typeof record !== 'object') return false;
  const note = record as Partial<Note>;
  return (
    nonEmptyString(note.id) &&
    typeof note.title === 'string' &&
    typeof note.body === 'string' &&
    isStringArray(note.notebookIds) &&
    isNullableString(note.notebookId) &&
    isIsoDate(note.createdAt) &&
    isIsoDate(note.updatedAt) &&
    isNullableIsoDate(note.deletedAt) &&
    isNullableIsoDate(note.trashedAt) &&
    nonEmptyString(note.deviceId) &&
    isPositiveInteger(note.version) &&
    Boolean(note.syncStatus && SYNC_STATUSES.has(note.syncStatus))
  );
}

function hasNotebookRecord(record: unknown): record is Notebook {
  if (!record || typeof record !== 'object') return false;
  const notebook = record as Partial<Notebook>;
  return (
    nonEmptyString(notebook.id) &&
    typeof notebook.name === 'string' &&
    isIsoDate(notebook.createdAt) &&
    isIsoDate(notebook.updatedAt) &&
    isNullableIsoDate(notebook.deletedAt) &&
    nonEmptyString(notebook.deviceId) &&
    isPositiveInteger(notebook.version) &&
    Boolean(notebook.syncStatus && SYNC_STATUSES.has(notebook.syncStatus))
  );
}

function hasEntityChanges<T>(
  value: unknown,
  hasRecord: (record: unknown) => record is T
): value is Array<{ record: T; baseVersion: number }> {
  return (
    Array.isArray(value) &&
    value.every((change) => {
      if (!change || typeof change !== 'object') return false;
      const candidate = change as { baseVersion?: unknown; record?: unknown };
      return (
        isNonNegativeInteger(candidate.baseVersion) &&
        hasRecord(candidate.record)
      );
    })
  );
}

function pullSince(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

api.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'author-notes',
    time: new Date().toISOString()
  } satisfies HealthResponse)
);

api.post('/api/auth/login', async (c) => {
  if (requestBodyTooLarge(c.req.raw, MAX_LOGIN_BODY_BYTES)) {
    return c.json({ error: 'Login payload too large' }, 413);
  }

  const body = (await c.req
    .json()
    .catch(() => null)) as AuthLoginRequest | null;

  if (!hasDevicePayload(body?.device) || typeof body?.password !== 'string') {
    return c.json({ error: 'Invalid login payload' }, 400);
  }

  const attemptKey = loginAttemptKey(c.req.raw, body.username);
  if (isLoginRateLimited(attemptKey)) {
    return c.json(
      { error: 'Too many login attempts. Try again shortly.' },
      429
    );
  }

  const db = await openLocalDatabase();
  try {
    await syncRemoteBestEffort(db);
    const user = await authenticateUser(db, body.username, body.password);
    if (!user) {
      recordFailedLogin(attemptKey);
      return c.json({ error: 'Invalid username or password' }, 401);
    }
    clearFailedLogins(attemptKey);

    await upsertDevice(db, body.device);
    const session = await createAuthSession(db, user, body.device.id);
    await syncRemoteBestEffort(db);
    return c.json({
      token: session.token,
      user,
      device: body.device,
      expiresAt: session.expiresAt
    } satisfies AuthLoginResponse);
  } finally {
    db.close();
  }
});

api.get('/api/auth/validate', async (c) => {
  const db = await openLocalDatabase();
  try {
    const session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    return c.json({
      ok: true,
      time: new Date().toISOString(),
      user: session.user,
      expiresAt: session.expiresAt
    } satisfies AuthValidateResponse);
  } finally {
    db.close();
  }
});

api.get('/api/notes', async (c) => {
  const db = await openLocalDatabase();
  try {
    const authError = await requireAuth(db, c.req.raw);
    if (authError) return authError;

    await syncRemoteBestEffort(db);
    return c.json({ notes: await listNotes(db) });
  } finally {
    db.close();
  }
});

api.get('/api/notebooks', async (c) => {
  const db = await openLocalDatabase();
  try {
    const authError = await requireAuth(db, c.req.raw);
    if (authError) return authError;

    await syncRemoteBestEffort(db);
    return c.json({ notebooks: await listNotebooks(db) });
  } finally {
    db.close();
  }
});

api.post('/api/sync/pull', async (c) => {
  if (requestBodyTooLarge(c.req.raw, MAX_LOGIN_BODY_BYTES)) {
    return c.json({ error: 'Pull payload too large' }, 413);
  }

  const db = await openLocalDatabase();
  try {
    const authError = await requireAuth(db, c.req.raw);
    if (authError) return authError;

    await syncRemoteBestEffort(db);
    const body = (await c.req.json().catch(() => ({}))) as PullRequest;
    return c.json(await pullChangesSince(db, pullSince(body.since)));
  } finally {
    db.close();
  }
});

api.post('/api/sync/push', async (c) => {
  if (requestBodyTooLarge(c.req.raw, MAX_SYNC_BODY_BYTES)) {
    return c.json({ error: 'Push payload too large' }, 413);
  }

  const db = await openLocalDatabase();
  try {
    const authError = await requireAuth(db, c.req.raw);
    if (authError) return authError;

    await syncRemoteBestEffort(db);
    const body = (await c.req.json().catch(() => null)) as PushRequest | null;
    if (
      !hasDevicePayload(body?.device) ||
      !hasEntityChanges(body?.notes, hasNoteRecord) ||
      !hasEntityChanges(body?.notebooks, hasNotebookRecord)
    ) {
      return c.json({ error: 'Invalid push payload' }, 400);
    }

    const response = await pushChanges(db, body);
    await syncRemoteBestEffort(db);
    return c.json(response);
  } finally {
    db.close();
  }
});

api.post('/api/cleanup-trash', async (c) => {
  const db = await openLocalDatabase();
  try {
    const authError = await requireAuth(db, c.req.raw);
    if (authError) return authError;

    await syncRemoteBestEffort(db);
    const response = await cleanupTrash(db);
    await syncRemoteBestEffort(db);
    return c.json(response);
  } finally {
    db.close();
  }
});
