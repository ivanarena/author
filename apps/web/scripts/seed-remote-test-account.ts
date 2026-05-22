import {
  assertNoCurrentOnlyBlockers,
  openRemoteTestDatabase,
  seedRemoteTestAccount
} from './remote-test-data';
import {
  assertSafeRemoteTestTarget,
  remoteTestTargetFromEnv
} from '../src/lib/server/remote-test-target';

const target = remoteTestTargetFromEnv();
assertSafeRemoteTestTarget(target);

const db = await openRemoteTestDatabase(target);
try {
  await assertNoCurrentOnlyBlockers(db);
  const result = await seedRemoteTestAccount(db, target);
  console.log(
    `Seeded ${target.username} in remote test database: ${result.notebooks.length} notebooks, ${result.notes.length} notes, ${result.acceptedRecords} accepted records`
  );
  console.log(`Remote test account email: ${target.email}`);
} finally {
  db.close();
}
