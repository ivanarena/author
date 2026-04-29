import { fixtureDevice, fixtureNote, fixtureNotebook } from '@author/test-fixtures';
import { openDatabase } from '../src/lib/server/db';
import { pushChanges, upsertDevice } from '../src/lib/server/repository';

const db = await openDatabase();

try {
  await upsertDevice(db, fixtureDevice);
  const result = await pushChanges(db, {
    device: fixtureDevice,
    notebooks: [{ record: fixtureNotebook, baseVersion: 0 }],
    notes: [{ record: fixtureNote, baseVersion: 0 }]
  });

  console.log(`Seeded ${result.accepted.length} records`);
} finally {
  db.close();
}
