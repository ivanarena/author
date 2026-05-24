import type { PushRequest } from '@author/api-types';
import {
  getRecordLimitConfig,
  type RecordLimitConfig,
  type RuntimeEnv
} from './config';
import { get, type NotesDb, type SqlArgs } from './db';

const NOTE_BUDGET_SHARE = 0.9;
const NOTEBOOK_BUDGET_SHARE = 1 - NOTE_BUDGET_SHARE;

export interface RecordLimitCheckResult {
  error: string;
  limits: {
    activeUsers: number;
    maxNotes: number;
    maxNotebooks: number;
    estimatedNotes: number;
    estimatedNotebooks: number;
  };
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return count === 1 ? singular : pluralValue;
}

async function countRows(
  db: NotesDb,
  sql: string,
  args: SqlArgs = []
): Promise<number> {
  const row = await get(db, sql, args);
  const count = Number(row?.count ?? 0);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

async function countActiveRecords(
  db: NotesDb,
  table: 'notes' | 'notebooks',
  ownerUsername: string
): Promise<number> {
  return await countRows(
    db,
    `SELECT count(*) AS count
     FROM ${table}
     WHERE owner_username = ? AND deleted_at IS NULL`,
    [ownerUsername]
  );
}

async function countActiveRecordIds(
  db: NotesDb,
  table: 'notes' | 'notebooks',
  ownerUsername: string,
  ids: string[]
): Promise<number> {
  const safeIds = uniqueIds(ids);
  if (!safeIds.length) return 0;
  return await countRows(
    db,
    `SELECT count(*) AS count
     FROM ${table}
     WHERE owner_username = ?
       AND deleted_at IS NULL
       AND id IN (${placeholders(safeIds.length)})`,
    [ownerUsername, ...safeIds]
  );
}

async function activeUserCount(db: NotesDb): Promise<number> {
  return Math.max(
    1,
    await countRows(db, 'SELECT count(*) AS count FROM users')
  );
}

function perUserLimits(
  config: RecordLimitConfig,
  users: number
): { maxNotes: number; maxNotebooks: number } {
  const usableBytes = config.storageBudgetBytes * config.safetyRatio;
  const perUserBytes = usableBytes / Math.max(1, users);
  return {
    maxNotes: Math.max(
      1,
      Math.floor((perUserBytes * NOTE_BUDGET_SHARE) / config.estimatedNoteBytes)
    ),
    maxNotebooks: Math.max(
      1,
      Math.floor(
        (perUserBytes * NOTEBOOK_BUDGET_SHARE) / config.estimatedNotebookBytes
      )
    )
  };
}

async function projectedActiveCount(
  db: NotesDb,
  table: 'notes' | 'notebooks',
  ownerUsername: string,
  changes: Array<{ record: { id: string; deletedAt: string | null } }>
): Promise<number> {
  const activeIds = uniqueIds(
    changes
      .filter((change) => !change.record.deletedAt)
      .map((change) => change.record.id)
  );
  const deletedIds = uniqueIds(
    changes
      .filter((change) => change.record.deletedAt)
      .map((change) => change.record.id)
  );
  const [current, alreadyActive, activeDeletes] = await Promise.all([
    countActiveRecords(db, table, ownerUsername),
    countActiveRecordIds(db, table, ownerUsername, activeIds),
    countActiveRecordIds(db, table, ownerUsername, deletedIds)
  ]);
  return Math.max(
    0,
    current + activeIds.length - alreadyActive - activeDeletes
  );
}

export async function checkRecordLimits(
  db: NotesDb,
  ownerUsername: string,
  request: PushRequest,
  env?: RuntimeEnv | null
): Promise<RecordLimitCheckResult | null> {
  const config = getRecordLimitConfig(env);
  if (!config.enabled) return null;

  const [users, estimatedNotes, estimatedNotebooks] = await Promise.all([
    activeUserCount(db),
    projectedActiveCount(db, 'notes', ownerUsername, request.notes),
    projectedActiveCount(db, 'notebooks', ownerUsername, request.notebooks)
  ]);
  const limits = perUserLimits(config, users);

  if (
    estimatedNotes <= limits.maxNotes &&
    estimatedNotebooks <= limits.maxNotebooks
  ) {
    return null;
  }

  return {
    error: `Server storage limit estimate reached for this account. The current shared Turso budget allows about ${limits.maxNotes} active ${plural(limits.maxNotes, 'note')} and ${limits.maxNotebooks} active ${plural(limits.maxNotebooks, 'notebook')} per user with ${users} active ${plural(users, 'user')}.`,
    limits: {
      activeUsers: users,
      maxNotes: limits.maxNotes,
      maxNotebooks: limits.maxNotebooks,
      estimatedNotes,
      estimatedNotebooks
    }
  };
}
