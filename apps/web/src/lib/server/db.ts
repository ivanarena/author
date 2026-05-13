import type { Client, InArgs, Row, Transaction } from '@libsql/client';
import {
  getLocalDatabaseConfig,
  getLoginUsername,
  type DatabaseConfig
} from './config';

export type NotesDb = Client;
export type NotesExecutor = Client | Transaction;
export type SqlArgs = InArgs;

const initializedDatabases = new Map<string, Promise<void>>();
const databaseWriteQueues = new Map<string, Promise<void>>();
const databaseWriteKeys = new WeakMap<NotesDb, string>();
const LEGACY_OWNER_USERNAME = 'legacy-token';
const DEFAULT_SIGNUP_INVITE_CODE = 'authorprivatefriendsonly';
const WRITE_TRANSACTION_MAX_ATTEMPTS = 6;
const WRITE_TRANSACTION_RETRY_BASE_MS = 25;

function defaultDataOwner(): string {
  const configured = getLoginUsername()?.trim().toLowerCase();
  return configured || LEGACY_OWNER_USERNAME;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const schemaSql = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    device_id TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
    ON auth_sessions(expires_at);

  CREATE INDEX IF NOT EXISTS users_updated_at_idx
    ON users(updated_at);

  CREATE TABLE IF NOT EXISTS invitation_codes (
    code TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    disabled_at TEXT
  );

  CREATE INDEX IF NOT EXISTS invitation_codes_active_idx
    ON invitation_codes(disabled_at);

  CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entity_changes (
    revision INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_username TEXT NOT NULL DEFAULT 'legacy-token',
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS entity_changes_revision_idx
    ON entity_changes(revision);

  CREATE INDEX IF NOT EXISTS entity_changes_entity_idx
    ON entity_changes(entity_type, entity_id, revision);

  CREATE INDEX IF NOT EXISTS entity_changes_owner_revision_idx
    ON entity_changes(owner_username, revision);

  CREATE INDEX IF NOT EXISTS entity_changes_owner_entity_revision_idx
    ON entity_changes(owner_username, entity_type, entity_id, revision);

  CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    owner_username TEXT NOT NULL DEFAULT 'legacy-token',
    name TEXT NOT NULL,
    name_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    device_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    sync_status TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS notebooks_updated_at_idx
    ON notebooks(updated_at);

  CREATE INDEX IF NOT EXISTS notebooks_active_name_idx
    ON notebooks(owner_username, deleted_at, name);

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    owner_username TEXT NOT NULL DEFAULT 'legacy-token',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    title_hash TEXT,
    body_hash TEXT,
    notebook_ids TEXT NOT NULL DEFAULT '[]',
    notebook_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    trashed_at TEXT,
    device_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    sync_status TEXT NOT NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS notes_updated_at_idx
    ON notes(updated_at);

  CREATE INDEX IF NOT EXISTS notes_trashed_at_idx
    ON notes(trashed_at);

  CREATE TABLE IF NOT EXISTS note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL,
    owner_username TEXT NOT NULL DEFAULT 'legacy-token',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    title_hash TEXT,
    body_hash TEXT,
    notebook_ids TEXT NOT NULL DEFAULT '[]',
    notebook_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    trashed_at TEXT,
    device_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    saved_at TEXT NOT NULL,
    reason TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notebook_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notebook_id TEXT NOT NULL,
    owner_username TEXT NOT NULL DEFAULT 'legacy-token',
    name TEXT NOT NULL,
    name_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    device_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    saved_at TEXT NOT NULL,
    reason TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entity_tombstones (
    owner_username TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    device_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    PRIMARY KEY (owner_username, entity_type, entity_id)
  );
`;

const createNotesTableSql = `
  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    owner_username TEXT NOT NULL DEFAULT 'legacy-token',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    title_hash TEXT,
    body_hash TEXT,
    notebook_ids TEXT NOT NULL DEFAULT '[]',
    notebook_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    trashed_at TEXT,
    device_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    sync_status TEXT NOT NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
  );
`;

const createNoteVersionsTableSql = `
  CREATE TABLE note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL,
    owner_username TEXT NOT NULL DEFAULT 'legacy-token',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    title_hash TEXT,
    body_hash TEXT,
    notebook_ids TEXT NOT NULL DEFAULT '[]',
    notebook_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    trashed_at TEXT,
    device_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    saved_at TEXT NOT NULL,
    reason TEXT NOT NULL
  );
`;

export async function exec(db: NotesExecutor, sql: string): Promise<void> {
  await db.executeMultiple(sql);
}

export async function run(
  db: NotesExecutor,
  sql: string,
  args: SqlArgs = []
): Promise<void> {
  const operation = async () => {
    await retryDatabaseBusy(() => db.execute({ sql, args }));
  };
  const key = databaseWriteKeys.get(db as NotesDb);
  if (key) {
    await serializeDatabaseWrite(db as NotesDb, operation);
    return;
  }
  await operation();
}

export async function all(
  db: NotesExecutor,
  sql: string,
  args: SqlArgs = []
): Promise<Row[]> {
  const result = await db.execute({ sql, args });
  return result.rows;
}

export async function get(
  db: NotesExecutor,
  sql: string,
  args: SqlArgs = []
): Promise<Row | null> {
  const result = await db.execute({ sql, args });
  return result.rows[0] ?? null;
}

function databaseInitKey(config: DatabaseConfig): string {
  if (config.provider === 'local') return `local:${config.filePath}`;
  return `turso:${config.client.url}`;
}

async function enableConnectionPragmas(db: NotesDb): Promise<void> {
  await run(db, 'PRAGMA foreign_keys = ON');
  await run(db, 'PRAGMA busy_timeout = 250').catch(() => {});
}

async function hasColumn(
  db: NotesDb,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const rows = await all(db, `PRAGMA table_info(${tableName})`);
  return rows.some((row) => row.name === columnName);
}

async function migrateLegacyMarkdownColumns(db: NotesDb): Promise<void> {
  const notesHaveBody = await hasColumn(db, 'notes', 'body');
  const notesHaveMarkdownBody = await hasColumn(db, 'notes', 'markdown_body');
  if (notesHaveMarkdownBody) {
    const bodyExpression = notesHaveBody
      ? "COALESCE(NULLIF(body, ''), markdown_body)"
      : 'markdown_body';
    const notesHaveNotebookIds = await hasColumn(db, 'notes', 'notebook_ids');
    const notesHaveOwner = await hasColumn(db, 'notes', 'owner_username');
    const notesHaveTitleHash = await hasColumn(db, 'notes', 'title_hash');
    const notesHaveBodyHash = await hasColumn(db, 'notes', 'body_hash');
    const notebookIdsExpression = notesHaveNotebookIds
      ? "COALESCE(notebook_ids, CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END)"
      : "CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END";
    const ownerExpression = notesHaveOwner
      ? `COALESCE(owner_username, ${sqlString(defaultDataOwner())})`
      : sqlString(defaultDataOwner());
    const titleHashExpression = notesHaveTitleHash ? 'title_hash' : 'NULL';
    const bodyHashExpression = notesHaveBodyHash ? 'body_hash' : 'NULL';
    await exec(
      db,
      `PRAGMA foreign_keys = OFF;
       ALTER TABLE notes RENAME TO notes_legacy_markdown;
       ${createNotesTableSql}
       INSERT INTO notes (
         id, owner_username, title, body, title_hash, body_hash, notebook_ids, notebook_id, created_at, updated_at,
         deleted_at, trashed_at, device_id, version, sync_status
       )
       SELECT
         id, ${ownerExpression}, title, ${bodyExpression}, ${titleHashExpression}, ${bodyHashExpression}, ${notebookIdsExpression}, notebook_id, created_at, updated_at,
         deleted_at, trashed_at, device_id, version, sync_status
       FROM notes_legacy_markdown;
       DROP TABLE notes_legacy_markdown;
       PRAGMA foreign_keys = ON;`
    );
  }

  const versionsHaveBody = await hasColumn(db, 'note_versions', 'body');
  const versionsHaveMarkdownBody = await hasColumn(
    db,
    'note_versions',
    'markdown_body'
  );
  if (versionsHaveMarkdownBody) {
    const bodyExpression = versionsHaveBody
      ? "COALESCE(NULLIF(body, ''), markdown_body)"
      : 'markdown_body';
    const versionsHaveNotebookIds = await hasColumn(
      db,
      'note_versions',
      'notebook_ids'
    );
    const versionsHaveOwner = await hasColumn(
      db,
      'note_versions',
      'owner_username'
    );
    const versionsHaveTitleHash = await hasColumn(
      db,
      'note_versions',
      'title_hash'
    );
    const versionsHaveBodyHash = await hasColumn(
      db,
      'note_versions',
      'body_hash'
    );
    const notebookIdsExpression = versionsHaveNotebookIds
      ? "COALESCE(notebook_ids, CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END)"
      : "CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END";
    const ownerExpression = versionsHaveOwner
      ? `COALESCE(owner_username, ${sqlString(defaultDataOwner())})`
      : sqlString(defaultDataOwner());
    const titleHashExpression = versionsHaveTitleHash ? 'title_hash' : 'NULL';
    const bodyHashExpression = versionsHaveBodyHash ? 'body_hash' : 'NULL';
    await exec(
      db,
      `ALTER TABLE note_versions RENAME TO note_versions_legacy_markdown;
       ${createNoteVersionsTableSql}
       INSERT INTO note_versions (
         id, note_id, owner_username, title, body, title_hash, body_hash, notebook_ids, notebook_id, created_at, updated_at,
         deleted_at, trashed_at, device_id, version, saved_at, reason
       )
       SELECT
         id, note_id, ${ownerExpression}, title, ${bodyExpression}, ${titleHashExpression}, ${bodyHashExpression}, ${notebookIdsExpression}, notebook_id, created_at, updated_at,
         deleted_at, trashed_at, device_id, version, saved_at, reason
       FROM note_versions_legacy_markdown;
       DROP TABLE note_versions_legacy_markdown;`
    );
  }
}

async function migrateNotebookIds(db: NotesDb): Promise<void> {
  if (!(await hasColumn(db, 'notes', 'notebook_ids'))) {
    await run(
      db,
      `ALTER TABLE notes ADD COLUMN notebook_ids TEXT NOT NULL DEFAULT '[]'`
    );
    await run(
      db,
      `UPDATE notes SET notebook_ids = CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END`
    );
  }

  if (!(await hasColumn(db, 'note_versions', 'notebook_ids'))) {
    await run(
      db,
      `ALTER TABLE note_versions ADD COLUMN notebook_ids TEXT NOT NULL DEFAULT '[]'`
    );
    await run(
      db,
      `UPDATE note_versions SET notebook_ids = CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END`
    );
  }
}

async function migrateSyncOwnershipAndHashes(db: NotesDb): Promise<void> {
  const owner = defaultDataOwner();
  const ownerTables = [
    'notes',
    'notebooks',
    'note_versions',
    'notebook_versions',
    'entity_changes'
  ];

  for (const table of ownerTables) {
    if (!(await hasColumn(db, table, 'owner_username'))) {
      await run(
        db,
        `ALTER TABLE ${table} ADD COLUMN owner_username TEXT NOT NULL DEFAULT ${sqlString(owner)}`
      );
    }
    await run(
      db,
      `UPDATE ${table} SET owner_username = ? WHERE owner_username IS NULL OR owner_username = ''`,
      [owner]
    );
  }

  for (const table of ['notes', 'note_versions']) {
    if (!(await hasColumn(db, table, 'title_hash'))) {
      await run(db, `ALTER TABLE ${table} ADD COLUMN title_hash TEXT`);
    }
    if (!(await hasColumn(db, table, 'body_hash'))) {
      await run(db, `ALTER TABLE ${table} ADD COLUMN body_hash TEXT`);
    }
  }

  await exec(
    db,
    `CREATE INDEX IF NOT EXISTS entity_changes_owner_revision_idx
       ON entity_changes(owner_username, revision);
     CREATE INDEX IF NOT EXISTS entity_changes_owner_entity_revision_idx
       ON entity_changes(owner_username, entity_type, entity_id, revision);
     CREATE INDEX IF NOT EXISTS notebooks_active_name_idx
       ON notebooks(owner_username, deleted_at, name);
     CREATE TABLE IF NOT EXISTS entity_tombstones (
       owner_username TEXT NOT NULL,
       entity_type TEXT NOT NULL,
       entity_id TEXT NOT NULL,
       deleted_at TEXT NOT NULL,
       device_id TEXT NOT NULL,
       version INTEGER NOT NULL,
       PRIMARY KEY (owner_username, entity_type, entity_id)
     );`
  );
}

async function seedEntityChanges(db: NotesDb): Promise<void> {
  const existing = await get(
    db,
    'SELECT count(*) AS count FROM entity_changes'
  );
  if (Number(existing?.count ?? 0) > 0) return;

  await exec(
    db,
    `INSERT INTO entity_changes (owner_username, entity_type, entity_id, operation, updated_at)
       SELECT ${sqlString(defaultDataOwner())}, 'device', id, 'upsert', last_seen_at FROM devices;
     INSERT INTO entity_changes (owner_username, entity_type, entity_id, operation, updated_at)
       SELECT owner_username, 'notebook', id, 'upsert', updated_at FROM notebooks;
     INSERT INTO entity_changes (owner_username, entity_type, entity_id, operation, updated_at)
       SELECT owner_username, 'note', id, 'upsert', updated_at FROM notes;`
  );
}

export interface ServerMigration {
  version: number;
  name: string;
  rollback: string;
  up: (db: NotesDb) => Promise<void>;
}

export const SERVER_MIGRATIONS: ServerMigration[] = [
  {
    version: 1,
    name: 'users-display-name',
    rollback:
      'Restore from the pre-upgrade SQLite/Turso backup; SQLite cannot drop this column safely in place.',
    up: async (db) => {
      if (!(await hasColumn(db, 'users', 'display_name'))) {
        await run(db, 'ALTER TABLE users ADD COLUMN display_name TEXT');
      }
    }
  },
  {
    version: 2,
    name: 'legacy-markdown-body-columns',
    rollback:
      'Restore from the pre-upgrade backup. This migration rewrites notes and note_versions when legacy markdown_body columns exist.',
    up: migrateLegacyMarkdownColumns
  },
  {
    version: 3,
    name: 'note-notebook-ids',
    rollback:
      'Restore from the pre-upgrade backup. The notebook_ids data is derived from notebook_id for old rows.',
    up: migrateNotebookIds
  },
  {
    version: 4,
    name: 'sync-ownership-and-field-hashes',
    rollback:
      'Restore from the pre-upgrade backup. Ownership defaults and hash columns are forward-only schema additions.',
    up: migrateSyncOwnershipAndHashes
  },
  {
    version: 5,
    name: 'notebook-name-hashes',
    rollback:
      'Restore from the pre-upgrade backup. Existing clients can republish encrypted notebook names if needed.',
    up: async (db) => {
      for (const table of ['notebooks', 'notebook_versions']) {
        if (!(await hasColumn(db, table, 'name_hash'))) {
          await run(db, `ALTER TABLE ${table} ADD COLUMN name_hash TEXT`);
        }
      }
      await run(
        db,
        `CREATE INDEX IF NOT EXISTS notebooks_active_name_hash_idx
           ON notebooks(owner_username, deleted_at, name_hash)`
      );
    }
  },
  {
    version: 6,
    name: 'invitation-codes',
    rollback:
      'Restore from the pre-upgrade backup or disable codes by setting disabled_at on invitation_codes rows.',
    up: async (db) => {
      await exec(
        db,
        `CREATE TABLE IF NOT EXISTS invitation_codes (
           code TEXT PRIMARY KEY,
           created_at TEXT NOT NULL,
           disabled_at TEXT
         );
         CREATE INDEX IF NOT EXISTS invitation_codes_active_idx
           ON invitation_codes(disabled_at);`
      );
    }
  }
];

async function seedDefaultInvitationCodes(db: NotesDb): Promise<void> {
  await run(
    db,
    `INSERT INTO invitation_codes (code, created_at, disabled_at)
     VALUES (?, ?, NULL)
     ON CONFLICT(code) DO UPDATE SET disabled_at = NULL`,
    [DEFAULT_SIGNUP_INVITE_CODE, new Date().toISOString()]
  );
}

async function ensureSchemaMigrationsTable(db: NotesDb): Promise<void> {
  await exec(
    db,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     );`
  );
}

export async function appliedMigrationVersions(
  db: NotesDb
): Promise<Set<number>> {
  await ensureSchemaMigrationsTable(db);
  const rows = await all(db, 'SELECT version FROM schema_migrations');
  return new Set(rows.map((row) => Number(row.version)));
}

async function recordMigration(
  db: NotesDb,
  migration: ServerMigration
): Promise<void> {
  await run(
    db,
    `INSERT INTO schema_migrations (version, name, applied_at)
     VALUES (?, ?, ?)
     ON CONFLICT(version) DO UPDATE SET
       name = excluded.name,
       applied_at = excluded.applied_at`,
    [migration.version, migration.name, new Date().toISOString()]
  );
}

export async function runPendingMigrations(db: NotesDb): Promise<void> {
  const applied = await appliedMigrationVersions(db);
  for (const migration of SERVER_MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    await migration.up(db);
    await recordMigration(db, migration);
    applied.add(migration.version);
  }
}

export async function initializeDatabase(db: NotesDb): Promise<void> {
  await exec(db, schemaSql);
  await runPendingMigrations(db);
  await seedDefaultInvitationCodes(db);
  await seedEntityChanges(db);
}

async function openLibsqlClient(config: {
  url: string;
  authToken?: string;
}): Promise<Client> {
  const { createClient } = await import('@libsql/client');
  return createClient(config);
}

async function ensureDatabaseInitialized(
  config: DatabaseConfig
): Promise<void> {
  const key = databaseInitKey(config);
  const existing = initializedDatabases.get(key);
  if (existing) {
    await existing;
    return;
  }

  const initialize = (async () => {
    const db = await openLibsqlClient(config.client);
    try {
      await initializeDatabase(db);
    } finally {
      db.close();
    }
  })();
  initializedDatabases.set(
    key,
    initialize.catch((error) => {
      initializedDatabases.delete(key);
      throw error;
    })
  );
  await initializedDatabases.get(key);
}

export async function openConfiguredDatabase(
  config: DatabaseConfig
): Promise<NotesDb> {
  if (config.provider === 'local') {
    const { mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(config.filePath), { recursive: true });
  }

  await ensureDatabaseInitialized(config);
  const db = await openLibsqlClient(config.client);
  databaseWriteKeys.set(db, databaseInitKey(config));
  await enableConnectionPragmas(db);
  return db;
}

export async function openDatabase(): Promise<NotesDb> {
  return await openLocalDatabase();
}

export async function openLocalDatabase(): Promise<NotesDb> {
  return await openConfiguredDatabase(getLocalDatabaseConfig());
}

export async function openMemoryDatabase(): Promise<NotesDb> {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tempDir = mkdtempSync(join(tmpdir(), 'author-'));
  const filePath = join(tempDir, 'test.sqlite');
  const db = await openLibsqlClient({ url: `file:${filePath}` });
  databaseWriteKeys.set(db, `local:${filePath}`);
  const close = db.close.bind(db);
  db.close = () => {
    close();
    rmSync(tempDir, { recursive: true, force: true });
  };
  await enableConnectionPragmas(db);
  await initializeDatabase(db);
  return db;
}

function isDatabaseBusyError(error: unknown): boolean {
  const record = error as {
    code?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const code = String(record?.code ?? record?.cause?.code ?? '');
  const message = String(record?.message ?? record?.cause?.message ?? '');
  return (
    code === 'SQLITE_BUSY' ||
    message.includes('SQLITE_BUSY') ||
    message.includes('database is locked')
  );
}

function transactionRetryDelay(attempt: number): number {
  return WRITE_TRANSACTION_RETRY_BASE_MS * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryDatabaseBusy<T>(operation: () => Promise<T>): Promise<T> {
  for (
    let attempt = 0;
    attempt < WRITE_TRANSACTION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      if (
        isDatabaseBusyError(error) &&
        attempt < WRITE_TRANSACTION_MAX_ATTEMPTS - 1
      ) {
        await sleep(transactionRetryDelay(attempt));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Database busy retry loop exited unexpectedly');
}

async function serializeDatabaseWrite<T>(
  db: NotesDb,
  operation: () => Promise<T>
): Promise<T> {
  const key = databaseWriteKeys.get(db);
  if (!key) return await operation();

  const previous = databaseWriteQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => current);
  databaseWriteQueues.set(key, tail);

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (databaseWriteQueues.get(key) === tail) {
      databaseWriteQueues.delete(key);
    }
  }
}

export async function withWriteTransaction<T>(
  db: NotesDb,
  operation: (tx: Transaction) => Promise<T>
): Promise<T> {
  return await serializeDatabaseWrite(db, async () => {
    for (
      let attempt = 0;
      attempt < WRITE_TRANSACTION_MAX_ATTEMPTS;
      attempt += 1
    ) {
      let tx: Transaction | null = null;
      try {
        tx = await db.transaction('write');
        const result = await operation(tx);
        await tx.commit();
        return result;
      } catch (error) {
        await tx?.rollback().catch(() => {});
        if (
          isDatabaseBusyError(error) &&
          attempt < WRITE_TRANSACTION_MAX_ATTEMPTS - 1
        ) {
          await sleep(transactionRetryDelay(attempt));
          continue;
        }
        throw error;
      } finally {
        if (tx && !tx.closed) tx.close();
      }
    }

    throw new Error('Write transaction retry loop exited unexpectedly');
  });
}
