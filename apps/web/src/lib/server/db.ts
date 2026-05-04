import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createClient,
  type Client,
  type InArgs,
  type Row,
  type Transaction
} from '@libsql/client';
import {
  getLocalDatabaseConfig,
  getLoginUsername,
  type DatabaseConfig
} from './config';

export type NotesDb = Client;
export type NotesExecutor = Client | Transaction;
export type SqlArgs = InArgs;

const initializedDatabases = new Map<string, Promise<void>>();
const LEGACY_OWNER_USERNAME = 'legacy-token';

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

  CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
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

  CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    owner_username TEXT NOT NULL DEFAULT 'legacy-token',
    name TEXT NOT NULL,
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
  await db.execute({ sql, args });
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
  return config.provider === 'local'
    ? `local:${config.filePath}`
    : `turso:${config.client.url}`;
}

async function enableConnectionPragmas(db: NotesDb): Promise<void> {
  await run(db, 'PRAGMA foreign_keys = ON');
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

export async function initializeDatabase(db: NotesDb): Promise<void> {
  await exec(db, schemaSql);
  if (!(await hasColumn(db, 'users', 'display_name'))) {
    await run(db, 'ALTER TABLE users ADD COLUMN display_name TEXT');
  }
  await migrateLegacyMarkdownColumns(db);
  await migrateNotebookIds(db);
  await migrateSyncOwnershipAndHashes(db);
  await seedEntityChanges(db);
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
    const db = createClient(config.client);
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
    mkdirSync(dirname(config.filePath), { recursive: true });
  }

  await ensureDatabaseInitialized(config);
  const db = createClient(config.client);
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
  const tempDir = mkdtempSync(join(tmpdir(), 'author-notes-'));
  const db = createClient({ url: `file:${join(tempDir, 'test.sqlite')}` });
  const close = db.close.bind(db);
  db.close = () => {
    close();
    rmSync(tempDir, { recursive: true, force: true });
  };
  await initializeDatabase(db);
  return db;
}

export async function withWriteTransaction<T>(
  db: NotesDb,
  operation: (tx: Transaction) => Promise<T>
): Promise<T> {
  const tx = await db.transaction('write');
  try {
    const result = await operation(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  } finally {
    if (!tx.closed) tx.close();
  }
}
