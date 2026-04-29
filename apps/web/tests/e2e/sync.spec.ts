import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const token = 'e2e-token';
const localDeviceId = 'e2e-browser-device';

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

async function hoverMenusThroughBridge(page: Page) {
  const menuButton = page.getByRole('button', { name: 'Show menus' });
  const box = await menuButton.boundingBox();
  if (!box) throw new Error('Menu button is not visible');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 6);
  await page.mouse.move(box.x + 80, box.y + box.height + 18);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ deviceId, authToken }) => {
      localStorage.setItem('author-notes-device-id', deviceId);
      localStorage.setItem('author-notes-token', authToken);
    },
    { deviceId: localDeviceId, authToken: token }
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

test('persists in browser IndexedDB, syncs, and shows stale-edit conflicts', async ({
  page,
  request
}) => {
  await page.goto('/');

  const title = page.getByLabel('Note title');
  const body = page.getByLabel('Note body');
  const menuButton = page.getByRole('button', { name: 'Show menus' });
  const syncButton = page.getByRole('button', { name: 'Sync', exact: true });

  await expect(title).toBeVisible();
  await menuButton.hover();
  await expect(syncButton).toBeVisible();
  await expect(syncButton).toBeEnabled();
  await hoverMenusThroughBridge(page);
  await expect(syncButton).toBeVisible();

  await title.fill('Browser sync note');
  await body.fill('Stored in IndexedDB first');
  await expect(body).toHaveValue('Stored in IndexedDB first');
  await expect.poll(() => browserNoteBodies(page)).toContain('Stored in IndexedDB first');

  await menuButton.hover();
  await syncButton.click();
  await expect(page.getByText('Synced')).toBeVisible();

  const pullResponse = await request.post('/api/sync/pull', {
    headers: { authorization: `Bearer ${token}` },
    data: { since: null }
  });
  expect(pullResponse.ok()).toBe(true);

  const pulled = (await pullResponse.json()) as {
    notes: Array<{
      id: string;
      title: string;
      body: string;
      notebookId: string | null;
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
      trashedAt: string | null;
      deviceId: string;
      version: number;
      syncStatus: 'synced' | 'pending' | 'conflict' | 'deleted';
    }>;
  };
  const remoteNote = pulled.notes.find((note) => note.title === 'Browser sync note');
  expect(remoteNote?.body).toBe('Stored in IndexedDB first');

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
  await page.waitForTimeout(300);
  await menuButton.hover();
  await syncButton.click();

  const dialog = page.getByRole('dialog', { name: 'Sync conflict' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Remote phone version');
  await expect(dialog).toContainText('Local browser version');
});
