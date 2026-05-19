import type {
  AccountResponse,
  AccountUpdateRequest,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthSignupRequest,
  AuthValidateResponse,
  ConfigResponse,
  DeleteAccountRequest,
  HealthResponse,
  PasswordChangeRequest,
  PullRequest,
  PushRequest,
  RemoteSyncState,
  SyncStatusResponse,
  TotpDisableRequest,
  TotpEnableRequest,
  TotpSetupResponse
} from '@author/api-types';
import { API_PATHS } from '@author/api-types';
import type { Note, Notebook, SyncStatus } from '@author/schema';
import { Hono, type Context } from 'hono';
import {
  type AuthSession,
  authenticateTrustedDevice,
  authenticateUser,
  changeUserPassword,
  createAuthSession,
  createUserAccount,
  disableUserTotp,
  enableUserTotp,
  generateTotpSecret,
  deleteSessionFromRequest,
  deleteUserAccount,
  hasSignupAllowedEmails,
  isSignupEmailAllowed,
  listTrustedAuthDevices,
  mirrorUserForLocalSession,
  normalizeUsername,
  requireAuth,
  revokeTrustedAuthDevice,
  sessionFromRequest,
  trustAuthDevice,
  totpOtpauthUrl,
  updateUserProfile,
  unauthorized
} from './auth';
import {
  getPublicApiBaseUrl,
  getRemoteDatabaseConfig,
  setRuntimeEnv,
  shouldSyncRemoteDatabase,
  shouldTrustProxyHeaders,
  type RuntimeEnv
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

type ApiBindings = RuntimeEnv;

type ApiContext = Context<{ Bindings: ApiBindings }>;

export const api = new Hono<{ Bindings: ApiBindings }>();

api.use('*', async (c, next) => {
  setRuntimeEnv(c.env);
  await next();
});

const LOGIN_ATTEMPT_WINDOW_MS = 60_000;
const MAX_FAILED_LOGIN_ATTEMPTS = 8;
const MAX_SIGNUP_ATTEMPTS = 4;
const MAX_LOGIN_ATTEMPT_KEYS = 500;
const MAX_LOGIN_BODY_BYTES = 16 * 1024;
const MAX_SYNC_BODY_BYTES = 5 * 1024 * 1024;
const MAX_SYNC_CHANGES_PER_PUSH = 20;
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
const serverStartedAt = Date.now();

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'RequestBodyTooLargeError';
  }
}

function syncOwner(session: AuthSession): string {
  return session.user.username;
}

function isTursoPrimary(c: ApiContext): boolean {
  return c.env?.NOTES_DB_PROVIDER === 'turso';
}

function remoteMirrorConfig(
  c: ApiContext
): ReturnType<typeof getRemoteDatabaseConfig> {
  if (isTursoPrimary(c)) return null;
  return shouldSyncRemoteDatabase(c.env)
    ? getRemoteDatabaseConfig(c.env)
    : null;
}

async function openPrimaryDatabase(c: ApiContext): Promise<NotesDb> {
  if (!isTursoPrimary(c)) return await openLocalDatabase();

  const config = getRemoteDatabaseConfig(c.env);
  if (!config) {
    throw new Error('Turso primary database is not configured');
  }
  return await openConfiguredDatabase(config);
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

function remoteSyncSnapshot(c?: ApiContext): SyncStatusResponse['remote'] {
  const enabled = c
    ? !isTursoPrimary(c) && shouldSyncRemoteDatabase(c.env)
    : shouldSyncRemoteDatabase();
  return {
    enabled,
    state: enabled ? remoteSyncStatus.state : 'disabled',
    pendingSince: enabled ? remoteSyncStatus.pendingSince : null,
    lastStartedAt: enabled ? remoteSyncStatus.lastStartedAt : null,
    lastSyncedAt: enabled ? remoteSyncStatus.lastSyncedAt : null,
    lastError: enabled ? remoteSyncStatus.lastError : null
  };
}

function requestOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  if (!shouldTrustProxyHeaders()) return requestUrl.origin;

  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  const forwardedHost =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    request.headers.get('host')?.trim();
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return requestUrl.origin;
}

function publicApiBaseUrl(request: Request, c?: ApiContext): string {
  return getPublicApiBaseUrl(c?.env) ?? requestOrigin(request);
}

async function accountResponse(
  db: NotesDb,
  session: AuthSession,
  user: AuthSession['user'] = session.user
): Promise<AccountResponse> {
  return {
    user,
    trustedDevices: session.legacy
      ? []
      : await listTrustedAuthDevices(db, user.username, session.deviceId)
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

async function setPersistentRemoteSyncPending(
  pending: boolean,
  env?: RuntimeEnv | null
): Promise<void> {
  if (!shouldSyncRemoteDatabase(env)) return;
  let db: NotesDb | null = null;
  try {
    db = await openLocalDatabase();
    await setSyncMeta(db, REMOTE_SYNC_PENDING_KEY, pending ? '1' : '0');
  } catch (error) {
    reportRemoteSyncError(error);
  } finally {
    db?.close();
  }
}

async function hasPersistentRemoteSyncPending(
  env?: RuntimeEnv | null
): Promise<boolean> {
  if (!shouldSyncRemoteDatabase(env)) return false;
  let db: NotesDb | null = null;
  try {
    db = await openLocalDatabase();
    return (await getSyncMeta(db, REMOTE_SYNC_PENDING_KEY)) === '1';
  } catch (error) {
    reportRemoteSyncError(error);
    return false;
  } finally {
    db?.close();
  }
}

async function revivePersistentRemoteSyncIfPending(
  env?: RuntimeEnv | null
): Promise<void> {
  if (
    remoteSyncQueueRunning ||
    remoteSyncQueued ||
    remoteSyncRetryTimer ||
    !(await hasPersistentRemoteSyncPending(env))
  ) {
    return;
  }

  void queueRemoteSyncAfter(undefined, env);
}

async function syncRemoteBestEffort(
  db: NotesDb,
  env?: RuntimeEnv | null
): Promise<boolean> {
  try {
    await syncRemoteDatabase(db);
    await setPersistentRemoteSyncPending(false, env);
    return true;
  } catch (error) {
    if (isRemoteMirrorSyncAlreadyRunning(error)) {
      await setPersistentRemoteSyncPending(true, env);
      setRemoteSyncState('queued', {
        pendingSince: new Date().toISOString(),
        lastError: null
      });
      scheduleRemoteSyncRetry(env);
      return false;
    }
    reportRemoteSyncError(error);
    await setPersistentRemoteSyncPending(true, env);
    return false;
  }
}

async function syncRemoteWithFreshConnection(
  env?: RuntimeEnv | null
): Promise<boolean> {
  if (!shouldSyncRemoteDatabase(env)) return true;

  let db: NotesDb | null = null;
  try {
    db = await openLocalDatabase();
    return await syncRemoteBestEffort(db, env);
  } catch (error) {
    reportRemoteSyncError(error);
    return false;
  } finally {
    db?.close();
  }
}

async function mirrorRemoteUserForLocalSession(
  remoteConfig: NonNullable<ReturnType<typeof getRemoteDatabaseConfig>>,
  db: NotesDb,
  username: string
): Promise<boolean> {
  const remote = await openConfiguredDatabase(remoteConfig);
  try {
    return (await mirrorUserForLocalSession(remote, db, username)) !== null;
  } finally {
    remote.close();
  }
}

async function queueRemoteSyncAfter(
  remoteSync?: Promise<boolean>,
  env?: RuntimeEnv | null
): Promise<void> {
  if (!shouldSyncRemoteDatabase(env)) return;
  await setPersistentRemoteSyncPending(true, env);
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
          scheduleRemoteSyncRetry(env);
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
        const ok = await syncRemoteWithFreshConnection(env);
        if (!ok) {
          scheduleRemoteSyncRetry(env);
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
          await setPersistentRemoteSyncPending(false, env);
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
        void queueRemoteSyncAfter(undefined, env);
      }
    }
  })();
}

function scheduleRemoteSyncRetry(env?: RuntimeEnv | null): void {
  if (!shouldSyncRemoteDatabase(env) || remoteSyncRetryTimer) return;
  remoteSyncFailureCount += 1;
  const delayMs = Math.min(
    REMOTE_SYNC_RETRY_BASE_MS * 2 ** (remoteSyncFailureCount - 1),
    REMOTE_SYNC_RETRY_MAX_MS
  );
  remoteSyncRetryTimer = setTimeout(() => {
    remoteSyncRetryTimer = null;
    void queueRemoteSyncAfter(undefined, env);
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

function signupAttemptKey(
  request: Request,
  username: string | null | undefined
): string {
  return `signup:${loginAttemptKey(request, username)}`;
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

function isLoginRateLimited(
  key: string,
  now = Date.now(),
  maxAttempts = MAX_FAILED_LOGIN_ATTEMPTS
): boolean {
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.delete(key);
    return false;
  }
  return attempt.count >= maxAttempts;
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

function metricLine(name: string, value: string | number): string {
  return `${name} ${value}`;
}

function unixTimestampSeconds(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function metricsBody(c?: ApiContext): string {
  const remote = remoteSyncSnapshot(c);
  const state = remote.state;
  return [
    '# HELP author_up App process liveness.',
    '# TYPE author_up gauge',
    metricLine('author_up', 1),
    '# HELP author_uptime_seconds Seconds since the server process started.',
    '# TYPE author_uptime_seconds gauge',
    metricLine(
      'author_uptime_seconds',
      Math.max(0, Math.floor((Date.now() - serverStartedAt) / 1000))
    ),
    '# HELP author_remote_sync_enabled Whether remote database sync is enabled.',
    '# TYPE author_remote_sync_enabled gauge',
    metricLine('author_remote_sync_enabled', remote.enabled ? 1 : 0),
    '# HELP author_remote_sync_state Current remote sync state.',
    '# TYPE author_remote_sync_state gauge',
    ...(['disabled', 'queued', 'syncing', 'synced', 'error'] as const).map(
      (candidate) =>
        `author_remote_sync_state{state="${candidate}"} ${
          state === candidate ? 1 : 0
        }`
    ),
    '# HELP author_remote_sync_last_success_timestamp_seconds Last successful remote sync timestamp.',
    '# TYPE author_remote_sync_last_success_timestamp_seconds gauge',
    metricLine(
      'author_remote_sync_last_success_timestamp_seconds',
      unixTimestampSeconds(remote.lastSyncedAt)
    ),
    '# HELP author_remote_sync_pending Whether a remote sync is queued or running.',
    '# TYPE author_remote_sync_pending gauge',
    metricLine(
      'author_remote_sync_pending',
      state === 'queued' || state === 'syncing' ? 1 : 0
    )
  ].join('\n');
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

function accountUpdateError(
  error: unknown
): { error: string; status: 400 | 409 } | null {
  const message = error instanceof Error ? error.message : '';
  if (message === 'A valid email address is required') {
    return { error: message, status: 400 };
  }
  if (
    /UNIQUE constraint failed: users\.email|users_email_unique_idx/i.test(
      message
    )
  ) {
    return { error: 'Email is already taken', status: 409 };
  }
  return null;
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
    isNullableString(notebook.nameHash ?? null) &&
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

function pushChangeCount(body: PushRequest): number {
  return body.notes.length + body.notebooks.length;
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
    service: 'author',
    time: new Date().toISOString()
  } satisfies HealthResponse)
);

api.get(API_PATHS.metrics, (c) =>
  c.text(`${metricsBody(c)}\n`, 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8'
  })
);

api.get(API_PATHS.config, async (c) => {
  const remoteConfig = remoteMirrorConfig(c);
  const remoteEnabled = remoteConfig !== null;
  const primaryTurso = isTursoPrimary(c);
  return c.json({
    apiBaseUrl: publicApiBaseUrl(c.req.raw, c),
    remote: {
      enabled: remoteEnabled,
      configured: remoteConfig !== null
    },
    signup: {
      enabled: remoteEnabled || primaryTurso,
      emailRequired: true,
      emailAllowListRequired: true
    }
  } satisfies ConfigResponse);
});

api.post(API_PATHS.authLogin, async (c) => {
  const parsed = await jsonOrSizeError<AuthLoginRequest>(
    c.req.raw,
    MAX_LOGIN_BODY_BYTES,
    'Login payload too large'
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  if (
    !hasDevicePayload(body?.device) ||
    (body?.password !== undefined &&
      body.password !== null &&
      typeof body.password !== 'string')
  ) {
    return c.json({ error: 'Invalid login payload' }, 400);
  }
  const password =
    typeof body.password === 'string' && body.password.trim()
      ? body.password
      : null;
  if (!password && typeof body?.username !== 'string') {
    return c.json({ error: 'Invalid login payload' }, 400);
  }

  const attemptKey = loginAttemptKey(c.req.raw, body.username);
  if (isLoginRateLimited(attemptKey)) {
    return c.json(
      { error: 'Too many login attempts. Try again shortly.' },
      429
    );
  }

  let remoteUser: Awaited<ReturnType<typeof authenticateUser>> = null;
  const remoteConfig = remoteMirrorConfig(c);
  if (remoteConfig) {
    let remote: NotesDb | null = null;
    try {
      remote = await openConfiguredDatabase(remoteConfig);
      remoteUser = password
        ? await authenticateUser(remote, body.username, password, body.totpCode)
        : await authenticateTrustedDevice(
            remote,
            body.username,
            body.device.id,
            body.totpCode
          );
      if (remoteUser) {
        await upsertDevice(remote, body.device, undefined, remoteUser.username);
        await trustAuthDevice(remote, remoteUser.username, body.device.id);
      }
    } catch (error) {
      console.warn(
        'Remote login failed:',
        error instanceof Error ? error.message : error
      );
      return c.json({ error: 'Remote login failed' }, 503);
    } finally {
      remote?.close();
    }
    if (!remoteUser) {
      recordFailedLogin(attemptKey);
      return c.json({ error: 'Invalid username or password' }, 401);
    }
  }

  const db = await openPrimaryDatabase(c);
  try {
    if (
      remoteUser &&
      remoteConfig &&
      !(await mirrorRemoteUserForLocalSession(
        remoteConfig,
        db,
        remoteUser.username
      ))
    ) {
      return c.json(
        { error: 'Could not prepare local session for this account' },
        503
      );
    }
    if (remoteUser && remoteConfig) {
      await queueRemoteSyncAfter(undefined, c.env);
    }

    const user = remoteUser
      ? remoteUser
      : password
        ? await authenticateUser(db, body.username, password, body.totpCode)
        : await authenticateTrustedDevice(
            db,
            body.username,
            body.device.id,
            body.totpCode
          );
    if (!user) {
      recordFailedLogin(attemptKey);
      return c.json(
        {
          error: remoteUser
            ? 'Could not prepare local session for this account'
            : 'Invalid username or password'
        },
        remoteUser ? 503 : 401
      );
    }
    clearFailedLogins(attemptKey);

    await upsertDevice(db, body.device, undefined, user.username);
    await trustAuthDevice(db, user.username, body.device.id);
    const session = await createAuthSession(db, user, body.device.id);
    await queueRemoteSyncAfter(undefined, c.env);
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
    typeof body?.email !== 'string' ||
    typeof body?.password !== 'string'
  ) {
    return c.json({ error: 'Invalid signup payload' }, 400);
  }

  const attemptKey = signupAttemptKey(c.req.raw, body.username);
  if (isLoginRateLimited(attemptKey, Date.now(), MAX_SIGNUP_ATTEMPTS)) {
    return c.json(
      { error: 'Too many signup attempts. Try again shortly.' },
      429
    );
  }

  const remoteConfig = remoteMirrorConfig(c);
  const primaryTurso = isTursoPrimary(c);
  if (!remoteConfig && !primaryTurso) {
    recordFailedLogin(attemptKey);
    return c.json({ error: 'Signup requires remote database access' }, 503);
  }

  if (!remoteConfig && primaryTurso) {
    const db = await openPrimaryDatabase(c);
    try {
      if (!(await hasSignupAllowedEmails(db))) {
        recordFailedLogin(attemptKey);
        return c.json(
          {
            error: 'Signup is disabled. Add an allowed email first.'
          },
          403
        );
      }

      if (!(await isSignupEmailAllowed(db, body.email))) {
        recordFailedLogin(attemptKey);
        return c.json({ error: 'Email is not allowed to sign up' }, 403);
      }

      const user = await createUserAccount(
        db,
        body.username,
        body.email,
        body.password,
        body.displayName
      );
      if (!user) {
        recordFailedLogin(attemptKey);
        return c.json({ error: 'Username or email is already taken' }, 409);
      }

      clearFailedLogins(attemptKey);
      await upsertDevice(db, body.device, undefined, user.username);
      await trustAuthDevice(db, user.username, body.device.id);
      const session = await createAuthSession(db, user, body.device.id);
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
  }

  if (!remoteConfig) {
    recordFailedLogin(attemptKey);
    return c.json({ error: 'Signup requires remote database access' }, 503);
  }

  const remote = await openConfiguredDatabase(remoteConfig);
  let user: Awaited<ReturnType<typeof createUserAccount>>;
  try {
    if (!(await hasSignupAllowedEmails(remote))) {
      recordFailedLogin(attemptKey);
      return c.json(
        { error: 'Signup is disabled. Add an allowed email first.' },
        403
      );
    }

    if (!(await isSignupEmailAllowed(remote, body.email))) {
      recordFailedLogin(attemptKey);
      return c.json({ error: 'Email is not allowed to sign up' }, 403);
    }

    const createdUser = await createUserAccount(
      remote,
      body.username,
      body.email,
      body.password,
      body.displayName
    );
    if (!createdUser) {
      recordFailedLogin(attemptKey);
      return c.json({ error: 'Username or email is already taken' }, 409);
    }
    await upsertDevice(remote, body.device, undefined, createdUser.username);
    await trustAuthDevice(remote, createdUser.username, body.device.id);
    user = createdUser;
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Signup failed' },
      400
    );
  } finally {
    remote.close();
  }

  clearFailedLogins(attemptKey);

  const db = await openPrimaryDatabase(c);
  try {
    if (
      !(await mirrorRemoteUserForLocalSession(remoteConfig, db, user.username))
    ) {
      return c.json(
        { error: 'Account created, but local offline setup failed' },
        503
      );
    }

    await upsertDevice(db, body.device, undefined, user.username);
    await trustAuthDevice(db, user.username, body.device.id);
    const session = await createAuthSession(db, user, body.device.id);
    await queueRemoteSyncAfter(undefined, c.env);
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
  const db = await openPrimaryDatabase(c);
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
  const db = await openPrimaryDatabase(c);
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
  const db = await openPrimaryDatabase(c);
  try {
    const session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    return c.json(await accountResponse(db, session));
  } finally {
    db.close();
  }
});

api.patch(API_PATHS.account, async (c) => {
  const db = await openPrimaryDatabase(c);
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
    if (
      (body.displayName !== undefined && !isNullableString(body.displayName)) ||
      (body.email !== undefined && !isNullableString(body.email))
    ) {
      return c.json({ error: 'Invalid account payload' }, 400);
    }
    const remoteConfig = remoteMirrorConfig(c);
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        try {
          const user = await updateUserProfile(
            db,
            session.user.username,
            body.displayName,
            body.email
          );
          return c.json(await accountResponse(db, session, user));
        } catch (error) {
          const mapped = accountUpdateError(error);
          if (mapped) return c.json({ error: mapped.error }, mapped.status);
          throw error;
        }
      }
      return c.json({ error: 'Account updates require remote access' }, 503);
    }
    if (!(await syncRemoteBestEffort(db, c.env))) {
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
      try {
        user = await updateUserProfile(
          remote,
          session.user.username,
          body.displayName,
          body.email
        );
      } catch (error) {
        const mapped = accountUpdateError(error);
        if (mapped) return c.json({ error: mapped.error }, mapped.status);
        throw error;
      }
    } finally {
      remote.close();
    }

    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json(
        { error: 'Profile saved remotely, but local offline setup failed' },
        503
      );
    }

    await queueRemoteSyncAfter(undefined, c.env);
    return c.json(await accountResponse(db, session, user));
  } finally {
    db.close();
  }
});

api.post(API_PATHS.accountPassword, async (c) => {
  const db = await openPrimaryDatabase(c);
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

    const remoteConfig = remoteMirrorConfig(c);
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        const user = await changeUserPassword(
          db,
          session.user.username,
          body.currentPassword,
          body.newPassword
        );
        if (!user) {
          return c.json({ error: 'Current password is incorrect' }, 401);
        }
        return c.json(await accountResponse(db, session, user));
      }
      return c.json({ error: 'Password changes require remote access' }, 503);
    }
    if (!(await syncRemoteBestEffort(db, c.env))) {
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

    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json(
        { error: 'Password changed remotely, but local offline setup failed' },
        503
      );
    }

    await queueRemoteSyncAfter(undefined, c.env);
    return c.json(await accountResponse(db, session, user));
  } finally {
    db.close();
  }
});

api.post(API_PATHS.accountTotpSetup, async (c) => {
  const db = await openPrimaryDatabase(c);
  try {
    const session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot use 2FA' }, 400);
    }

    const secret = generateTotpSecret();
    return c.json({
      secret,
      otpauthUrl: totpOtpauthUrl(session.user, secret)
    } satisfies TotpSetupResponse);
  } finally {
    db.close();
  }
});

api.post(API_PATHS.accountTotp, async (c) => {
  const db = await openPrimaryDatabase(c);
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot use 2FA' }, 400);
    }
    const parsed = await jsonOrSizeError<TotpEnableRequest>(
      c.req.raw,
      MAX_LOGIN_BODY_BYTES,
      '2FA payload too large'
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (
      typeof body?.currentPassword !== 'string' ||
      typeof body?.secret !== 'string' ||
      typeof body?.totpCode !== 'string'
    ) {
      return c.json({ error: 'Invalid 2FA payload' }, 400);
    }

    const remoteConfig = remoteMirrorConfig(c);
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        const user = await enableUserTotp(
          db,
          session.user.username,
          body.currentPassword,
          body.secret,
          body.totpCode
        );
        if (!user) return c.json({ error: 'Could not verify 2FA setup' }, 401);
        return c.json(await accountResponse(db, session, user));
      }
      return c.json({ error: '2FA changes require remote access' }, 503);
    }
    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json({ error: 'Could not sync before 2FA update' }, 503);
    }
    session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot use 2FA' }, 400);
    }

    const remote = await openConfiguredDatabase(remoteConfig);
    let user: Awaited<ReturnType<typeof enableUserTotp>>;
    try {
      user = await enableUserTotp(
        remote,
        session.user.username,
        body.currentPassword,
        body.secret,
        body.totpCode
      );
    } finally {
      remote.close();
    }
    if (!user) return c.json({ error: 'Could not verify 2FA setup' }, 401);

    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json(
        { error: '2FA enabled remotely, but local offline setup failed' },
        503
      );
    }

    await queueRemoteSyncAfter(undefined, c.env);
    return c.json(await accountResponse(db, session, user));
  } finally {
    db.close();
  }
});

api.delete(API_PATHS.accountTotp, async (c) => {
  const db = await openPrimaryDatabase(c);
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot use 2FA' }, 400);
    }
    const parsed = await jsonOrSizeError<TotpDisableRequest>(
      c.req.raw,
      MAX_LOGIN_BODY_BYTES,
      '2FA payload too large'
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (typeof body?.currentPassword !== 'string') {
      return c.json({ error: 'Invalid 2FA payload' }, 400);
    }

    const remoteConfig = remoteMirrorConfig(c);
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        const user = await disableUserTotp(
          db,
          session.user.username,
          body.currentPassword,
          body.totpCode
        );
        if (!user) return c.json({ error: 'Could not verify 2FA code' }, 401);
        return c.json(await accountResponse(db, session, user));
      }
      return c.json({ error: '2FA changes require remote access' }, 503);
    }
    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json({ error: 'Could not sync before 2FA update' }, 503);
    }
    session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot use 2FA' }, 400);
    }

    const remote = await openConfiguredDatabase(remoteConfig);
    let user: Awaited<ReturnType<typeof disableUserTotp>>;
    try {
      user = await disableUserTotp(
        remote,
        session.user.username,
        body.currentPassword,
        body.totpCode
      );
    } finally {
      remote.close();
    }
    if (!user) return c.json({ error: 'Could not verify 2FA code' }, 401);

    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json(
        { error: '2FA disabled remotely, but local offline setup failed' },
        503
      );
    }

    await queueRemoteSyncAfter(undefined, c.env);
    return c.json(await accountResponse(db, session, user));
  } finally {
    db.close();
  }
});

api.delete(`${API_PATHS.accountTrustedDevices}/:deviceId`, async (c) => {
  const db = await openPrimaryDatabase(c);
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json(
        { error: 'Legacy token accounts cannot manage trusted devices' },
        400
      );
    }

    const deviceId = c.req.param('deviceId')?.trim();
    if (!deviceId) return c.json({ error: 'Invalid device' }, 400);

    const remoteConfig = remoteMirrorConfig(c);
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        await revokeTrustedAuthDevice(db, session.user.username, deviceId);
        return c.json(await accountResponse(db, session));
      }
      return c.json(
        { error: 'Trusted device changes require remote access' },
        503
      );
    }

    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json(
        { error: 'Could not sync before trusted device update' },
        503
      );
    }
    session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json(
        { error: 'Legacy token accounts cannot manage trusted devices' },
        400
      );
    }

    const remote = await openConfiguredDatabase(remoteConfig);
    try {
      await revokeTrustedAuthDevice(remote, session.user.username, deviceId);
    } finally {
      remote.close();
    }
    await revokeTrustedAuthDevice(db, session.user.username, deviceId);
    await queueRemoteSyncAfter(undefined, c.env);
    return c.json(await accountResponse(db, session));
  } finally {
    db.close();
  }
});

api.delete(API_PATHS.account, async (c) => {
  const db = await openPrimaryDatabase(c);
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

    const remoteConfig = remoteMirrorConfig(c);
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        const deleted = await deleteUserAccount(
          db,
          session.user.username,
          body.password
        );
        if (!deleted) return c.json({ error: 'Password is incorrect' }, 401);
        return c.json({ ok: true });
      }
      return c.json({ error: 'Account deletion requires remote access' }, 503);
    }
    if (!(await syncRemoteBestEffort(db, c.env))) {
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

    if (!(await syncRemoteBestEffort(db, c.env))) {
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
  const db = await openPrimaryDatabase(c);
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    if (!(await syncRemoteBestEffort(db, c.env))) {
      await queueRemoteSyncAfter(undefined, c.env);
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
  const db = await openPrimaryDatabase(c);
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    if (!(await syncRemoteBestEffort(db, c.env))) {
      await queueRemoteSyncAfter(undefined, c.env);
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
  const db = await openPrimaryDatabase(c);
  try {
    const authError = await requireAuth(db, c.req.raw);
    if (authError) return authError;

    await revivePersistentRemoteSyncIfPending(c.env);
    return c.json({
      remote: remoteSyncSnapshot(c)
    } satisfies SyncStatusResponse);
  } finally {
    db.close();
  }
});

api.post(API_PATHS.syncPull, async (c) => {
  const db = await openPrimaryDatabase(c);
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

    if (!(await syncRemoteBestEffort(db, c.env))) {
      await queueRemoteSyncAfter(undefined, c.env);
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
  const db = await openPrimaryDatabase(c);
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
    if (pushChangeCount(body) > MAX_SYNC_CHANGES_PER_PUSH) {
      return c.json(
        {
          error:
            'Too many changes in one sync push; refresh Author and try again.'
        },
        413
      );
    }

    if (!(await syncRemoteBestEffort(db, c.env))) {
      await queueRemoteSyncAfter(undefined, c.env);
    } else {
      session = await sessionFromRequest(db, c.req.raw);
      if (!session) return unauthorized();
    }
    const response = await pushChanges(db, body, syncOwner(session));
    await queueRemoteSyncAfter(undefined, c.env);
    return c.json(response);
  } finally {
    db.close();
  }
});

api.post(API_PATHS.cleanupTrash, async (c) => {
  const db = await openPrimaryDatabase(c);
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    if (!(await syncRemoteBestEffort(db, c.env))) {
      await queueRemoteSyncAfter(undefined, c.env);
    } else {
      session = await sessionFromRequest(db, c.req.raw);
      if (!session) return unauthorized();
    }
    const response = await cleanupTrash(db, new Date(), syncOwner(session));
    if (!(await syncRemoteBestEffort(db, c.env))) {
      await queueRemoteSyncAfter(undefined, c.env);
    }
    return c.json(response);
  } finally {
    db.close();
  }
});
