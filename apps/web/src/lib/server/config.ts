import { resolve } from 'node:path';

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

export function getDatabasePath(): string {
  return resolve(process.env.NOTES_DB_PATH ?? '.data/notes.sqlite');
}

export function getDatabaseConfig(): DatabaseConfig {
  const provider = process.env.NOTES_DB_PROVIDER ?? 'local';

  if (provider === 'turso') {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken) {
      throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required when NOTES_DB_PROVIDER=turso');
    }

    return {
      provider: 'turso',
      client: { url, authToken }
    };
  }

  if (provider !== 'local') {
    throw new Error(`Unsupported NOTES_DB_PROVIDER "${provider}"`);
  }

  const filePath = getDatabasePath();
  return {
    provider: 'local',
    filePath,
    client: { url: `file:${resolve(filePath)}` }
  };
}

export function getAuthToken(): string {
  return process.env.NOTES_AUTH_TOKEN ?? 'local-dev-token';
}

export function getLoginPassword(): string {
  return process.env.NOTES_LOGIN_PASSWORD ?? 'local-dev-password';
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
