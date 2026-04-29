import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createClient, type Client, type InArgs, type Row, type Transaction } from '@libsql/client';
import { getDatabaseConfig } from './config';

export type NotesDb = Client;
export type NotesExecutor = Client | Transaction;
export type SqlArgs = InArgs;

const schemaSql = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    device_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    sync_status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
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

  CREATE TABLE IF NOT EXISTS note_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
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
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    device_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    saved_at TEXT NOT NULL,
    reason TEXT NOT NULL
  );
`;

const createNotesTableSql = `
  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
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
    title TEXT NOT NULL,
    body TEXT NOT NULL,
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

export async function run(db: NotesExecutor, sql: string, args: SqlArgs = []): Promise<void> {
  await db.execute({ sql, args });
}

export async function all(db: NotesExecutor, sql: string, args: SqlArgs = []): Promise<Row[]> {
  const result = await db.execute({ sql, args });
  return result.rows;
}

export async function get(db: NotesExecutor, sql: string, args: SqlArgs = []): Promise<Row | null> {
  const result = await db.execute({ sql, args });
  return result.rows[0] ?? null;
}

async function hasColumn(db: NotesDb, tableName: string, columnName: string): Promise<boolean> {
  const rows = await all(db, `PRAGMA table_info(${tableName})`);
  return rows.some((row) => row.name === columnName);
}

async function migrateLegacyMarkdownColumns(db: NotesDb): Promise<void> {
  const notesHaveBody = await hasColumn(db, 'notes', 'body');
  const notesHaveMarkdownBody = await hasColumn(db, 'notes', 'markdown_body');
  if (notesHaveMarkdownBody) {
    const bodyExpression = notesHaveBody ? "COALESCE(NULLIF(body, ''), markdown_body)" : 'markdown_body';
    const notesHaveNotebookIds = await hasColumn(db, 'notes', 'notebook_ids');
    const notebookIdsExpression = notesHaveNotebookIds
      ? "COALESCE(notebook_ids, CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END)"
      : "CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END";
    await exec(
      db,
      `PRAGMA foreign_keys = OFF;
       ALTER TABLE notes RENAME TO notes_legacy_markdown;
       ${createNotesTableSql}
       INSERT INTO notes (
         id, title, body, notebook_ids, notebook_id, created_at, updated_at,
         deleted_at, trashed_at, device_id, version, sync_status
       )
       SELECT
         id, title, ${bodyExpression}, ${notebookIdsExpression}, notebook_id, created_at, updated_at,
         deleted_at, trashed_at, device_id, version, sync_status
       FROM notes_legacy_markdown;
       DROP TABLE notes_legacy_markdown;
       PRAGMA foreign_keys = ON;`
    );
  }

  const versionsHaveBody = await hasColumn(db, 'note_versions', 'body');
  const versionsHaveMarkdownBody = await hasColumn(db, 'note_versions', 'markdown_body');
  if (versionsHaveMarkdownBody) {
    const bodyExpression = versionsHaveBody ? "COALESCE(NULLIF(body, ''), markdown_body)" : 'markdown_body';
    const versionsHaveNotebookIds = await hasColumn(db, 'note_versions', 'notebook_ids');
    const notebookIdsExpression = versionsHaveNotebookIds
      ? "COALESCE(notebook_ids, CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END)"
      : "CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END";
    await exec(
      db,
      `ALTER TABLE note_versions RENAME TO note_versions_legacy_markdown;
       ${createNoteVersionsTableSql}
       INSERT INTO note_versions (
         id, note_id, title, body, notebook_ids, notebook_id, created_at, updated_at,
         deleted_at, trashed_at, device_id, version, saved_at, reason
       )
       SELECT
         id, note_id, title, ${bodyExpression}, ${notebookIdsExpression}, notebook_id, created_at, updated_at,
         deleted_at, trashed_at, device_id, version, saved_at, reason
       FROM note_versions_legacy_markdown;
       DROP TABLE note_versions_legacy_markdown;`
    );
  }
}

async function migrateNotebookIds(db: NotesDb): Promise<void> {
  if (!(await hasColumn(db, 'notes', 'notebook_ids'))) {
    await run(db, `ALTER TABLE notes ADD COLUMN notebook_ids TEXT NOT NULL DEFAULT '[]'`);
    await run(db, `UPDATE notes SET notebook_ids = CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END`);
  }

  if (!(await hasColumn(db, 'note_versions', 'notebook_ids'))) {
    await run(db, `ALTER TABLE note_versions ADD COLUMN notebook_ids TEXT NOT NULL DEFAULT '[]'`);
    await run(db, `UPDATE note_versions SET notebook_ids = CASE WHEN notebook_id IS NULL THEN '[]' ELSE json_array(notebook_id) END`);
  }
}

export async function initializeDatabase(db: NotesDb): Promise<void> {
  await exec(db, schemaSql);
  await migrateLegacyMarkdownColumns(db);
  await migrateNotebookIds(db);
}

export async function openDatabase(): Promise<NotesDb> {
  const config = getDatabaseConfig();
  if (config.provider === 'local') {
    mkdirSync(dirname(config.filePath), { recursive: true });
  }

  const db = createClient(config.client);
  await initializeDatabase(db);
  return db;
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
