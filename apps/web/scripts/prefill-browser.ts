import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import type { Device, Note, Notebook } from '@author/schema';

interface LocalNote extends Note {
  lastSyncedVersion: number;
  lastSyncedAt: string | null;
}

interface LocalNotebook extends Notebook {
  lastSyncedVersion: number;
  lastSyncedAt: string | null;
}

const appUrl = process.env.NOTES_APP_URL ?? 'http://127.0.0.1:5173';
const headless = process.env.HEADLESS === '1';
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profileDir =
  process.env.NOTES_MOCK_PROFILE ??
  resolve(appRoot, '.data/mock-browser-profile');

const devices: Device[] = [
  { id: 'mock-device-laptop', name: 'Mock laptop' },
  { id: 'mock-device-phone', name: 'Mock phone' }
];

const notebooks: LocalNotebook[] = [
  mockNotebook('mock-notebook-work', 'Work', 42),
  mockNotebook('mock-notebook-personal', 'Personal', 36),
  mockNotebook('mock-notebook-reading', 'Reading', 18)
];

const notes: LocalNote[] = [
  mockNote(
    'mock-note-01',
    'Weekly planning',
    'Sketch launch tasks, decide the smallest next action, and keep the afternoon clear for writing.',
    'mock-notebook-work',
    0,
    1
  ),
  mockNote(
    'mock-note-02',
    'Apartment list',
    'Replace the entry bulb. Pick up coffee filters. Measure the window before ordering linen curtains.',
    'mock-notebook-personal',
    0,
    3
  ),
  mockNote(
    'mock-note-03',
    'Sync questions',
    'What should happen when the phone edits an old note while the laptop is offline for a week?',
    'mock-notebook-work',
    1,
    2,
    'mock-device-phone'
  ),
  mockNote(
    'mock-note-04',
    'Morning pages fragment',
    'The useful thing is usually smaller than the dramatic thing. Start where the room is quiet.',
    null,
    2,
    4
  ),
  mockNote(
    'mock-note-05',
    'Books to revisit',
    'Calvino, Le Guin essays, and that old typography manual with the excellent chapter on margins.',
    'mock-notebook-reading',
    4,
    5
  ),
  mockNote(
    'mock-note-06',
    'Recipe adjustment',
    'Use less lemon, more salt, and wait longer before stirring the onions. The slow version wins.',
    'mock-notebook-personal',
    8,
    3
  ),
  mockNote(
    'mock-note-07',
    'Project notes',
    'The app should feel instant offline. Menus can stay hidden until needed, but recovery paths must be obvious.',
    'mock-notebook-work',
    12,
    1
  ),
  mockNote(
    'mock-note-08',
    'Quote without a source',
    'A clean page is not empty. It is a place where attention has room to arrive.',
    null,
    21,
    6
  ),
  mockNote(
    'mock-note-09',
    'Long train idea',
    'A tiny reading journal organized by the last sentence that made me stop.',
    'mock-notebook-reading',
    45,
    2
  ),
  mockNote(
    'mock-note-10',
    'Winter packing',
    'Gloves, charger, notebook, wool socks, paperback, and the black pen that does not smear.',
    'mock-notebook-personal',
    96,
    4
  )
];

function mockNotebook(
  id: string,
  name: string,
  daysAgo: number
): LocalNotebook {
  const createdAt = daysAgoIso(daysAgo, 9);
  return {
    id,
    name,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    deviceId: 'mock-device-laptop',
    version: 1,
    syncStatus: 'synced',
    lastSyncedVersion: 1,
    lastSyncedAt: createdAt
  };
}

function mockNote(
  id: string,
  title: string,
  body: string,
  notebookId: string | null,
  daysAgo: number,
  hour: number,
  deviceId = 'mock-device-laptop'
): LocalNote {
  const updatedAt = daysAgoIso(daysAgo, 8 + hour);
  const createdAt = daysAgoIso(daysAgo + 2, 8 + hour);
  const notebookIds = notebookId ? [notebookId] : [];
  return {
    id,
    title,
    body,
    notebookIds,
    notebookId: notebookIds[0] ?? null,
    createdAt,
    updatedAt,
    deletedAt: null,
    trashedAt: null,
    deviceId,
    version: 1,
    syncStatus: 'synced',
    lastSyncedVersion: 1,
    lastSyncedAt: updatedAt
  };
}

function daysAgoIso(daysAgo: number, hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 15, 0, 0);
  return date.toISOString();
}

mkdirSync(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  headless,
  viewport: headless ? { width: 1440, height: 1000 } : null
});

try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  await page.evaluate('globalThis.__name = (target) => target');
  await page.evaluate(
    async ({ devices, notebooks, notes }) => {
      function openDatabase(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open('author');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      function transactionDone(transaction: IDBTransaction): Promise<void> {
        return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      }

      async function deleteMockRows(store: IDBObjectStore): Promise<void> {
        await new Promise<void>((resolve, reject) => {
          const request = store.openCursor();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve();
              return;
            }

            const id = String(cursor.key);
            if (id.startsWith('mock-')) {
              cursor.delete();
            }
            cursor.continue();
          };
        });
      }

      const db = await openDatabase();
      const deleteTransaction = db.transaction(
        ['devices', 'notebooks', 'notes', 'conflicts'],
        'readwrite'
      );
      await Promise.all([
        deleteMockRows(deleteTransaction.objectStore('notes')),
        deleteMockRows(deleteTransaction.objectStore('notebooks')),
        deleteMockRows(deleteTransaction.objectStore('devices')),
        deleteMockRows(deleteTransaction.objectStore('conflicts')),
        transactionDone(deleteTransaction)
      ]);
      db.close();

      const writeDb = await openDatabase();
      const writeTransaction = writeDb.transaction(
        ['devices', 'notebooks', 'notes'],
        'readwrite'
      );
      const deviceStore = writeTransaction.objectStore('devices');
      const notebookStore = writeTransaction.objectStore('notebooks');
      const noteStore = writeTransaction.objectStore('notes');
      for (const device of devices) deviceStore.put(device);
      for (const notebook of notebooks) notebookStore.put(notebook);
      for (const note of notes) noteStore.put(note);
      await transactionDone(writeTransaction);
      writeDb.close();
    },
    { devices, notebooks, notes }
  );

  await page.reload({ waitUntil: 'networkidle' });
  console.log(`Seeded ${notes.length} mock notes in ${profileDir}`);

  if (!headless) {
    console.log('Mock browser is open. Press Ctrl+C when you are done.');
    await new Promise(() => {});
  }
} finally {
  if (headless) await context.close();
}
