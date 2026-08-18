import {
  createSignupInvitation,
  isSignupEmailAllowed
} from '../src/lib/server/auth';
import {
  getRemoteDatabaseConfig,
  shouldSyncRemoteDatabase
} from '../src/lib/server/config';
import {
  openConfiguredDatabase,
  openDatabase,
  type NotesDb
} from '../src/lib/server/db';

const email = process.argv[2]?.trim();
const days = Number(process.argv[3] ?? '7');
if (!email || !Number.isFinite(days) || days <= 0 || days > 90) {
  console.error(
    'Usage: tsx scripts/create-signup-invitation.ts <email> [days:1-90]'
  );
  process.exit(1);
}

let db: NotesDb;
const remoteConfig = getRemoteDatabaseConfig();
if (remoteConfig && shouldSyncRemoteDatabase()) {
  db = await openConfiguredDatabase(remoteConfig);
} else {
  db = await openDatabase();
}

try {
  if (!(await isSignupEmailAllowed(db, email))) {
    throw new Error('Email is not in signup_allowed_emails');
  }
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000);
  console.log(`Email: ${email.toLowerCase()}`);
  console.log(`Expires: ${expiresAt.toISOString()}`);
  console.log(`Invitation: ${createSignupInvitation(email, expiresAt)}`);
} finally {
  db.close();
}
