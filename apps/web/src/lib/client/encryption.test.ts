import { describe, expect, it } from 'vitest';
import type { Note } from '@author/schema';
import {
  decryptNoteFields,
  decryptText,
  encryptNoteFields,
  encryptText,
  isEncryptedText,
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

describe('client note encryption', () => {
  it('encrypts and decrypts text envelopes', async () => {
    const encrypted = await encryptText('private text', 'test-key');

    expect(encrypted).not.toContain('private text');
    expect(isEncryptedText(encrypted)).toBe(true);
    await expect(decryptText(encrypted, 'test-key')).resolves.toBe('private text');
  });

  it('keeps note field encryption deterministic for sync comparisons', async () => {
    const first = await encryptNoteFields(note, 'sync-key');
    const second = await encryptNoteFields(note, 'sync-key');

    expect(first.title).toBe(second.title);
    expect(first.body).toBe(second.body);
    expect(first.title).not.toContain(note.title);
    expect(first.body).not.toContain(note.body);
    await expect(decryptNoteFields(first, 'sync-key')).resolves.toMatchObject({
      title: note.title,
      body: note.body
    });
  });

  it('reencrypts existing notes when the active key changes', async () => {
    const oldEncrypted = await encryptNoteFields(note, 'old-key');
    const nextEncrypted = await reencryptNoteFields(oldEncrypted, 'old-key', 'new-key');

    expect(nextEncrypted.body).not.toBe(oldEncrypted.body);
    await expect(decryptNoteFields(nextEncrypted, 'new-key')).resolves.toMatchObject({
      title: note.title,
      body: note.body
    });
    expect(await decryptText(nextEncrypted.body, 'old-key')).toBe(nextEncrypted.body);
  });
});
