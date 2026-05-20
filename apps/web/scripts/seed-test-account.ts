import type { Device, Note, Notebook } from '@author/schema';
import {
  openConfiguredDatabase,
  openDatabase,
  run,
  type NotesDb
} from '../src/lib/server/db';
import {
  getRemoteDatabaseConfig,
  shouldSyncRemoteDatabase
} from '../src/lib/server/config';
import {
  authenticateUser,
  setUserPassword,
  updateUserProfile
} from '../src/lib/server/auth';
import { pushChanges, upsertDevice } from '../src/lib/server/repository';

const DEFAULT_USERNAME = 'author-test';
const DEFAULT_PASSWORD = 'AuthorTest!2026';
const DEFAULT_EMAIL = 'author-test@example.local';

function usage(): never {
  console.error(
    'Usage: tsx scripts/seed-test-account.ts [username] [password] [email]'
  );
  process.exit(1);
}

const username = process.argv[2] ?? DEFAULT_USERNAME;
if (username === '--help' || username === '-h') usage();

const password = process.argv[3] ?? DEFAULT_PASSWORD;
const email = process.argv[4] ?? DEFAULT_EMAIL;
const normalizedUsername = username.trim().toLowerCase();
const prefix = `seed-${normalizedUsername.replace(/[^a-z0-9-]/g, '-')}`;

const device: Device = {
  id: `${prefix}-device`,
  name: 'Seeded Android test data'
};

const notebookNames = [
  'Inbox',
  'Work',
  'Product',
  'Home',
  'Reading',
  'Travel',
  'Finance',
  'Personal'
];

const notesByNotebook: Record<string, Array<[string, string]>> = {
  Inbox: [
    [
      'Loose ideas for the week',
      'Check the Android top bar, then try search after opening the keyboard.'
    ],
    [
      'Grocery fragments',
      'Coffee, lemons, rice, oat milk, and the good dish soap.'
    ],
    ['Call list', 'Book dentist, confirm package pickup, reply to Marco.']
  ],
  Work: [
    [
      'Monday standup',
      'Ship the profile menu cleanup, verify offline-first loading, and test sync.'
    ],
    [
      'Review notes',
      'Check empty states, long notebook names, and dense note lists on Android.'
    ],
    [
      'Release checklist',
      'Build APK, install on emulator, run focused tests, then smoke test login.'
    ],
    [
      'Bug triage',
      'Keyboard whitespace, stale APK installs, and confusing loading labels.'
    ]
  ],
  Product: [
    [
      'Search polish',
      'Make search visible without turning the notes list into a dashboard.'
    ],
    [
      'Settings IA',
      'Profile should be a small door: profile or sign in, settings, and sort.'
    ],
    [
      'Notebook separators',
      'Separate system filters, notebooks, and trash so the list scans faster.'
    ]
  ],
  Home: [
    [
      'Apartment measurements',
      'Desk wall is 184 cm. Shelf depth should stay below 28 cm.'
    ],
    ['Plants', 'Move basil closer to the window and trim the dry mint stems.'],
    [
      'Weekend reset',
      'Laundry, invoices, fridge cleanout, backup laptop photos.'
    ]
  ],
  Reading: [
    [
      'Books to revisit',
      'Calvino, Le Guin essays, A Pattern Language, and the typography manual.'
    ],
    [
      'Article queue',
      'Offline-first design, SQLite replication notes, and Compose text fields.'
    ],
    ['Quotes', 'The useful thing is usually smaller than the dramatic thing.']
  ],
  Travel: [
    [
      'Vienna walk',
      'Try the quiet route by the canal, then coffee near Schwedenplatz.'
    ],
    ['Packing list', 'Charger, notebook, passport, light jacket, headphones.'],
    [
      'Train idea',
      'A tiny reading journal organized by the sentence that made me stop.'
    ]
  ],
  Finance: [
    [
      'Monthly review',
      'Categorize subscriptions and move receipts into the archive folder.'
    ],
    ['Renewals', 'Domain, backup storage, phone plan, and accounting software.']
  ],
  Personal: [
    [
      'Morning pages fragment',
      'Start with the smallest honest sentence and let the page warm up.'
    ],
    [
      'Fitness notes',
      'Short walk after lunch, stretch calves, keep water on the desk.'
    ],
    [
      'Gift ideas',
      'Notebook refill, coffee beans, linen tea towel, tiny travel cable.'
    ]
  ]
};

function isoFor(index: number): string {
  const date = new Date(Date.UTC(2026, 4, 1, 9, 0, 0));
  date.setUTCDate(date.getUTCDate() + index);
  date.setUTCHours(9 + (index % 8), (index * 7) % 60);
  return date.toISOString();
}

const seededUpdatedDates = [
  '2026-06-01T09:15:00.000Z',
  '2026-05-19T10:05:00.000Z',
  '2026-05-18T15:40:00.000Z',
  '2026-05-15T08:30:00.000Z',
  '2026-05-04T17:20:00.000Z',
  '2026-04-22T11:10:00.000Z',
  '2026-03-12T14:25:00.000Z',
  '2026-02-08T09:50:00.000Z',
  '2026-01-06T16:15:00.000Z',
  '2025-12-17T12:45:00.000Z',
  '2025-11-11T13:05:00.000Z',
  '2025-10-03T18:00:00.000Z',
  '2025-09-14T07:35:00.000Z',
  '2025-08-21T20:10:00.000Z',
  '2025-07-09T10:30:00.000Z',
  '2025-06-18T11:55:00.000Z',
  '2025-05-02T14:05:00.000Z',
  '2025-04-15T09:45:00.000Z',
  '2025-03-27T17:30:00.000Z',
  '2025-02-10T08:20:00.000Z',
  '2025-01-23T15:15:00.000Z',
  '2024-12-04T12:00:00.000Z',
  '2024-09-19T16:40:00.000Z',
  '2024-06-06T10:10:00.000Z',
  '2024-03-28T11:25:00.000Z',
  '2023-11-16T13:50:00.000Z'
];

function noteDates(index: number): { createdAt: string; updatedAt: string } {
  const updatedAt = new Date(
    seededUpdatedDates[index % seededUpdatedDates.length]
  );
  const createdAt = new Date(updatedAt);
  createdAt.setUTCDate(createdAt.getUTCDate() - 2 - (index % 9));
  createdAt.setUTCHours(8 + (index % 6), (index * 11) % 60, 0, 0);
  return {
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString()
  };
}

function notebookId(name: string): string {
  return `${prefix}-notebook-${slug(name)}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const notebooks: Notebook[] = notebookNames.map((name, index) => ({
  id: notebookId(name),
  name,
  nameHash: null,
  createdAt: isoFor(index),
  updatedAt: isoFor(index),
  deletedAt: null,
  deviceId: device.id,
  version: 1,
  syncStatus: 'synced'
}));

let seededNoteIndex = 0;

const notes: Note[] = notebookNames.flatMap((notebookName) => {
  const notebookNotes = notesByNotebook[notebookName] ?? [];
  return notebookNotes.map(([title, body]) => {
    const { createdAt, updatedAt } = noteDates(seededNoteIndex);
    seededNoteIndex += 1;
    const id = `${prefix}-note-${slug(notebookName)}-${slug(title)}`;
    const notebook = notebookId(notebookName);
    return {
      id,
      title,
      body,
      titleHash: null,
      bodyHash: null,
      notebookIds: [notebook],
      notebookId: notebook,
      createdAt,
      updatedAt,
      deletedAt: null,
      trashedAt: null,
      deviceId: device.id,
      version: 1,
      syncStatus: 'synced'
    };
  });
});

notes.push(
  {
    id: `${prefix}-note-unfiled-quick-capture`,
    title: 'Quick capture',
    body: 'An unfiled note for testing the Unfiled filter and recent grouping.',
    titleHash: null,
    bodyHash: null,
    notebookIds: [],
    notebookId: null,
    ...noteDates(seededNoteIndex++),
    deletedAt: null,
    trashedAt: null,
    deviceId: device.id,
    version: 1,
    syncStatus: 'synced'
  },
  {
    id: `${prefix}-note-unfiled-search-keywords`,
    title: 'Search keywords',
    body: 'alpha beta keyboard profile sorting separators notebook android month year 2025 2024',
    titleHash: null,
    bodyHash: null,
    notebookIds: [],
    notebookId: null,
    ...noteDates(seededNoteIndex++),
    deletedAt: null,
    trashedAt: null,
    deviceId: device.id,
    version: 1,
    syncStatus: 'synced'
  }
);

async function seedDatabase(db: NotesDb, label: string): Promise<void> {
  const user = await setUserPassword(db, normalizedUsername, password);
  await updateUserProfile(db, user.username, user.displayName, email);

  await clearSeededWorkspace(db, user.username);
  await upsertDevice(db, device);
  const result = await pushChanges(
    db,
    {
      device,
      notebooks: notebooks.map((record) => ({ record, baseVersion: 0 })),
      notes: notes.map((record) => ({ record, baseVersion: 0 }))
    },
    user.username
  );

  const verified = await authenticateUser(db, user.username, password);
  if (!verified)
    throw new Error(`Seeded user ${user.username} could not authenticate`);

  console.log(
    `${label}: seeded ${notebooks.length} notebooks and ${notes.length} notes (${result.accepted.length} accepted records)`
  );
}

const db = await openDatabase();

try {
  await seedDatabase(db, 'Local');

  if (shouldSyncRemoteDatabase()) {
    const remoteConfig = getRemoteDatabaseConfig();
    if (remoteConfig) {
      const remote = await openConfiguredDatabase(remoteConfig);
      try {
        await seedDatabase(remote, 'Remote');
      } finally {
        remote.close();
      }
    }
  }

  console.log(`User: ${normalizedUsername}`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
} finally {
  db.close();
}

async function clearSeededWorkspace(
  db: NotesDb,
  ownerUsername: string
): Promise<void> {
  const args = [ownerUsername];
  await run(db, 'DELETE FROM note_versions WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM notebook_versions WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM notes WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM notebooks WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM entity_tombstones WHERE owner_username = ?', args);
  await run(db, 'DELETE FROM entity_changes WHERE owner_username = ?', args);
}
