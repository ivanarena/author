import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SECRET_KEYS = [
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

const REQUIRED_KEYS = [
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'NOTES_LOGIN_PASSWORD',
  'NOTES_SERVER_SECRET'
] as const;

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

function secretValues(rootEnvPath: string): Record<string, string> {
  const fileEnv = parseEnvFile(rootEnvPath);
  const secrets: Record<string, string> = {};
  for (const key of SECRET_KEYS) {
    const value = process.env[key] ?? fileEnv[key];
    if (value?.trim()) secrets[key] = value;
  }
  return secrets;
}

const repoRoot = resolve(import.meta.dirname, '../../..');
const webRoot = resolve(repoRoot, 'apps/web');
const rootEnvPath = resolve(repoRoot, '.env');
const dryRun = process.argv.includes('--dry-run');
const secrets = secretValues(rootEnvPath);
const missing = REQUIRED_KEYS.filter((key) => !secrets[key]);

if (missing.length) {
  throw new Error(
    `Missing required Worker secret values: ${missing.join(', ')}`
  );
}

const keys = Object.keys(secrets).sort();
if (dryRun) {
  console.log(`Would upload Worker secrets: ${keys.join(', ')}`);
  process.exit(0);
}

console.log(`Uploading Worker secrets: ${keys.join(', ')}`);
const result = spawnSync('aube', ['exec', 'wrangler', 'secret', 'bulk'], {
  cwd: webRoot,
  input: JSON.stringify(secrets),
  stdio: ['pipe', 'inherit', 'inherit']
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
