import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

let token = '';
const localDeviceId = 'e2e-browser-device';
const loginUsername = 'owner';
const loginPassword = 'e2e-password';

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

async function browserNoteBodies(page: Page) {
  return await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open('author-notes');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('notes', 'readonly');
          const getAll = transaction.objectStore('notes').getAll();
          getAll.onerror = () => reject(getAll.error);
          getAll.onsuccess = () => {
            resolve(getAll.result.map((note) => String(note.body ?? '')));
            db.close();
          };
        };
      })
  );
}

async function pullRemoteNotes(request: APIRequestContext): Promise<RemoteNote[]> {
  const response = await request.post('/api/sync/pull', {
    headers: { authorization: `Bearer ${token}` },
    data: { since: null }
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { notes: RemoteNote[] };
  return body.notes;
}

async function pushRemoteNote(
  request: APIRequestContext,
  note: RemoteNote,
  baseVersion: number,
  device = { id: 'e2e-remote-device', name: 'E2E remote' }
) {
  const response = await request.post('/api/sync/push', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      device,
      notebooks: [],
      notes: [{ record: note, baseVersion }]
    }
  });
  expect(response.ok()).toBe(true);
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

test.beforeEach(async ({ page, request }) => {
  token = await loginForToken(request);
  await page.addInitScript(
    ({ deviceId, authToken, username }) => {
      localStorage.setItem('author-notes-device-id', deviceId);
      localStorage.setItem('author-notes-token', authToken);
      localStorage.setItem('author-notes-username', username);
    },
    { deviceId: localDeviceId, authToken: token, username: loginUsername }
  );
});

test('renames and deletes notebooks from hover controls', async ({ page }) => {
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

  await page.getByRole('button', { name: 'Work' }).hover();
  await page.getByRole('button', { name: 'Delete notebook', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Delete Work?' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm delete notebook' }).click();

  await expect(page.getByRole('button', { name: 'Work' })).toHaveCount(0);
});

test('keeps a stored online session synced from local edits', async ({ page, request }) => {
  await page.goto('/');

  const titleText = `Online session note ${Date.now()}`;
  const bodyText = 'Autosynced from a local IndexedDB edit';

  await page.getByLabel('Note title').fill(titleText);
  await page.getByLabel('Note body').fill(bodyText);
  await expect.poll(() => browserNoteBodies(page)).toContain(bodyText);

  await expect
    .poll(
      async () => (await pullRemoteNotes(request)).find((note) => note.title === titleText)?.body ?? null,
      { timeout: 15_000 }
    )
    .toBe(bodyText);
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
  await expect.poll(() => browserNoteBodies(page)).toContain(firstBody);

  await firstPushStarted;

  await page.getByLabel('Note body').fill(secondBody);
  await expect.poll(() => browserNoteBodies(page)).toContain(secondBody);

  await expect
    .poll(
      async () => (await pullRemoteNotes(request)).find((note) => note.title === titleText)?.body ?? null,
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
  await pushRemoteNote(request, note, 0, { id: 'e2e-seed-device', name: 'E2E seed' });

  await page.goto('/');
  await hoverMenusThroughBridge(page);
  const seededNote = page.getByText(titleText, { exact: true });
  await expect(seededNote).toBeVisible();
  await seededNote.click();

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.context().setOffline(true);

  const localBody = 'Local browser version while offline';
  await page.getByLabel('Note body').fill(localBody);
  await expect.poll(() => browserNoteBodies(page)).toContain(localBody);

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
  await expect.poll(() => browserNoteBodies(page)).toContain('Stored in IndexedDB first');

  await expect
    .poll(
      async () => (await pullRemoteNotes(request)).find((note) => note.title === 'Browser sync note')?.body ?? null,
      { timeout: 15_000 }
    )
    .toBe('Stored in IndexedDB first');
  const remoteNote = (await pullRemoteNotes(request)).find((note) => note.title === 'Browser sync note');
  expect(remoteNote).toBeDefined();

  const phoneEdit = {
    ...remoteNote!,
    body: 'Remote phone version',
    deviceId: 'e2e-phone-device',
    updatedAt: new Date(Date.now() + 1000).toISOString(),
    version: remoteNote!.version + 1,
    syncStatus: 'pending' as const
  };
  const remotePush = await request.post('/api/sync/push', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      device: { id: 'e2e-phone-device', name: 'E2E Phone' },
      notebooks: [],
      notes: [{ record: phoneEdit, baseVersion: remoteNote!.version }]
    }
  });
  expect(remotePush.ok()).toBe(true);

  await body.fill('Local browser version');

  const dialog = page.getByRole('dialog', { name: 'Sync conflict' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText('Remote phone version');
  await expect(dialog).toContainText('Local browser version');
});
