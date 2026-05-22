import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createClient } from '@libsql/client';
import {
  getLocalDatabaseConfig,
  getRemoteDatabaseConfig,
  shouldSyncRemoteDatabase
} from '../src/lib/server/config';
import {
  all,
  initializeDatabase,
  run,
  withWriteTransaction,
  type NotesDb,
  type NotesExecutor
} from '../src/lib/server/db';
import {
  deleteNotesByIds,
  deleteNotebooksByIds
} from '../src/lib/server/repository';

type CleanupTarget = 'local' | 'remote' | 'both';

type Row = Record<string, unknown>;

type EntityRow = {
  id: string;
  ownerUsername: string;
};

const OLD_NOTE_FIELDS =
  "title LIKE 'enc:v1:%' OR title LIKE 'enc:v2:%' OR body LIKE 'enc:v1:%' OR body LIKE 'enc:v2:%'";
const OLD_NOTEBOOK_FIELDS = "name LIKE 'enc:v1:%' OR name LIKE 'enc:v2:%'";
const BACKUP_TABLES = [
  'users',
  'auth_sessions',
  'trusted_auth_devices',
  'devices',
  'notes',
  'notebooks',
  'note_versions',
  'notebook_versions',
  'entity_changes',
  'entity_tombstones',
  'schema_migrations',
  'sync_meta',
  'invitation_codes',
  'signup_allowed_emails',
  'auth_rate_limits'
];

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const targetArg = process.argv
  .slice(2)
  .find((arg) => arg.startsWith('--target='))
  ?.slice('--target='.length) as CleanupTarget | undefined;
const target: CleanupTarget = targetArg ?? 'local';

if (!['local', 'remote', 'both'].includes(target)) {
  throw new Error('--target must be local, remote, or both');
}

function backupStamp(): string {
  return new Date()
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d+Z$/, 'Z');
}

function backupDir(): string {
  const dir = process.env.CURRENT_ONLY_CLEANUP_BACKUP_DIR ?? '.data';
  mkdirSync(dir, { recursive: true });
  return dir;
}

function asString(value: unknown): string {
  return String(value ?? '');
}

async function tableExists(
  db: NotesExecutor,
  tableName: string
): Promise<boolean> {
  const rows = await all(
    db,
    `SELECT 1 AS present
     FROM sqlite_master
     WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return rows.length > 0;
}

async function countWhere(
  db: NotesExecutor,
  tableName: string,
  where: string
): Promise<number> {
  if (!(await tableExists(db, tableName))) return 0;
  const rows = await all(
    db,
    `SELECT count(*) AS count FROM ${tableName} WHERE ${where}`
  );
  return Number(rows[0]?.count ?? 0);
}

async function rowsWhere(
  db: NotesExecutor,
  tableName: string,
  where: string
): Promise<Row[]> {
  if (!(await tableExists(db, tableName))) return [];
  return (await all(db, `SELECT * FROM ${tableName} WHERE ${where}`)) as Row[];
}

async function unsupportedEntities(
  db: NotesExecutor,
  tableName: 'notes' | 'notebooks',
  where: string
): Promise<EntityRow[]> {
  const rows = await rowsWhere(db, tableName, where);
  return rows.map((row) => ({
    id: asString(row.id),
    ownerUsername: asString(row.owner_username) || 'legacy-token'
  }));
}

function groupByOwner(rows: EntityRow[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const ids = grouped.get(row.ownerUsername) ?? [];
    ids.push(row.id);
    grouped.set(row.ownerUsername, ids);
  }
  return grouped;
}

async function snapshotDatabase(
  label: string,
  db: NotesDb,
  stamp: string
): Promise<string> {
  const outputPath = join(
    backupDir(),
    `${label}-current-only-cleanup-${stamp}.json`
  );
  const tables: Record<string, Row[]> = {};
  for (const tableName of BACKUP_TABLES) {
    if (await tableExists(db, tableName)) {
      tables[tableName] = (await all(
        db,
        `SELECT * FROM ${tableName}`
      )) as Row[];
    }
  }
  writeFileSync(
    outputPath,
    JSON.stringify({ createdAt: new Date().toISOString(), tables }, null, 2)
  );
  return outputPath;
}

async function inspect(db: NotesExecutor) {
  return {
    oldNotes: await countWhere(db, 'notes', OLD_NOTE_FIELDS),
    oldNoteVersions: await countWhere(db, 'note_versions', OLD_NOTE_FIELDS),
    oldNotebooks: await countWhere(db, 'notebooks', OLD_NOTEBOOK_FIELDS),
    oldNotebookVersions: await countWhere(
      db,
      'notebook_versions',
      OLD_NOTEBOOK_FIELDS
    ),
    oldUsers: await countWhere(
      db,
      'users',
      "password_hash NOT LIKE 'argon2id-scram-sha256:v1:%'"
    )
  };
}

async function deleteOldUsers(tx: NotesExecutor): Promise<string[]> {
  const rows = await rowsWhere(
    tx,
    'users',
    "password_hash NOT LIKE 'argon2id-scram-sha256:v1:%'"
  );
  const usernames = rows.map((row) => asString(row.username)).filter(Boolean);
  for (const username of usernames) {
    await run(tx, 'DELETE FROM auth_sessions WHERE username = ?', [username]);
    await run(tx, 'DELETE FROM trusted_auth_devices WHERE username = ?', [
      username
    ]);
    await run(tx, 'DELETE FROM users WHERE username = ?', [username]);
  }
  return usernames;
}

async function cleanupTarget(label: string, db: NotesDb): Promise<void> {
  const before = await inspect(db);
  console.log(`${label} before cleanup: ${JSON.stringify(before)}`);
  if (!apply) return;

  const stamp = backupStamp();
  const backupPath = await snapshotDatabase(label, db, stamp);
  console.log(`${label} backup written: ${backupPath}`);

  const deletedUsers: string[] = [];
  await withWriteTransaction(db, async (tx) => {
    const notes = await unsupportedEntities(tx, 'notes', OLD_NOTE_FIELDS);
    for (const [ownerUsername, ids] of groupByOwner(notes)) {
      await deleteNotesByIds(tx, ids, ownerUsername);
    }

    const notebooks = await unsupportedEntities(
      tx,
      'notebooks',
      OLD_NOTEBOOK_FIELDS
    );
    for (const [ownerUsername, ids] of groupByOwner(notebooks)) {
      await deleteNotebooksByIds(tx, ids, ownerUsername);
    }

    await run(tx, `DELETE FROM note_versions WHERE ${OLD_NOTE_FIELDS}`);
    await run(tx, `DELETE FROM notebook_versions WHERE ${OLD_NOTEBOOK_FIELDS}`);
    deletedUsers.push(...(await deleteOldUsers(tx)));
  });

  await initializeDatabase(db);
  const after = await inspect(db);
  console.log(`${label} after cleanup: ${JSON.stringify(after)}`);
  if (deletedUsers.length) {
    console.log(
      `${label} deleted old verifier users: ${deletedUsers.join(', ')}`
    );
  }
}

async function openLocalRaw(): Promise<{ db: NotesDb; close: () => void }> {
  const config = getLocalDatabaseConfig();
  const db = createClient(config.client);
  return {
    db,
    close: () => db.close()
  };
}

async function openRemoteRaw(): Promise<{ db: NotesDb; close: () => void }> {
  const config = getRemoteDatabaseConfig();
  if (!config || !shouldSyncRemoteDatabase()) {
    throw new Error('Remote sync database is not configured');
  }
  const db = createClient(config.client);
  return {
    db,
    close: () => db.close()
  };
}

async function backupLocalSqlite(): Promise<void> {
  if (!apply) return;
  const config = getLocalDatabaseConfig();
  if (config.provider !== 'local') return;
  const stamp = backupStamp();
  const outputPath = join(
    backupDir(),
    `${basename(config.filePath, '.sqlite')}-pre-current-only-cleanup-${stamp}.sqlite`
  );
  copyFileSync(config.filePath, outputPath);
  console.log(`local sqlite backup written: ${outputPath}`);
}

if (!apply) {
  console.log('Dry run only. Pass --apply to mutate databases.');
}

if (target === 'local' || target === 'both') {
  await backupLocalSqlite();
  const local = await openLocalRaw();
  try {
    await cleanupTarget('local', local.db);
  } finally {
    local.close();
  }
}

if (target === 'remote' || target === 'both') {
  const remote = await openRemoteRaw();
  try {
    await cleanupTarget('remote', remote.db);
  } finally {
    remote.close();
  }
}
