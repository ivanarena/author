import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const WORKER_SECRET_KEYS = [
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'NOTES_LOGIN_PASSWORD',
  'NOTES_SERVER_SECRET',
  'NOTES_AUTH_SESSION_DAYS',
  'NOTES_SIGNUP_ALLOWED_EMAILS',
  'NOTES_METRICS_TOKEN',
  'AUTHOR_API_URL',
  'NOTES_RECORD_LIMITS_ENABLED',
  'NOTES_RECORD_LIMIT_STORAGE_BYTES',
  'NOTES_RECORD_LIMIT_SAFETY_RATIO',
  'NOTES_RECORD_LIMIT_NOTE_BYTES',
  'NOTES_RECORD_LIMIT_NOTEBOOK_BYTES'
] as const;

const REQUIRED_WORKER_KEYS = [
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'NOTES_LOGIN_PASSWORD',
  'NOTES_SERVER_SECRET'
] as const;

const STAGING_REQUIRED_WORKER_KEYS = [
  ...REQUIRED_WORKER_KEYS,
  'AUTHOR_API_URL'
] as const;

const STAGING_ENV_MAP = {
  TURSO_DATABASE_URL: ['STAGING_TURSO_DATABASE_URL'],
  TURSO_AUTH_TOKEN: ['STAGING_TURSO_AUTH_TOKEN'],
  NOTES_LOGIN_PASSWORD: ['STAGING_NOTES_LOGIN_PASSWORD'],
  NOTES_SERVER_SECRET: ['STAGING_NOTES_SERVER_SECRET'],
  NOTES_AUTH_SESSION_DAYS: ['STAGING_NOTES_AUTH_SESSION_DAYS'],
  NOTES_SIGNUP_ALLOWED_EMAILS: ['STAGING_NOTES_SIGNUP_ALLOWED_EMAILS'],
  NOTES_METRICS_TOKEN: ['STAGING_NOTES_METRICS_TOKEN'],
  AUTHOR_API_URL: ['STAGING_AUTHOR_API_URL'],
  NOTES_RECORD_LIMITS_ENABLED: ['STAGING_NOTES_RECORD_LIMITS_ENABLED'],
  NOTES_RECORD_LIMIT_STORAGE_BYTES: [
    'STAGING_NOTES_RECORD_LIMIT_STORAGE_BYTES'
  ],
  NOTES_RECORD_LIMIT_SAFETY_RATIO: ['STAGING_NOTES_RECORD_LIMIT_SAFETY_RATIO'],
  NOTES_RECORD_LIMIT_NOTE_BYTES: ['STAGING_NOTES_RECORD_LIMIT_NOTE_BYTES'],
  NOTES_RECORD_LIMIT_NOTEBOOK_BYTES: [
    'STAGING_NOTES_RECORD_LIMIT_NOTEBOOK_BYTES'
  ]
} satisfies Record<(typeof WORKER_SECRET_KEYS)[number], readonly string[]>;

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};

  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.replace(/^export\s+/, '');
    const separator = normalized.indexOf('=');
    if (separator <= 0) continue;

    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function envValue(
  env: Record<string, string | undefined>,
  ...keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function productionSecretValues(
  env: Record<string, string | undefined>
): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const key of WORKER_SECRET_KEYS) {
    const value = envValue(env, key);
    if (value) secrets[key] = value;
  }
  return secrets;
}

function stagingSecretValues(
  env: Record<string, string | undefined>
): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const [workerKey, stagingKeys] of Object.entries(STAGING_ENV_MAP)) {
    const value = envValue(env, ...stagingKeys);
    if (value) secrets[workerKey] = value;
  }

  if (!secrets.NOTES_SIGNUP_ALLOWED_EMAILS) {
    const username =
      envValue(env, 'AUTHOR_REMOTE_TEST_USERNAME') ?? 'author-remote-test';
    secrets.NOTES_SIGNUP_ALLOWED_EMAILS =
      envValue(env, 'AUTHOR_REMOTE_TEST_EMAIL') ??
      `${username}@example.invalid`;
  }

  return secrets;
}

const repoRoot = resolve(import.meta.dirname, '../../..');
const webRoot = resolve(repoRoot, 'apps/web');
const rootEnvPath = resolve(repoRoot, '.env');
const dryRun = process.argv.includes('--dry-run');
const staging = process.argv.includes('--staging');
const fileEnv = parseEnvFile(rootEnvPath);
const combinedEnv = { ...fileEnv, ...process.env };
const allowShellProductionSecrets =
  envValue(combinedEnv, 'AUTHOR_ALLOW_SHELL_PRODUCTION_SECRETS') === 'true';
const productionEnv =
  fileEnv.AUTHOR_DEPLOY_TARGET?.trim() === 'production' &&
  !allowShellProductionSecrets
    ? { ...process.env, ...fileEnv }
    : process.env;
const workerName = staging
  ? (envValue(
      combinedEnv,
      'STAGING_CLOUDFLARE_WORKER_NAME',
      'AUTHOR_REMOTE_TEST_WORKER_NAME'
    ) ?? 'author-staging')
  : 'author';
const secrets = staging
  ? stagingSecretValues(combinedEnv)
  : productionSecretValues(productionEnv);
const requiredKeys = staging
  ? STAGING_REQUIRED_WORKER_KEYS
  : REQUIRED_WORKER_KEYS;
const missing = requiredKeys.filter((key) => !secrets[key]);

if (!staging) {
  if (envValue(combinedEnv, 'AUTHOR_DEPLOY_TARGET') !== 'production') {
    throw new Error(
      'Production Worker secret upload requires AUTHOR_DEPLOY_TARGET=production in the ignored root .env or current shell.'
    );
  }

  if (!allowShellProductionSecrets) {
    const shellOnlyKeys = REQUIRED_WORKER_KEYS.filter(
      (key) => !fileEnv[key]?.trim() && process.env[key]?.trim()
    );
    if (shellOnlyKeys.length) {
      throw new Error(
        `Production Worker secret upload found required values only in the inherited shell environment: ${shellOnlyKeys.join(', ')}. Put production deploy secrets in the ignored root .env or set AUTHOR_ALLOW_SHELL_PRODUCTION_SECRETS=true for an intentional one-off deploy.`
      );
    }
  }
}

if (missing.length) {
  throw new Error(
    `Missing required ${staging ? 'staging ' : ''}Worker secret values: ${missing.join(', ')}`
  );
}

const keys = Object.keys(secrets).sort();
if (dryRun) {
  console.log(
    `Would upload Worker secrets to ${workerName}: ${keys.join(', ')}`
  );
  process.exit(0);
}

console.log(`Uploading Worker secrets to ${workerName}: ${keys.join(', ')}`);
const args = ['exec', 'wrangler', 'secret', 'bulk'];
if (staging) {
  args.push('--name', workerName);
}

const result = spawnSync('aube', args, {
  cwd: webRoot,
  input: JSON.stringify(secrets),
  stdio: ['pipe', 'inherit', 'inherit']
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
