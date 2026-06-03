import type { Device, Note, Notebook } from '@author/schema';

export const fixtureDevice: Device = {
  id: 'fixture-device',
  name: 'Fixture Laptop'
};

export const fixtureNotebooks: Notebook[] = [
  notebook('fixture-notebook-inbox', 'Inbox', '2026-01-03T08:30:00.000Z'),
  notebook('fixture-notebook-workshop', 'Workshop', '2026-01-12T15:45:00.000Z'),
  notebook('fixture-notebook-home', 'Home', '2026-02-01T10:10:00.000Z'),
  notebook('fixture-notebook-reading', 'Reading', '2026-02-18T19:20:00.000Z')
];

export const fixtureNotebook = fixtureNotebooks[0];

export const fixtureNotes: Note[] = [
  note(
    'fixture-note-launch-plan',
    'April launch checklist',
    [
      'Confirm the hosted backup before changing DNS.',
      'Write the short release note in plain language.',
      'Do one final phone sync test from the train.'
    ].join('\n'),
    fixtureNotebooks[1].id,
    '2026-02-24T09:05:00.000Z',
    '2026-04-21T14:30:00.000Z'
  ),
  note(
    'fixture-note-window-measurements',
    'Kitchen window measurements',
    'Left panel 68 cm wide. Right panel 69 cm. Order the white linen curtains, not the oatmeal ones.',
    fixtureNotebooks[2].id,
    '2026-03-02T18:15:00.000Z',
    '2026-03-02T18:24:00.000Z'
  ),
  note(
    'fixture-note-reading-list',
    'Books to revisit',
    'Calvino, Le Guin essays, A Pattern Language, and the typography manual with the margin chapter.',
    fixtureNotebooks[3].id,
    '2026-01-29T21:00:00.000Z',
    '2026-04-06T20:12:00.000Z'
  ),
  note(
    'fixture-note-inbox-fragment',
    'Morning pages fragment',
    'The useful thing is usually smaller than the dramatic thing. Start where the room is quiet.',
    fixtureNotebooks[0].id,
    '2026-04-26T07:40:00.000Z',
    '2026-04-26T07:48:00.000Z'
  ),
  note(
    'fixture-note-sync-question',
    'Offline sync question',
    'What should happen when the phone edits an old note while the laptop has been offline for a week?',
    fixtureNotebooks[1].id,
    '2026-03-18T11:35:00.000Z',
    '2026-04-11T16:05:00.000Z'
  ),
  note(
    'fixture-note-train-idea',
    'Train idea',
    'A tiny reading journal organized by the last sentence that made me stop.',
    null,
    '2026-02-07T13:10:00.000Z',
    '2026-02-07T13:10:00.000Z'
  )
];

export const fixtureNote = fixtureNotes[3];

function notebook(id: string, name: string, createdAt: string): Notebook {
  return {
    id,
    name,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    deviceId: fixtureDevice.id,
    version: 1,
    syncStatus: 'synced'
  };
}

function note(
  id: string,
  title: string,
  body: string,
  notebookId: string | null,
  createdAt: string,
  updatedAt: string
): Note {
  const notebookIds = notebookId ? [notebookId] : [];
  return {
    id,
    title,
    body,
    notebookIds,
    notebookId: notebookIds[0] ?? null,
    createdAt,
    updatedAt,
    deletedAt: null,
    trashedAt: null,
    isFavorite: false,
    deviceId: fixtureDevice.id,
    version: 1,
    syncStatus: 'synced'
  };
}
