import { createHash, randomBytes } from 'node:crypto';
import type {
  AuthChallengeResponse,
  AuthKdfParams,
  AuthProof,
  AuthProofPurpose,
  PasswordVerifier
} from '@author/api-types';
import {
  AUTH_PROOF_ALGORITHM,
  AUTH_PROOF_KDF_PARAMS,
  authKdfParamsAreCurrent,
  authKdfParamsString,
  authProofMessage,
  base64UrlEncode,
  constantTimeEqual,
  decodeBase64UrlStrict,
  hmacSha256,
  passwordVerifierFromPassword,
  xorBytes
} from '../shared/auth-proof';
import {
  MIN_PASSWORD_LENGTH,
  passwordMeetsMinimumLength
} from '../shared/password-policy';
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
const PASSWORD_VERIFIER_PREFIX = `${AUTH_PROOF_ALGORITHM}:v1:`;
const SESSION_TOKEN_BYTES = 32;
const AUTH_SESSION_COOKIE_NAME = 'author_session';
const AUTH_CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_AUTH_CHALLENGE_ROWS = 1_000;
const MAX_AUTH_CHALLENGES_PER_USER_PURPOSE = 5;
const SERVER_SECRET_PREFIX = 'srvenc:v1:';
const TOTP_SECRET_BYTES = 20;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const SESSION_TOUCH_INTERVAL_MS = 60_000;
const DEVICE_TRUST_SECRET_MIN_LENGTH = 32;
const E2EE_KEYRING_MAX_BYTES = 64 * 1024;
const PROFILE_IMAGE_MAX_BYTES = 128 * 1024;
const PROFILE_IMAGE_PATTERN =
  /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const SIGNUP_INVITATION_MAX_TTL_MS = 90 * 24 * 60 * 60_000;
const SIGNUP_INVITATION_PREFIX = 'invite:v1:';
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const textEncoder = new TextEncoder();

type UserRow = {
  username: string;
  email: string | null;
  display_name: string | null;
  profile_image: string | null;
  password_hash: string;
  password_salt: string;
  e2ee_keyring: string | null;
  totp_secret: string | null;
  totp_enabled_at: string | null;
};

type SessionRow = {
  username: string;
  device_id: string | null;
  last_seen_at: string;
  expires_at: string;
};

type AuthChallengeRow = {
  id: string;
  username: string;
  purpose: AuthProofPurpose;
  client_nonce: string;
  server_nonce: string;
  created_at: string;
  expires_at: string;
};

export interface AccountTombstone {
  username: string;
  deletionId: string;
  deletedAt: string;
}

type SignupInvitationPayload = {
  email: string;
  expiresAt: string;
  nonce: string;
};

type ParsedPasswordVerifier = {
  params: AuthKdfParams;
  storedKey: Uint8Array;
  serverKey: Uint8Array;
  salt: string;
};

export interface VerifiedAuthProof {
  user: AuthUser;
  serverProof: string;
}

export interface AuthUser {
  username: string;
  email: string | null;
  displayName: string | null;
  profileImage: string | null;
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

function digestBytes(value: Uint8Array): Buffer {
  return createHash('sha256').update(value).digest();
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
  return constantTimeStringEqual(actual, expected);
}

function constantTimeStringEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  const length = Math.max(actualBytes.length, expectedBytes.length, 1);
  let difference = actualBytes.length ^ expectedBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }
  return difference === 0;
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

function signupInvitationSignature(payload: string): string {
  return base64UrlEncode(
    hmacSha256(
      textEncoder.encode(getServerSecret()),
      `author:signup-invitation:v1:${payload}`
    )
  );
}

export function createSignupInvitation(
  email: string,
  expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000)
): string {
  const normalizedEmail = requireEmail(email);
  const ttl = expiresAt.getTime() - Date.now();
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > SIGNUP_INVITATION_MAX_TTL_MS) {
    throw new Error('Signup invitation expiry must be within 90 days');
  }
  const payload: SignupInvitationPayload = {
    email: normalizedEmail,
    expiresAt: expiresAt.toISOString(),
    nonce: randomBytes(16).toString('base64url')
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${SIGNUP_INVITATION_PREFIX}${encoded}:${signupInvitationSignature(encoded)}`;
}

export function signupInvitationIsValid(
  email: string,
  invitationCode: string | null | undefined,
  now = new Date()
): boolean {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || typeof invitationCode !== 'string') return false;
  const value = invitationCode.trim();
  if (!value.startsWith(SIGNUP_INVITATION_PREFIX)) return false;
  const parts = value.slice(SIGNUP_INVITATION_PREFIX.length).split(':');
  if (
    parts.length !== 2 ||
    !tokensMatch(parts[1], signupInvitationSignature(parts[0]))
  ) {
    return false;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8')
    ) as Partial<SignupInvitationPayload>;
    const expiry = Date.parse(payload.expiresAt ?? '');
    return (
      payload.email === normalizedEmail &&
      typeof payload.nonce === 'string' &&
      payload.nonce.length >= 16 &&
      Number.isFinite(expiry) &&
      expiry > now.getTime() &&
      expiry - now.getTime() <= SIGNUP_INVITATION_MAX_TTL_MS
    );
  } catch {
    return false;
  }
}

function requirePassword(password: string): string {
  if (!password.trim()) {
    throw new Error('Password is required');
  }
  if (!passwordMeetsMinimumLength(password)) {
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

function jpegDimensions(bytes: Uint8Array): [number, number] | null {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return [width, height];
    }
    offset += segmentLength;
  }
  return null;
}

function profileImageDimensions(
  mime: string,
  bytes: Uint8Array
): [number, number] | null {
  if (mime === 'jpeg') return jpegDimensions(bytes);
  if (mime === 'png') {
    if (
      bytes.length < 24 ||
      String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
    ) {
      return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (mime !== 'webp' || bytes.length < 25) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return [width, height];
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
    const height =
      1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    return [width, height];
  }
  if (
    chunk === 'VP8 ' &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return [width, height];
  }
  return null;
}

function cleanProfileImage(
  profileImage: string | null | undefined
): string | null {
  if (profileImage === null || profileImage === undefined) return null;
  const match = PROFILE_IMAGE_PATTERN.exec(profileImage);
  const encoded = match?.[2] ?? '';
  if (!match || encoded.length % 4 !== 0) {
    throw new Error('Profile picture must be a JPEG, PNG, or WebP image');
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(encoded), (character) =>
      character.charCodeAt(0)
    );
  } catch {
    throw new Error('Profile picture must be a JPEG, PNG, or WebP image');
  }
  if (bytes.length <= 0 || bytes.length > PROFILE_IMAGE_MAX_BYTES) {
    throw new Error('Profile picture must be 128 KB or smaller');
  }
  const mime = match[1];
  const validHeader =
    (mime === 'jpeg' &&
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (mime === 'png' &&
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a) ||
    (mime === 'webp' &&
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP');
  const dimensions = validHeader ? profileImageDimensions(mime, bytes) : null;
  if (
    !dimensions ||
    dimensions[0] <= 0 ||
    dimensions[1] <= 0 ||
    dimensions[0] > 4096 ||
    dimensions[1] > 4096 ||
    dimensions[0] * dimensions[1] > 16_777_216
  ) {
    throw new Error('Profile picture must be a JPEG, PNG, or WebP image');
  }
  return profileImage;
}

function validWrappedKeyringBox(
  value: unknown,
  context: 'password' | 'recovery'
): boolean {
  if (!value || typeof value !== 'object') return false;
  const box = value as Record<string, unknown>;
  return (
    box.alg === 'AES-256-GCM' &&
    box.kdf === 'sha256' &&
    box.context === context &&
    typeof box.iv === 'string' &&
    /^[A-Za-z0-9_-]{16}$/.test(box.iv) &&
    typeof box.ciphertext === 'string' &&
    /^[A-Za-z0-9_-]{22,}$/.test(box.ciphertext)
  );
}

function validE2eeKeyring(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return (
      parsed.version === 1 &&
      typeof parsed.activeKeyId === 'string' &&
      /^[A-Za-z0-9_-]{8,128}$/.test(parsed.activeKeyId) &&
      typeof parsed.wrappedAt === 'string' &&
      !Number.isNaN(Date.parse(parsed.wrappedAt)) &&
      validWrappedKeyringBox(parsed.passwordWrap, 'password') &&
      (parsed.recoveryWrap === undefined ||
        validWrappedKeyringBox(parsed.recoveryWrap, 'recovery'))
    );
  } catch {
    return false;
  }
}

function cleanE2eeKeyring(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (
    !trimmed ||
    textEncoder.encode(trimmed).byteLength > E2EE_KEYRING_MAX_BYTES ||
    !validE2eeKeyring(trimmed)
  ) {
    throw new Error('Invalid encrypted keyring');
  }
  return trimmed;
}

export function e2eeKeyringHash(
  value: string | null | undefined
): string | null {
  return value ? createHash('sha256').update(value).digest('base64url') : null;
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
  const label = encodeURIComponent(`author:${user.email ?? user.username}`);
  const issuer = encodeURIComponent('author');
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
  const verifier = parsePasswordVerifier(row);
  if (!verifier) return false;
  const candidate = await passwordVerifierFromPassword(
    password,
    verifier.salt,
    verifier.params
  );
  const candidateStoredKey = decodeBase64UrlStrict(candidate.storedKey);
  return Boolean(
    candidateStoredKey &&
    constantTimeEqual(candidateStoredKey, verifier.storedKey)
  );
}

function passwordHashFromVerifier(verifier: PasswordVerifier): {
  hash: string;
  salt: string;
} {
  const normalized = requirePasswordVerifier(verifier);
  return {
    hash: `${PASSWORD_VERIFIER_PREFIX}${authKdfParamsString(
      normalized.params
    )}:${normalized.storedKey}:${normalized.serverKey}`,
    salt: normalized.salt
  };
}

function requirePasswordVerifier(verifier: PasswordVerifier): PasswordVerifier {
  if (
    verifier?.algorithm !== AUTH_PROOF_ALGORITHM ||
    !authKdfParamsAreCurrent(verifier.params)
  ) {
    throw new Error('Unsupported password verifier');
  }
  const salt = decodeBase64UrlStrict(verifier.salt);
  const storedKey = decodeBase64UrlStrict(verifier.storedKey);
  const serverKey = decodeBase64UrlStrict(verifier.serverKey);
  if (
    !salt ||
    salt.length < 16 ||
    !storedKey ||
    storedKey.length !== PASSWORD_KEY_LENGTH ||
    !serverKey ||
    serverKey.length !== PASSWORD_KEY_LENGTH
  ) {
    throw new Error('Invalid password verifier');
  }
  return verifier;
}

function parsePasswordVerifier(row: UserRow): ParsedPasswordVerifier | null {
  if (!row.password_hash.startsWith(PASSWORD_VERIFIER_PREFIX)) return null;
  const payload = row.password_hash.slice(PASSWORD_VERIFIER_PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) return null;
  const [params, storedKeyValue, serverKeyValue] = parts;
  if (params !== authKdfParamsString(AUTH_PROOF_KDF_PARAMS)) return null;
  const storedKey = decodeBase64UrlStrict(storedKeyValue);
  const serverKey = decodeBase64UrlStrict(serverKeyValue);
  const salt = decodeBase64UrlStrict(row.password_salt);
  if (
    !storedKey ||
    storedKey.length !== PASSWORD_KEY_LENGTH ||
    !serverKey ||
    serverKey.length !== PASSWORD_KEY_LENGTH ||
    !salt ||
    salt.length < 16
  ) {
    return null;
  }
  return {
    params: AUTH_PROOF_KDF_PARAMS,
    storedKey,
    serverKey,
    salt: row.password_salt
  };
}

async function getUserRow(
  db: NotesExecutor,
  username: string
): Promise<UserRow | null> {
  const row = await get(
    db,
    `SELECT username, email, display_name, profile_image, password_hash, password_salt,
            e2ee_keyring,
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
    `SELECT username, email, display_name, profile_image, password_hash, password_salt,
            e2ee_keyring,
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

function cleanLoginIdentifier(login: string | null | undefined): string | null {
  return normalizeUsername(login) ?? normalizeEmail(login);
}

function fakeAuthSalt(identifier: string): string {
  const secret = getServerSecret() ?? 'local-dev';
  return digest(`author:auth-proof-fake-salt:v1\0${secret}\0${identifier}`)
    .subarray(0, 16)
    .toString('base64url');
}

function rowToAuthUser(row: UserRow): AuthUser {
  return {
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    profileImage: row.profile_image,
    twoFactorEnabled: Boolean(row.totp_secret && row.totp_enabled_at)
  };
}

export async function getUserE2eeKeyring(
  db: NotesExecutor,
  username: string
): Promise<string | null> {
  const row = await getUserRow(db, requireUsername(username));
  return row?.e2ee_keyring ?? null;
}

function authCredentialsChanged(
  existing: UserRow | null,
  next: UserRow
): boolean {
  return (
    !existing ||
    existing.password_hash !== next.password_hash ||
    existing.password_salt !== next.password_salt ||
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

export async function createAuthChallenge(
  db: NotesExecutor,
  login: string | null | undefined,
  purpose: AuthProofPurpose,
  clientNonce: string
): Promise<AuthChallengeResponse | null> {
  const username = cleanLoginIdentifier(login);
  const clientNonceBytes = decodeBase64UrlStrict(clientNonce);
  if (!username || !clientNonceBytes || clientNonceBytes.length < 16) {
    return null;
  }

  const row = await getUserRowByLogin(db, username);
  const verifier = row ? parsePasswordVerifier(row) : null;
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + AUTH_CHALLENGE_TTL_MS
  ).toISOString();
  const challengeId = randomBytes(24).toString('base64url');
  const serverNonce = randomBytes(32).toString('base64url');
  const bootstrapUsername = normalizeUsername(getLoginUsername());
  const bootstrapPassword = getLoginPassword();
  const mode =
    purpose === 'login' &&
    !row &&
    bootstrapUsername &&
    bootstrapPassword &&
    username === bootstrapUsername
      ? 'bootstrap'
      : 'proof';
  const salt = verifier?.salt ?? fakeAuthSalt(username);

  await run(db, 'DELETE FROM auth_challenges WHERE expires_at <= ?', [
    nowIso
  ]).catch(() => {});
  await run(
    db,
    `DELETE FROM auth_challenges
     WHERE username = ? AND purpose = ? AND created_at < ?`,
    [
      username,
      purpose,
      new Date(now.getTime() - AUTH_CHALLENGE_TTL_MS).toISOString()
    ]
  ).catch(() => {});
  await run(
    db,
    `INSERT INTO auth_challenges (
       id, username, purpose, client_nonce, server_nonce, created_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      challengeId,
      username,
      purpose,
      clientNonce,
      serverNonce,
      nowIso,
      expiresAt
    ]
  );
  await run(
    db,
    `DELETE FROM auth_challenges
     WHERE username = ? AND purpose = ? AND id NOT IN (
       SELECT id
       FROM auth_challenges
       WHERE username = ? AND purpose = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?
     )`,
    [username, purpose, username, purpose, MAX_AUTH_CHALLENGES_PER_USER_PURPOSE]
  ).catch(() => {});
  const count = Number(
    (await get(db, 'SELECT count(*) AS count FROM auth_challenges'))?.count ?? 0
  );
  if (count > MAX_AUTH_CHALLENGE_ROWS) {
    await run(
      db,
      `DELETE FROM auth_challenges
       WHERE id IN (
         SELECT id
         FROM auth_challenges
         ORDER BY created_at ASC
         LIMIT ?
       )`,
      [count - MAX_AUTH_CHALLENGE_ROWS]
    );
  }

  return {
    mode,
    challengeId,
    username,
    purpose,
    clientNonce,
    serverNonce,
    expiresAt,
    salt,
    params: verifier?.params ?? AUTH_PROOF_KDF_PARAMS
  };
}

export async function createSessionAuthChallenge(
  db: NotesExecutor,
  username: string,
  purpose: Exclude<AuthProofPurpose, 'login'>,
  clientNonce: string
): Promise<AuthChallengeResponse | null> {
  return await createAuthChallenge(db, username, purpose, clientNonce);
}

async function consumeAuthChallenge(
  db: NotesExecutor,
  proof: AuthProof | null | undefined,
  purpose: AuthProofPurpose
): Promise<AuthChallengeRow | null> {
  if (
    !proof ||
    typeof proof.challengeId !== 'string' ||
    typeof proof.clientNonce !== 'string' ||
    typeof proof.proof !== 'string'
  ) {
    return null;
  }
  const row = (await get(
    db,
    `SELECT id, username, purpose, client_nonce, server_nonce, created_at, expires_at
     FROM auth_challenges
     WHERE id = ?`,
    [proof.challengeId]
  )) as AuthChallengeRow | null;
  if (row) {
    await run(db, 'DELETE FROM auth_challenges WHERE id = ?', [
      proof.challengeId
    ]);
  }
  if (
    !row ||
    row.purpose !== purpose ||
    row.client_nonce !== proof.clientNonce ||
    row.expires_at <= new Date().toISOString()
  ) {
    return null;
  }
  return row;
}

async function verifyProofForRow(
  row: UserRow,
  challenge: AuthChallengeRow,
  proof: AuthProof
): Promise<string | null> {
  const verifier = parsePasswordVerifier(row);
  const proofBytes = decodeBase64UrlStrict(proof.proof);
  if (!verifier || !proofBytes || proofBytes.length !== PASSWORD_KEY_LENGTH) {
    return null;
  }
  const message = authProofMessage({
    challengeId: challenge.id,
    username: challenge.username,
    purpose: challenge.purpose,
    clientNonce: challenge.client_nonce,
    serverNonce: challenge.server_nonce,
    salt: verifier.salt,
    params: verifier.params
  });
  const clientSignature = hmacSha256(verifier.storedKey, message);
  const clientKey = xorBytes(proofBytes, clientSignature);
  if (!constantTimeEqual(digestBytes(clientKey), verifier.storedKey)) {
    return null;
  }
  return base64UrlEncode(hmacSha256(verifier.serverKey, message));
}

export async function authenticateUserProof(
  db: NotesExecutor,
  login: string | null | undefined,
  proof: AuthProof | null | undefined,
  totpCode?: string | null
): Promise<VerifiedAuthProof | null> {
  const challenge = await consumeAuthChallenge(db, proof, 'login');
  const requestedLogin = cleanLoginIdentifier(login);
  if (!challenge || (requestedLogin && requestedLogin !== challenge.username)) {
    return null;
  }
  const row = await getUserRowByLogin(db, challenge.username);
  if (!row) return null;
  const serverProof = await verifyProofForRow(row, challenge, proof!);
  if (!serverProof) return null;
  if (row.totp_secret && !(await verifyTotpCode(row.totp_secret, totpCode))) {
    return null;
  }
  return { user: rowToAuthUser(row), serverProof };
}

async function verifyUserProof(
  db: NotesExecutor,
  username: string,
  proof: AuthProof | null | undefined,
  purpose: Exclude<AuthProofPurpose, 'login'>
): Promise<UserRow | null> {
  const normalized = requireUsername(username);
  const challenge = await consumeAuthChallenge(db, proof, purpose);
  if (!challenge || challenge.username !== normalized) return null;
  const row = await getUserRow(db, normalized);
  if (!row) return null;
  return (await verifyProofForRow(row, challenge, proof!)) ? row : null;
}

export async function bootstrapUserWithVerifier(
  db: NotesExecutor,
  username: string | null | undefined,
  bootstrapPassword: string | null | undefined,
  verifier: PasswordVerifier | null | undefined
): Promise<AuthUser | null> {
  const normalized = normalizeUsername(username);
  const bootstrapUsername = normalizeUsername(getLoginUsername());
  const configuredPassword = getLoginPassword();
  if (
    !normalized ||
    !bootstrapUsername ||
    normalized !== bootstrapUsername ||
    typeof bootstrapPassword !== 'string' ||
    !configuredPassword ||
    !tokensMatch(bootstrapPassword, configuredPassword) ||
    !verifier ||
    (await getUserRow(db, normalized))
  ) {
    return null;
  }
  return await setUserPasswordVerifier(db, normalized, verifier);
}

export async function setUserPassword(
  db: NotesExecutor,
  username: string,
  password: string
): Promise<AuthUser> {
  const safePassword = requirePassword(password);
  return await setUserPasswordVerifier(
    db,
    username,
    await passwordVerifierFromPassword(safePassword)
  );
}

export async function setUserPasswordVerifier(
  db: NotesExecutor,
  username: string,
  verifier: PasswordVerifier,
  e2eeKeyring?: string | null
): Promise<AuthUser> {
  const normalized = requireUsername(username);
  const deletedAccount = await get(
    db,
    'SELECT 1 AS deleted FROM account_tombstones WHERE username = ?',
    [normalized]
  );
  if (deletedAccount && !(await getUserRow(db, normalized))) {
    throw new Error('Deleted usernames cannot be reused');
  }
  const now = new Date().toISOString();
  const passwordHash = passwordHashFromVerifier(verifier);
  const existing = await getUserRow(db, normalized);
  const nextE2eeKeyring =
    e2eeKeyring === undefined ? undefined : cleanE2eeKeyring(e2eeKeyring);
  if (existing?.e2ee_keyring && !nextE2eeKeyring) {
    throw new Error(
      'Password reset for an encrypted account requires a replacement encrypted keyring. Use the E2EE recovery flow.'
    );
  }

  await run(db, 'DELETE FROM auth_sessions WHERE username = ?', [normalized]);
  await run(db, 'DELETE FROM trusted_auth_devices WHERE username = ?', [
    normalized
  ]);
  await run(
    db,
    `INSERT INTO users (
	       username, email, display_name, password_hash, password_salt,
	       e2ee_keyring, totp_secret, totp_enabled_at, created_at, updated_at
	     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	     ON CONFLICT(username) DO UPDATE SET
	       password_hash = excluded.password_hash,
	       password_salt = excluded.password_salt,
	       e2ee_keyring = COALESCE(excluded.e2ee_keyring, users.e2ee_keyring),
	       updated_at = excluded.updated_at`,
    [
      normalized,
      null,
      null,
      passwordHash.hash,
      passwordHash.salt,
      nextE2eeKeyring ?? null,
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
    profileImage: null,
    twoFactorEnabled: false
  };
}

export async function createUserAccount(
  db: NotesExecutor,
  username: string,
  email: string,
  verifier: PasswordVerifier,
  displayName: string | null | undefined,
  e2eeKeyring?: string | null
): Promise<AuthUser | null> {
  const normalized = requireUsername(username);
  const normalizedEmail = requireEmail(email);
  if (
    (await getUserRow(db, normalized)) ||
    (await getUserRowByEmail(db, normalizedEmail)) ||
    (await get(
      db,
      'SELECT 1 AS deleted FROM account_tombstones WHERE username = ?',
      [normalized]
    ))
  ) {
    return null;
  }

  const now = new Date().toISOString();
  const passwordHash = passwordHashFromVerifier(verifier);
  const nextDisplayName = cleanDisplayName(displayName);
  const nextE2eeKeyring = cleanE2eeKeyring(e2eeKeyring);

  await run(
    db,
    `INSERT INTO users (
       username, email, display_name, password_hash, password_salt,
       e2ee_keyring, totp_secret, totp_enabled_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalized,
      normalizedEmail,
      nextDisplayName,
      passwordHash.hash,
      passwordHash.salt,
      nextE2eeKeyring,
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
    profileImage: null,
    twoFactorEnabled: false
  };
}

export async function createInvitedUserAccount(
  db: NotesDb,
  username: string,
  email: string,
  invitationCode: string,
  verifier: PasswordVerifier,
  displayName: string | null | undefined,
  e2eeKeyring?: string | null
): Promise<AuthUser | null> {
  return await withWriteTransaction(db, async (tx) => {
    if (
      !(await isSignupEmailAllowed(tx, email)) ||
      !signupInvitationIsValid(email, invitationCode)
    ) {
      return null;
    }
    const tokenHash = createHash('sha256')
      .update(invitationCode.trim())
      .digest('base64url');
    if (
      await get(
        tx,
        'SELECT 1 AS consumed FROM consumed_signup_invitations WHERE token_hash = ?',
        [tokenHash]
      )
    ) {
      return null;
    }
    const user = await createUserAccount(
      tx,
      username,
      email,
      verifier,
      displayName,
      e2eeKeyring
    );
    if (!user) return null;
    await run(
      tx,
      `INSERT INTO consumed_signup_invitations (token_hash, consumed_at)
       VALUES (?, ?)`,
      [tokenHash, new Date().toISOString()]
    );
    return user;
  });
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
	       username, email, display_name, profile_image, password_hash, password_salt,
	       e2ee_keyring, totp_secret, totp_enabled_at, created_at, updated_at
	     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	     ON CONFLICT(username) DO UPDATE SET
	       email = excluded.email,
	       display_name = excluded.display_name,
	       profile_image = excluded.profile_image,
	       password_hash = excluded.password_hash,
	       password_salt = excluded.password_salt,
	       e2ee_keyring = excluded.e2ee_keyring,
	       totp_secret = excluded.totp_secret,
       totp_enabled_at = excluded.totp_enabled_at,
       updated_at = excluded.updated_at`,
    [
      normalized,
      sourceUser.email,
      sourceUser.display_name,
      sourceUser.profile_image,
      sourceUser.password_hash,
      sourceUser.password_salt,
      sourceUser.e2ee_keyring,
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
    return rowToAuthUser(row);
  }

  return null;
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
     LEFT JOIN devices
       ON devices.id = trusted_auth_devices.device_id
      AND devices.owner_username = trusted_auth_devices.username
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
        profileImage: null,
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
            users.profile_image, users.totp_secret, users.totp_enabled_at,
            auth_sessions.device_id, last_seen_at, expires_at
     FROM auth_sessions
     LEFT JOIN users ON users.username = auth_sessions.username
     WHERE token_hash = ?`,
    [hash]
  )) as
    | (SessionRow & {
        email: string | null;
        display_name: string | null;
        profile_image: string | null;
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
      profileImage: row.profile_image,
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
  email?: string | null | undefined,
  e2eeKeyring?: string | null | undefined,
  profileImage?: string | null | undefined
): Promise<AuthUser> {
  const normalized = requireUsername(username);
  const nextDisplayName =
    displayName === undefined ? undefined : cleanDisplayName(displayName);
  const nextEmail =
    email === undefined
      ? undefined
      : email === null
        ? null
        : requireEmail(email);
  const nextE2eeKeyring =
    e2eeKeyring === undefined ? undefined : cleanE2eeKeyring(e2eeKeyring);
  const nextProfileImage =
    profileImage === undefined ? undefined : cleanProfileImage(profileImage);
  const updates: string[] = [];
  const args: (string | null)[] = [];
  if (nextEmail !== undefined) {
    updates.push('email = ?');
    args.push(nextEmail);
  }
  if (nextDisplayName !== undefined) {
    updates.push('display_name = ?');
    args.push(nextDisplayName);
  }
  if (nextE2eeKeyring !== undefined) {
    updates.push('e2ee_keyring = ?');
    args.push(nextE2eeKeyring);
  }
  if (nextProfileImage !== undefined) {
    updates.push('profile_image = ?');
    args.push(nextProfileImage);
  }
  if (updates.length > 0) {
    updates.push('updated_at = ?');
    args.push(new Date().toISOString(), normalized);
    await run(
      db,
      `UPDATE users SET ${updates.join(', ')} WHERE username = ?`,
      args
    );
  }
  const row = await getUserRow(db, normalized);
  if (!row) throw new Error('User not found');
  return rowToAuthUser(row);
}

export async function updateUserE2eeKeyring(
  db: NotesDb,
  username: string,
  proof: AuthProof | null | undefined,
  e2eeKeyring: string | null | undefined,
  expectedHash: string | null | undefined
): Promise<AuthUser | null> {
  if (typeof e2eeKeyring !== 'string' || !e2eeKeyring.trim()) return null;
  const normalized = requireUsername(username);
  return await withWriteTransaction(db, async (tx) => {
    const row = await verifyUserProof(tx, normalized, proof, 'keyring_update');
    if (!row || expectedHash !== e2eeKeyringHash(row.e2ee_keyring)) return null;
    const nextKeyring = cleanE2eeKeyring(e2eeKeyring);
    await run(
      tx,
      'UPDATE users SET e2ee_keyring = ?, updated_at = ? WHERE username = ?',
      [nextKeyring, new Date().toISOString(), normalized]
    );
    const updated = await getUserRow(tx, normalized);
    return updated ? rowToAuthUser(updated) : null;
  });
}

export async function changeUserPassword(
  db: NotesExecutor,
  username: string,
  proof: AuthProof | null | undefined,
  newVerifier: PasswordVerifier | null | undefined,
  e2eeKeyring?: string | null
): Promise<AuthUser | null> {
  const normalized = requireUsername(username);
  const row = await verifyUserProof(db, normalized, proof, 'password_change');
  if (!row || !newVerifier) return null;
  await setUserPasswordVerifier(db, normalized, newVerifier, e2eeKeyring);
  const updated = await getUserRow(db, normalized);
  return updated ? rowToAuthUser(updated) : null;
}

export async function enableUserTotp(
  db: NotesExecutor,
  username: string,
  proof: AuthProof | null | undefined,
  secret: string,
  totpCode: string
): Promise<AuthUser | null> {
  const normalized = requireUsername(username);
  const row = await verifyUserProof(db, normalized, proof, 'totp');
  const cleanSecret = cleanTotpSecret(secret);
  if (!row || !cleanSecret || !(await verifyTotpCode(cleanSecret, totpCode))) {
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
  proof: AuthProof | null | undefined,
  totpCode?: string | null
): Promise<AuthUser | null> {
  const normalized = requireUsername(username);
  const row = await verifyUserProof(db, normalized, proof, 'totp');
  if (!row) return null;
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
  proof: AuthProof | null | undefined
): Promise<boolean> {
  const normalized = requireUsername(username);
  return await withWriteTransaction(db, async (tx) => {
    const row = await verifyUserProof(tx, normalized, proof, 'delete_account');
    if (!row) return false;

    await run(
      tx,
      `INSERT INTO account_tombstones (username, deletion_id, deleted_at)
       VALUES (?, ?, ?)
       ON CONFLICT(username) DO NOTHING`,
      [
        normalized,
        randomBytes(16).toString('base64url'),
        new Date().toISOString()
      ]
    );
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
    await run(tx, 'DELETE FROM trusted_auth_devices WHERE username = ?', [
      normalized
    ]);
    await run(tx, 'DELETE FROM devices WHERE owner_username = ?', [normalized]);
    await run(tx, 'DELETE FROM users WHERE username = ?', [normalized]);

    return true;
  });
}

export async function pruneExpiredAuthState(
  db: NotesExecutor,
  now = new Date()
): Promise<void> {
  await run(db, 'DELETE FROM auth_sessions WHERE expires_at <= ?', [
    now.toISOString()
  ]);
  await run(db, 'DELETE FROM auth_challenges WHERE expires_at <= ?', [
    now.toISOString()
  ]);
  await run(db, 'DELETE FROM auth_rate_limits WHERE reset_at <= ?', [
    now.getTime()
  ]);
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
