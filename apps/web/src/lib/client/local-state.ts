import type { Device } from '@author/schema';
import { localDb } from './db';
import { clearStoredEncryptionKeyMaterial } from './encryption';

const DEVICE_KEY = 'author-device-id';
const DEVICE_TRUST_SECRET_KEY = 'author-device-trust-secret-v1';
const TOKEN_KEY = 'author-token';
const SESSION_TOKEN_KEY = 'author-session-token';
const USERNAME_KEY = 'author-username';
const LAST_USERNAME_KEY = 'author-last-username';
const EMAIL_KEY = 'author-email';
const DISPLAY_NAME_KEY = 'author-display-name';
const TWO_FACTOR_KEY = 'author-two-factor-enabled';
const SESSION_EXPIRES_KEY = 'author-session-expires-at';
const THEME_KEY = 'author-theme';
export const COOKIE_SESSION_TOKEN = '__author_cookie_session__';

let volatileToken: string | null = null;

export type StoredTheme =
  | 'system'
  | 'light'
  | 'light-mint'
  | 'light-rose'
  | 'light-lavender'
  | 'dark'
  | 'dark-mint'
  | 'dark-rose'
  | 'dark-lavender';

export type ResolvedTheme = Exclude<StoredTheme, 'system'>;

const THEME_VALUES = new Set<string>([
  'system',
  'light',
  'light-mint',
  'light-rose',
  'light-lavender',
  'dark',
  'dark-mint',
  'dark-rose',
  'dark-lavender'
]);
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

export interface StoredAuthUser {
  username: string;
  email?: string | null;
  displayName: string | null;
  twoFactorEnabled?: boolean;
}

export interface StoredSession {
  token: string;
  user: StoredAuthUser;
  expiresAt: string | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return [...values]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function getOrCreateDeviceTrustSecret(): string {
  const existing = localStorage.getItem(DEVICE_TRUST_SECRET_KEY)?.trim();
  if (existing && existing.length >= 32) return existing;

  const secret = randomHex(32);
  localStorage.setItem(DEVICE_TRUST_SECRET_KEY, secret);
  return secret;
}

export async function getOrCreateDevice(): Promise<Device> {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = newId();
    localStorage.setItem(DEVICE_KEY, id);
  }

  const existing = await localDb.devices.get(id);
  if (existing) return existing;

  const device: Device = {
    id,
    name: navigator.userAgent.includes('Android')
      ? 'Android browser'
      : 'This browser'
  };
  await localDb.devices.put(device);
  return device;
}

export async function renameCurrentDevice(name: string): Promise<Device> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Device name required');

  const current = await getOrCreateDevice();
  const device: Device = {
    ...current,
    name: trimmedName.slice(0, 80)
  };
  await localDb.devices.put(device);
  return device;
}

export function getToken(): string | null {
  if (volatileToken) return volatileToken;

  const sessionToken = sessionStorageSafe()?.getItem(SESSION_TOKEN_KEY);
  if (sessionToken) {
    volatileToken = sessionToken;
    return sessionToken;
  }

  const legacyToken = localStorage.getItem(TOKEN_KEY);
  if (legacyToken) {
    localStorage.removeItem(TOKEN_KEY);
    volatileToken = legacyToken;
    sessionStorageSafe()?.setItem(SESSION_TOKEN_KEY, legacyToken);
    return legacyToken;
  }

  return hasStoredSessionMetadata() ? COOKIE_SESSION_TOKEN : null;
}

export function setToken(token: string): void {
  volatileToken = token;
  localStorage.removeItem(TOKEN_KEY);
  sessionStorageSafe()?.removeItem(SESSION_TOKEN_KEY);
}

export function clearToken(): void {
  volatileToken = null;
  localStorage.removeItem(TOKEN_KEY);
  sessionStorageSafe()?.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_EXPIRES_KEY);
}

export function getStoredSession(): StoredSession | null {
  const token = getToken();
  if (!token) return null;
  const username = getUsername()?.trim();
  if (!username) return null;

  return {
    token,
    user: {
      username,
      email: getEmail(),
      displayName: getDisplayName(),
      twoFactorEnabled: getTwoFactorEnabled()
    },
    expiresAt: localStorage.getItem(SESSION_EXPIRES_KEY)
  };
}

export function setStoredSession(session: StoredSession): void {
  setToken(session.token);
  setUsername(session.user.username);
  setEmail(session.user.email ?? null);
  setDisplayName(session.user.displayName);
  setTwoFactorEnabled(Boolean(session.user.twoFactorEnabled));
  if (session.expiresAt) {
    localStorage.setItem(SESSION_EXPIRES_KEY, session.expiresAt);
  } else {
    localStorage.removeItem(SESSION_EXPIRES_KEY);
  }
}

export function clearStoredSession({
  clearEncryptionKeyMaterial = false
}: { clearEncryptionKeyMaterial?: boolean } = {}): void {
  clearToken();
  clearUsername();
  if (clearEncryptionKeyMaterial) clearStoredEncryptionKeyMaterial();
}

function sessionStorageSafe(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function hasStoredSessionMetadata(): boolean {
  return Boolean(localStorage.getItem(USERNAME_KEY));
}

export function getUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY);
}

export function setUsername(username: string): void {
  localStorage.setItem(USERNAME_KEY, username);
  localStorage.setItem(LAST_USERNAME_KEY, username);
}

export function clearUsername(): void {
  localStorage.removeItem(USERNAME_KEY);
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem(DISPLAY_NAME_KEY);
  localStorage.removeItem(TWO_FACTOR_KEY);
}

export function getLoginHint(): string {
  return (
    localStorage.getItem(USERNAME_KEY) ??
    localStorage.getItem(LAST_USERNAME_KEY) ??
    ''
  );
}

export function getDisplayName(): string | null {
  return localStorage.getItem(DISPLAY_NAME_KEY);
}

export function getEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY);
}

export function setEmail(email: string | null): void {
  if (email?.trim()) {
    localStorage.setItem(EMAIL_KEY, email);
  } else {
    localStorage.removeItem(EMAIL_KEY);
  }
}

export function getTwoFactorEnabled(): boolean {
  return localStorage.getItem(TWO_FACTOR_KEY) === 'true';
}

export function setTwoFactorEnabled(enabled: boolean): void {
  if (enabled) {
    localStorage.setItem(TWO_FACTOR_KEY, 'true');
  } else {
    localStorage.removeItem(TWO_FACTOR_KEY);
  }
}

export function setDisplayName(displayName: string | null): void {
  if (displayName?.trim()) {
    localStorage.setItem(DISPLAY_NAME_KEY, displayName);
  } else {
    localStorage.removeItem(DISPLAY_NAME_KEY);
  }
}

function isStoredTheme(value: string | null): value is StoredTheme {
  return value !== null && THEME_VALUES.has(value);
}

function systemTheme(): ResolvedTheme {
  if (typeof matchMedia !== 'function') return 'light';
  return matchMedia(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(theme: StoredTheme): ResolvedTheme {
  return theme === 'system' ? systemTheme() : theme;
}

function applyTheme(theme: StoredTheme): ResolvedTheme {
  const resolvedTheme = resolveTheme(theme);
  document.documentElement.dataset.theme = resolvedTheme;
  document
    .querySelector?.('meta[name="theme-color"]')
    ?.setAttribute(
      'content',
      resolvedTheme.startsWith('dark') ? '#111111' : '#f8f7f3'
    );
  return resolvedTheme;
}

export function getTheme(): StoredTheme {
  const stored = localStorage.getItem(THEME_KEY);
  return isStoredTheme(stored) ? stored : 'system';
}

export function setTheme(theme: StoredTheme): ResolvedTheme {
  const storedTheme = isStoredTheme(theme) ? theme : 'system';
  localStorage.setItem(THEME_KEY, storedTheme);
  return applyTheme(storedTheme);
}

export function watchSystemTheme(
  callback: (theme: ResolvedTheme) => void
): () => void {
  if (typeof matchMedia !== 'function') return () => {};

  const media = matchMedia(SYSTEM_DARK_QUERY);
  const listener = () => {
    if (getTheme() !== 'system') return;
    callback(applyTheme('system'));
  };

  media.addEventListener?.('change', listener);
  return () => media.removeEventListener?.('change', listener);
}
