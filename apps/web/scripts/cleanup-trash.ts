import { openDatabase } from '../src/lib/server/db';
import { shouldSyncRemoteDatabase } from '../src/lib/server/config';
import { cleanupTrash } from '../src/lib/server/repository';
import { syncRemoteDatabase } from '../src/lib/server/remote-sync';

const db = await openDatabase();

try {
  const result = await cleanupTrash(db);
  console.log(
    `Deleted ${result.deletedNotes} notes and ${result.deletedNotebooks} notebooks older than ${result.cutoff}`
  );
  if (shouldSyncRemoteDatabase()) {
    await syncRemoteDatabase(db);
    console.log('Remote mirror synchronized.');
  }
} finally {
  db.close();
}
