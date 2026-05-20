import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Note, Notebook } from '@author/schema';
import {
  ENCRYPTION_KEY_MATERIAL_STORAGE_KEY,
  canDecryptEncryptedText,
  clearStoredEncryptionKeyMaterial,
  commitEncryptionKeyMaterial,
  decryptNotebookFields,
  decryptNoteFields,
  decryptText,
  encryptNotebookFields,
  encryptNoteFields,
  encryptText,
  getEncryptionKeyMaterial,
  hasStoredEncryptionKeyMaterial,
  isCurrentEncryptedText,
  isCurrentFieldHash,
  isEncryptedText,
  keyMaterialFromPassword,
  reencryptNoteFields
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

const testEncoder = new TextEncoder();

async function legacyPasswordMaterial(
  username: string,
  password: string
): Promise<string> {
  const normalized = username.trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    testEncoder.encode(`${normalized}\0${password}`)
  );
  return base64UrlEncode(new Uint8Array(digest));
}

async function passwordV2MaterialFromPassword(
  username: string,
  password: string
): Promise<string> {
  const normalized = username.trim().toLowerCase();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    testEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 210_000,
      salt: testEncoder.encode(`author:password-key:v2:${normalized}`)
    },
    passwordKey,
    256
  );
  return `password:v2:210000:${base64UrlEncode(new Uint8Array(derived))}:legacy:${await legacyPasswordMaterial(username, password)}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
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
    ).resolves.toBe(encrypted);
  });

  it('encrypts literal text that only imitates an encryption prefix', async () => {
    const prefixedPlaintext = 'enc:v2:ZmFrZS1pdg:bm90LWFlcy1nY20';
    const encrypted = await encryptText(prefixedPlaintext, 'test-key');

    expect(encrypted).not.toBe(prefixedPlaintext);
    expect(isEncryptedText(encrypted)).toBe(true);
    await expect(decryptText(encrypted, 'test-key')).resolves.toBe(
      prefixedPlaintext
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

  it('encrypts prefixed note fields instead of preserving spoofed envelopes', async () => {
    const prefixedNote = {
      ...note,
      title: 'enc:v2:dGl0bGU:ZmFrZQ',
      body: 'enc:v2:Ym9keQ:ZmFrZQ',
      titleHash: 'hash:v2:stale-title',
      bodyHash: 'hash:v2:stale-body'
    };

    const encrypted = await encryptNoteFields(prefixedNote, 'sync-key');

    expect(encrypted.title).not.toBe(prefixedNote.title);
    expect(encrypted.body).not.toBe(prefixedNote.body);
    expect(encrypted.titleHash).not.toBe(prefixedNote.titleHash);
    expect(encrypted.bodyHash).not.toBe(prefixedNote.bodyHash);
    await expect(
      decryptNoteFields(encrypted, 'sync-key')
    ).resolves.toMatchObject({
      title: prefixedNote.title,
      body: prefixedNote.body
    });
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
    await expect(
      decryptNotebookFields(moved, 'sync-key')
    ).resolves.toMatchObject({
      name: encrypted.name
    });
  });

  it('reads legacy notebook name envelopes and migrates them to id-bound context', async () => {
    const legacyEncrypted = {
      ...notebook,
      name: await encryptText(notebook.name, 'sync-key', 'notebook:name'),
      nameHash: null
    };

    await expect(
      decryptNotebookFields(legacyEncrypted, 'sync-key')
    ).resolves.toMatchObject({
      name: notebook.name
    });

    const migrated = await encryptNotebookFields(legacyEncrypted, 'sync-key');
    expect(migrated.name).not.toBe(legacyEncrypted.name);
    expect(isCurrentFieldHash(migrated.nameHash)).toBe(true);
    await expect(
      decryptNotebookFields(migrated, 'sync-key')
    ).resolves.toMatchObject({
      name: notebook.name
    });
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
    expect(await decryptText(nextEncrypted.body, 'old-key')).toBe(
      nextEncrypted.body
    );
  });

  it('generates local browser key material instead of using the legacy public fallback', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    const material = getEncryptionKeyMaterial();

    expect(material).toMatch(/^local:v2:/);
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

    expect(storage.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBeNull();
    expect(session.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBe(material);
    expect(getEncryptionKeyMaterial()).toBe(material);
    expect(hasStoredEncryptionKeyMaterial()).toBe(true);
    clearStoredEncryptionKeyMaterial();
    expect(hasStoredEncryptionKeyMaterial()).toBe(false);
    expect(session.getItem(ENCRYPTION_KEY_MATERIAL_STORAGE_KEY)).toBeNull();
  });

  it('derives Argon2id password key material with PBKDF2 and legacy fallbacks', async () => {
    const material = await keyMaterialFromPassword('Owner', 'test-password');

    expect(material).toMatch(
      /^password:v3:argon2id:m=19456,t=2,p=1:[A-Za-z0-9_-]+:pbkdf2:v2:210000:[A-Za-z0-9_-]+:legacy:[A-Za-z0-9_-]+$/
    );
  });

  it('uses only the active Argon2id segment for v3 primary encryption', async () => {
    const material = await keyMaterialFromPassword('Owner', 'test-password');
    const encrypted = await encryptText('argon secret', material);
    const tamperedFallbacks = [
      ...material.split(':').slice(0, 5),
      'pbkdf2',
      'v2',
      '210000',
      'unused-fallback',
      'legacy',
      'unused-legacy'
    ].join(':');

    expect(await decryptText(encrypted, tamperedFallbacks)).toBe(
      'argon secret'
    );
  });

  it('migrates PBKDF2 password notes to the active Argon2id material', async () => {
    const oldMaterial = await passwordV2MaterialFromPassword(
      'Owner',
      'password'
    );
    const oldEncrypted = await encryptNoteFields(note, oldMaterial);
    const nextMaterial = await keyMaterialFromPassword('Owner', 'password');

    await expect(
      decryptNoteFields(oldEncrypted, nextMaterial)
    ).resolves.toMatchObject({
      title: note.title,
      body: note.body
    });

    const migrated = await encryptNoteFields(oldEncrypted, nextMaterial);

    expect(migrated.title).not.toBe(oldEncrypted.title);
    expect(migrated.body).not.toBe(oldEncrypted.body);
    expect(
      await decryptText(migrated.body, oldMaterial, `note:${note.id}:body`)
    ).toBe(migrated.body);
    await expect(
      decryptNoteFields(migrated, nextMaterial)
    ).resolves.toMatchObject({
      title: note.title,
      body: note.body
    });
  });

  it('derives password key material that can still read legacy password notes', async () => {
    const legacyMaterial =
      'password:abSPzwfsxk9bY3O09rjIx28-3mo4XMf4kCbea9af9M0';
    const encrypted = await encryptText('legacy secret', legacyMaterial);
    const nextMaterial = await keyMaterialFromPassword('Owner', 'password');

    expect(nextMaterial).toContain(':legacy:');
    await expect(decryptText(encrypted, nextMaterial)).resolves.toBe(
      'legacy secret'
    );
  });
});
