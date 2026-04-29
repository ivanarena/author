import { openDatabase } from '../src/lib/server/db';
import { cleanupTrash } from '../src/lib/server/repository';

const db = await openDatabase();

try {
  const result = await cleanupTrash(db);
  console.log(
    `Deleted ${result.deletedNotes} notes and ${result.deletedNotebooks} notebooks older than ${result.cutoff}`
  );
} finally {
  db.close();
}
