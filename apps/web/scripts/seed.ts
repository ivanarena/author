import {
  fixtureDevice,
  fixtureNotes,
  fixtureNotebooks
} from '@author/test-fixtures';
import { exec, openDatabase } from '../src/lib/server/db';
import { pushChanges, upsertDevice } from '../src/lib/server/repository';

const db = await openDatabase();

try {
  await exec(
    db,
    `DELETE FROM note_versions;
     DELETE FROM notebook_versions;
     DELETE FROM entity_tombstones;
     DELETE FROM entity_changes;
     DELETE FROM notes;
     DELETE FROM notebooks;
     DELETE FROM devices;
     DELETE FROM sync_meta WHERE key LIKE 'mirror.%';`
  );

  await upsertDevice(db, fixtureDevice);
  const result = await pushChanges(db, {
    device: fixtureDevice,
    notebooks: fixtureNotebooks.map((record) => ({ record, baseVersion: 0 })),
    notes: fixtureNotes.map((record) => ({ record, baseVersion: 0 }))
  });

  console.log(
    `Reset and seeded ${result.accepted.length} records (${fixtureNotebooks.length} notebooks, ${fixtureNotes.length} notes)`
  );
} finally {
  db.close();
}
