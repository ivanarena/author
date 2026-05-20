import type { Device } from '@author/schema';
import { localDb } from './db';
import { clearStoredEncryptionKeyMaterial } from './encryption';

const DEVICE_KEY = 'author-device-id';
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
  | 'light'
  | 'light-mint'
  | 'light-rose'
  | 'light-lavender'
  | 'dark'
  | 'dark-mint'
  | 'dark-rose'
  | 'dark-lavender';

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

  return {
    token,
    user: {
      username: getUsername() ?? '',
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

export function getTheme(): StoredTheme {
  const stored = localStorage.getItem(THEME_KEY);
  if (
    stored === 'light' ||
    stored === 'light-mint' ||
    stored === 'light-rose' ||
    stored === 'light-lavender' ||
    stored === 'dark' ||
    stored === 'dark-mint' ||
    stored === 'dark-rose' ||
    stored === 'dark-lavender'
  ) {
    return stored;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme: StoredTheme): void {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.dataset.theme = theme;
}
