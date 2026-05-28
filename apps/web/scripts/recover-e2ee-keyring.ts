import { readFileSync } from 'node:fs';
import {
  recoveryKitText,
  restoreKeyringFromRecoveryKit,
  rewrapKeyringForPassword,
  type E2eeRecoveryKit
} from '../src/lib/client/encryption';
import {
  AUTH_PROOF_ALGORITHM,
  authKdfParamsString,
  passwordVerifierFromPassword
} from '../src/lib/shared/auth-proof';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const kitPath = requiredEnv('AUTHOR_RECOVERY_KIT_PATH');
const recoveryCode = requiredEnv('AUTHOR_RECOVERY_CODE');
const username = requiredEnv('AUTHOR_RECOVERY_USERNAME').toLowerCase();
const newPassword = requiredEnv('AUTHOR_RECOVERY_NEW_PASSWORD');
const output = process.env.AUTHOR_RECOVERY_OUTPUT?.trim() || 'sql';

const kit = JSON.parse(readFileSync(kitPath, 'utf8')) as E2eeRecoveryKit;
const keyMaterial = await restoreKeyringFromRecoveryKit(kit, recoveryCode);
const e2eeKeyring = await rewrapKeyringForPassword(
  keyMaterial,
  username,
  newPassword
);
const verifier = await passwordVerifierFromPassword(newPassword);
const passwordHash = `${AUTH_PROOF_ALGORITHM}:v1:${authKdfParamsString(
  verifier.params
)}:${verifier.storedKey}:${verifier.serverKey}`;
const passwordSalt = verifier.salt;

if (output === 'json') {
  console.log(
    JSON.stringify(
      {
        username,
        passwordHash,
        passwordSalt,
        e2eeKeyring,
        recoveryKit: JSON.parse(recoveryKitText(kit))
      },
      null,
      2
    )
  );
} else {
  console.log(
    [
      'BEGIN;',
      `DELETE FROM auth_sessions WHERE username = ${sqlString(username)};`,
      `DELETE FROM trusted_auth_devices WHERE username = ${sqlString(
        username
      )};`,
      `UPDATE users SET password_hash = ${sqlString(
        passwordHash
      )}, password_salt = ${sqlString(passwordSalt)}, e2ee_keyring = ${sqlString(
        e2eeKeyring
      )}, updated_at = CURRENT_TIMESTAMP WHERE username = ${sqlString(username)};`,
      'COMMIT;'
    ].join('\n')
  );
}
