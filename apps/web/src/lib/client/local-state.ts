import type { Device } from '@author/schema';
import { localDb } from './db';

const DEVICE_KEY = 'author-notes-device-id';
const TOKEN_KEY = 'author-notes-token';
const USERNAME_KEY = 'author-notes-username';
const THEME_KEY = 'author-notes-theme';

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
    name: navigator.userAgent.includes('Android') ? 'Android browser' : 'This browser'
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
}

export function getUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY);
}

export function setUsername(username: string): void {
  localStorage.setItem(USERNAME_KEY, username);
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
