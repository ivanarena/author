import type { Device, Note, Notebook } from '@author/schema';

export const fixtureDevice: Device = {
  id: 'fixture-device',
  name: 'Fixture Laptop'
};

export const fixtureNotebook: Notebook = {
  id: 'fixture-notebook',
  name: 'Inbox',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  deviceId: fixtureDevice.id,
  version: 1,
  syncStatus: 'synced'
};

export const fixtureNote: Note = {
  id: 'fixture-note',
  title: 'Seed note',
  body: 'A small local-first note.',
  notebookId: fixtureNotebook.id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  trashedAt: null,
  deviceId: fixtureDevice.id,
  version: 1,
  syncStatus: 'synced'
};
