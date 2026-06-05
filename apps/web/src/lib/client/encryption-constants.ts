export const ENCRYPTION_PREFIX = 'enc:v4:';
export const LEGACY_ENCRYPTION_PREFIX = 'enc:v3:';
export const ENCRYPTION_KEY_MATERIAL_STORAGE_KEY =
  'author-encryption-key-material-v1';
export const ENCRYPTION_KEY_MATERIAL_STORAGE_MODE_KEY =
  'author-encryption-key-material-mode-v1';
export const ENCRYPTION_UPGRADE_REQUIRED_MESSAGE =
  'This workspace uses an older encryption format. Open it with the migration-capable release first, then return to this version.';
export const ENCRYPTION_DECRYPT_FAILED_MESSAGE =
  'Encrypted note data cannot be decrypted with the active key material. Sign in again before syncing or changing this workspace.';

export const HASH_V3_PREFIX = 'hash:v3:';
export const KEYRING_MATERIAL_PREFIX = 'keyring:v1:';
export const RECOVERY_CODE_PREFIX = 'author-recovery-v1-';
export const PASSWORD_ARGON2_MEMORY_KIB = 19_456;
export const PASSWORD_ARGON2_ITERATIONS = 2;
export const PASSWORD_ARGON2_PARALLELISM = 1;
export const PASSWORD_ARGON2_SALT_PREFIX = 'author:password-key:v3';
export const CURRENT_ENCRYPTION_VERSION = 'v4';
export const LEGACY_ENCRYPTION_VERSION = 'v3';
export const CURRENT_PASSWORD_MATERIAL_VERSION = 'v4';
export const DIRECT_KEY_ID = 'direct';
export const NOTEBOOK_NAME_HASH_CONTEXT = 'notebook:name';

export type EncryptionKeyMaterialStorageMode = 'persistent' | 'session';

export interface PreparedAccountKeyring {
  keyMaterial: string;
  e2eeKeyring: string;
  recoveryCode: string;
  recoveryKit: E2eeRecoveryKit;
}

export interface E2eeRecoveryBundle {
  recoveryCode: string;
  recoveryKit: E2eeRecoveryKit;
  e2eeKeyring?: string;
}

export interface E2eeRecoveryKit {
  type: 'author-recovery-kit';
  version: 1;
  createdAt: string;
  recoveryWrap: WrappedKeyringBox;
  keyHint: string;
}

export type KeyringScope = 'local' | 'account';

export type KeyringKey = {
  id: string;
  material: string;
  createdAt: string;
  status: 'active' | 'retired';
};

export type KeyringMaterial = {
  version: 1;
  scope: KeyringScope;
  accountUsername?: string;
  activeKeyId: string;
  keys: KeyringKey[];
  legacyMaterials?: string[];
  createdAt: string;
  updatedAt: string;
};

export type WrappedE2eeKeyring = {
  version: 1;
  activeKeyId: string;
  wrappedAt: string;
  passwordWrap: WrappedKeyringBox;
  recoveryWrap?: WrappedKeyringBox;
};

export type WrappedKeyringBox = {
  alg: 'AES-256-GCM';
  kdf: 'sha256';
  context: 'password' | 'recovery';
  iv: string;
  ciphertext: string;
};

export type EncryptionEnvelope =
  | {
      version: 'v3';
      keyId: null;
      iv: Uint8Array;
      ciphertext: Uint8Array;
    }
  | {
      version: 'v4';
      keyId: string;
      iv: Uint8Array;
      ciphertext: Uint8Array;
    };

export type EncryptionKeyDescriptor = {
  version: 'v3' | 'v4';
  keyId: string;
  cacheKey: string;
  rawKey?: Uint8Array;
  directMaterial?: string;
};
