export interface RemoteTestTarget {
  apiUrl: string | null;
  databaseUrl: string;
  authToken: string;
  username: string;
  password: string;
  email: string;
  allowNonTestTarget: boolean;
}

export interface RemoteTestTargetOptions {
  requireApiUrl?: boolean;
}

const SAFE_TARGET_PATTERN =
  /(^|[-_.:/])(ci|dev|preview|smoke|stage|staging|test)([-_.:/]|$)/i;

function envValue(
  env: Partial<Record<string, string | undefined>>,
  ...names: string[]
): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function defaultEmail(username: string): string {
  return `${username}@example.invalid`;
}

export function remoteTestTargetFromEnv(
  env: Partial<Record<string, string | undefined>> = process.env,
  options: RemoteTestTargetOptions = {}
): RemoteTestTarget {
  const apiUrl = envValue(
    env,
    'AUTHOR_REMOTE_TEST_API_URL',
    'STAGING_AUTHOR_API_URL'
  );
  const databaseUrl = envValue(
    env,
    'AUTHOR_REMOTE_TEST_DATABASE_URL',
    'STAGING_TURSO_DATABASE_URL',
    'TURSO_DATABASE_URL'
  );
  const authToken = envValue(
    env,
    'AUTHOR_REMOTE_TEST_AUTH_TOKEN',
    'STAGING_TURSO_AUTH_TOKEN',
    'TURSO_AUTH_TOKEN'
  );
  const username =
    envValue(env, 'AUTHOR_REMOTE_TEST_USERNAME') ?? 'author-remote-test';
  const password = envValue(
    env,
    'AUTHOR_REMOTE_TEST_PASSWORD',
    'STAGING_AUTHOR_REMOTE_TEST_PASSWORD'
  );
  const email =
    envValue(env, 'AUTHOR_REMOTE_TEST_EMAIL') ?? defaultEmail(username);

  const missing = [
    options.requireApiUrl && !apiUrl ? 'AUTHOR_REMOTE_TEST_API_URL' : null,
    !databaseUrl ? 'AUTHOR_REMOTE_TEST_DATABASE_URL' : null,
    !authToken ? 'AUTHOR_REMOTE_TEST_AUTH_TOKEN' : null,
    !password ? 'AUTHOR_REMOTE_TEST_PASSWORD' : null
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing remote test configuration: ${missing.join(', ')}`);
  }

  return {
    apiUrl,
    databaseUrl: databaseUrl!,
    authToken: authToken!,
    username,
    password: password!,
    email,
    allowNonTestTarget:
      envValue(env, 'AUTHOR_REMOTE_TEST_ALLOW_NON_TEST_TARGET') === 'true'
  };
}

export function assertSafeRemoteTestTarget(target: RemoteTestTarget): void {
  if (target.allowNonTestTarget) return;

  const unsafeTargets = [target.apiUrl, target.databaseUrl]
    .filter((value): value is string => Boolean(value))
    .filter((value) => !SAFE_TARGET_PATTERN.test(value));
  if (unsafeTargets.length > 0) {
    throw new Error(
      'Remote test target must look like a test/staging target. Set AUTHOR_REMOTE_TEST_ALLOW_NON_TEST_TARGET=true only for an intentionally isolated non-production database.'
    );
  }

  if (!/^author[-_.]remote[-_.]test([-._a-z0-9]*)?$/i.test(target.username)) {
    throw new Error(
      'AUTHOR_REMOTE_TEST_USERNAME must be a dedicated author-remote-test account'
    );
  }
}

export function remoteTestWorkerName(
  env: Partial<Record<string, string | undefined>> = process.env
): string {
  return (
    envValue(
      env,
      'AUTHOR_REMOTE_TEST_WORKER_NAME',
      'STAGING_CLOUDFLARE_WORKER_NAME'
    ) ?? 'author-staging'
  );
}
