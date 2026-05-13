import { randomBytes } from 'node:crypto';
import { openDatabase } from '../src/lib/server/db';
import {
  authenticateUser,
  setUserPassword,
  updateUserProfile
} from '../src/lib/server/auth';

function usage(): never {
  console.error(
    'Usage: tsx scripts/create-user.ts <username> [password|--random] [email]'
  );
  process.exit(1);
}

function randomPassword(): string {
  return randomBytes(24).toString('base64url');
}

const username = process.argv[2];
const passwordArg = process.argv[3];
const email = process.argv[4];
if (!username) usage();

const password =
  passwordArg === '--random' || !passwordArg ? randomPassword() : passwordArg;
const db = await openDatabase();

try {
  const user = await setUserPassword(db, username, password);
  if (email) {
    await updateUserProfile(db, user.username, user.displayName, email);
  }
  const verified = await authenticateUser(db, user.username, password);
  if (!verified)
    throw new Error(`Created user ${user.username} could not authenticate`);

  console.log(`User: ${user.username}`);
  if (email) console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
} finally {
  db.close();
}
