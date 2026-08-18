import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note, Notebook } from '@author/schema';
import {
  ENCRYPTION_KEY_MATERIAL_STORAGE_KEY,
  ENCRYPTION_KEY_MATERIAL_STORAGE_MODE_KEY,
  ENCRYPTION_DECRYPT_FAILED_MESSAGE,
  assertSupportedEncryptionKeyMaterial,
  canDecryptEncryptedText,
  clearStoredEncryptionKeyMaterial,
  commitEncryptionKeyMaterial,
  createRecoveryBundle,
  decryptNotebookFields,
  decryptNoteFields,
  decryptText,
  encryptNotebookFields,
  encryptNoteFields,
  encryptText,
  getEncryptionKeyMaterialStorageMode,
  getEncryptionKeyMaterial,
  hasStoredEncryptionKeyMaterial,
  isCurrentEncryptedText,
  isCurrentFieldHash,
  isEncryptedText,
  isUnsupportedEncryptedText,
  keyMaterialFromPassword,
  keyringMaterialFromWrapped,
  migratePasswordMaterialToAccountKeyring,
  prepareNewAccountKeyring,
  reencryptNoteFields,
  restoreKeyringFromRecoveryKit,
  rewrapKeyringForPassword,
  setEncryptionKeyMaterialStorageMode
} from './encryption';

const note: Note = {
  id: 'note-1',
  title: 'Launch notes',
  body: 'Keep this body out of raw storage.',
  notebookIds: [],
  notebookId: null,
  createdAt: '2026-04-30T10:00:00.000Z',
  updatedAt: '2026-04-30T10:00:00.000Z',
  deletedAt: null,
  trashedAt: null,
  isFavorite: false,
  deviceId: 'device-1',
  version: 1,
  syncStatus: 'pending'
};

const notebook: Notebook = {
  id: 'notebook-1',
  name: 'Ideas',
  createdAt: '2026-04-30T10:00:00.000Z',
  updatedAt: '2026-04-30T10:00:00.000Z',
  deletedAt: null,
  deviceId: 'device-1',
  version: 1,
  syncStatus: 'pending'
};

const crossDeviceFixture = {
  username: 'ivanknowswhat',
  password: 'cross-device-password-2026',
  keyMaterial:
    'keyring:v1:eyJ2ZXJzaW9uIjoxLCJzY29wZSI6ImFjY291bnQiLCJhY2NvdW50VXNlcm5hbWUiOiJpdmFua25vd3N3aGF0IiwiYWN0aXZlS2V5SWQiOiJka19jcm9zc19kZXZpY2VfdGVzdCIsImtleXMiOlt7ImlkIjoiZGtfY3Jvc3NfZGV2aWNlX3Rlc3QiLCJtYXRlcmlhbCI6IkFRSURCQVVHQndnSkNnc01EUTRQRUJFU0V4UVZGaGNZR1JvYkhCMGVIeUEiLCJjcmVhdGVkQXQiOiIyMDI2LTA2LTA2VDAwOjAwOjAwLjAwMFoiLCJzdGF0dXMiOiJhY3RpdmUifV0sImNyZWF0ZWRBdCI6IjIwMjYtMDYtMDZUMDA6MDA6MDAuMDAwWiIsInVwZGF0ZWRBdCI6IjIwMjYtMDYtMDZUMDA6MDA6MDAuMDAwWiJ9',
  e2eeKeyring:
    '{"version":1,"activeKeyId":"dk_cross_device_test","wrappedAt":"2026-06-06T00:00:00.000Z","passwordWrap":{"alg":"AES-256-GCM","kdf":"sha256","context":"password","iv":"EBESExQVFhcYGRob","ciphertext":"y7APgNIh9IA6rt6GuOe7pTGfT09DNii7F9Fi5eB8-GewVRoZKmYvcKmmS-mJsqSfx2Ho6ZzGr2HH6-J3xIj40UakTLjxksoG2O_pb4utD0dNh-Ls7rtvyE4SvNMPgEYmjAsHo7K9ChBYMLLblaOvBvEAPENlqBbURKvefwAAKYGrzdSOGpm728cV5_IBnx4RAuPZzYprhwKHlPSKhmSkaxOBPSr9aHLIGWwv9DAklpMfDmJReUibWbsY6DLI1-9RGC3taBrD08dvPk4uEr2866ansAl3_mqSKHMszDM4LIMKKljWc09n-ZGFN-KsCkbiGMX0cbaAXLH6e40Nri0oqKtzZKAgGAh6IKcHO8iTTs3lbucdI6BS9BGph8BcpcntjwV4EUuDJVg4EWOTcMJyRUwTV-wb1TI7ixzCKqLbywU3GTfECAp_6Zc6qMZMYY2Idolmnw2ZOqnEUskZnZpAMzAN33x3Q1PBj62xa6Eo0S4MWrl-o5Wdm4USBu6JAdLylzcaGPtwm2ohmefC_WyGpf26S6qa7qSoSH9vzDS3nXLjlDrnBeLBLp-nQMa1PJjmRQYADDuohUdON5h0LMniZpdYYIxf_dUiEPEfnxL_xG3-yPgxzhLY"}}',
  title:
    'enc:v4:dk_cross_device_test:ICEiIyQlJicoKSor:NIHVEIZ2taJuy2T8Z22wyD3wFxOWxToCV1ChoQPZkEEEFQ',
  body: 'enc:v4:dk_cross_device_test:MDEyMzQ1Njc4OTo7:Ogt4VSKzR-umq82mqNrCHbF661Qoz4GMjc30m1di5H1q'
};

class MemoryStorage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function legacyV3EncryptText(
  value: string,
  keyMaterial: string,
  context = 'text'
): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`author:encryption:v3:${keyMaterial}`)
  );
  const key = await crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: bufferSource(iv),
      additionalData: bufferSource(
        encoder.encode(`author:encrypted-field:v3:${context}`)
      )
    },
    key,
    encoder.encode(value)
  );
  return `enc:v3:${base64UrlEncode(iv)}:${base64UrlEncode(
    new Uint8Array(ciphertext)
  )}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client note encryption', () => {
  it('encrypts and decrypts text envelopes', async () => {
    const encrypted = await encryptText('private text', 'test-key');

    expect(encrypted).not.toContain('private text');
    expect(isEncryptedText(encrypted)).toBe(true);
    expect(isCurrentEncryptedText(encrypted)).toBe(true);
    await expect(decryptText(encrypted, 'test-key')).resolves.toBe(
      'private text'
    );
  });

  it('binds encrypted fields to their entity context', async () => {
    const encrypted = await encryptText(
      'private text',
      'test-key',
      'note:note-1:title'
    );

    await expect(
      decryptText(encrypted, 'test-key', 'note:note-1:title')
    ).resolves.toBe('private text');
    await expect(
      decryptText(encrypted, 'test-key', 'note:note-2:title')
    ).rejects.toThrow(ENCRYPTION_DECRYPT_FAILED_MESSAGE);
    await expect(
      decryptText(encrypted, 'other-key', 'note:note-1:title')
    ).rejects.toThrow(ENCRYPTION_DECRYPT_FAILED_MESSAGE);
  });

  it('fails closed for text that imitates an encrypted namespace', async () => {
    const prefixedPlaintext = 'enc:v3:ZmFrZS1pdg:bm90LWFlcy1nY20';
    await expect(encryptText(prefixedPlaintext, 'test-key')).rejects.toThrow(
      'Unsupported or malformed encrypted field version'
    );
    await expect(
      canDecryptEncryptedText(prefixedPlaintext, 'test-key')
    ).resolves.toBe(false);
  });

  it('keeps note field hashes deterministic for sync comparisons', async () => {
    const first = await encryptNoteFields(note, 'sync-key');
    const second = await encryptNoteFields(note, 'sync-key');

    expect(first.titleHash).toBe(second.titleHash);
    expect(first.bodyHash).toBe(second.bodyHash);
    expect(isCurrentFieldHash(first.titleHash)).toBe(true);
    expect(isCurrentFieldHash(first.bodyHash)).toBe(true);
    expect(first.title).not.toBe(second.title);
    expect(first.body).not.toBe(second.body);
    expect(first.title).not.toContain(note.title);
    expect(first.body).not.toContain(note.body);
    await expect(decryptNoteFields(first, 'sync-key')).resolves.toMatchObject({
      title: note.title,
      body: note.body
    });
  });

  it('rejects prefixed note fields with malformed envelopes', async () => {
    const prefixedNote = {
      ...note,
      title: 'enc:v3:dGl0bGU:ZmFrZQ',
      body: 'enc:v3:Ym9keQ:ZmFrZQ',
      titleHash: 'hash:v2:stale-title',
      bodyHash: 'hash:v2:stale-body'
    };

    await expect(encryptNoteFields(prefixedNote, 'sync-key')).rejects.toThrow(
      'Unsupported or malformed encrypted field version'
    );
  });

  it('refuses to republish current note ciphertext with the wrong key', async () => {
    const encrypted = await encryptNoteFields(note, 'old-key');

    await expect(encryptNoteFields(encrypted, 'new-key')).rejects.toThrow(
      ENCRYPTION_DECRYPT_FAILED_MESSAGE
    );
  });

  it('encrypts notebook names with deterministic hashes for duplicate checks', async () => {
    const first = await encryptNotebookFields(notebook, 'sync-key');
    const second = await encryptNotebookFields(
      { ...notebook, id: 'notebook-2' },
      'sync-key'
    );
    const normalizedDuplicate = await encryptNotebookFields(
      { ...notebook, id: 'notebook-3', name: ' ideas ' },
      'sync-key'
    );

    expect(first.nameHash).toBe(second.nameHash);
    expect(first.nameHash).toBe(normalizedDuplicate.nameHash);
    expect(isCurrentFieldHash(first.nameHash)).toBe(true);
    expect(first.name).not.toBe(second.name);
    expect(first.name).not.toContain(notebook.name);
    await expect(
      decryptNotebookFields(first, 'sync-key')
    ).resolves.toMatchObject({
      name: notebook.name
    });
  });

  it('binds notebook name envelopes to their notebook id', async () => {
    const encrypted = await encryptNotebookFields(notebook, 'sync-key');
    const moved = {
      ...notebook,
      id: 'notebook-2',
      name: encrypted.name
    };

    await expect(
      decryptNotebookFields(encrypted, 'sync-key')
    ).resolves.toMatchObject({
      name: notebook.name
    });
    await expect(decryptNotebookFields(moved, 'sync-key')).rejects.toThrow(
      ENCRYPTION_DECRYPT_FAILED_MESSAGE
    );
  });

  it('refuses to republish current notebook ciphertext with the wrong key', async () => {
    const encrypted = await encryptNotebookFields(notebook, 'old-key');

    await expect(encryptNotebookFields(encrypted, 'new-key')).rejects.toThrow(
      ENCRYPTION_DECRYPT_FAILED_MESSAGE
    );
  });

  it('reencrypts existing notes when the active key changes', async () => {
    const oldEncrypted = await encryptNoteFields(note, 'old-key');
    const nextEncrypted = await reencryptNoteFields(
      oldEncrypted,
      'old-key',
      'new-key'
    );

    expect(nextEncrypted.body).not.toBe(oldEncrypted.body);
    await expect(
      decryptNoteFields(nextEncrypted, 'new-key')
    ).resolves.toMatchObject({
      title: note.title,
      body: note.body
    });
    await expect(decryptText(nextEncrypted.body, 'old-key')).rejects.toThrow(
      ENCRYPTION_DECRYPT_FAILED_MESSAGE
    );
  });

  it('generates local browser key material when storage is available', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    const material = getEncryptionKeyMaterial();

    expect(material).toMatch(/^keyring:v1:/);
    expect(storage.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBe(material);
    expect(hasStoredEncryptionKeyMaterial()).toBe(false);
  });

  it('recognizes password key material as sync-capable', async () => {
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', session);
    const material = await keyMaterialFromPassword('Owner', 'test-password');

    commitEncryptionKeyMaterial(material);

    expect(storage.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBe(material);
    expect(session.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBe(material);
    expect(getEncryptionKeyMaterial()).toBe(material);
    expect(hasStoredEncryptionKeyMaterial()).toBe(true);
    clearStoredEncryptionKeyMaterial();
    expect(hasStoredEncryptionKeyMaterial()).toBe(false);
    expect(session.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBeNull();
  });

  it('can keep sync key material session-only on hardened browsers', async () => {
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', session);
    const material = await keyMaterialFromPassword('Owner', 'test-password');

    setEncryptionKeyMaterialStorageMode('session');
    commitEncryptionKeyMaterial(material);

    expect(getEncryptionKeyMaterialStorageMode()).toBe('session');
    expect(storage.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBeNull();
    expect(session.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBe(material);
    expect(hasStoredEncryptionKeyMaterial()).toBe(true);

    session.clear();
    expect(hasStoredEncryptionKeyMaterial()).toBe(false);
    expect(getEncryptionKeyMaterial()).toMatch(/^keyring:v1:/);
    expect(storage.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toMatch(
      /^keyring:v1:/
    );
  });

  it('unwraps account keyrings and rewraps them without changing note keys', async () => {
    const prepared = await prepareNewAccountKeyring('Owner', 'test-password');
    const unwrapped = await keyringMaterialFromWrapped(
      prepared.e2eeKeyring,
      'owner',
      'test-password'
    );
    const encrypted = await encryptNoteFields(note, unwrapped);

    expect(unwrapped).toBe(prepared.keyMaterial);
    await expect(
      decryptNoteFields(encrypted, prepared.keyMaterial)
    ).resolves.toMatchObject({
      title: note.title,
      body: note.body
    });

    const rewrapped = await rewrapKeyringForPassword(
      prepared.keyMaterial,
      'owner',
      'new-password',
      prepared.e2eeKeyring
    );
    await expect(
      keyringMaterialFromWrapped(rewrapped, 'owner', 'new-password')
    ).resolves.toBe(prepared.keyMaterial);
    await expect(
      keyringMaterialFromWrapped(rewrapped, 'owner', 'test-password')
    ).rejects.toThrow(ENCRYPTION_DECRYPT_FAILED_MESSAGE);
  });

  it('matches the cross-device keyring and encrypted-field fixture', async () => {
    await expect(
      keyringMaterialFromWrapped(
        crossDeviceFixture.e2eeKeyring,
        crossDeviceFixture.username,
        crossDeviceFixture.password
      )
    ).resolves.toBe(crossDeviceFixture.keyMaterial);
    await expect(
      decryptText(
        crossDeviceFixture.title,
        crossDeviceFixture.keyMaterial,
        'note:fixture-note:title'
      )
    ).resolves.toBe('Cross-device title');
    await expect(
      decryptText(
        crossDeviceFixture.body,
        crossDeviceFixture.keyMaterial,
        'note:fixture-note:body'
      )
    ).resolves.toBe('Cross-device body');
    await expect(
      keyringMaterialFromWrapped(
        crossDeviceFixture.e2eeKeyring,
        crossDeviceFixture.username,
        'wrong-password-2026'
      )
    ).rejects.toThrow(ENCRYPTION_DECRYPT_FAILED_MESSAGE);
  });

  it('restores keyring material from a recovery kit and code', async () => {
    const prepared = await prepareNewAccountKeyring('Owner', 'test-password');
    const bundle = await createRecoveryBundle(
      prepared.e2eeKeyring,
      prepared.keyMaterial
    );

    expect(bundle.recoveryCode).toMatch(/^author-recovery-v1-/);
    expect(bundle.e2eeKeyring).toContain('"recoveryWrap"');
    await expect(
      restoreKeyringFromRecoveryKit(bundle.recoveryKit, bundle.recoveryCode)
    ).resolves.toBe(prepared.keyMaterial);
    await expect(
      restoreKeyringFromRecoveryKit(bundle.recoveryKit, 'wrong-code')
    ).rejects.toThrow('Invalid recovery code');
  });

  it('migrates legacy password-encrypted v3 envelopes into account keyrings', async () => {
    const passwordMaterial = await keyMaterialFromPassword(
      'Owner',
      'test-password'
    );
    const legacy = await legacyV3EncryptText(
      'legacy body',
      passwordMaterial,
      'note:note-1:body'
    );
    const migrated = await migratePasswordMaterialToAccountKeyring(
      'Owner',
      passwordMaterial
    );

    await expect(
      decryptText(legacy, migrated.keyMaterial, 'note:note-1:body')
    ).resolves.toBe('legacy body');

    const upgradedNote = await encryptNoteFields(
      { ...note, body: legacy },
      migrated.keyMaterial
    );
    expect(upgradedNote.body).toMatch(/^enc:v4:/);
    await expect(
      decryptText(upgradedNote.body, migrated.keyMaterial, 'note:note-1:body')
    ).resolves.toBe('legacy body');
  });

  it('moves existing sync key material when the browser storage mode changes', async () => {
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', session);
    const material = await keyMaterialFromPassword('Owner', 'test-password');

    commitEncryptionKeyMaterial(material);
    setEncryptionKeyMaterialStorageMode('session');

    expect(storage.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_MODE_KEY)).toBe(
      'session'
    );
    expect(storage.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBeNull();
    expect(session.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBe(material);

    setEncryptionKeyMaterialStorageMode('persistent');
    expect(storage.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBe(material);
    expect(session.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBe(material);
  });

  it('derives Argon2id-only password key material', async () => {
    const material = await keyMaterialFromPassword('Owner', 'test-password');

    expect(material).toMatch(
      /^password:v4:argon2id:m=19456,t=2,p=1:[A-Za-z0-9_-]+$/
    );
    expect(material).not.toContain('pbkdf2');
  });

  it('identifies old encryption formats as requiring the migration release', () => {
    expect(isUnsupportedEncryptedText('enc:v1:old')).toBe(true);
    expect(isUnsupportedEncryptedText('enc:v2:old')).toBe(true);
    expect(isUnsupportedEncryptedText('enc:v3:spoof')).toBe(true);
    expect(isUnsupportedEncryptedText('enc:v5:future')).toBe(true);

    expect(() =>
      assertSupportedEncryptionKeyMaterial(
        'password:v3:argon2id:m=1,t=1,p=1:key'
      )
    ).toThrow('migration-capable release');
    expect(() =>
      assertSupportedEncryptionKeyMaterial('password:old-sha-key')
    ).toThrow('migration-capable release');
    expect(() =>
      assertSupportedEncryptionKeyMaterial(
        'password:v4:argon2id:m=19456,t=2,p=1:key'
      )
    ).not.toThrow();
  });
});
