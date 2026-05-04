import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  decryptNoteFields,
  ENCRYPTION_KEY_MATERIAL_STORAGE_KEY,
  encryptNoteFields,
  isEncryptedText,
  keyMaterialFromPassword
} from '../../src/lib/client/encryption';

let token = '';
const localDeviceId = 'e2e-browser-device';
const loginUsername = 'owner';
const loginPassword = 'e2e-password';
let e2eKeyMaterial = '';

type RemoteNote = {
  id: string;
  title: string;
  body: string;
  notebookIds: string[];
  notebookId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  trashedAt: string | null;
  deviceId: string;
  version: number;
  syncStatus: 'synced' | 'pending' | 'conflict' | 'deleted';
};

async function browserStoredNotes(page: Page): Promise<RemoteNote[]> {
  return await page.evaluate(
    () =>
      new Promise<RemoteNote[]>((resolve, reject) => {
        const request = indexedDB.open('author-notes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('notes', 'readonly');
          const getAll = transaction.objectStore('notes').getAll();
          getAll.onerror = () => reject(getAll.error);
          getAll.onsuccess = () => {
            resolve(getAll.result as RemoteNote[]);
            db.close();
          };
        };
      })
  );
}

async function expectBrowserStoredEncryptedNote(
  page: Page,
  title: string,
  body: string
) {
  await expect
    .poll(async () => {
      const rawNotes = await browserStoredNotes(page);
      const decryptedNotes = await Promise.all(
        rawNotes.map((note) => decryptNoteFields(note, e2eKeyMaterial))
      );
      const noteIndex = decryptedNotes.findIndex(
        (note) => note.title === title && note.body === body
      );
      if (noteIndex === -1) return false;

      const rawNote = rawNotes[noteIndex];
      return (
        isEncryptedText(rawNote.title) &&
        isEncryptedText(rawNote.body) &&
        !rawNote.title.includes(title) &&
        !rawNote.body.includes(body)
      );
    })
    .toBe(true);
}

async function pullRemoteNotes(
  request: APIRequestContext
): Promise<RemoteNote[]> {
  const response = await request.post('/api/sync/pull', {
    headers: { authorization: `Bearer ${token}` },
    data: { since: null }
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { notes: RemoteNote[] };
  return Promise.all(
    body.notes.map((note) => decryptNoteFields(note, e2eKeyMaterial))
  );
}

async function pushRemoteNote(
  request: APIRequestContext,
  note: RemoteNote,
  baseVersion: number,
  device = { id: 'e2e-remote-device', name: 'E2E remote' }
) {
  const encryptedNote = await encryptNoteFields(note, e2eKeyMaterial);
  const response = await request.post('/api/sync/push', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      device,
      notebooks: [],
      notes: [{ record: encryptedNote, baseVersion }]
    }
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { conflicts: unknown[] };
  expect(body.conflicts).toHaveLength(0);
}

async function loginForToken(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/auth/login', {
    data: {
      username: loginUsername,
      password: loginPassword,
      device: { id: localDeviceId, name: 'E2E browser' }
    }
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { token: string };
  return body.token;
}

async function hoverMenusThroughBridge(page: Page) {
  const menuButton = page.getByRole('button', { name: 'Show menus' });
  const box = await menuButton.boundingBox();
  if (!box) throw new Error('Menu button is not visible');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 6);
  await page.mouse.move(box.x + 80, box.y + box.height + 18);
}

async function waitForVisibleSyncedStatus(page: Page) {
  await hoverMenusThroughBridge(page);
  await expect(
    page
      .getByRole('complementary', { name: 'Notes' })
      .getByLabel('Sync status: All changes saved')
  ).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  token = await loginForToken(request);
  e2eKeyMaterial = await keyMaterialFromPassword(loginUsername, loginPassword);
  await page.addInitScript(
    ({ deviceId, authToken, username, keyMaterial, keyMaterialStorageKey }) => {
      localStorage.setItem('author-notes-device-id', deviceId);
      localStorage.setItem('author-notes-token', authToken);
      localStorage.setItem('author-notes-username', username);
      localStorage.setItem(keyMaterialStorageKey, keyMaterial);
    },
    {
      deviceId: localDeviceId,
      authToken: token,
      username: loginUsername,
      keyMaterial: e2eKeyMaterial,
      keyMaterialStorageKey: ENCRYPTION_KEY_MATERIAL_STORAGE_KEY
    }
  );
});

test('renames notebooks and trashes their notes before delete', async ({
  page
}) => {
  await page.goto('/');

  await hoverMenusThroughBridge(page);
  await page.getByRole('button', { name: 'New notebook' }).click();
  await page.getByPlaceholder('Notebook name').fill('Ideas');
  await page.getByRole('button', { name: 'Create notebook' }).click();

  const notebook = page.getByRole('button', { name: 'Ideas' });
  await expect(notebook).toBeVisible();
  await notebook.hover();
  await page.getByRole('button', { name: 'Rename notebook' }).click();

  await page.getByRole('textbox', { name: 'Notebook name' }).fill('Work');
  await page.getByRole('button', { name: 'Save notebook name' }).click();
  await expect(page.getByRole('button', { name: 'Work' })).toBeVisible();
  await expect(page.locator('nav')).toHaveCSS('scrollbar-width', 'none');

  const notebookNoteTitle = `Notebook note ${Date.now()}`;
  await page.getByLabel('Note title').fill(notebookNoteTitle);
  await page.getByLabel('Note body').fill('This should be recoverable.');
  await expectBrowserStoredEncryptedNote(
    page,
    notebookNoteTitle,
    'This should be recoverable.'
  );

  await page.getByRole('button', { name: 'Work', exact: true }).hover();
  await page
    .getByRole('button', { name: 'Delete notebook', exact: true })
    .click();
  await expect(page.getByRole('group', { name: 'Delete Work?' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm delete notebook' }).click();

  await expect(page.getByRole('button', { name: 'Work' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Trash' }).click();
  await expect(
    page.getByText(notebookNoteTitle, { exact: true })
  ).toBeVisible();
});

test('keeps a stored online session synced from local edits', async ({
  page,
  request
}) => {
  await page.goto('/');

  const titleText = `Online session note ${Date.now()}`;
  const bodyText = 'Autosynced from a local IndexedDB edit';

  await page.getByLabel('Note title').fill(titleText);
  await page.getByLabel('Note body').fill(bodyText);
  await expectBrowserStoredEncryptedNote(page, titleText, bodyText);

  await expect
    .poll(
      async () =>
        (await pullRemoteNotes(request)).find(
          (note) => note.title === titleText
        )?.body ?? null,
      { timeout: 15_000 }
    )
    .toBe(bodyText);
});

test('shows local IndexedDB notes after a browser reload', async ({ page }) => {
  await page.goto('/');

  const titleText = `Reloaded local note ${Date.now()}`;
  const bodyText = 'Still here after a browser reload';

  await page.getByLabel('Note title').fill(titleText);
  await page.getByLabel('Note body').fill(bodyText);
  await expectBrowserStoredEncryptedNote(page, titleText, bodyText);

  await page.reload();
  await hoverMenusThroughBridge(page);
  await expect(page.getByText(titleText, { exact: true })).toBeVisible();

  await page.getByText(titleText, { exact: true }).click();
  await expect(page.getByLabel('Note body')).toHaveValue(bodyText);
});

test('logs in from the profile menu when no session is stored', async ({
  page
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem('author-notes-token');
    localStorage.removeItem('author-notes-username');
    localStorage.removeItem('author-notes-display-name');
    localStorage.removeItem('author-notes-session-expires-at');
    localStorage.removeItem('author-notes-encryption-key-material-v1');
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Profile and settings' }).click();
  await page.getByRole('menuitem', { name: 'Sign in to sync' }).click();
  const loginDialog = page.getByRole('dialog', { name: 'Sign in' });
  await loginDialog.getByLabel('Username').fill(loginUsername);
  await loginDialog.getByLabel('Password', { exact: true }).fill(loginPassword);
  await loginDialog
    .getByRole('button', { name: 'Sign in', exact: true })
    .click();

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('author-notes-token')))
    .toEqual(expect.any(String));
  await expect(loginDialog).toBeHidden();

  await page.getByRole('button', { name: 'Profile and settings' }).click();
  await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Log out' }).click();

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('author-notes-token')))
    .toBeNull();
  await page.getByRole('button', { name: 'Profile and settings' }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Sign in to sync' })
  ).toBeVisible();
});

test('exports deprecated JSON without closing settings and shows JSON import result banners', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Profile and settings' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await expect(page.getByText('Deprecated')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^author-notes-.*\.json$/);

  const importButton = page.getByRole('button', { name: 'Import JSON' });
  await expect(importButton).toBeVisible();
  await expect(importButton).toBeEnabled();

  let chooserPromise = page.waitForEvent('filechooser');
  await importButton.click();
  let chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'author-notes-broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{')
  });
  await expect(page.getByText('Import failed')).toBeVisible();

  chooserPromise = page.waitForEvent('filechooser');
  await importButton.click();
  chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'author-notes-import-smoke.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        app: 'author-notes',
        format: 'author-notes-json',
        version: 1,
        exportedAt: '2026-05-04T09:00:00.000Z',
        notebooks: [{ id: 'smoke-notebook', name: 'Smoke Test' }],
        notes: [
          {
            title: 'Import smoke',
            body: 'Imported from the e2e archive test.',
            notebookIds: ['smoke-notebook'],
            createdAt: '2026-05-04T09:00:00.000Z',
            updatedAt: '2026-05-04T09:00:00.000Z',
            trashedAt: null
          }
        ]
      })
    )
  });

  await expect(page.getByText('Import succeeded')).toBeVisible();
  await expect(page.getByLabel('Note title')).toHaveValue('Import smoke');
  await expect(page.getByLabel('Note body')).toHaveValue(
    'Imported from the e2e archive test.'
  );
});

test('keeps edits made during an online sync pending until the latest local version lands', async ({
  page,
  request
}) => {
  let sawFirstPush: () => void = () => undefined;
  const firstPushStarted = new Promise<void>((resolve) => {
    sawFirstPush = resolve;
  });
  let delayedFirstPush = false;

  await page.route('**/api/sync/push', async (route) => {
    if (!delayedFirstPush) {
      delayedFirstPush = true;
      sawFirstPush();
      await page.waitForTimeout(700);
    }
    await route.continue();
  });

  await page.goto('/');

  const titleText = `In-flight local edit ${Date.now()}`;
  const firstBody = 'First version sent to the server';
  const secondBody = 'Second version typed while sync is still running';

  await page.getByLabel('Note title').fill(titleText);
  await page.getByLabel('Note body').fill(firstBody);
  await expectBrowserStoredEncryptedNote(page, titleText, firstBody);

  await firstPushStarted;

  await page.getByLabel('Note body').fill(secondBody);
  await expectBrowserStoredEncryptedNote(page, titleText, secondBody);

  await expect
    .poll(
      async () =>
        (await pullRemoteNotes(request)).find(
          (note) => note.title === titleText
        )?.body ?? null,
      { timeout: 15_000 }
    )
    .toBe(secondBody);
});

test('keeps local offline edits and reports conflicts when the online session returns', async ({
  page,
  request
}) => {
  const now = new Date().toISOString();
  const titleText = `Reconnect conflict ${Date.now()}`;
  const note: RemoteNote = {
    id: `e2e-reconnect-conflict-${Date.now()}`,
    title: titleText,
    body: 'Original remote note',
    notebookIds: [],
    notebookId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    trashedAt: null,
    deviceId: 'e2e-seed-device',
    version: 1,
    syncStatus: 'pending'
  };
  await pushRemoteNote(request, note, 0, {
    id: 'e2e-seed-device',
    name: 'E2E seed'
  });

  await page.goto('/');
  await hoverMenusThroughBridge(page);
  const seededNote = page.getByText(titleText, { exact: true });
  await expect(seededNote).toBeVisible();
  await seededNote.click();

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.context().setOffline(true);

  const localBody = 'Local browser version while offline';
  await page.getByLabel('Note body').fill(localBody);
  await expectBrowserStoredEncryptedNote(page, titleText, localBody);

  const remoteBody = 'Remote phone version while browser was offline';
  await pushRemoteNote(
    request,
    {
      ...note,
      body: remoteBody,
      deviceId: 'e2e-phone-device',
      updatedAt: new Date(Date.now() + 1000).toISOString(),
      version: 2,
      syncStatus: 'pending'
    },
    1,
    { id: 'e2e-phone-device', name: 'E2E Phone' }
  );

  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  const dialog = page.getByRole('dialog', { name: 'Sync conflict' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(remoteBody);
  await expect(dialog).toContainText(localBody);
});

test('persists in browser IndexedDB, syncs, and shows stale-edit conflicts', async ({
  page,
  request
}) => {
  await page.goto('/');

  const title = page.getByLabel('Note title');
  const body = page.getByLabel('Note body');

  await expect(title).toBeVisible();

  await title.fill('Browser sync note');
  await body.fill('Stored in IndexedDB first');
  await expect(body).toHaveValue('Stored in IndexedDB first');
  await expectBrowserStoredEncryptedNote(
    page,
    'Browser sync note',
    'Stored in IndexedDB first'
  );

  await expect
    .poll(
      async () =>
        (await pullRemoteNotes(request)).find(
          (note) => note.title === 'Browser sync note'
        )?.body ?? null,
      { timeout: 15_000 }
    )
    .toBe('Stored in IndexedDB first');
  const remoteNote = (await pullRemoteNotes(request)).find(
    (note) => note.title === 'Browser sync note'
  );
  expect(remoteNote).toBeDefined();
  await waitForVisibleSyncedStatus(page);

  const phoneEdit = {
    ...remoteNote!,
    body: 'Remote phone version',
    deviceId: 'e2e-phone-device',
    updatedAt: new Date(Date.now() + 1000).toISOString(),
    version: remoteNote!.version + 1,
    syncStatus: 'pending' as const
  };
  const encryptedPhoneEdit = await encryptNoteFields(phoneEdit, e2eKeyMaterial);
  const remotePush = await request.post('/api/sync/push', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      device: { id: 'e2e-phone-device', name: 'E2E Phone' },
      notebooks: [],
      notes: [{ record: encryptedPhoneEdit, baseVersion: remoteNote!.version }]
    }
  });
  expect(remotePush.ok()).toBe(true);

  await body.fill('Local browser version');

  const dialog = page.getByRole('dialog', { name: 'Sync conflict' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText('Remote phone version');
  await expect(dialog).toContainText('Local browser version');
});
