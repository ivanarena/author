import type { Client, InArgs, Row, Transaction } from '@libsql/client';
import {
  getSignupAllowedEmails,
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
    id TEXT NOT NULL,
    owner_username TEXT NOT NULL DEFAULT 'legacy-token',
    name TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (owner_username, id)
  );

  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT,
	    password_hash TEXT NOT NULL,
	    password_salt TEXT NOT NULL,
	    e2ee_keyring TEXT,
	    totp_secret TEXT,
    totp_enabled_at TEXT,
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
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
    ON auth_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key_hash TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS auth_rate_limits_reset_at_idx
    ON auth_rate_limits(reset_at);

  CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    purpose TEXT NOT NULL,
    client_nonce TEXT NOT NULL,
    server_nonce TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS auth_challenges_expires_at_idx
    ON auth_challenges(expires_at);

  CREATE INDEX IF NOT EXISTS auth_challenges_user_purpose_idx
    ON auth_challenges(username, purpose, created_at);

  CREATE TABLE IF NOT EXISTS trusted_auth_devices (
    username TEXT NOT NULL,
    device_id TEXT NOT NULL,
    secret_hash TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    PRIMARY KEY (username, device_id),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS trusted_auth_devices_device_idx
    ON trusted_auth_devices(device_id);

  CREATE INDEX IF NOT EXISTS devices_id_idx
    ON devices(id);

  CREATE INDEX IF NOT EXISTS users_updated_at_idx
    ON users(updated_at);

  CREATE TABLE IF NOT EXISTS invitation_codes (
    code TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    disabled_at TEXT
  );

  CREATE INDEX IF NOT EXISTS invitation_codes_active_idx
    ON invitation_codes(disabled_at);

  CREATE TABLE IF NOT EXISTS signup_allowed_emails (
    email TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );

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
    'devices',
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
     CREATE INDEX IF NOT EXISTS devices_owner_id_idx
       ON devices(owner_username, id);
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
       SELECT owner_username, 'device', id, 'upsert', last_seen_at FROM devices;
     INSERT INTO entity_changes (owner_username, entity_type, entity_id, operation, updated_at)
       SELECT owner_username, 'notebook', id, 'upsert', updated_at FROM notebooks;
     INSERT INTO entity_changes (owner_username, entity_type, entity_id, operation, updated_at)
       SELECT owner_username, 'note', id, 'upsert', updated_at FROM notes;`
  );
}

async function seedSignupAllowedEmails(db: NotesDb): Promise<void> {
  const emails = getSignupAllowedEmails();
  if (!emails.length) return;

  const now = new Date().toISOString();
  for (const email of emails) {
    await run(
      db,
      `INSERT INTO signup_allowed_emails (email, created_at)
       VALUES (?, ?)
       ON CONFLICT(email) DO NOTHING`,
      [email, now]
    );
  }
}

async function tableExists(db: NotesDb, tableName: string): Promise<boolean> {
  const row = await get(
    db,
    `SELECT 1 AS present
     FROM sqlite_master
     WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return Boolean(row);
}

async function unsupportedEncryptedFieldCount(
  db: NotesDb,
  tableName: string,
  columns: string[]
): Promise<number> {
  if (!(await tableExists(db, tableName))) return 0;
  const predicates = columns
    .map((column) => `${column} LIKE 'enc:v1:%' OR ${column} LIKE 'enc:v2:%'`)
    .join(' OR ');
  const row = await get(
    db,
    `SELECT count(*) AS count FROM ${tableName} WHERE ${predicates}`
  );
  return Number(row?.count ?? 0);
}

async function requireCurrentEncryptedServerRows(db: NotesDb): Promise<void> {
  const checkedTables = [
    { tableName: 'notes', columns: ['title', 'body'] },
    { tableName: 'note_versions', columns: ['title', 'body'] },
    { tableName: 'notebooks', columns: ['name'] },
    { tableName: 'notebook_versions', columns: ['name'] }
  ];
  const blockers: string[] = [];

  for (const table of checkedTables) {
    const count = await unsupportedEncryptedFieldCount(
      db,
      table.tableName,
      table.columns
    );
    if (count > 0) blockers.push(`${table.tableName}=${count}`);
  }

  if (blockers.length) {
    throw new Error(
      `Server database contains enc:v1 or enc:v2 note data (${blockers.join(
        ', '
      )}). Run the migration-capable release first so clients republish enc:v3 rows before starting this version.`
    );
  }
}

async function requireCurrentPasswordVerifiers(db: NotesDb): Promise<void> {
  if (!(await tableExists(db, 'users'))) return;
  const row = await get(
    db,
    `SELECT count(*) AS count
     FROM users
     WHERE password_hash NOT LIKE 'argon2id-scram-sha256:v1:%'`
  );
  const count = Number(row?.count ?? 0);
  if (count > 0) {
    throw new Error(
      `Server database contains ${count} non-current password verifier row(s). Run the current-only cleanup task or reset those accounts before starting this version.`
    );
  }
}

async function migrateArgon2AesCurrentOnly(db: NotesDb): Promise<void> {
  await requireCurrentEncryptedServerRows(db);
  await requireCurrentPasswordVerifiers(db);
  if (await hasColumn(db, 'users', 'password_iterations')) {
    await run(db, 'ALTER TABLE users DROP COLUMN password_iterations');
  }
}

async function accountScopedDevicePrimaryKeyExists(
  db: NotesDb
): Promise<boolean> {
  if (!(await tableExists(db, 'devices'))) return false;
  const rows = await all(db, 'PRAGMA table_info(devices)');
  const primaryKeyColumns = rows
    .filter((row) => Number(row.pk ?? 0) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((row) => String(row.name));
  return (
    primaryKeyColumns.length === 2 &&
    primaryKeyColumns[0] === 'owner_username' &&
    primaryKeyColumns[1] === 'id'
  );
}

async function accountScopedTrustedDeviceForeignKeyExists(
  db: NotesDb
): Promise<boolean> {
  if (!(await tableExists(db, 'trusted_auth_devices'))) return false;
  const rows = await all(db, 'PRAGMA foreign_key_list(trusted_auth_devices)');
  return (
    rows.some(
      (row) =>
        row.table === 'devices' &&
        row.from === 'username' &&
        row.to === 'owner_username'
    ) &&
    rows.some(
      (row) =>
        row.table === 'devices' &&
        row.from === 'device_id' &&
        row.to === 'id' &&
        String(row.on_delete).toUpperCase() === 'CASCADE'
    )
  );
}

async function migrateAccountScopedDevices(db: NotesDb): Promise<void> {
  if (
    (await accountScopedDevicePrimaryKeyExists(db)) &&
    (await accountScopedTrustedDeviceForeignKeyExists(db))
  ) {
    return;
  }

  const owner = defaultDataOwner();
  await run(db, 'PRAGMA foreign_keys = OFF');
  try {
    await exec(
      db,
      `BEGIN;

       CREATE TABLE devices_account_scoped (
         id TEXT NOT NULL,
         owner_username TEXT NOT NULL DEFAULT 'legacy-token',
         name TEXT NOT NULL,
         last_seen_at TEXT NOT NULL,
         PRIMARY KEY (owner_username, id)
       );

       INSERT INTO devices_account_scoped (
         id, owner_username, name, last_seen_at
       )
       SELECT id,
              COALESCE(NULLIF(owner_username, ''), ${sqlString(owner)}),
              name,
              last_seen_at
       FROM devices
       WHERE id IS NOT NULL AND id <> ''
       ON CONFLICT(owner_username, id) DO UPDATE SET
         name = excluded.name,
         last_seen_at = excluded.last_seen_at;

       INSERT INTO devices_account_scoped (
         id, owner_username, name, last_seen_at
       )
       SELECT auth_sessions.device_id,
              auth_sessions.username,
              CASE
                WHEN devices.owner_username = auth_sessions.username
                  THEN devices.name
                ELSE auth_sessions.device_id
              END,
              auth_sessions.last_seen_at
       FROM auth_sessions
       LEFT JOIN devices
         ON devices.id = auth_sessions.device_id
       WHERE auth_sessions.device_id IS NOT NULL
         AND auth_sessions.device_id <> ''
       ON CONFLICT(owner_username, id) DO UPDATE SET
         last_seen_at = CASE
           WHEN excluded.last_seen_at > devices_account_scoped.last_seen_at
             THEN excluded.last_seen_at
           ELSE devices_account_scoped.last_seen_at
         END;

       INSERT INTO devices_account_scoped (
         id, owner_username, name, last_seen_at
       )
       SELECT trusted_auth_devices.device_id,
              trusted_auth_devices.username,
              CASE
                WHEN devices.owner_username = trusted_auth_devices.username
                  THEN devices.name
                ELSE trusted_auth_devices.device_id
              END,
              trusted_auth_devices.last_used_at
       FROM trusted_auth_devices
       LEFT JOIN devices
         ON devices.id = trusted_auth_devices.device_id
       WHERE trusted_auth_devices.device_id IS NOT NULL
         AND trusted_auth_devices.device_id <> ''
       ON CONFLICT(owner_username, id) DO UPDATE SET
         last_seen_at = CASE
           WHEN excluded.last_seen_at > devices_account_scoped.last_seen_at
             THEN excluded.last_seen_at
           ELSE devices_account_scoped.last_seen_at
         END;

       INSERT INTO devices_account_scoped (
         id, owner_username, name, last_seen_at
       )
       SELECT device_id, owner_username, device_id, MAX(updated_at)
       FROM notes
       WHERE device_id IS NOT NULL AND device_id <> ''
       GROUP BY owner_username, device_id
       ON CONFLICT(owner_username, id) DO UPDATE SET
         last_seen_at = CASE
           WHEN excluded.last_seen_at > devices_account_scoped.last_seen_at
             THEN excluded.last_seen_at
           ELSE devices_account_scoped.last_seen_at
         END;

       INSERT INTO devices_account_scoped (
         id, owner_username, name, last_seen_at
       )
       SELECT device_id, owner_username, device_id, MAX(updated_at)
       FROM notebooks
       WHERE device_id IS NOT NULL AND device_id <> ''
       GROUP BY owner_username, device_id
       ON CONFLICT(owner_username, id) DO UPDATE SET
         last_seen_at = CASE
           WHEN excluded.last_seen_at > devices_account_scoped.last_seen_at
             THEN excluded.last_seen_at
           ELSE devices_account_scoped.last_seen_at
         END;

       INSERT INTO devices_account_scoped (
         id, owner_username, name, last_seen_at
       )
       SELECT entity_id, owner_username, entity_id, MAX(updated_at)
       FROM entity_changes
       WHERE entity_type = 'device'
         AND operation = 'upsert'
         AND entity_id IS NOT NULL
         AND entity_id <> ''
       GROUP BY owner_username, entity_id
       ON CONFLICT(owner_username, id) DO UPDATE SET
         last_seen_at = CASE
           WHEN excluded.last_seen_at > devices_account_scoped.last_seen_at
             THEN excluded.last_seen_at
           ELSE devices_account_scoped.last_seen_at
         END;

       CREATE TABLE auth_sessions_account_scoped (
         token_hash TEXT PRIMARY KEY,
         username TEXT NOT NULL,
         device_id TEXT,
         created_at TEXT NOT NULL,
         last_seen_at TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
       );

       INSERT INTO auth_sessions_account_scoped (
         token_hash, username, device_id, created_at, last_seen_at, expires_at
       )
       SELECT token_hash, username, device_id, created_at, last_seen_at, expires_at
       FROM auth_sessions;

       CREATE TABLE trusted_auth_devices_account_scoped (
         username TEXT NOT NULL,
         device_id TEXT NOT NULL,
         secret_hash TEXT,
         created_at TEXT NOT NULL,
         last_used_at TEXT NOT NULL,
         PRIMARY KEY (username, device_id),
         FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
         FOREIGN KEY (username, device_id)
           REFERENCES devices_account_scoped(owner_username, id)
           ON DELETE CASCADE
       );

       INSERT INTO trusted_auth_devices_account_scoped (
         username, device_id, secret_hash, created_at, last_used_at
       )
       SELECT username, device_id, secret_hash, created_at, last_used_at
       FROM trusted_auth_devices
       WHERE device_id IS NOT NULL
         AND device_id <> '';

       DROP TABLE trusted_auth_devices;
       DROP TABLE auth_sessions;
       DROP TABLE devices;

       ALTER TABLE devices_account_scoped RENAME TO devices;
       ALTER TABLE auth_sessions_account_scoped RENAME TO auth_sessions;
       ALTER TABLE trusted_auth_devices_account_scoped
         RENAME TO trusted_auth_devices;

       CREATE INDEX IF NOT EXISTS devices_id_idx
         ON devices(id);
       CREATE INDEX IF NOT EXISTS devices_owner_id_idx
         ON devices(owner_username, id);
       CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
         ON auth_sessions(expires_at);
       CREATE INDEX IF NOT EXISTS trusted_auth_devices_device_idx
         ON trusted_auth_devices(device_id);

       COMMIT;`
    );

    const violations = await all(db, 'PRAGMA foreign_key_check');
    if (violations.length > 0) {
      throw new Error(
        'Account-scoped device migration failed foreign key check'
      );
    }
  } catch (error) {
    await run(db, 'ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await run(db, 'PRAGMA foreign_keys = ON');
  }
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
  },
  {
    version: 7,
    name: 'user-email-and-totp',
    rollback:
      'Restore from the pre-upgrade backup. Email and TOTP columns are forward-only account additions.',
    up: async (db) => {
      if (!(await hasColumn(db, 'users', 'email'))) {
        await run(db, 'ALTER TABLE users ADD COLUMN email TEXT');
      }
      if (!(await hasColumn(db, 'users', 'totp_secret'))) {
        await run(db, 'ALTER TABLE users ADD COLUMN totp_secret TEXT');
      }
      if (!(await hasColumn(db, 'users', 'totp_enabled_at'))) {
        await run(db, 'ALTER TABLE users ADD COLUMN totp_enabled_at TEXT');
      }
      await run(
        db,
        `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
           ON users(email)
           WHERE email IS NOT NULL`
      );
    }
  },
  {
    version: 8,
    name: 'trusted-auth-devices',
    rollback:
      'Restore from the pre-upgrade backup. Trusted auth devices are recreated after password login on each browser.',
    up: async (db) => {
      await exec(
        db,
        `CREATE TABLE IF NOT EXISTS trusted_auth_devices (
           username TEXT NOT NULL,
           device_id TEXT NOT NULL,
           secret_hash TEXT,
           created_at TEXT NOT NULL,
           last_used_at TEXT NOT NULL,
           PRIMARY KEY (username, device_id),
           FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
           FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS trusted_auth_devices_device_idx
           ON trusted_auth_devices(device_id);`
      );
    }
  },
  {
    version: 9,
    name: 'signup-allowed-emails',
    rollback:
      'Restore from the pre-upgrade backup or delete rows from signup_allowed_emails to disable signup.',
    up: async (db) => {
      await exec(
        db,
        `CREATE TABLE IF NOT EXISTS signup_allowed_emails (
           email TEXT PRIMARY KEY,
           created_at TEXT NOT NULL
         );`
      );
      await seedSignupAllowedEmails(db);
    }
  },
  {
    version: 10,
    name: 'auth-rate-limits',
    rollback:
      'Restore from the pre-upgrade backup or drop auth_rate_limits; rows are temporary login-throttle state.',
    up: async (db) => {
      await exec(
        db,
        `CREATE TABLE IF NOT EXISTS auth_rate_limits (
           key_hash TEXT PRIMARY KEY,
           count INTEGER NOT NULL,
           reset_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS auth_rate_limits_reset_at_idx
           ON auth_rate_limits(reset_at);`
      );
    }
  },
  {
    version: 11,
    name: 'trusted-auth-device-secrets',
    rollback:
      'Restore from the pre-upgrade backup. Trusted auth devices are recreated after password login on each browser or Android install.',
    up: async (db) => {
      if (!(await hasColumn(db, 'trusted_auth_devices', 'secret_hash'))) {
        await run(
          db,
          'ALTER TABLE trusted_auth_devices ADD COLUMN secret_hash TEXT'
        );
      }
      await run(db, 'DELETE FROM trusted_auth_devices');
    }
  },
  {
    version: 12,
    name: 'owned-devices',
    rollback:
      'Restore from the pre-upgrade backup. Device ownership is a forward-only metadata hardening change.',
    up: async (db) => {
      const owner = defaultDataOwner();
      if (!(await hasColumn(db, 'devices', 'owner_username'))) {
        await run(
          db,
          `ALTER TABLE devices ADD COLUMN owner_username TEXT NOT NULL DEFAULT ${sqlString(owner)}`
        );
      }
      await run(
        db,
        `UPDATE devices SET owner_username = ? WHERE owner_username IS NULL OR owner_username = ''`,
        [owner]
      );
      await run(
        db,
        `CREATE INDEX IF NOT EXISTS devices_owner_id_idx
           ON devices(owner_username, id)`
      );
    }
  },
  {
    version: 13,
    name: 'argon2-aes-current-only-cleanup',
    rollback:
      'Restore from the pre-upgrade backup. This migration refuses old encrypted rows or non-current password verifiers and drops the obsolete password_iterations column.',
    up: migrateArgon2AesCurrentOnly
  },
  {
    version: 14,
    name: 'auth-proof-challenges',
    rollback:
      'Restore from the pre-upgrade backup or drop auth_challenges; rows are short-lived login challenge state.',
    up: async (db) => {
      await exec(
        db,
        `CREATE TABLE IF NOT EXISTS auth_challenges (
           id TEXT PRIMARY KEY,
           username TEXT NOT NULL,
           purpose TEXT NOT NULL,
           client_nonce TEXT NOT NULL,
           server_nonce TEXT NOT NULL,
           created_at TEXT NOT NULL,
           expires_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS auth_challenges_expires_at_idx
           ON auth_challenges(expires_at);
         CREATE INDEX IF NOT EXISTS auth_challenges_user_purpose_idx
           ON auth_challenges(username, purpose, created_at);`
      );
    }
  },
  {
    version: 15,
    name: 'record-limit-active-count-indexes',
    rollback:
      'Restore from the pre-upgrade backup or drop notes_owner_active_idx and notebooks_owner_active_idx.',
    up: async (db) => {
      await exec(
        db,
        `CREATE INDEX IF NOT EXISTS notes_owner_active_idx
           ON notes(owner_username, deleted_at, id);
         CREATE INDEX IF NOT EXISTS notebooks_owner_active_idx
           ON notebooks(owner_username, deleted_at, id);`
      );
    }
  },
  {
    version: 16,
    name: 'account-scoped-device-primary-key',
    rollback:
      'Restore from the pre-upgrade backup. This migration rebuilds device, session, and trusted-device tables so browser device ids are isolated per account.',
    up: migrateAccountScopedDevices
  },
  {
    version: 17,
    name: 'version-snapshot-retention-indexes',
    rollback:
      'Restore from the pre-upgrade backup or drop note_versions_owner_saved_at_idx and notebook_versions_owner_saved_at_idx.',
    up: async (db) => {
      await exec(
        db,
        `CREATE INDEX IF NOT EXISTS note_versions_owner_saved_at_idx
           ON note_versions(owner_username, saved_at);
         CREATE INDEX IF NOT EXISTS notebook_versions_owner_saved_at_idx
           ON notebook_versions(owner_username, saved_at);`
      );
    }
  },
  {
    version: 18,
    name: 'account-e2ee-keyrings',
    rollback:
      'Restore from the pre-upgrade backup or leave e2ee_keyring unused; clients can recreate it after password sign-in.',
    up: async (db) => {
      if (!(await hasColumn(db, 'users', 'e2ee_keyring'))) {
        await run(db, 'ALTER TABLE users ADD COLUMN e2ee_keyring TEXT');
      }
    }
  }
];

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
  await seedSignupAllowedEmails(db);
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
