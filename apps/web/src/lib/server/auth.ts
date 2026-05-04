import { createHash, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  getAuthSessionDays,
  getLegacyAuthToken,
  getLoginPassword,
  getLoginUsername
} from './config';
import { get, run, type NotesExecutor } from './db';

const pbkdf2Async = promisify(pbkdf2);
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_KEY_LENGTH = 32;
const SESSION_TOKEN_BYTES = 32;
const SESSION_TOUCH_INTERVAL_MS = 60_000;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

type UserRow = {
  username: string;
  display_name: string | null;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
};

type SessionRow = {
  username: string;
  last_seen_at: string;
  expires_at: string;
};

export interface AuthUser {
  username: string;
  displayName: string | null;
}

export interface AuthSession {
  user: AuthUser;
  expiresAt: string | null;
  legacy: boolean;
}

export interface CreatedAuthSession extends AuthSession {
  token: string;
  expiresAt: string;
  legacy: false;
}

export function tokenFromRequest(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice('bearer '.length).trim();
    return token || null;
  }

  const legacyToken = request.headers.get('x-notes-token')?.trim();
  return legacyToken || null;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function tokenHash(token: string): string {
  return digest(token).toString('hex');
}

export function tokensMatch(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  return timingSafeEqual(digest(actual), digest(expected));
}

export function normalizeUsername(
  username: string | null | undefined
): string | null {
  const normalized = username?.trim().toLocaleLowerCase();
  if (!normalized || !USERNAME_PATTERN.test(normalized)) return null;
  return normalized;
}

function requireUsername(username: string): string {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    throw new Error(
      'Usernames may contain lowercase letters, numbers, dots, hyphens, and underscores'
    );
  }
  return normalized;
}

function requirePassword(password: string): string {
  if (!password.trim()) {
    throw new Error('Password is required');
  }
  return password;
}

function cleanDisplayName(
  displayName: string | null | undefined
): string | null {
  const trimmed = displayName?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

async function hashPassword(
  password: string,
  salt = randomBytes(16).toString('base64url'),
  iterations = PASSWORD_ITERATIONS
): Promise<{ hash: string; salt: string; iterations: number }> {
  const derived = await pbkdf2Async(
    password,
    salt,
    iterations,
    PASSWORD_KEY_LENGTH,
    'sha256'
  );
  return {
    hash: derived.toString('base64url'),
    salt,
    iterations
  };
}

async function verifyPassword(
  password: string,
  row: UserRow
): Promise<boolean> {
  const derived = await pbkdf2Async(
    password,
    row.password_salt,
    Number(row.password_iterations),
    PASSWORD_KEY_LENGTH,
    'sha256'
  );
  const stored = Buffer.from(row.password_hash, 'base64url');
  return stored.length === derived.length && timingSafeEqual(stored, derived);
}

async function getUserRow(
  db: NotesExecutor,
  username: string
): Promise<UserRow | null> {
  const row = await get(
    db,
    `SELECT username, display_name, password_hash, password_salt, password_iterations
     FROM users
     WHERE username = ?`,
    [username]
  );
  return row as UserRow | null;
}

async function maybeBootstrapEnvUser(
  db: NotesExecutor,
  username: string,
  password: string
): Promise<UserRow | null> {
  const bootstrapUsername = normalizeUsername(getLoginUsername());
  const bootstrapPassword = getLoginPassword();
  if (
    !bootstrapUsername ||
    !bootstrapPassword ||
    username !== bootstrapUsername
  )
    return null;
  if (!tokensMatch(password, bootstrapPassword)) return null;

  await setUserPassword(db, username, password);
  return await getUserRow(db, username);
}

export async function setUserPassword(
  db: NotesExecutor,
  username: string,
  password: string
): Promise<AuthUser> {
  const normalized = requireUsername(username);
  const safePassword = requirePassword(password);
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(safePassword);

  await run(db, 'DELETE FROM auth_sessions WHERE username = ?', [normalized]);
  await run(
    db,
    `INSERT INTO users (
       username, display_name, password_hash, password_salt, password_iterations, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       password_iterations = excluded.password_iterations,
       updated_at = excluded.updated_at`,
    [
      normalized,
      null,
      passwordHash.hash,
      passwordHash.salt,
      passwordHash.iterations,
      now,
      now
    ]
  );

  return { username: normalized, displayName: null };
}

export async function authenticateUser(
  db: NotesExecutor,
  username: string | null | undefined,
  password: string | null | undefined
): Promise<AuthUser | null> {
  const normalized = normalizeUsername(username ?? getLoginUsername());
  if (!normalized || typeof password !== 'string') return null;

  const row =
    (await getUserRow(db, normalized)) ??
    (await maybeBootstrapEnvUser(db, normalized, password));
  if (!row) return null;
  return (await verifyPassword(password, row))
    ? { username: normalized, displayName: row.display_name }
    : null;
}

export async function createAuthSession(
  db: NotesExecutor,
  user: AuthUser,
  deviceId: string | null
): Promise<CreatedAuthSession> {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const hash = tokenHash(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + getAuthSessionDays() * 86_400_000
  ).toISOString();

  await run(db, 'DELETE FROM auth_sessions WHERE expires_at <= ?', [nowIso]);
  await run(
    db,
    `INSERT INTO auth_sessions (
       token_hash, username, device_id, created_at, last_seen_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [hash, user.username, deviceId, nowIso, nowIso, expiresAt]
  );

  return {
    token,
    user,
    expiresAt,
    legacy: false
  };
}

export async function sessionFromToken(
  db: NotesExecutor,
  token: string | null
): Promise<AuthSession | null> {
  if (!token) return null;

  const legacyToken = getLegacyAuthToken();
  if (legacyToken && tokensMatch(token, legacyToken)) {
    return {
      user: { username: 'legacy-token', displayName: null },
      expiresAt: null,
      legacy: true
    };
  }
  const hash = tokenHash(token);

  const row = (await get(
    db,
    `SELECT auth_sessions.username, users.display_name, last_seen_at, expires_at
     FROM auth_sessions
     LEFT JOIN users ON users.username = auth_sessions.username
     WHERE token_hash = ?`,
    [hash]
  )) as (SessionRow & { display_name: string | null }) | null;
  if (!row) return null;

  const now = new Date().toISOString();
  if (row.expires_at <= now) {
    await run(db, 'DELETE FROM auth_sessions WHERE token_hash = ?', [hash]);
    return null;
  }

  const lastSeenAt = Date.parse(row.last_seen_at);
  if (
    Number.isNaN(lastSeenAt) ||
    Date.now() - lastSeenAt > SESSION_TOUCH_INTERVAL_MS
  ) {
    await run(
      db,
      'UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?',
      [now, hash]
    );
  }

  return {
    user: { username: row.username, displayName: row.display_name },
    expiresAt: row.expires_at,
    legacy: false
  };
}

export async function updateUserProfile(
  db: NotesExecutor,
  username: string,
  displayName: string | null | undefined
): Promise<AuthUser> {
  const normalized = requireUsername(username);
  const nextDisplayName = cleanDisplayName(displayName);
  await run(
    db,
    'UPDATE users SET display_name = ?, updated_at = ? WHERE username = ?',
    [nextDisplayName, new Date().toISOString(), normalized]
  );
  return { username: normalized, displayName: nextDisplayName };
}

export async function changeUserPassword(
  db: NotesExecutor,
  username: string,
  currentPassword: string,
  newPassword: string
): Promise<AuthUser | null> {
  const normalized = requireUsername(username);
  const row = await getUserRow(db, normalized);
  if (!row || !(await verifyPassword(currentPassword, row))) return null;
  await setUserPassword(db, normalized, newPassword);
  return { username: normalized, displayName: row.display_name };
}

export async function deleteUserAccount(
  db: NotesExecutor,
  username: string,
  password: string
): Promise<boolean> {
  const normalized = requireUsername(username);
  const row = await getUserRow(db, normalized);
  if (!row || !(await verifyPassword(password, row))) return false;
  await run(db, 'DELETE FROM users WHERE username = ?', [normalized]);
  return true;
}

export async function deleteSessionFromRequest(
  db: NotesExecutor,
  request: Request
): Promise<void> {
  const token = tokenFromRequest(request);
  if (!token || tokensMatch(token, getLegacyAuthToken() ?? '')) return;
  await run(db, 'DELETE FROM auth_sessions WHERE token_hash = ?', [
    tokenHash(token)
  ]);
}

export async function sessionFromRequest(
  db: NotesExecutor,
  request: Request
): Promise<AuthSession | null> {
  return await sessionFromToken(db, tokenFromRequest(request));
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'content-type': 'application/json'
    }
  });
}

export async function requireAuth(
  db: NotesExecutor,
  request: Request
): Promise<Response | null> {
  return (await sessionFromRequest(db, request)) ? null : unauthorized();
}
