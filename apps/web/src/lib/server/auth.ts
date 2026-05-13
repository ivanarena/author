import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  getAuthSessionDays,
  getLegacyAuthToken,
  getLoginPassword,
  getLoginUsername,
  getSignupAllowedEmails
} from './config';
import {
  get,
  run,
  withWriteTransaction,
  type NotesDb,
  type NotesExecutor
} from './db';

const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_KEY_LENGTH = 32;
const SESSION_TOKEN_BYTES = 32;
const TOTP_SECRET_BYTES = 20;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const SESSION_TOUCH_INTERVAL_MS = 60_000;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const textEncoder = new TextEncoder();

type UserRow = {
  username: string;
  email: string | null;
  display_name: string | null;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  totp_secret: string | null;
  totp_enabled_at: string | null;
};

type SessionRow = {
  username: string;
  last_seen_at: string;
  expires_at: string;
};

export interface AuthUser {
  username: string;
  email: string | null;
  displayName: string | null;
  twoFactorEnabled: boolean;
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

export function hasSignupAllowedEmails(): boolean {
  return getSignupAllowedEmails().length > 0;
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

export function normalizeEmail(
  email: string | null | undefined
): string | null {
  const normalized = email?.trim().toLocaleLowerCase();
  if (
    !normalized ||
    normalized.length > 254 ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    return null;
  }
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

function requireEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    throw new Error('A valid email address is required');
  }
  return normalized;
}

export function isSignupEmailAllowed(email: string): boolean {
  const normalized = requireEmail(email);
  return getSignupAllowedEmails().includes(normalized);
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
  const derived = await derivePasswordBytes(password, salt, iterations);
  return {
    hash: Buffer.from(derived).toString('base64url'),
    salt,
    iterations
  };
}

async function derivePasswordBytes(
  password: string,
  salt: string,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: textEncoder.encode(salt),
      iterations: Number(iterations)
    },
    key,
    PASSWORD_KEY_LENGTH * 8
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(actual: Uint8Array, expected: Uint8Array): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Uint8Array | null {
  const clean = value.toUpperCase().replaceAll(/\s|=/g, '');
  if (!clean) return null;

  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) return null;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

function cleanTotpCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replaceAll(/\s|-/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

function cleanTotpSecret(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.toUpperCase().replaceAll(/\s|=/g, '');
  return base32Decode(clean) ? clean : null;
}

async function hotp(secret: string, counter: number): Promise<string | null> {
  const secretBytes = base32Decode(secret);
  if (!secretBytes) return null;

  const counterBytes = new Uint8Array(8);
  let remaining = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    counterBytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, counterBytes)
  );
  const offset = signature[signature.length - 1] & 0x0f;
  const truncated =
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3];
  return String(truncated % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

export function totpOtpauthUrl(user: AuthUser, secret: string): string {
  const label = encodeURIComponent(`Author:${user.email ?? user.username}`);
  const issuer = encodeURIComponent('Author');
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export async function verifyTotpCode(
  secret: string | null,
  value: unknown,
  now = Date.now()
): Promise<boolean> {
  const cleanSecret = cleanTotpSecret(secret);
  const code = cleanTotpCode(value);
  if (!cleanSecret || !code) return false;

  const counter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  for (const offset of [-1, 0, 1]) {
    const expected = await hotp(cleanSecret, counter + offset);
    if (
      expected &&
      constantTimeEqual(textEncoder.encode(code), textEncoder.encode(expected))
    ) {
      return true;
    }
  }
  return false;
}

async function verifyPassword(
  password: string,
  row: UserRow
): Promise<boolean> {
  let derived: Uint8Array;
  try {
    derived = await derivePasswordBytes(
      password,
      row.password_salt,
      Number(row.password_iterations)
    );
  } catch (error) {
    if (isPbkdf2IterationLimitError(error)) return false;
    throw error;
  }
  const stored = Buffer.from(row.password_hash, 'base64url');
  return constantTimeEqual(stored, derived);
}

function isPbkdf2IterationLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'NotSupportedError' &&
    /Pbkdf2 failed: iteration counts above \d+ are not supported/.test(
      error.message
    )
  );
}

async function getUserRow(
  db: NotesExecutor,
  username: string
): Promise<UserRow | null> {
  const row = await get(
    db,
    `SELECT username, email, display_name, password_hash, password_salt, password_iterations,
            totp_secret, totp_enabled_at
     FROM users
     WHERE username = ?`,
    [username]
  );
  return row as UserRow | null;
}

async function getUserRowByEmail(
  db: NotesExecutor,
  email: string
): Promise<UserRow | null> {
  const row = await get(
    db,
    `SELECT username, email, display_name, password_hash, password_salt, password_iterations,
            totp_secret, totp_enabled_at
     FROM users
     WHERE email = ?`,
    [email]
  );
  return row as UserRow | null;
}

async function getUserRowByLogin(
  db: NotesExecutor,
  login: string | null | undefined
): Promise<UserRow | null> {
  const username = normalizeUsername(login);
  if (username) return await getUserRow(db, username);
  const email = normalizeEmail(login);
  return email ? await getUserRowByEmail(db, email) : null;
}

function rowToAuthUser(row: UserRow): AuthUser {
  return {
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    twoFactorEnabled: Boolean(row.totp_secret && row.totp_enabled_at)
  };
}

function authCredentialsChanged(
  existing: UserRow | null,
  next: UserRow
): boolean {
  return (
    !existing ||
    existing.password_hash !== next.password_hash ||
    existing.password_salt !== next.password_salt ||
    existing.password_iterations !== next.password_iterations ||
    existing.totp_secret !== next.totp_secret ||
    existing.totp_enabled_at !== next.totp_enabled_at
  );
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

async function rehashUserPassword(
  db: NotesExecutor,
  row: UserRow,
  password: string
): Promise<UserRow | null> {
  await setUserPassword(db, row.username, password);
  return await getUserRow(db, row.username);
}

async function maybeRecoverBootstrapEnvUser(
  db: NotesExecutor,
  row: UserRow,
  password: string
): Promise<UserRow | null> {
  if (row.password_iterations <= PASSWORD_ITERATIONS) return null;

  const bootstrapUsername = normalizeUsername(getLoginUsername());
  const bootstrapPassword = getLoginPassword();
  if (
    !bootstrapUsername ||
    !bootstrapPassword ||
    row.username !== bootstrapUsername ||
    !tokensMatch(password, bootstrapPassword)
  ) {
    return null;
  }

  return await rehashUserPassword(db, row, password);
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
       username, email, display_name, password_hash, password_salt, password_iterations,
       totp_secret, totp_enabled_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       password_iterations = excluded.password_iterations,
       updated_at = excluded.updated_at`,
    [
      normalized,
      null,
      null,
      passwordHash.hash,
      passwordHash.salt,
      passwordHash.iterations,
      null,
      null,
      now,
      now
    ]
  );

  return {
    username: normalized,
    email: null,
    displayName: null,
    twoFactorEnabled: false
  };
}

export async function createUserAccount(
  db: NotesExecutor,
  username: string,
  email: string,
  password: string,
  displayName: string | null | undefined
): Promise<AuthUser | null> {
  const normalized = requireUsername(username);
  const normalizedEmail = requireEmail(email);
  const safePassword = requirePassword(password);
  if (
    (await getUserRow(db, normalized)) ||
    (await getUserRowByEmail(db, normalizedEmail))
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(safePassword);
  const nextDisplayName = cleanDisplayName(displayName);

  await run(
    db,
    `INSERT INTO users (
       username, email, display_name, password_hash, password_salt, password_iterations,
       totp_secret, totp_enabled_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized,
      normalizedEmail,
      nextDisplayName,
      passwordHash.hash,
      passwordHash.salt,
      passwordHash.iterations,
      null,
      null,
      now,
      now
    ]
  );

  return {
    username: normalized,
    email: normalizedEmail,
    displayName: nextDisplayName,
    twoFactorEnabled: false
  };
}

export async function mirrorUserForLocalSession(
  source: NotesExecutor,
  target: NotesExecutor,
  username: string
): Promise<AuthUser | null> {
  const normalized = requireUsername(username);
  const sourceUser = await getUserRow(source, normalized);
  if (!sourceUser) return null;

  const existing = await getUserRow(target, normalized);
  if (authCredentialsChanged(existing, sourceUser)) {
    await run(target, 'DELETE FROM auth_sessions WHERE username = ?', [
      normalized
    ]);
  }

  const now = new Date().toISOString();
  await run(
    target,
    `INSERT INTO users (
       username, email, display_name, password_hash, password_salt, password_iterations,
       totp_secret, totp_enabled_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       password_iterations = excluded.password_iterations,
       totp_secret = excluded.totp_secret,
       totp_enabled_at = excluded.totp_enabled_at,
       updated_at = excluded.updated_at`,
    [
      normalized,
      sourceUser.email,
      sourceUser.display_name,
      sourceUser.password_hash,
      sourceUser.password_salt,
      sourceUser.password_iterations,
      sourceUser.totp_secret,
      sourceUser.totp_enabled_at,
      now,
      now
    ]
  );

  return rowToAuthUser(sourceUser);
}

export async function authenticateUser(
  db: NotesExecutor,
  username: string | null | undefined,
  password: string | null | undefined,
  totpCode?: string | null
): Promise<AuthUser | null> {
  const login = username ?? getLoginUsername();
  const bootstrapUsername = normalizeUsername(login);
  if (
    typeof password !== 'string' ||
    (!bootstrapUsername && !normalizeEmail(login))
  ) {
    return null;
  }

  const row =
    (await getUserRowByLogin(db, login)) ??
    (bootstrapUsername
      ? await maybeBootstrapEnvUser(db, bootstrapUsername, password)
      : null);
  if (!row) return null;

  if (await verifyPassword(password, row)) {
    if (row.totp_secret && !(await verifyTotpCode(row.totp_secret, totpCode))) {
      return null;
    }
    const activeRow =
      row.password_iterations > PASSWORD_ITERATIONS
        ? ((await rehashUserPassword(db, row, password)) ?? row)
        : row;
    return rowToAuthUser(activeRow);
  }

  const recoveredRow = await maybeRecoverBootstrapEnvUser(db, row, password);
  if (!recoveredRow || !(await verifyPassword(password, recoveredRow))) {
    return null;
  }
  return rowToAuthUser(recoveredRow);
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
      user: {
        username: 'legacy-token',
        email: null,
        displayName: null,
        twoFactorEnabled: false
      },
      expiresAt: null,
      legacy: true
    };
  }
  const hash = tokenHash(token);

  const row = (await get(
    db,
    `SELECT auth_sessions.username, users.email, users.display_name,
            users.totp_secret, users.totp_enabled_at, last_seen_at, expires_at
     FROM auth_sessions
     LEFT JOIN users ON users.username = auth_sessions.username
     WHERE token_hash = ?`,
    [hash]
  )) as
    | (SessionRow & {
        email: string | null;
        display_name: string | null;
        totp_secret: string | null;
        totp_enabled_at: string | null;
      })
    | null;
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
    user: {
      username: row.username,
      email: row.email,
      displayName: row.display_name,
      twoFactorEnabled: Boolean(row.totp_secret && row.totp_enabled_at)
    },
    expiresAt: row.expires_at,
    legacy: false
  };
}

export async function updateUserProfile(
  db: NotesExecutor,
  username: string,
  displayName: string | null | undefined,
  email?: string | null | undefined
): Promise<AuthUser> {
  const normalized = requireUsername(username);
  const nextDisplayName = cleanDisplayName(displayName);
  const nextEmail =
    email === undefined
      ? undefined
      : email === null
        ? null
        : requireEmail(email);
  if (nextEmail !== undefined) {
    await run(
      db,
      'UPDATE users SET email = ?, display_name = ?, updated_at = ? WHERE username = ?',
      [nextEmail, nextDisplayName, new Date().toISOString(), normalized]
    );
  } else {
    await run(
      db,
      'UPDATE users SET display_name = ?, updated_at = ? WHERE username = ?',
      [nextDisplayName, new Date().toISOString(), normalized]
    );
  }
  const row = await getUserRow(db, normalized);
  if (!row) throw new Error('User not found');
  return rowToAuthUser(row);
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
  const updated = await getUserRow(db, normalized);
  return updated ? rowToAuthUser(updated) : null;
}

export async function enableUserTotp(
  db: NotesExecutor,
  username: string,
  currentPassword: string,
  secret: string,
  totpCode: string
): Promise<AuthUser | null> {
  const normalized = requireUsername(username);
  const row = await getUserRow(db, normalized);
  const cleanSecret = cleanTotpSecret(secret);
  if (
    !row ||
    !cleanSecret ||
    !(await verifyPassword(currentPassword, row)) ||
    !(await verifyTotpCode(cleanSecret, totpCode))
  ) {
    return null;
  }

  await run(
    db,
    `UPDATE users
     SET totp_secret = ?, totp_enabled_at = ?, updated_at = ?
     WHERE username = ?`,
    [
      cleanSecret,
      new Date().toISOString(),
      new Date().toISOString(),
      normalized
    ]
  );
  await run(db, 'DELETE FROM auth_sessions WHERE username = ?', [normalized]);
  const updated = await getUserRow(db, normalized);
  return updated ? rowToAuthUser(updated) : null;
}

export async function disableUserTotp(
  db: NotesExecutor,
  username: string,
  currentPassword: string,
  totpCode?: string | null
): Promise<AuthUser | null> {
  const normalized = requireUsername(username);
  const row = await getUserRow(db, normalized);
  if (!row || !(await verifyPassword(currentPassword, row))) return null;
  if (row.totp_secret && !(await verifyTotpCode(row.totp_secret, totpCode))) {
    return null;
  }

  await run(
    db,
    `UPDATE users
     SET totp_secret = NULL, totp_enabled_at = NULL, updated_at = ?
     WHERE username = ?`,
    [new Date().toISOString(), normalized]
  );
  await run(db, 'DELETE FROM auth_sessions WHERE username = ?', [normalized]);
  const updated = await getUserRow(db, normalized);
  return updated ? rowToAuthUser(updated) : null;
}

export async function deleteUserAccount(
  db: NotesDb,
  username: string,
  password: string
): Promise<boolean> {
  const normalized = requireUsername(username);
  return await withWriteTransaction(db, async (tx) => {
    const row = await getUserRow(tx, normalized);
    if (!row || !(await verifyPassword(password, row))) return false;

    await run(tx, 'DELETE FROM auth_sessions WHERE username = ?', [normalized]);
    await run(tx, 'DELETE FROM note_versions WHERE owner_username = ?', [
      normalized
    ]);
    await run(tx, 'DELETE FROM notebook_versions WHERE owner_username = ?', [
      normalized
    ]);
    await run(tx, 'DELETE FROM entity_tombstones WHERE owner_username = ?', [
      normalized
    ]);
    await run(tx, 'DELETE FROM entity_changes WHERE owner_username = ?', [
      normalized
    ]);
    await run(tx, 'DELETE FROM notes WHERE owner_username = ?', [normalized]);
    await run(tx, 'DELETE FROM notebooks WHERE owner_username = ?', [
      normalized
    ]);
    await run(tx, 'DELETE FROM users WHERE username = ?', [normalized]);

    return true;
  });
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
