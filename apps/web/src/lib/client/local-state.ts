import type { Device } from '@author/schema';
import { localDb } from './db';
import { clearStoredEncryptionKeyMaterial } from './encryption';

const DEVICE_KEY = 'author-notes-device-id';
const TOKEN_KEY = 'author-notes-token';
const USERNAME_KEY = 'author-notes-username';
const LAST_USERNAME_KEY = 'author-notes-last-username';
const DISPLAY_NAME_KEY = 'author-notes-display-name';
const SESSION_EXPIRES_KEY = 'author-notes-session-expires-at';
const THEME_KEY = 'author-notes-theme';

export interface StoredAuthUser {
  username: string;
  displayName: string | null;
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

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_EXPIRES_KEY);
}

export function getStoredSession(): StoredSession | null {
  const token = getToken();
  if (!token) return null;

  return {
    token,
    user: {
      username: getUsername() ?? '',
      displayName: getDisplayName()
    },
    expiresAt: localStorage.getItem(SESSION_EXPIRES_KEY)
  };
}

export function setStoredSession(session: StoredSession): void {
  setToken(session.token);
  setUsername(session.user.username);
  setDisplayName(session.user.displayName);
  if (session.expiresAt) {
    localStorage.setItem(SESSION_EXPIRES_KEY, session.expiresAt);
  } else {
    localStorage.removeItem(SESSION_EXPIRES_KEY);
  }
}

export function clearStoredSession(): void {
  clearToken();
  clearUsername();
  clearStoredEncryptionKeyMaterial();
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
  localStorage.removeItem(DISPLAY_NAME_KEY);
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

export function setDisplayName(displayName: string | null): void {
  if (displayName?.trim()) {
    localStorage.setItem(DISPLAY_NAME_KEY, displayName);
  } else {
    localStorage.removeItem(DISPLAY_NAME_KEY);
  }
}

export function getTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme: 'light' | 'dark'): void {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.dataset.theme = theme;
}
