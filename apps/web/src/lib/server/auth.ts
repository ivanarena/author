import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  getAuthSessionDays,
  getLegacyAuthToken,
  getLoginPassword,
  getLoginUsername,
  getServerSecret
} from './config';
import {
  all,
  get,
  run,
  withWriteTransaction,
  type NotesDb,
  type NotesExecutor
} from './db';

const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_ITERATION_PLATFORM_FALLBACK = 100_000;
const MIN_PASSWORD_LENGTH = 12;
const SESSION_TOKEN_BYTES = 32;
const AUTH_SESSION_COOKIE_NAME = 'author_session';
const SERVER_SECRET_PREFIX = 'srvenc:v1:';
const TOTP_SECRET_BYTES = 20;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const SESSION_TOUCH_INTERVAL_MS = 60_000;
const DEVICE_TRUST_SECRET_MIN_LENGTH = 32;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const textEncoder = new TextEncoder();
let passwordIterationTarget: Promise<number> | null = null;

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

type PasswordVerification = 'match' | 'mismatch' | 'unsupported';

type SessionRow = {
  username: string;
  device_id: string | null;
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
  deviceId: string | null;
  expiresAt: string | null;
  legacy: boolean;
}

export interface CreatedAuthSession extends AuthSession {
  token: string;
  expiresAt: string;
  legacy: false;
}

export interface TrustedAuthDevice {
  deviceId: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export async function hasSignupAllowedEmails(
  db: NotesExecutor
): Promise<boolean> {
  const row = await get(
    db,
    'SELECT 1 AS allowed FROM signup_allowed_emails LIMIT 1'
  );
  return Boolean(row);
}

export function tokenFromRequest(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice('bearer '.length).trim();
    return token || null;
  }

  const legacyToken = request.headers.get('x-notes-token')?.trim();
  if (legacyToken) return legacyToken;

  return cookieValue(request.headers.get('cookie'), AUTH_SESSION_COOKIE_NAME);
}

export function authSessionCookie(
  token: string,
  expiresAt: string,
  secure: boolean
): string {
  const attributes = [
    `${AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearAuthSessionCookie(secure: boolean): string {
  const attributes = [
    `${AUTH_SESSION_COOKIE_NAME}=`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0'
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey !== name) continue;
    const value = rawValue.join('=');
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return value || null;
    }
  }
  return null;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function tokenHash(token: string): string {
  return digest(token).toString('hex');
}

function deviceTrustSecretHash(
  username: string,
  deviceId: string,
  secret: string
): string {
  return tokenHash(`trusted-device:v1\0${username}\0${deviceId}\0${secret}`);
}

function normalizeDeviceTrustSecret(
  secret: string | null | undefined
): string | null {
  const normalized = secret?.trim();
  if (!normalized || normalized.length < DEVICE_TRUST_SECRET_MIN_LENGTH) {
    return null;
  }
  return normalized;
}

function requireDeviceTrustSecret(secret: string | null | undefined): string {
  const normalized = normalizeDeviceTrustSecret(secret);
  if (!normalized) throw new Error('Device trust secret is required');
  return normalized;
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

export async function isSignupEmailAllowed(
  db: NotesExecutor,
  email: string
): Promise<boolean> {
  const normalized = requireEmail(email);
  const row = await get(
    db,
    'SELECT 1 AS allowed FROM signup_allowed_emails WHERE email = ?',
    [normalized]
  );
  return Boolean(row);
}

function requirePassword(password: string): string {
  if (!password.trim()) {
    throw new Error('Password is required');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    );
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
  const { derived, iterations: effectiveIterations } =
    await supportedPasswordHash(password, salt, iterations);
  return {
    hash: Buffer.from(derived).toString('base64url'),
    salt,
    iterations: effectiveIterations
  };
}

async function supportedPasswordHash(
  password: string,
  salt: string,
  iterations: number
): Promise<{ derived: Uint8Array; iterations: number }> {
  try {
    return {
      derived: await derivePasswordBytes(password, salt, iterations),
      iterations
    };
  } catch (error) {
    if (
      iterations > PASSWORD_ITERATION_PLATFORM_FALLBACK &&
      isPbkdf2IterationLimitError(error)
    ) {
      return {
        derived: await derivePasswordBytes(
          password,
          salt,
          PASSWORD_ITERATION_PLATFORM_FALLBACK
        ),
        iterations: PASSWORD_ITERATION_PLATFORM_FALLBACK
      };
    }
    throw error;
  }
}

function effectivePasswordIterations(): Promise<number> {
  passwordIterationTarget ??= supportedPasswordHash(
    'author-password-iteration-probe',
    'author-password-iteration-probe-salt',
    PASSWORD_ITERATIONS
  ).then(({ iterations }) => iterations);
  return passwordIterationTarget;
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
  const cleanSecret = await readableTotpSecret(secret);
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

async function readableTotpSecret(
  secret: string | null
): Promise<string | null> {
  if (!secret) return null;
  return cleanTotpSecret(await decryptServerSecret(secret));
}

async function encryptServerSecret(value: string): Promise<string> {
  const keyMaterial = getServerSecret();
  if (!keyMaterial) {
    throw new Error('NOTES_SERVER_SECRET is required to store 2FA secrets');
  }

  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: bufferSource(iv),
      additionalData: bufferSource(textEncoder.encode('author:totp-secret:v1'))
    },
    await serverSecretKey(keyMaterial),
    textEncoder.encode(value)
  );

  return `${SERVER_SECRET_PREFIX}${iv.toString('base64url')}:${Buffer.from(
    encrypted
  ).toString('base64url')}`;
}

async function decryptServerSecret(value: string): Promise<string> {
  if (!value.startsWith(SERVER_SECRET_PREFIX)) return value;

  const payload = value.slice(SERVER_SECRET_PREFIX.length);
  const [iv, encrypted] = payload.split(':');
  const keyMaterial = getServerSecret();
  if (!iv || !encrypted || !keyMaterial) return value;

  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bufferSource(Buffer.from(iv, 'base64url')),
        additionalData: bufferSource(
          textEncoder.encode('author:totp-secret:v1')
        )
      },
      await serverSecretKey(keyMaterial),
      bufferSource(Buffer.from(encrypted, 'base64url'))
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return value;
  }
}

async function serverSecretKey(keyMaterial: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(`author:server-secret:v1:${keyMaterial}`)
  );
  return await crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function verifyPassword(
  password: string,
  row: UserRow
): Promise<boolean> {
  return (await verifyPasswordStatus(password, row)) === 'match';
}

async function verifyPasswordStatus(
  password: string,
  row: UserRow
): Promise<PasswordVerification> {
  let derived: Uint8Array;
  try {
    derived = await derivePasswordBytes(
      password,
      row.password_salt,
      Number(row.password_iterations)
    );
  } catch (error) {
    if (isPbkdf2IterationLimitError(error)) return 'unsupported';
    throw error;
  }
  const stored = Buffer.from(row.password_hash, 'base64url');
  return constantTimeEqual(stored, derived) ? 'match' : 'mismatch';
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
  if (row.password_iterations <= PASSWORD_ITERATION_PLATFORM_FALLBACK)
    return null;

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
  await run(db, 'DELETE FROM trusted_auth_devices WHERE username = ?', [
    normalized
  ]);
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
    await run(target, 'DELETE FROM trusted_auth_devices WHERE username = ?', [
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

  const verification = await verifyPasswordStatus(password, row);
  if (verification === 'match') {
    if (row.totp_secret && !(await verifyTotpCode(row.totp_secret, totpCode))) {
      return null;
    }
    const activeRow =
      row.password_iterations < (await effectivePasswordIterations())
        ? ((await rehashUserPassword(db, row, password)) ?? row)
        : row;
    return rowToAuthUser(activeRow);
  }

  if (verification !== 'unsupported') return null;

  const recoveredRow = await maybeRecoverBootstrapEnvUser(db, row, password);
  if (!recoveredRow || !(await verifyPassword(password, recoveredRow))) {
    return null;
  }
  return rowToAuthUser(recoveredRow);
}

export async function trustAuthDevice(
  db: NotesExecutor,
  username: string,
  deviceId: string,
  deviceTrustSecret: string | null | undefined
): Promise<void> {
  const normalized = requireUsername(username);
  const safeDeviceId = deviceId.trim();
  if (!safeDeviceId) throw new Error('Device is required');
  const safeSecret = requireDeviceTrustSecret(deviceTrustSecret);
  const secretHash = deviceTrustSecretHash(
    normalized,
    safeDeviceId,
    safeSecret
  );
  const now = new Date().toISOString();
  await run(
    db,
    `INSERT INTO trusted_auth_devices (
       username, device_id, secret_hash, created_at, last_used_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(username, device_id) DO UPDATE SET
       secret_hash = excluded.secret_hash,
       last_used_at = excluded.last_used_at`,
    [normalized, safeDeviceId, secretHash, now, now]
  );
}

export async function listTrustedAuthDevices(
  db: NotesExecutor,
  username: string,
  currentDeviceId: string | null
): Promise<TrustedAuthDevice[]> {
  const normalized = requireUsername(username);
  const rows = await all(
    db,
    `SELECT trusted_auth_devices.device_id, trusted_auth_devices.created_at,
            trusted_auth_devices.last_used_at, devices.name AS device_name
     FROM trusted_auth_devices
     LEFT JOIN devices ON devices.id = trusted_auth_devices.device_id
     WHERE trusted_auth_devices.username = ?
       AND trusted_auth_devices.secret_hash IS NOT NULL
     ORDER BY trusted_auth_devices.last_used_at DESC,
              trusted_auth_devices.created_at DESC`,
    [normalized]
  );

  return rows.map((row) => {
    const deviceId = String(row.device_id ?? '');
    return {
      deviceId,
      deviceName: String(row.device_name ?? deviceId),
      createdAt: String(row.created_at ?? ''),
      lastUsedAt: String(row.last_used_at ?? ''),
      current: currentDeviceId === deviceId
    };
  });
}

export async function revokeTrustedAuthDevice(
  db: NotesExecutor,
  username: string,
  deviceId: string
): Promise<void> {
  const normalized = requireUsername(username);
  const safeDeviceId = deviceId.trim();
  if (!safeDeviceId) throw new Error('Device is required');
  await run(
    db,
    'DELETE FROM trusted_auth_devices WHERE username = ? AND device_id = ?',
    [normalized, safeDeviceId]
  );
}

async function isTrustedAuthDevice(
  db: NotesExecutor,
  username: string,
  deviceId: string,
  deviceTrustSecret: string | null | undefined
): Promise<boolean> {
  const safeDeviceId = deviceId.trim();
  if (!safeDeviceId) return false;
  const safeSecret = normalizeDeviceTrustSecret(deviceTrustSecret);
  if (!safeSecret) return false;
  const row = await get(
    db,
    `SELECT secret_hash
     FROM trusted_auth_devices
     WHERE username = ? AND device_id = ? AND secret_hash IS NOT NULL`,
    [username, safeDeviceId]
  );
  const expected = String(row?.secret_hash ?? '');
  return tokensMatch(
    deviceTrustSecretHash(username, safeDeviceId, safeSecret),
    expected
  );
}

export async function authenticateTrustedDevice(
  db: NotesExecutor,
  username: string | null | undefined,
  deviceId: string | null | undefined,
  deviceTrustSecret: string | null | undefined,
  totpCode?: string | null
): Promise<AuthUser | null> {
  if (typeof deviceId !== 'string' || !deviceId.trim()) return null;
  const safeDeviceId = deviceId.trim();
  const row = await getUserRowByLogin(db, username);
  if (!row || !row.totp_secret || !row.totp_enabled_at) return null;
  if (
    !(await isTrustedAuthDevice(
      db,
      row.username,
      safeDeviceId,
      deviceTrustSecret
    ))
  )
    return null;
  if (!(await verifyTotpCode(row.totp_secret, totpCode))) return null;
  await trustAuthDevice(db, row.username, safeDeviceId, deviceTrustSecret);
  return rowToAuthUser(row);
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
    deviceId,
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
      deviceId: null,
      expiresAt: null,
      legacy: true
    };
  }
  const hash = tokenHash(token);

  const row = (await get(
    db,
    `SELECT auth_sessions.username, users.email, users.display_name,
            users.totp_secret, users.totp_enabled_at,
            auth_sessions.device_id, last_seen_at, expires_at
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
    deviceId: row.device_id,
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
      await encryptServerSecret(cleanSecret),
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
