import { accessSync, constants } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

export type DatabaseConfig =
  | {
      provider: 'local';
      filePath: string;
      client: { url: string };
    }
  | {
      provider: 'turso';
      client: { url: string; authToken: string };
    };

function dataRootIsWritable(): boolean {
  try {
    accessSync('/data', constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveDatabasePath(
  configuredPath: string,
  canWriteDataRoot = dataRootIsWritable()
): string {
  if (configuredPath.startsWith('/data/') && !canWriteDataRoot) {
    return resolvePath('.data', configuredPath.slice('/data/'.length));
  }

  return resolvePath(configuredPath);
}

export function getDatabasePath(): string {
  return resolveDatabasePath(process.env.NOTES_DB_PATH ?? '.data/notes.sqlite');
}

export function getLocalDatabaseConfig(): Extract<
  DatabaseConfig,
  { provider: 'local' }
> {
  const filePath = getDatabasePath();
  return {
    provider: 'local',
    filePath,
    client: { url: `file:${resolvePath(filePath)}` }
  };
}

export function getRemoteDatabaseConfig(): Extract<
  DatabaseConfig,
  { provider: 'turso' }
> | null {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return null;

  return {
    provider: 'turso',
    client: { url, authToken }
  };
}

export function getDatabaseConfig(): DatabaseConfig {
  // Backward-compatible name for callers that need the primary server DB.
  // The primary DB is always local SQLite; Turso is an optional sync peer.
  return getLocalDatabaseConfig();
}

export function shouldSyncRemoteDatabase(): boolean {
  if (process.env.NOTES_REMOTE_SYNC_ENABLED === 'false') return false;
  return Boolean(getRemoteDatabaseConfig());
}

export function getPublicApiBaseUrl(): string | null {
  const value =
    process.env.AUTHOR_NOTES_API_URL ??
    process.env.AUTHOR_NOTES_SYNC_API_URL ??
    process.env.ANDROID_SYNC_API_URL ??
    process.env.ANDROID_SYNC_SERVER_URL ??
    process.env.NOTES_SYNC_SERVER_URL;
  const trimmed = value?.trim();
  return trimmed || null;
}

export function getLegacyAuthToken(): string | null {
  if (process.env.NOTES_LEGACY_AUTH_TOKEN_ENABLED !== 'true') return null;

  const token = process.env.NOTES_AUTH_TOKEN?.trim();
  return token || null;
}

export function getLoginUsername(): string {
  return process.env.NOTES_LOGIN_USERNAME ?? 'owner';
}

export function getLoginPassword(): string | null {
  const password = process.env.NOTES_LOGIN_PASSWORD;
  if (password !== undefined) return password.trim() ? password : null;
  return process.env.NODE_ENV === 'production' ? null : 'local-dev-password';
}

export function getAuthSessionDays(): number {
  const days = Number(process.env.NOTES_AUTH_SESSION_DAYS ?? '90');
  return Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : 90;
}

export function shouldTrustProxyHeaders(): boolean {
  return process.env.NOTES_TRUST_PROXY_HEADERS === 'true';
}

export function isCleanupSchedulerEnabled(): boolean {
  return process.env.NOTES_CLEANUP_ENABLED !== 'false';
}

export function shouldRunCleanupOnStart(): boolean {
  return process.env.NOTES_CLEANUP_RUN_ON_START !== 'false';
}

export function getCleanupIntervalMs(): number {
  const minutes = Number(process.env.NOTES_CLEANUP_INTERVAL_MINUTES ?? '1440');
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 1440;
  return safeMinutes * 60 * 1000;
}
