import type {
  AccountResponse,
  AccountUpdateRequest,
  AuthChallengeRequest,
  AuthChallengeResponse,
  AuthProofPurpose,
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
import { Hono, type Context } from 'hono';
import {
  type AuthSession,
  authenticateTrustedDevice,
  authenticateUserProof,
  authSessionCookie,
  bootstrapUserWithVerifier,
  changeUserPassword,
  clearAuthSessionCookie,
  createAuthChallenge,
  createAuthSession,
  createInvitedUserAccount,
  createSessionAuthChallenge,
  getUserE2eeKeyring,
  disableUserTotp,
  enableUserTotp,
  generateTotpSecret,
  deleteSessionFromRequest,
  deleteUserAccount,
  hasSignupAllowedEmails,
  isSignupEmailAllowed,
  listTrustedAuthDevices,
  normalizeEmail,
  mirrorUserForLocalSession,
  normalizeUsername,
  pruneExpiredAuthState,
  requireAuth,
  revokeTrustedAuthDevice,
  sessionFromRequest,
  signupInvitationIsValid,
  trustAuthDevice,
  tokensMatch,
  totpOtpauthUrl,
  updateUserE2eeKeyring,
  updateUserProfile,
  unauthorized
} from './auth';
import {
  areMetricsPublic,
  getMetricsToken,
  getPublicApiBaseUrl,
  getRemoteDatabaseConfig,
  hasHttpsPublicApiBaseUrl,
  isTursoPrimaryDatabase,
  setRuntimeEnv,
  shouldSyncRemoteDatabase,
  shouldTrustCloudflareHeaders,
  shouldTrustProxyHeaders,
  type RuntimeEnv
} from './config';
import {
  get,
  openConfiguredDatabase,
  openLocalDatabase,
  run,
  type NotesDb
} from './db';
import {
  cleanupTrash,
  compactEntityChanges,
  DeviceLimitExceededError,
  getSyncMeta,
  listNotes,
  listNotebooks,
  pullChangesSince,
  pruneUnreferencedDevices,
  pushChanges,
  RecordLimitExceededError,
  setSyncMeta,
  upsertDevice
} from './repository';
import {
  syncRemoteDatabase,
  waitForRemoteSyncIdleForTests
} from './remote-sync';
import { isSecureRequest } from './security-headers';
import { databaseBackupSnapshot } from './backup-scheduler';
import {
  resetTrashCleanupStateForTests,
  trashCleanupSnapshot
} from './cleanup-scheduler';
import { jsonOrSizeError } from './request-body';
import {
  hasCurrentEncryptedNoteFields,
  hasCurrentEncryptedNotebookFields,
  hasDeviceRecord,
  hasEntityChanges,
  hasNotebookRecord,
  hasNoteRecord,
  hasUniqueEntityChangeIds,
  isNullableString
} from './payload-validation';

type ApiBindings = RuntimeEnv;

type ApiContext = Context<{ Bindings: ApiBindings }>;

export const api = new Hono<{ Bindings: ApiBindings }>();

const REQUEST_DURATION_BUCKETS_SECONDS = [
  0.005, 0.025, 0.1, 0.5, 1, 2.5, 5, 10
] as const;

type ApiMetricEntry = {
  count: number;
  errors: number;
  durationSum: number;
  durationBuckets: number[];
};

const apiMetrics = new Map<string, ApiMetricEntry>();
const METRIC_PATHS = new Set<string>(Object.values(API_PATHS));
const METRIC_METHODS = new Set([
  'GET',
  'POST',
  'PATCH',
  'PUT',
  'DELETE',
  'OPTIONS'
]);

function normalizedMetricMethod(method: string): string {
  const normalized = method.toUpperCase();
  return METRIC_METHODS.has(normalized) ? normalized : 'OTHER';
}

function normalizedMetricPath(path: string): string {
  return METRIC_PATHS.has(path) ? path : '/api/:unmatched';
}

api.onError((error, c) => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Turso primary database is not configured') {
    const response = c.json(
      { error: 'Server database is not configured' },
      503
    );
    applyNoStoreApiHeaders(response);
    return response;
  }
  if (
    message.includes('NOTES_SERVER_SECRET') ||
    message.includes('NOTES_LOGIN_PASSWORD')
  ) {
    const response = c.json(
      { error: 'Server authentication is not configured' },
      503
    );
    applyNoStoreApiHeaders(response);
    return response;
  }

  if (error instanceof DeviceLimitExceededError) {
    const response = c.json({ error: error.message }, 409);
    applyNoStoreApiHeaders(response);
    return response;
  }

  if (message.includes('Database request timed out')) {
    const response = c.json({ error: 'Database request timed out' }, 503);
    applyNoStoreApiHeaders(response);
    return response;
  }

  console.error('API request failed:', message || error);
  const response = c.json({ error: 'Internal server error' }, 500);
  applyNoStoreApiHeaders(response);
  return response;
});

function mergeVaryHeader(existing: string | null, additions: string[]): string {
  if (existing?.trim() === '*') return existing;
  const values = new Map<string, string>();
  for (const value of existing?.split(',') ?? []) {
    const trimmed = value.trim();
    if (trimmed) values.set(trimmed.toLowerCase(), trimmed);
  }
  for (const addition of additions) {
    values.set(addition.toLowerCase(), addition);
  }
  return [...values.values()].join(', ');
}

function applyNoStoreApiHeaders(response: Response): void {
  response.headers.set('cache-control', 'no-store, private');
  response.headers.set(
    'vary',
    mergeVaryHeader(response.headers.get('vary'), ['Authorization', 'Cookie'])
  );
}

function metricLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function apiMetricKey(method: string, path: string): string {
  return `${normalizedMetricMethod(method)} ${path}`;
}

function apiMetricEntry(method: string, path: string): ApiMetricEntry {
  const key = apiMetricKey(method, path);
  const existing = apiMetrics.get(key);
  if (existing) return existing;
  const created = {
    count: 0,
    errors: 0,
    durationSum: 0,
    durationBuckets: REQUEST_DURATION_BUCKETS_SECONDS.map(() => 0)
  };
  apiMetrics.set(key, created);
  return created;
}

function observeApiRequest(
  method: string,
  path: string,
  status: number,
  durationSeconds: number
): void {
  const entry = apiMetricEntry(method, path);
  entry.count += 1;
  if (status >= 500) entry.errors += 1;
  entry.durationSum += durationSeconds;
  for (const [index, bucket] of REQUEST_DURATION_BUCKETS_SECONDS.entries()) {
    if (durationSeconds <= bucket) entry.durationBuckets[index] += 1;
  }
}

api.use('*', async (c, next) => {
  setRuntimeEnv(c.env);
  const started = performance.now();
  const path = normalizedMetricPath(new URL(c.req.url).pathname);
  const originError = rejectCrossOriginMutation(c);
  if (originError) {
    applyNoStoreApiHeaders(originError);
    observeApiRequest(
      c.req.method,
      path,
      originError.status,
      (performance.now() - started) / 1000
    );
    return originError;
  }
  try {
    await next();
    applyNoStoreApiHeaders(c.res);
    observeApiRequest(
      c.req.method,
      path,
      c.res.status,
      (performance.now() - started) / 1000
    );
  } catch (error) {
    observeApiRequest(
      c.req.method,
      path,
      500,
      (performance.now() - started) / 1000
    );
    throw error;
  }
});

const LOGIN_ATTEMPT_WINDOW_MS = 60_000;
const MAX_FAILED_LOGIN_ATTEMPTS = 8;
const MAX_AUTH_CHALLENGE_ATTEMPTS = 20;
const MAX_AUTH_CHALLENGE_CLIENT_ATTEMPTS = 100;
const MAX_SIGNUP_ATTEMPTS = 4;
const MAX_SYNC_PUSHES_PER_MINUTE = 60;
const MAX_LOGIN_ATTEMPT_KEYS = 500;
const MAX_LOGIN_BODY_BYTES = 16 * 1024;
const MAX_ACCOUNT_BODY_BYTES = 256 * 1024;
const MAX_SYNC_BODY_BYTES = 5 * 1024 * 1024;
const MAX_SYNC_CHANGES_PER_PUSH = 20;
const REMOTE_SYNC_RETRY_BASE_MS = 5_000;
const REMOTE_SYNC_RETRY_MAX_MS = 5 * 60_000;
const REMOTE_SYNC_PENDING_KEY = 'remote.sync.pending';
const rateLimitEncoder = new TextEncoder();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
let remoteSyncRetryTimer: ReturnType<typeof setTimeout> | null = null;
let remoteSyncFailureCount = 0;
let remoteSyncQueueRunning = false;
let remoteSyncQueued = false;
let remoteSyncQueuePromise: Promise<void> | null = null;
const serverStartedAt = Date.now();
const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function syncOwner(session: AuthSession): string {
  return session.user.username;
}

function isTursoPrimary(c: ApiContext): boolean {
  return isTursoPrimaryDatabase(c.env);
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

function rejectCrossOriginMutation(c: ApiContext): Response | null {
  if (SAFE_HTTP_METHODS.has(c.req.raw.method.toUpperCase())) return null;
  const origin = c.req.raw.headers.get('origin')?.trim();
  if (!origin) return null;

  try {
    const expectedOrigin = new URL(publicApiBaseUrl(c.req.raw, c)).origin;
    if (new URL(origin).origin === expectedOrigin) return null;
  } catch {
    return c.json({ error: 'Invalid request origin' }, 403);
  }

  return c.json({ error: 'Invalid request origin' }, 403);
}

function authCookieSecure(c: ApiContext): boolean {
  if (hasHttpsPublicApiBaseUrl(c.env)) return true;
  return isSecureRequest(
    c.req.raw,
    new URL(c.req.raw.url),
    shouldTrustProxyHeaders()
  );
}

function setAuthSessionCookie(
  c: ApiContext,
  session: { token: string; expiresAt: string }
): void {
  c.header(
    'set-cookie',
    authSessionCookie(session.token, session.expiresAt, authCookieSecure(c))
  );
}

function clearAuthCookie(c: ApiContext): void {
  c.header('set-cookie', clearAuthSessionCookie(authCookieSecure(c)));
}

function bearerSessionRequested(c: ApiContext): boolean {
  return (
    c.req.raw.headers.get('x-author-session-mode')?.trim() === 'bearer' ||
    !c.req.raw.headers.get('origin')
  );
}

async function accountResponse(
  db: NotesDb,
  session: AuthSession,
  user: AuthSession['user'] = session.user,
  replacementSession?: { token: string; expiresAt: string } | null,
  includeBearerToken = false
): Promise<AccountResponse> {
  return {
    user,
    e2eeKeyring: session.legacy
      ? null
      : await getUserE2eeKeyring(db, user.username),
    trustedDevices: session.legacy
      ? []
      : await listTrustedAuthDevices(db, user.username, session.deviceId),
    ...(replacementSession
      ? {
          session: {
            ...(includeBearerToken ? { token: replacementSession.token } : {}),
            expiresAt: replacementSession.expiresAt
          }
        }
      : {})
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resetHonoStateForTests(): Promise<void> {
  clearRemoteSyncRetry();
  remoteSyncQueued = false;
  await remoteSyncQueuePromise?.catch(() => {});
  await waitForRemoteSyncIdleForTests();
  for (let attempt = 0; remoteSyncQueueRunning && attempt < 100; attempt += 1) {
    await sleep(10);
  }
  remoteSyncFailureCount = 0;
  loginAttempts.clear();
  apiMetrics.clear();
  resetTrashCleanupStateForTests();
  setRemoteSyncState('synced', {
    pendingSince: null,
    lastError: null
  });
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

  queueRemoteSyncSoon(env);
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
  remoteSyncQueuePromise = (async () => {
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
      remoteSyncQueuePromise = null;
      if (remoteSyncQueued) {
        queueRemoteSyncSoon(env);
      }
    }
  })();
  void remoteSyncQueuePromise.catch(reportRemoteSyncError);
}

function queueRemoteSyncSoon(env?: RuntimeEnv | null): void {
  void queueRemoteSyncAfter(undefined, env).catch(reportRemoteSyncError);
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
    queueRemoteSyncSoon(env);
  }, delayMs);
}

function requestClientKey(request: Request): string {
  const cloudflareIp = shouldTrustCloudflareHeaders()
    ? request.headers.get('cf-connecting-ip')?.trim()
    : null;
  if (cloudflareIp) return `cf:${cloudflareIp}`;

  const forwardedFor = shouldTrustProxyHeaders()
    ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    : null;
  const realIp = shouldTrustProxyHeaders()
    ? request.headers.get('x-real-ip')?.trim()
    : null;
  return forwardedFor || realIp || 'local';
}

function loginAttemptKey(
  request: Request,
  username: string | null | undefined
): string {
  const client = requestClientKey(request);
  return `${client}:${normalizeUsername(username) ?? normalizeEmail(username) ?? 'unknown'}`;
}

function signupAttemptKey(request: Request): string {
  return `signup:client:${requestClientKey(request)}`;
}

function accountProofAttemptKey(
  request: Request,
  username: string,
  purpose: 'password_change' | 'keyring_update' | 'totp' | 'delete_account'
): string {
  return `${purpose}:${loginAttemptKey(request, username)}`;
}

function authChallengeAttemptLimits(
  request: Request,
  username: string,
  purpose: AuthProofPurpose
): Array<{ key: string; maxAttempts: number }> {
  const client = requestClientKey(request);
  const identity =
    normalizeUsername(username) ?? normalizeEmail(username) ?? 'unknown';
  return [
    {
      key: `auth-challenge:client:${client}`,
      maxAttempts: MAX_AUTH_CHALLENGE_CLIENT_ATTEMPTS
    },
    {
      key: `auth-challenge:${purpose}:${client}:${identity}`,
      maxAttempts: MAX_AUTH_CHALLENGE_ATTEMPTS
    }
  ];
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

async function persistentLoginAttemptKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    rateLimitEncoder.encode(`author-rate-limit:${key}`)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function isPersistentLoginRateLimited(
  db: NotesDb,
  key: string,
  now = Date.now(),
  maxAttempts = MAX_FAILED_LOGIN_ATTEMPTS
): Promise<boolean> {
  await run(db, 'DELETE FROM auth_rate_limits WHERE reset_at <= ?', [now]);
  const keyHash = await persistentLoginAttemptKey(key);
  const attempt = await get(
    db,
    'SELECT count, reset_at FROM auth_rate_limits WHERE key_hash = ?',
    [keyHash]
  );
  if (!attempt || Number(attempt.reset_at) <= now) return false;
  return Number(attempt.count) >= maxAttempts;
}

async function recordPersistentFailedLogin(
  db: NotesDb,
  key: string,
  now = Date.now()
): Promise<void> {
  const keyHash = await persistentLoginAttemptKey(key);
  const resetAt = now + LOGIN_ATTEMPT_WINDOW_MS;
  await run(
    db,
    `INSERT INTO auth_rate_limits (key_hash, count, reset_at)
     VALUES (?, 1, ?)
     ON CONFLICT(key_hash) DO UPDATE SET
       count = CASE
         WHEN auth_rate_limits.reset_at <= ? THEN 1
         ELSE auth_rate_limits.count + 1
       END,
       reset_at = CASE
         WHEN auth_rate_limits.reset_at <= ? THEN ?
         ELSE auth_rate_limits.reset_at
       END`,
    [keyHash, resetAt, now, now, resetAt]
  );
}

async function clearPersistentFailedLogins(
  db: NotesDb,
  key: string
): Promise<void> {
  await run(db, 'DELETE FROM auth_rate_limits WHERE key_hash = ?', [
    await persistentLoginAttemptKey(key)
  ]);
}

async function isRateLimited(
  db: NotesDb,
  key: string,
  now = Date.now(),
  maxAttempts = MAX_FAILED_LOGIN_ATTEMPTS
): Promise<boolean> {
  return (
    isLoginRateLimited(key, now, maxAttempts) ||
    (await isPersistentLoginRateLimited(db, key, now, maxAttempts))
  );
}

async function recordFailedAuthAttempt(
  db: NotesDb,
  key: string,
  now = Date.now()
): Promise<void> {
  recordFailedLogin(key, now);
  await recordPersistentFailedLogin(db, key, now);
}

async function authChallengeRateLimitError(
  c: ApiContext,
  db: NotesDb,
  username: string,
  purpose: AuthProofPurpose
): Promise<Response | null> {
  const limits = authChallengeAttemptLimits(c.req.raw, username, purpose);
  for (const limit of limits) {
    if (await isRateLimited(db, limit.key, undefined, limit.maxAttempts)) {
      return c.json(
        { error: 'Too many auth challenge attempts. Try again shortly.' },
        429
      );
    }
  }

  await Promise.all(
    limits.map((limit) => recordFailedAuthAttempt(db, limit.key))
  );
  return null;
}

async function clearFailedAuthAttempts(
  db: NotesDb,
  key: string
): Promise<void> {
  clearFailedLogins(key);
  await clearPersistentFailedLogins(db, key);
}

async function clearAuthChallengeAttempts(
  db: NotesDb,
  request: Request,
  username: string,
  purpose: AuthProofPurpose
): Promise<void> {
  await Promise.all(
    authChallengeAttemptLimits(request, username, purpose).map((limit) =>
      clearFailedAuthAttempts(db, limit.key)
    )
  );
}

async function accountProofRateLimitError(
  c: ApiContext,
  db: NotesDb,
  username: string,
  purpose: 'password_change' | 'keyring_update' | 'totp' | 'delete_account'
): Promise<{ key: string; response: Response | null }> {
  const key = accountProofAttemptKey(c.req.raw, username, purpose);
  if (await isRateLimited(db, key)) {
    return {
      key,
      response: c.json(
        { error: 'Too many verification attempts. Try again shortly.' },
        429
      )
    };
  }
  return { key, response: null };
}

function metricLine(name: string, value: string | number): string {
  return `${name} ${value}`;
}

function unixTimestampSeconds(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0;
}

function apiMetricsLines(): string[] {
  const lines = [
    '# HELP author_http_requests_total API requests by method and path.',
    '# TYPE author_http_requests_total counter',
    '# HELP author_http_request_errors_total API requests that returned 5xx responses.',
    '# TYPE author_http_request_errors_total counter',
    '# HELP author_http_request_duration_seconds API request duration histogram.',
    '# TYPE author_http_request_duration_seconds histogram'
  ];
  for (const [key, entry] of apiMetrics) {
    const separator = key.indexOf(' ');
    const method = key.slice(0, separator);
    const path = key.slice(separator + 1);
    const labels = `method="${metricLabelValue(method)}",path="${metricLabelValue(path)}"`;
    lines.push(`author_http_requests_total{${labels}} ${entry.count}`);
    lines.push(`author_http_request_errors_total{${labels}} ${entry.errors}`);
    for (const [index, bucket] of REQUEST_DURATION_BUCKETS_SECONDS.entries()) {
      lines.push(
        `author_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${entry.durationBuckets[index]}`
      );
    }
    lines.push(
      `author_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${entry.count}`
    );
    lines.push(
      `author_http_request_duration_seconds_sum{${labels}} ${entry.durationSum.toFixed(6)}`
    );
    lines.push(
      `author_http_request_duration_seconds_count{${labels}} ${entry.count}`
    );
  }
  return lines;
}

function metricsBody(c?: ApiContext): string {
  const remote = remoteSyncSnapshot(c);
  const state = remote.state;
  const backup = databaseBackupSnapshot();
  const cleanup = trashCleanupSnapshot();
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
    ),
    '# HELP author_database_backup_enabled Whether scheduled local SQLite backups are enabled.',
    '# TYPE author_database_backup_enabled gauge',
    metricLine('author_database_backup_enabled', backup.enabled ? 1 : 0),
    '# HELP author_database_backup_running Whether a scheduled database backup is running.',
    '# TYPE author_database_backup_running gauge',
    metricLine('author_database_backup_running', backup.running ? 1 : 0),
    '# HELP author_database_backup_last_success_timestamp_seconds Last successful scheduled backup timestamp.',
    '# TYPE author_database_backup_last_success_timestamp_seconds gauge',
    metricLine(
      'author_database_backup_last_success_timestamp_seconds',
      unixTimestampSeconds(backup.lastSuccessAt)
    ),
    '# HELP author_database_backup_last_failure_timestamp_seconds Last failed scheduled backup timestamp.',
    '# TYPE author_database_backup_last_failure_timestamp_seconds gauge',
    metricLine(
      'author_database_backup_last_failure_timestamp_seconds',
      unixTimestampSeconds(backup.lastFailureAt)
    ),
    '# HELP author_trash_cleanup_running Whether trash cleanup is currently running.',
    '# TYPE author_trash_cleanup_running gauge',
    metricLine('author_trash_cleanup_running', cleanup.running ? 1 : 0),
    '# HELP author_trash_cleanup_last_success_timestamp_seconds Last successful cleanup timestamp.',
    '# TYPE author_trash_cleanup_last_success_timestamp_seconds gauge',
    metricLine(
      'author_trash_cleanup_last_success_timestamp_seconds',
      unixTimestampSeconds(cleanup.lastSuccessAt)
    ),
    '# HELP author_trash_cleanup_last_failure_timestamp_seconds Last failed cleanup timestamp.',
    '# TYPE author_trash_cleanup_last_failure_timestamp_seconds gauge',
    metricLine(
      'author_trash_cleanup_last_failure_timestamp_seconds',
      unixTimestampSeconds(cleanup.lastFailureAt)
    ),
    '# HELP author_trash_cleanup_last_deleted_records Records deleted by the last cleanup.',
    '# TYPE author_trash_cleanup_last_deleted_records gauge',
    metricLine(
      'author_trash_cleanup_last_deleted_records',
      cleanup.lastDeletedNotes + cleanup.lastDeletedNotebooks
    ),
    '# HELP author_entity_changes_last_compacted Rows compacted by the last cleanup.',
    '# TYPE author_entity_changes_last_compacted gauge',
    metricLine(
      'author_entity_changes_last_compacted',
      cleanup.lastCompactedChanges
    ),
    ...apiMetricsLines()
  ].join('\n');
}

function bearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice('bearer '.length).trim();
  return token || null;
}

async function metricsAuthError(c: ApiContext): Promise<Response | null> {
  if (areMetricsPublic(c.env)) return null;

  const metricsToken = getMetricsToken(c.env);
  if (metricsToken) {
    const presented =
      c.req.raw.headers.get('x-author-metrics-token')?.trim() ??
      bearerToken(c.req.raw);
    return tokensMatch(presented, metricsToken) ? null : unauthorized();
  }

  if ((c.env?.NODE_ENV ?? process.env.NODE_ENV) === 'production') {
    return unauthorized();
  }
  const db = await openPrimaryDatabase(c);
  try {
    return await requireAuth(db, c.req.raw);
  } finally {
    db.close();
  }
}

function hasDevicePayload(
  device: unknown
): device is AuthLoginRequest['device'] {
  return hasDeviceRecord(device);
}

function deviceTrustSecretFromBody(
  body: Pick<AuthLoginRequest, 'deviceTrustSecret'>
): string | null {
  const secret = body.deviceTrustSecret;
  if (typeof secret !== 'string') return null;
  const trimmed = secret.trim();
  return trimmed.length >= 32 ? trimmed : null;
}

function accountUpdateError(
  error: unknown
): { error: string; status: 400 | 409 } | null {
  const message = error instanceof Error ? error.message : '';
  if (
    message === 'A valid email address is required' ||
    message.startsWith('Profile picture must be')
  ) {
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

api.get(API_PATHS.metrics, async (c) => {
  const authError = await metricsAuthError(c);
  if (authError) return authError;
  return c.text(`${metricsBody(c)}\n`, 200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8'
  });
});

api.get(API_PATHS.config, async (c) => {
  const databaseConfig = getRemoteDatabaseConfig(c.env);
  const primaryTurso = isTursoPrimary(c);
  const primaryTursoConfigured = primaryTurso && databaseConfig !== null;
  const remoteConfig = primaryTurso
    ? null
    : shouldSyncRemoteDatabase(c.env)
      ? databaseConfig
      : null;
  const remoteEnabled = remoteConfig !== null;
  return c.json({
    apiBaseUrl: publicApiBaseUrl(c.req.raw, c),
    remote: {
      enabled: remoteEnabled,
      configured: remoteConfig !== null
    },
    signup: {
      enabled: remoteEnabled || primaryTursoConfigured,
      emailRequired: true,
      emailAllowListRequired: true,
      invitationRequired: true
    }
  } satisfies ConfigResponse);
});

api.post(API_PATHS.authChallenge, async (c) => {
  const parsed = await jsonOrSizeError<AuthChallengeRequest>(
    c.req.raw,
    MAX_LOGIN_BODY_BYTES,
    'Auth challenge payload too large'
  );
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (
    !body ||
    ![
      'login',
      'password_change',
      'keyring_update',
      'totp',
      'delete_account'
    ].includes(body.purpose) ||
    typeof body.clientNonce !== 'string'
  ) {
    return c.json({ error: 'Invalid auth challenge payload' }, 400);
  }

  const purpose = body.purpose as AuthProofPurpose;
  const remoteConfig = remoteMirrorConfig(c);
  if (purpose === 'login') {
    if (typeof body.username !== 'string') {
      return c.json({ error: 'Invalid auth challenge payload' }, 400);
    }
    const target = remoteConfig
      ? await openConfiguredDatabase(remoteConfig)
      : await openPrimaryDatabase(c);
    try {
      const rateLimit = await authChallengeRateLimitError(
        c,
        target,
        body.username,
        purpose
      );
      if (rateLimit) return rateLimit;

      const challenge = await createAuthChallenge(
        target,
        body.username,
        purpose,
        body.clientNonce
      );
      if (!challenge) {
        return c.json({ error: 'Invalid auth challenge payload' }, 400);
      }
      return c.json(challenge satisfies AuthChallengeResponse);
    } finally {
      target.close();
    }
  }

  const db = await openPrimaryDatabase(c);
  try {
    const session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot be edited' }, 400);
    }
    const target = remoteConfig
      ? await openConfiguredDatabase(remoteConfig)
      : db;
    try {
      const rateLimit = await authChallengeRateLimitError(
        c,
        target,
        session.user.username,
        purpose
      );
      if (rateLimit) return rateLimit;

      const challenge = await createSessionAuthChallenge(
        target,
        session.user.username,
        purpose,
        body.clientNonce
      );
      if (!challenge) {
        return c.json({ error: 'Invalid auth challenge payload' }, 400);
      }
      return c.json(challenge satisfies AuthChallengeResponse);
    } finally {
      if (target !== db) target.close();
    }
  } finally {
    db.close();
  }
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
    typeof body?.username !== 'string' ||
    (body?.proof !== undefined &&
      body.proof !== null &&
      typeof body.proof !== 'object') ||
    (body?.passwordVerifier !== undefined &&
      body.passwordVerifier !== null &&
      typeof body.passwordVerifier !== 'object') ||
    (body?.bootstrapPassword !== undefined &&
      body.bootstrapPassword !== null &&
      typeof body.bootstrapPassword !== 'string') ||
    (body?.deviceTrustSecret !== undefined &&
      body.deviceTrustSecret !== null &&
      typeof body.deviceTrustSecret !== 'string')
  ) {
    return c.json({ error: 'Invalid login payload' }, 400);
  }
  const deviceTrustSecret = deviceTrustSecretFromBody(body);
  const hasProof = Boolean(body.proof);
  const hasBootstrapVerifier = Boolean(
    body.passwordVerifier && body.bootstrapPassword
  );

  const attemptKey = loginAttemptKey(c.req.raw, body.username);
  const db = await openPrimaryDatabase(c);
  try {
    if (await isRateLimited(db, attemptKey)) {
      return c.json(
        { error: 'Too many login attempts. Try again shortly.' },
        429
      );
    }

    let remoteUser: AuthLoginResponse['user'] | null = null;
    let serverProof: string | null = null;
    const remoteConfig = remoteMirrorConfig(c);
    if (remoteConfig) {
      let remote: NotesDb | null = null;
      try {
        remote = await openConfiguredDatabase(remoteConfig);
        if (hasProof) {
          const verified = await authenticateUserProof(
            remote,
            body.username,
            body.proof,
            body.totpCode
          );
          remoteUser = verified?.user ?? null;
          serverProof = verified?.serverProof ?? null;
        } else if (hasBootstrapVerifier) {
          remoteUser = await bootstrapUserWithVerifier(
            remote,
            body.username,
            body.bootstrapPassword,
            body.passwordVerifier
          );
        } else {
          remoteUser = await authenticateTrustedDevice(
            remote,
            body.username,
            body.device.id,
            deviceTrustSecret,
            body.totpCode
          );
        }
        if (remoteUser) {
          await clearAuthChallengeAttempts(
            remote,
            c.req.raw,
            body.username,
            'login'
          );
          await upsertDevice(
            remote,
            body.device,
            undefined,
            remoteUser.username
          );
          if (deviceTrustSecret) {
            await trustAuthDevice(
              remote,
              remoteUser.username,
              body.device.id,
              deviceTrustSecret
            );
          }
        }
      } catch (error) {
        if (error instanceof DeviceLimitExceededError) throw error;
        console.warn(
          'Remote login failed:',
          error instanceof Error ? error.message : error
        );
        return c.json({ error: 'Remote login failed' }, 503);
      } finally {
        remote?.close();
      }
      if (!remoteUser) {
        await recordFailedAuthAttempt(db, attemptKey);
        return c.json({ error: 'Invalid username or password' }, 401);
      }
    }

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

    let user: AuthLoginResponse['user'] | null;
    try {
      if (remoteUser) {
        user = remoteUser;
      } else if (hasProof) {
        const verified = await authenticateUserProof(
          db,
          body.username,
          body.proof,
          body.totpCode
        );
        user = verified?.user ?? null;
        serverProof = verified?.serverProof ?? null;
      } else if (hasBootstrapVerifier) {
        user = await bootstrapUserWithVerifier(
          db,
          body.username,
          body.bootstrapPassword,
          body.passwordVerifier
        );
      } else {
        user = await authenticateTrustedDevice(
          db,
          body.username,
          body.device.id,
          deviceTrustSecret,
          body.totpCode
        );
      }
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Login failed' },
        400
      );
    }
    if (!user) {
      await recordFailedAuthAttempt(db, attemptKey);
      return c.json(
        {
          error: remoteUser
            ? 'Could not prepare local session for this account'
            : 'Invalid username or password'
        },
        remoteUser ? 503 : 401
      );
    }
    await clearFailedAuthAttempts(db, attemptKey);
    await clearAuthChallengeAttempts(db, c.req.raw, body.username, 'login');

    await upsertDevice(db, body.device, undefined, user.username);
    if (deviceTrustSecret) {
      await trustAuthDevice(
        db,
        user.username,
        body.device.id,
        deviceTrustSecret
      );
    }
    const session = await createAuthSession(db, user, body.device.id);
    await queueRemoteSyncAfter(undefined, c.env);
    setAuthSessionCookie(c, session);
    return c.json({
      ...(bearerSessionRequested(c) ? { token: session.token } : {}),
      user,
      device: body.device,
      expiresAt: session.expiresAt,
      serverProof,
      e2eeKeyring: await getUserE2eeKeyring(db, user.username)
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
    typeof body?.invitationCode !== 'string' ||
    !body.passwordVerifier ||
    typeof body.passwordVerifier !== 'object' ||
    (body?.deviceTrustSecret !== undefined &&
      body.deviceTrustSecret !== null &&
      typeof body.deviceTrustSecret !== 'string') ||
    (body?.e2eeKeyring !== undefined && !isNullableString(body.e2eeKeyring))
  ) {
    return c.json({ error: 'Invalid signup payload' }, 400);
  }
  const deviceTrustSecret = deviceTrustSecretFromBody(body);

  const attemptKey = signupAttemptKey(c.req.raw);
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
      if (
        await isRateLimited(db, attemptKey, Date.now(), MAX_SIGNUP_ATTEMPTS)
      ) {
        return c.json(
          { error: 'Too many signup attempts. Try again shortly.' },
          429
        );
      }

      if (
        !(await hasSignupAllowedEmails(db)) ||
        !(await isSignupEmailAllowed(db, body.email)) ||
        !signupInvitationIsValid(body.email, body.invitationCode)
      ) {
        await recordFailedAuthAttempt(db, attemptKey);
        return c.json({ error: 'Signup could not be completed' }, 403);
      }

      const user = await createInvitedUserAccount(
        db,
        body.username,
        body.email,
        body.invitationCode,
        body.passwordVerifier,
        body.displayName,
        body.e2eeKeyring
      );
      if (!user) {
        await recordFailedAuthAttempt(db, attemptKey);
        return c.json({ error: 'Signup could not be completed' }, 409);
      }

      await clearFailedAuthAttempts(db, attemptKey);
      await upsertDevice(db, body.device, undefined, user.username);
      if (deviceTrustSecret) {
        await trustAuthDevice(
          db,
          user.username,
          body.device.id,
          deviceTrustSecret
        );
      }
      const session = await createAuthSession(db, user, body.device.id);
      setAuthSessionCookie(c, session);
      return c.json({
        ...(bearerSessionRequested(c) ? { token: session.token } : {}),
        user,
        device: body.device,
        expiresAt: session.expiresAt,
        e2eeKeyring: await getUserE2eeKeyring(db, user.username)
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
  let user: Awaited<ReturnType<typeof createInvitedUserAccount>>;
  try {
    if (
      await isRateLimited(remote, attemptKey, Date.now(), MAX_SIGNUP_ATTEMPTS)
    ) {
      return c.json(
        { error: 'Too many signup attempts. Try again shortly.' },
        429
      );
    }

    if (
      !(await hasSignupAllowedEmails(remote)) ||
      !(await isSignupEmailAllowed(remote, body.email)) ||
      !signupInvitationIsValid(body.email, body.invitationCode)
    ) {
      await recordFailedAuthAttempt(remote, attemptKey);
      return c.json({ error: 'Signup could not be completed' }, 403);
    }

    const createdUser = await createInvitedUserAccount(
      remote,
      body.username,
      body.email,
      body.invitationCode,
      body.passwordVerifier,
      body.displayName,
      body.e2eeKeyring
    );
    if (!createdUser) {
      await recordFailedAuthAttempt(remote, attemptKey);
      return c.json({ error: 'Signup could not be completed' }, 409);
    }
    await clearFailedAuthAttempts(remote, attemptKey);
    await upsertDevice(remote, body.device, undefined, createdUser.username);
    if (deviceTrustSecret) {
      await trustAuthDevice(
        remote,
        createdUser.username,
        body.device.id,
        deviceTrustSecret
      );
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
    if (deviceTrustSecret) {
      await trustAuthDevice(
        db,
        user.username,
        body.device.id,
        deviceTrustSecret
      );
    }
    const session = await createAuthSession(db, user, body.device.id);
    await queueRemoteSyncAfter(undefined, c.env);
    setAuthSessionCookie(c, session);
    return c.json({
      ...(bearerSessionRequested(c) ? { token: session.token } : {}),
      user,
      device: body.device,
      expiresAt: session.expiresAt,
      e2eeKeyring: await getUserE2eeKeyring(db, user.username)
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
    clearAuthCookie(c);
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

api.on(['PATCH', 'PUT'], API_PATHS.account, async (c) => {
  const db = await openPrimaryDatabase(c);
  try {
    let session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();
    if (session.legacy) {
      return c.json({ error: 'Legacy token accounts cannot be edited' }, 400);
    }
    const parsed = await jsonOrSizeError<AccountUpdateRequest>(
      c.req.raw,
      MAX_ACCOUNT_BODY_BYTES,
      'Account payload too large'
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.body ?? {};
    if (
      (body.displayName !== undefined && !isNullableString(body.displayName)) ||
      (body.email !== undefined && !isNullableString(body.email)) ||
      (body.profileImage !== undefined &&
        !isNullableString(body.profileImage)) ||
      (body.e2eeKeyring !== undefined && !isNullableString(body.e2eeKeyring)) ||
      (body.proof !== undefined &&
        body.proof !== null &&
        typeof body.proof !== 'object') ||
      (body.expectedE2eeKeyringHash !== undefined &&
        !isNullableString(body.expectedE2eeKeyringHash))
    ) {
      return c.json({ error: 'Invalid account payload' }, 400);
    }
    const keyringUpdate = body.e2eeKeyring !== undefined;
    if (
      keyringUpdate &&
      (body.displayName !== undefined ||
        body.email !== undefined ||
        body.profileImage !== undefined ||
        typeof body.e2eeKeyring !== 'string' ||
        !body.e2eeKeyring.trim() ||
        !body.proof)
    ) {
      return c.json({ error: 'Invalid encrypted keyring update' }, 400);
    }
    const remoteConfig = remoteMirrorConfig(c);
    if (keyringUpdate) {
      const rateLimit = await accountProofRateLimitError(
        c,
        db,
        session.user.username,
        'keyring_update'
      );
      if (rateLimit.response) return rateLimit.response;
      if (remoteConfig && !(await syncRemoteBestEffort(db, c.env))) {
        return c.json({ error: 'Could not sync before keyring update' }, 503);
      }

      let target: NotesDb = db;
      if (remoteConfig) target = await openConfiguredDatabase(remoteConfig);
      try {
        const user = await updateUserE2eeKeyring(
          target,
          session.user.username,
          body.proof,
          body.e2eeKeyring,
          body.expectedE2eeKeyringHash
        );
        if (!user) {
          await recordFailedAuthAttempt(db, rateLimit.key);
          return c.json(
            { error: 'Keyring authorization or current value did not match' },
            409
          );
        }
        await clearFailedAuthAttempts(db, rateLimit.key);
        if (remoteConfig) {
          if (
            !(await mirrorRemoteUserForLocalSession(
              remoteConfig,
              db,
              user.username
            )) ||
            !(await syncRemoteBestEffort(db, c.env))
          ) {
            return c.json(
              { error: 'Keyring saved remotely, but local setup failed' },
              503
            );
          }
        }
        return c.json(await accountResponse(db, session, user));
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Encrypted keyring update failed'
          },
          400
        );
      } finally {
        if (target !== db) target.close();
      }
    }
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        try {
          const user = await updateUserProfile(
            db,
            session.user.username,
            body.displayName,
            body.email,
            undefined,
            body.profileImage
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
          body.email,
          undefined,
          body.profileImage
        );
      } catch (error) {
        const mapped = accountUpdateError(error);
        if (mapped) return c.json({ error: mapped.error }, mapped.status);
        throw error;
      }
    } finally {
      remote.close();
    }

    if (
      !(await mirrorRemoteUserForLocalSession(remoteConfig, db, user.username))
    ) {
      return c.json(
        { error: 'Profile saved remotely, but local offline setup failed' },
        503
      );
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
      !body?.proof ||
      typeof body.proof !== 'object' ||
      !body.newPasswordVerifier ||
      typeof body.newPasswordVerifier !== 'object' ||
      (body.e2eeKeyring !== undefined && !isNullableString(body.e2eeKeyring))
    ) {
      return c.json({ error: 'Invalid password payload' }, 400);
    }

    const rateLimit = await accountProofRateLimitError(
      c,
      db,
      session.user.username,
      'password_change'
    );
    if (rateLimit.response) return rateLimit.response;

    const remoteConfig = remoteMirrorConfig(c);
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        let user: Awaited<ReturnType<typeof changeUserPassword>>;
        try {
          user = await changeUserPassword(
            db,
            session.user.username,
            body.proof,
            body.newPasswordVerifier,
            body.e2eeKeyring
          );
        } catch (error) {
          return c.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Password change failed'
            },
            400
          );
        }
        if (!user) {
          await recordFailedAuthAttempt(db, rateLimit.key);
          return c.json({ error: 'Current password is incorrect' }, 401);
        }
        await clearFailedAuthAttempts(db, rateLimit.key);
        const replacementSession = await createAuthSession(
          db,
          user,
          session.deviceId
        );
        setAuthSessionCookie(c, replacementSession);
        return c.json(
          await accountResponse(
            db,
            replacementSession,
            user,
            replacementSession,
            bearerSessionRequested(c)
          )
        );
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
        body.proof,
        body.newPasswordVerifier,
        body.e2eeKeyring
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : 'Password change failed'
        },
        400
      );
    } finally {
      remote.close();
    }
    if (!user) {
      await recordFailedAuthAttempt(db, rateLimit.key);
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
    await clearFailedAuthAttempts(db, rateLimit.key);

    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json(
        { error: 'Password changed remotely, but local offline setup failed' },
        503
      );
    }
    if (
      !(await mirrorRemoteUserForLocalSession(remoteConfig, db, user.username))
    ) {
      return c.json(
        { error: 'Password changed remotely, but local offline setup failed' },
        503
      );
    }

    const replacementSession = await createAuthSession(
      db,
      user,
      session.deviceId
    );
    setAuthSessionCookie(c, replacementSession);
    await queueRemoteSyncAfter(undefined, c.env);
    return c.json(
      await accountResponse(
        db,
        replacementSession,
        user,
        replacementSession,
        bearerSessionRequested(c)
      )
    );
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
      !body?.proof ||
      typeof body.proof !== 'object' ||
      typeof body?.secret !== 'string' ||
      typeof body?.totpCode !== 'string'
    ) {
      return c.json({ error: 'Invalid 2FA payload' }, 400);
    }

    const rateLimit = await accountProofRateLimitError(
      c,
      db,
      session.user.username,
      'totp'
    );
    if (rateLimit.response) return rateLimit.response;

    const remoteConfig = remoteMirrorConfig(c);
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        const user = await enableUserTotp(
          db,
          session.user.username,
          body.proof,
          body.secret,
          body.totpCode
        );
        if (!user) {
          await recordFailedAuthAttempt(db, rateLimit.key);
          return c.json({ error: 'Could not verify 2FA setup' }, 401);
        }
        await clearFailedAuthAttempts(db, rateLimit.key);
        clearAuthCookie(c);
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
        body.proof,
        body.secret,
        body.totpCode
      );
    } finally {
      remote.close();
    }
    if (!user) {
      await recordFailedAuthAttempt(db, rateLimit.key);
      return c.json({ error: 'Could not verify 2FA setup' }, 401);
    }
    await clearFailedAuthAttempts(db, rateLimit.key);

    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json(
        { error: '2FA enabled remotely, but local offline setup failed' },
        503
      );
    }

    await queueRemoteSyncAfter(undefined, c.env);
    clearAuthCookie(c);
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
    if (!body?.proof || typeof body.proof !== 'object') {
      return c.json({ error: 'Invalid 2FA payload' }, 400);
    }

    const rateLimit = await accountProofRateLimitError(
      c,
      db,
      session.user.username,
      'totp'
    );
    if (rateLimit.response) return rateLimit.response;

    const remoteConfig = remoteMirrorConfig(c);
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        const user = await disableUserTotp(
          db,
          session.user.username,
          body.proof,
          body.totpCode
        );
        if (!user) {
          await recordFailedAuthAttempt(db, rateLimit.key);
          return c.json({ error: 'Could not verify 2FA code' }, 401);
        }
        await clearFailedAuthAttempts(db, rateLimit.key);
        clearAuthCookie(c);
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
        body.proof,
        body.totpCode
      );
    } finally {
      remote.close();
    }
    if (!user) {
      await recordFailedAuthAttempt(db, rateLimit.key);
      return c.json({ error: 'Could not verify 2FA code' }, 401);
    }
    await clearFailedAuthAttempts(db, rateLimit.key);

    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json(
        { error: '2FA disabled remotely, but local offline setup failed' },
        503
      );
    }

    await queueRemoteSyncAfter(undefined, c.env);
    clearAuthCookie(c);
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
    if (!body?.proof || typeof body.proof !== 'object') {
      return c.json({ error: 'Invalid delete payload' }, 400);
    }

    const rateLimit = await accountProofRateLimitError(
      c,
      db,
      session.user.username,
      'delete_account'
    );
    if (rateLimit.response) return rateLimit.response;

    const remoteConfig = remoteMirrorConfig(c);
    if (!remoteConfig) {
      if (isTursoPrimary(c)) {
        const deleted = await deleteUserAccount(
          db,
          session.user.username,
          body.proof
        );
        if (!deleted) {
          await recordFailedAuthAttempt(db, rateLimit.key);
          return c.json({ error: 'Password is incorrect' }, 401);
        }
        await clearFailedAuthAttempts(db, rateLimit.key);
        clearAuthCookie(c);
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
        body.proof
      );
    } finally {
      remote.close();
    }
    if (!deleted) {
      await recordFailedAuthAttempt(db, rateLimit.key);
      return c.json({ error: 'Password is incorrect' }, 401);
    }
    await clearFailedAuthAttempts(db, rateLimit.key);

    if (!(await syncRemoteBestEffort(db, c.env))) {
      return c.json(
        { error: 'Account deleted remotely, but local cleanup failed' },
        503
      );
    }

    clearAuthCookie(c);
    return c.json({ ok: true });
  } finally {
    db.close();
  }
});

api.get(API_PATHS.notes, async (c) => {
  const db = await openPrimaryDatabase(c);
  try {
    const session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    queueRemoteSyncSoon(c.env);
    return c.json({ notes: await listNotes(db, syncOwner(session)) });
  } finally {
    db.close();
  }
});

api.get(API_PATHS.notebooks, async (c) => {
  const db = await openPrimaryDatabase(c);
  try {
    const session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    queueRemoteSyncSoon(c.env);
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
    const session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    const parsed = await jsonOrSizeError<PullRequest>(
      c.req.raw,
      MAX_LOGIN_BODY_BYTES,
      'Pull payload too large'
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.body ?? {};

    queueRemoteSyncSoon(c.env);
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
    const session = await sessionFromRequest(db, c.req.raw);
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
      !hasUniqueEntityChangeIds(body.notes) ||
      !hasUniqueEntityChangeIds(body.notebooks) ||
      !recordsBelongToDevice(body)
    ) {
      return c.json({ error: 'Invalid push payload' }, 400);
    }
    if (pushChangeCount(body) > MAX_SYNC_CHANGES_PER_PUSH) {
      return c.json(
        {
          error:
            'Too many changes in one sync push; refresh author and try again.'
        },
        413
      );
    }

    if (session.deviceId && session.deviceId !== body.device.id) {
      return c.json({ error: 'Sync device does not match this session' }, 403);
    }

    const accountKeyring = session.legacy
      ? null
      : await getUserE2eeKeyring(db, session.user.username);
    if (
      accountKeyring &&
      (!body.notes.every((change) =>
        hasCurrentEncryptedNoteFields(change.record)
      ) ||
        !body.notebooks.every((change) =>
          hasCurrentEncryptedNotebookFields(change.record)
        ))
    ) {
      return c.json(
        {
          error:
            'Sync-capable accounts require current encrypted fields and hashes'
        },
        400
      );
    }

    const syncRateKey = `sync-push:${syncOwner(session)}`;
    if (
      await isRateLimited(
        db,
        syncRateKey,
        Date.now(),
        MAX_SYNC_PUSHES_PER_MINUTE
      )
    ) {
      return c.json({ error: 'Too many sync pushes. Try again shortly.' }, 429);
    }
    await recordFailedAuthAttempt(db, syncRateKey);

    try {
      const response = await pushChanges(db, body, syncOwner(session), {
        enforceRecordLimits: true,
        recordLimitEnv: c.env
      });
      queueRemoteSyncSoon(c.env);
      return c.json(response);
    } catch (error) {
      if (error instanceof RecordLimitExceededError) {
        return c.json(error.result, 409);
      }
      throw error;
    }
  } finally {
    db.close();
  }
});

api.post(API_PATHS.cleanupTrash, async (c) => {
  const db = await openPrimaryDatabase(c);
  try {
    const session = await sessionFromRequest(db, c.req.raw);
    if (!session) return unauthorized();

    const response = await cleanupTrash(db, new Date(), syncOwner(session));
    await pruneExpiredAuthState(db);
    await pruneUnreferencedDevices(db);
    await compactEntityChanges(db, syncOwner(session));
    queueRemoteSyncSoon(c.env);
    return c.json(response);
  } finally {
    db.close();
  }
});
