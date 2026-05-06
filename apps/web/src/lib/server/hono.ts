import type {
  AccountUpdateRequest,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthSignupRequest,
  AuthValidateResponse,
  DeleteAccountRequest,
  HealthResponse,
  PasswordChangeRequest,
  PullRequest,
  PushRequest,
  RemoteSyncState,
  SyncStatusResponse
} from '@author/api-types';
import { API_PATHS } from '@author/api-types';
import type { Note, Notebook, SyncStatus } from '@author/schema';
import { Hono } from 'hono';
import {
  type AuthSession,
  authenticateUser,
  changeUserPassword,
  createAuthSession,
  createUserAccount,
  deleteSessionFromRequest,
  deleteUserAccount,
  normalizeUsername,
  requireAuth,
  sessionFromRequest,
  updateUserProfile,
  unauthorized
} from './auth';
import {
  getRemoteDatabaseConfig,
  shouldSyncRemoteDatabase,
  shouldTrustProxyHeaders
} from './config';
import { openConfiguredDatabase, openLocalDatabase, type NotesDb } from './db';
import {
  cleanupTrash,
  getSyncMeta,
  listNotes,
  listNotebooks,
  pullChangesSince,
  pushChanges,
  setSyncMeta,
  upsertDevice
} from './repository';
import { syncRemoteDatabase } from './remote-sync';

export const api = new Hono();

const LOGIN_ATTEMPT_WINDOW_MS = 60_000;
const MAX_FAILED_LOGIN_ATTEMPTS = 8;
const MAX_LOGIN_ATTEMPT_KEYS = 500;
const MAX_LOGIN_BODY_BYTES = 16 * 1024;
const MAX_SYNC_BODY_BYTES = 5 * 1024 * 1024;
const LOGIN_REMOTE_SYNC_GRACE_MS = 500;
const REMOTE_SYNC_RETRY_BASE_MS = 5_000;
const REMOTE_SYNC_RETRY_MAX_MS = 5 * 60_000;
const REMOTE_SYNC_PENDING_KEY = 'remote.sync.pending';
const SYNC_STATUSES = new Set<SyncStatus>([
  'synced',
  'pending',
  'conflict',
  'deleted'
]);
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
let remoteSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
let remoteSyncFailureCount = 0;
let remoteSyncQueueRunning = false;
let remoteSyncQueued = false;

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'RequestBodyTooLargeError';
  }
}

function syncOwner(session: AuthSession): string {
  return session.user.username;
}

function reportRemoteSyncError(error: unknown): void {
  if (isRemoteMirrorSyncAlreadyRunning(error)) return;
  console.warn(
    'Remote database sync failed:',
    error instanceof Error ? error.message : error
  );
}

function isRemoteMirrorSyncAlreadyRunning(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'MirrorLockUnavailable' ||
      error.message === 'Remote mirror sync is already running')
  );
}

const remoteSyncStatus: {
  state: RemoteSyncState;
  pendingSince: string | null;
  lastStartedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
} = {
  state: 'synced',
  pendingSince: null,
  lastStartedAt: null,
  lastSyncedAt: null,
  lastError: null
};

function remoteSyncSnapshot(): SyncStatusResponse['remote'] {
  const enabled = shouldSyncRemoteDatabase();
  return {
    enabled,
    state: enabled ? remoteSyncStatus.state : 'disabled',
    pendingSince: enabled ? remoteSyncStatus.pendingSince : null,
    lastStartedAt: enabled ? remoteSyncStatus.lastStartedAt : null,
    lastSyncedAt: enabled ? remoteSyncStatus.lastSyncedAt : null,
    lastError: enabled ? remoteSyncStatus.lastError : null
  };
}

function setRemoteSyncState(
  state: RemoteSyncState,
  values: Partial<typeof remoteSyncStatus> = {}
): void {
  remoteSyncStatus.state = state;
  Object.assign(remoteSyncStatus, values);
}

function clearRemoteSyncRetry(): void {
  if (!remoteSyncRetryTimer) return;
  clearTimeout(remoteSyncRetryTimer);
  remoteSyncRetryTimer = null;
}

async function setPersistentRemoteSyncPending(pending: boolean): Promise<void> {
  if (!shouldSyncRemoteDatabase()) return;
  const db = await openLocalDatabase();
  try {
    await setSyncMeta(db, REMOTE_SYNC_PENDING_KEY, pending ? '1' : '0');
  } catch (error) {
    reportRemoteSyncError(error);
  } finally {
    db.close();
  }
}

async function hasPersistentRemoteSyncPending(): Promise<boolean> {
  if (!shouldSyncRemoteDatabase()) return false;
  const db = await openLocalDatabase();
  try {
    return (await getSyncMeta(db, REMOTE_SYNC_PENDING_KEY)) === '1';
  } catch (error) {
    reportRemoteSyncError(error);
    return false;
  } finally {
    db.close();
  }
}

async function revivePersistentRemoteSyncIfPending(): Promise<void> {
  if (
    remoteSyncQueueRunning ||
    remoteSyncQueued ||
    remoteSyncRetryTimer ||
    !(await hasPersistentRemoteSyncPending())
  ) {
    return;
  }

  void queueRemoteSyncAfter();
}

async function syncRemoteBestEffort(db: NotesDb): Promise<boolean> {
  try {
    await syncRemoteDatabase(db);
    await setPersistentRemoteSyncPending(false);
    return true;
  } catch (error) {
    if (isRemoteMirrorSyncAlreadyRunning(error)) {
      await setPersistentRemoteSyncPending(true);
      setRemoteSyncState('queued', {
        pendingSince: new Date().toISOString(),
        lastError: null
      });
      scheduleRemoteSyncRetry();
      return false;
    }
    reportRemoteSyncError(error);
    await setPersistentRemoteSyncPending(true);
    return false;
  }
}

async function syncRemoteWithFreshConnection(): Promise<boolean> {
  if (!shouldSyncRemoteDatabase()) return true;

  let db: NotesDb | null = null;
  try {
    db = await openLocalDatabase();
    return await syncRemoteBestEffort(db);
  } catch (error) {
    reportRemoteSyncError(error);
    return false;
  } finally {
    db?.close();
  }
}

async function waitForRemoteSync(
  remoteSync: Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  if (!shouldSyncRemoteDatabase()) return true;

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      remoteSync,
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function queueRemoteSyncAfter(
  remoteSync?: Promise<boolean>
): Promise<void> {
  if (!shouldSyncRemoteDatabase()) return;
  await setPersistentRemoteSyncPending(true);
  clearRemoteSyncRetry();
  remoteSyncQueued = true;
  setRemoteSyncState('queued', {
    pendingSince: new Date().toISOString(),
    lastError: null
  });
  if (remoteSyncQueueRunning) return;

  remoteSyncQueueRunning = true;
  void (async () => {
    try {
      let previousOk = remoteSync ? await remoteSync : true;
      while (remoteSyncQueued) {
        remoteSyncQueued = false;
        if (!previousOk) {
          scheduleRemoteSyncRetry();
          if (
            remoteSyncStatus.state === 'queued' &&
            remoteSyncStatus.lastError === null
          ) {
            return;
          }
          setRemoteSyncState('error', {
            pendingSince: null,
            lastError: 'Remote database sync failed'
          });
          return;
        }

        const startedAt = new Date().toISOString();
        setRemoteSyncState('syncing', {
          lastStartedAt: startedAt,
          lastError: null
        });
        const ok = await syncRemoteWithFreshConnection();
        if (!ok) {
          scheduleRemoteSyncRetry();
          if (
            remoteSyncStatus.state === 'queued' &&
            remoteSyncStatus.lastError === null
          ) {
            return;
          }
          setRemoteSyncState('error', {
            pendingSince: null,
            lastError: 'Remote database sync failed'
          });
          return;
        }

        previousOk = true;
        remoteSyncFailureCount = 0;
        if (!remoteSyncQueued) {
          await setPersistentRemoteSyncPending(false);
        }
        setRemoteSyncState('synced', {
          pendingSince: null,
          lastSyncedAt: new Date().toISOString(),
          lastError: null
        });
      }
    } finally {
      remoteSyncQueueRunning = false;
      if (remoteSyncQueued) {
        void queueRemoteSyncAfter();
      }
    }
  })();
}

function scheduleRemoteSyncRetry(): void {
  if (!shouldSyncRemoteDatabase() || remoteSyncRetryTimer) return;
  remoteSyncFailureCount += 1;
  const delayMs = Math.min(
    REMOTE_SYNC_RETRY_BASE_MS * 2 ** (remoteSyncFailureCount - 1),
    REMOTE_SYNC_RETRY_MAX_MS
  );
  remoteSyncRetryTimer = setTimeout(() => {
    remoteSyncRetryTimer = null;
    void queueRemoteSyncAfter();
  }, delayMs);
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

async function readJsonBody<T>(
  request: Request,
  maxBytes: number
): Promise<T | null> {
  if (requestBodyTooLarge(request, maxBytes)) {
    throw new RequestBodyTooLargeError();
  }

  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError();
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());

  const text = chunks.join('');
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function jsonOrSizeError<T>(
  request: Request,
  maxBytes: number,
  message: string
): Promise<{ ok: true; body: T | null } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await readJsonBody<T>(request, maxBytes) };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: message }), {
          status: 413,
          headers: { 'content-type': 'application/json' }
        })
      };
    }
    throw error;
  }
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
    isNullableString(note.titleHash ?? null) &&
    isNullableString(note.bodyHash ?? null) &&
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

function recordsBelongToDevice(body: PushRequest): boolean {
  return (
    body.notes.every((change) => change.record.deviceId === body.device.id) &&
    body.notebooks.every((change) => change.record.deviceId === body.device.id)
  );
}

function pullSince(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

function pullRevision(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}

function pullLimit(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
}

api.get(API_PATHS.health, (c) =>
  c.json({
    ok: true,
    service: 'author-notes',
    time: new Date().toISOString()
  } satisfies HealthResponse)
);

api.post(API_PATHS.authLogin, async (c) => {
  const parsed = await jsonOrSizeError<AuthLoginRequest>(
    c.req.raw,
    MAX_LOGIN_BODY_BYTES,
    'Login payload too large'
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

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

  const remoteSync = syncRemoteWithFreshConnection();
  await waitForRemoteSync(remoteSync, LOGIN_REMOTE_SYNC_GRACE_MS);

  const db = await openLocalDatabase();
  try {
    const user = await authenticateUser(db, body.username, body.password);
    if (!user) {
      recordFailedLogin(attemptKey);
      return c.json({ error: 'Invalid username or password' }, 401);
    }
    clearFailedLogins(attemptKey);

    await upsertDevice(db, body.device, undefined, user.username);
    const session = await createAuthSession(db, user, body.device.id);
    await queueRemoteSyncAfter(remoteSync);
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

api.post(API_PATHS.authSignup, async (c) => {
  const parsed = await jsonOrSizeError<AuthSignupRequest>(
    c.req.raw,
    MAX_LOGIN_BODY_BYTES,
    'Signup payload too large'
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  if (
    !hasDevicePayload(body?.device) ||
    typeof body?.username !== 'string' ||
    typeof body?.password !== 'string'
  ) {
    return c.json({ error: 'Invalid signup payload' }, 400);
  }

  const remoteConfig = getRemoteDatabaseConfig();
  if (!remoteConfig) {
    return c.json({ error: 'Signup requires remote database access' }, 503);
  }

  const remote = await openConfiguredDatabase(remoteConfig);
  let user: Awaited<ReturnType<typeof createUserAccount>>;
  try {
    const createdUser = await createUserAccount(
      remote,
      body.username,
      body.password,
      body.displayName
    );
    if (!createdUser) {
      return c.json({ error: 'Username is already taken' }, 409);
    }
    user = createdUser;
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Signup failed' },
      400
    );
  } finally {
    remote.close();
  }

  const db = await openLocalDatabase();
  try {
    const synced = await syncRemoteBestEffort(db);
    if (!synced) {
      return c.json(
        { error: 'Account created, but local offline setup failed' },
        503
      );
    }

    await upsertDevice(db, body.device, undefined, user.username);
    const session = await createAuthSession(db, user, body.device.id);
    await queueRemoteSyncAfter();
    return c.json({
      token: session.token,
      user,
      device: body.device,
      expiresAt: session.expiresAt
    } satisfies AuthLoginResponse);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Signup failed' },
      400
    );
  } finally {
    db.close();
  }
});

api.get(API_PATHS.authValidate, async (c) => {
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

api.post(API_PATHS.authLogout, async (c) => {
  const db = await openLocalDatabase();
  try {
    const authError = await requireAuth(db, c.req.raw);
    if (authError) return authError;
    await deleteSessionFromRequest(db, c.req.raw);
    return c.json({ ok: true });
  } finally {
    db.close();
  }
});

api.get(API_PATHS.account, async (c) => {
  const db = await openLocalDatabase();
  try {
    const session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    return c.json({ user: session.user });
  } finally {
    db.close();
  }
});

api.patch(API_PATHS.account, async (c) => {
  const db = await openLocalDatabase();
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot be edited' }, 400);
    }
    const parsed = await jsonOrSizeError<AccountUpdateRequest>(
      c.req.raw,
      MAX_LOGIN_BODY_BYTES,
      'Account payload too large'
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.body ?? {};
    const remoteConfig = getRemoteDatabaseConfig();
    if (!remoteConfig) {
      return c.json({ error: 'Account updates require remote access' }, 503);
    }
    if (!(await syncRemoteBestEffort(db))) {
      return c.json({ error: 'Could not sync before profile update' }, 503);
    }
    session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot be edited' }, 400);
    }

    const remote = await openConfiguredDatabase(remoteConfig);
    let user: Awaited<ReturnType<typeof updateUserProfile>>;
    try {
      user = await updateUserProfile(
        remote,
        session.user.username,
        body.displayName
      );
    } finally {
      remote.close();
    }

    if (!(await syncRemoteBestEffort(db))) {
      return c.json(
        { error: 'Profile saved remotely, but local offline setup failed' },
        503
      );
    }

    await queueRemoteSyncAfter();
    return c.json({
      user
    });
  } finally {
    db.close();
  }
});

api.post(API_PATHS.accountPassword, async (c) => {
  const db = await openLocalDatabase();
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot be edited' }, 400);
    }
    const parsed = await jsonOrSizeError<PasswordChangeRequest>(
      c.req.raw,
      MAX_LOGIN_BODY_BYTES,
      'Password payload too large'
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (
      typeof body?.currentPassword !== 'string' ||
      typeof body?.newPassword !== 'string'
    ) {
      return c.json({ error: 'Invalid password payload' }, 400);
    }

    const remoteConfig = getRemoteDatabaseConfig();
    if (!remoteConfig) {
      return c.json({ error: 'Password changes require remote access' }, 503);
    }
    if (!(await syncRemoteBestEffort(db))) {
      return c.json({ error: 'Could not sync before password change' }, 503);
    }
    session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot be edited' }, 400);
    }

    const remote = await openConfiguredDatabase(remoteConfig);
    let user: Awaited<ReturnType<typeof changeUserPassword>>;
    try {
      user = await changeUserPassword(
        remote,
        session.user.username,
        body.currentPassword,
        body.newPassword
      );
    } finally {
      remote.close();
    }
    if (!user) return c.json({ error: 'Current password is incorrect' }, 401);

    if (!(await syncRemoteBestEffort(db))) {
      return c.json(
        { error: 'Password changed remotely, but local offline setup failed' },
        503
      );
    }

    await queueRemoteSyncAfter();
    return c.json({ user });
  } finally {
    db.close();
  }
});

api.delete(API_PATHS.account, async (c) => {
  const db = await openLocalDatabase();
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot be deleted' }, 400);
    }
    const parsed = await jsonOrSizeError<DeleteAccountRequest>(
      c.req.raw,
      MAX_LOGIN_BODY_BYTES,
      'Delete payload too large'
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (typeof body?.password !== 'string') {
      return c.json({ error: 'Invalid delete payload' }, 400);
    }

    const remoteConfig = getRemoteDatabaseConfig();
    if (!remoteConfig) {
      return c.json({ error: 'Account deletion requires remote access' }, 503);
    }
    if (!(await syncRemoteBestEffort(db))) {
      return c.json({ error: 'Could not sync before account deletion' }, 503);
    }
    session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot be deleted' }, 400);
    }

    const remote = await openConfiguredDatabase(remoteConfig);
    let deleted = false;
    try {
      deleted = await deleteUserAccount(
        remote,
        session.user.username,
        body.password
      );
    } finally {
      remote.close();
    }
    if (!deleted) return c.json({ error: 'Password is incorrect' }, 401);

    if (!(await syncRemoteBestEffort(db))) {
      return c.json(
        { error: 'Account deleted remotely, but local cleanup failed' },
        503
      );
    }

    return c.json({ ok: true });
  } finally {
    db.close();
  }
});

api.get(API_PATHS.notes, async (c) => {
  const db = await openLocalDatabase();
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    if (!(await syncRemoteBestEffort(db))) {
      await queueRemoteSyncAfter();
    } else {
      session = await sessionFromRequest(db, c.req.raw);
      if (!session) return unauthorized();
    }
    return c.json({ notes: await listNotes(db, syncOwner(session)) });
  } finally {
    db.close();
  }
});

api.get(API_PATHS.notebooks, async (c) => {
  const db = await openLocalDatabase();
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    if (!(await syncRemoteBestEffort(db))) {
      await queueRemoteSyncAfter();
    } else {
      session = await sessionFromRequest(db, c.req.raw);
      if (!session) return unauthorized();
    }
    return c.json({ notebooks: await listNotebooks(db, syncOwner(session)) });
  } finally {
    db.close();
  }
});

api.get(API_PATHS.syncStatus, async (c) => {
  const db = await openLocalDatabase();
  try {
    const authError = await requireAuth(db, c.req.raw);
    if (authError) return authError;

    await revivePersistentRemoteSyncIfPending();
    return c.json({
      remote: remoteSyncSnapshot()
    } satisfies SyncStatusResponse);
  } finally {
    db.close();
  }
});

api.post(API_PATHS.syncPull, async (c) => {
  const db = await openLocalDatabase();
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    const parsed = await jsonOrSizeError<PullRequest>(
      c.req.raw,
      MAX_LOGIN_BODY_BYTES,
      'Pull payload too large'
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.body ?? {};

    if (!(await syncRemoteBestEffort(db))) {
      await queueRemoteSyncAfter();
    } else {
      session = await sessionFromRequest(db, c.req.raw);
      if (!session) return unauthorized();
    }
    return c.json(
      await pullChangesSince(
        db,
        pullSince(body.since),
        pullRevision(body.sinceRevision),
        { ownerUsername: syncOwner(session), limit: pullLimit(body.limit) }
      )
    );
  } finally {
    db.close();
  }
});

api.post(API_PATHS.syncPush, async (c) => {
  const db = await openLocalDatabase();
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    const parsed = await jsonOrSizeError<PushRequest>(
      c.req.raw,
      MAX_SYNC_BODY_BYTES,
      'Push payload too large'
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (
      !body ||
      !hasDevicePayload(body.device) ||
      !hasEntityChanges(body.notes, hasNoteRecord) ||
      !hasEntityChanges(body.notebooks, hasNotebookRecord) ||
      !recordsBelongToDevice(body)
    ) {
      return c.json({ error: 'Invalid push payload' }, 400);
    }

    if (!(await syncRemoteBestEffort(db))) {
      await queueRemoteSyncAfter();
    } else {
      session = await sessionFromRequest(db, c.req.raw);
      if (!session) return unauthorized();
    }
    const response = await pushChanges(db, body, syncOwner(session));
    await queueRemoteSyncAfter();
    return c.json(response);
  } finally {
    db.close();
  }
});

api.post(API_PATHS.cleanupTrash, async (c) => {
  const db = await openLocalDatabase();
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    if (!(await syncRemoteBestEffort(db))) {
      await queueRemoteSyncAfter();
    } else {
      session = await sessionFromRequest(db, c.req.raw);
      if (!session) return unauthorized();
    }
    const response = await cleanupTrash(db, new Date(), syncOwner(session));
    if (!(await syncRemoteBestEffort(db))) {
      await queueRemoteSyncAfter();
    }
    return c.json(response);
  } finally {
    db.close();
  }
});
