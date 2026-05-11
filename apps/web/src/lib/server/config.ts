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

export type RuntimeEnv = Partial<Record<string, string>>;

let runtimeEnv: RuntimeEnv | null = null;

export function setRuntimeEnv(env: RuntimeEnv | null | undefined): void {
  runtimeEnv = env ?? null;
}

function envValue(name: string, env?: RuntimeEnv | null): string | undefined {
  return env?.[name] ?? runtimeEnv?.[name] ?? process.env[name];
}

function dataRootIsWritable(): boolean {
  return process.env.NODE_ENV === 'production';
}

function normalizePath(path: string): string {
  const absolute = path.startsWith('/')
    ? path
    : `${process.cwd().replace(/\/$/, '')}/${path}`;
  const parts: string[] = [];
  for (const part of absolute.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join('/')}`;
}

export function resolveDatabasePath(
  configuredPath: string,
  canWriteDataRoot = dataRootIsWritable()
): string {
  if (configuredPath.startsWith('/data/') && !canWriteDataRoot) {
    return normalizePath(`.data/${configuredPath.slice('/data/'.length)}`);
  }

  return normalizePath(configuredPath);
}

export function getDatabasePath(env?: RuntimeEnv | null): string {
  return resolveDatabasePath(
    envValue('NOTES_DB_PATH', env) ?? '.data/notes.sqlite'
  );
}

export function getLocalDatabaseConfig(): Extract<
  DatabaseConfig,
  { provider: 'local' }
> {
  const filePath = getDatabasePath();
  return {
    provider: 'local',
    filePath,
    client: { url: `file:${normalizePath(filePath)}` }
  };
}

export function getRemoteDatabaseConfig(
  env?: RuntimeEnv | null
): Extract<DatabaseConfig, { provider: 'turso' }> | null {
  const url = envValue('TURSO_DATABASE_URL', env);
  const authToken = envValue('TURSO_AUTH_TOKEN', env);
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

export function shouldSyncRemoteDatabase(env?: RuntimeEnv | null): boolean {
  if (envValue('NOTES_REMOTE_SYNC_ENABLED', env) === 'false') return false;
  return Boolean(getRemoteDatabaseConfig(env));
}

export function getSignupInviteCodes(env?: RuntimeEnv | null): string[] {
  return (envValue('NOTES_SIGNUP_INVITE_CODES', env) ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
}

export function getPublicApiBaseUrl(env?: RuntimeEnv | null): string | null {
  const value =
    envValue('AUTHOR_NOTES_API_URL', env) ??
    envValue('AUTHOR_NOTES_SYNC_API_URL', env) ??
    envValue('ANDROID_SYNC_API_URL', env) ??
    envValue('ANDROID_SYNC_SERVER_URL', env) ??
    envValue('NOTES_SYNC_SERVER_URL', env);
  const trimmed = value?.trim();
  return trimmed || null;
}

export function getLegacyAuthToken(): string | null {
  if (envValue('NOTES_LEGACY_AUTH_TOKEN_ENABLED') !== 'true') return null;

  const token = envValue('NOTES_AUTH_TOKEN')?.trim();
  return token || null;
}

export function getLoginUsername(): string {
  return envValue('NOTES_LOGIN_USERNAME') ?? 'owner';
}

export function getLoginPassword(): string | null {
  const password = envValue('NOTES_LOGIN_PASSWORD');
  if (password !== undefined) return password.trim() ? password : null;
  return envValue('NODE_ENV') === 'production' ? null : 'local-dev-password';
}

export function getAuthSessionDays(): number {
  const days = Number(envValue('NOTES_AUTH_SESSION_DAYS') ?? '90');
  return Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : 90;
}

export function shouldTrustProxyHeaders(): boolean {
  return envValue('NOTES_TRUST_PROXY_HEADERS') === 'true';
}

export function isCleanupSchedulerEnabled(): boolean {
  return envValue('NOTES_CLEANUP_ENABLED') === 'true';
}

export function shouldRunCleanupOnStart(): boolean {
  return envValue('NOTES_CLEANUP_RUN_ON_START') !== 'false';
}

export function getCleanupIntervalMs(): number {
  const minutes = Number(envValue('NOTES_CLEANUP_INTERVAL_MINUTES') ?? '1440');
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 1440;
  return safeMinutes * 60 * 1000;
}
