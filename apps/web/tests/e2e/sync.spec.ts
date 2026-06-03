import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  decryptNoteFields,
  ENCRYPTION_KEY_MATERIAL_STORAGE_KEY,
  encryptNoteFields,
  isEncryptedText,
  keyMaterialFromPassword,
  keyringMaterialFromWrapped,
  migratePasswordMaterialToAccountKeyring
} from '../../src/lib/client/encryption';
import {
  authProofFromPassword,
  passwordVerifierFromPassword,
  randomAuthNonce
} from '../../src/lib/shared/auth-proof';

let token = '';
const localDeviceId = 'e2e-browser-device';
const loginUsername = 'owner';
const loginPassword = 'e2e-password-2026';
let e2eKeyMaterial = '';

const testsWithoutPreloadedSession = new Set([
  'recovers editor text when reload interrupts the debounced save',
  'logs in from the profile menu when no session is stored',
  'signs up and manages trusted-device sign-in without ending the active session',
  'keeps local drafts when signing in and then syncs them remote'
]);

const testsWithoutRemoteTokenSetup = new Set([
  'recovers editor text when reload interrupts the debounced save',
  'logs in from the profile menu when no session is stored',
  'signs up and manages trusted-device sign-in without ending the active session'
]);

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
  isFavorite: boolean;
  deviceId: string;
  version: number;
  syncStatus: 'synced' | 'pending' | 'conflict' | 'deleted';
};

async function browserStoredNotes(page: Page): Promise<RemoteNote[]> {
  return await page.evaluate(
    () =>
      new Promise<RemoteNote[]>((resolve, reject) => {
        const request = indexedDB.open('author');
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
  body: string,
  keyMaterial?: string
) {
  await expect
    .poll(async () => {
      const material =
        keyMaterial ?? (await browserEncryptionKeyMaterial(page));
      if (!material) return false;
      const rawNotes = await browserStoredNotes(page);
      const decryptedNotes = await Promise.all(
        rawNotes.map((note) => decryptNoteFields(note, material))
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

async function browserEncryptionKeyMaterial(page: Page): Promise<string> {
  return await page.evaluate(
    (key) => sessionStorage.getItem(key) ?? localStorage.getItem(key) ?? '',
    ENCRYPTION_KEY_MATERIAL_STORAGE_KEY
  );
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
  const challengeResponse = await request.post('/api/auth/challenge', {
    data: {
      username: loginUsername,
      purpose: 'login',
      clientNonce: randomAuthNonce()
    }
  });
  expect(challengeResponse.ok()).toBe(true);
  const challenge = await challengeResponse.json();
  const loginBody =
    challenge.mode === 'bootstrap'
      ? {
          username: loginUsername,
          bootstrapPassword: loginPassword,
          passwordVerifier: await passwordVerifierFromPassword(loginPassword),
          device: { id: localDeviceId, name: 'E2E browser' }
        }
      : {
          username: loginUsername,
          proof: (await authProofFromPassword(loginPassword, challenge)).proof,
          device: { id: localDeviceId, name: 'E2E browser' }
        };
  const response = await request.post('/api/auth/login', {
    data: loginBody
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    token: string;
    e2eeKeyring?: string | null;
  };
  if (body.e2eeKeyring) {
    e2eKeyMaterial = await keyringMaterialFromWrapped(
      body.e2eeKeyring,
      loginUsername,
      loginPassword
    );
    return body.token;
  }

  const passwordMaterial = await keyMaterialFromPassword(
    loginUsername,
    loginPassword
  );
  const migrated = await migratePasswordMaterialToAccountKeyring(
    loginUsername,
    passwordMaterial
  );
  const keyringUpdate = await request.patch('/api/account', {
    headers: { authorization: `Bearer ${body.token}` },
    data: { e2eeKeyring: migrated.e2eeKeyring }
  });
  expect(keyringUpdate.ok()).toBe(true);
  e2eKeyMaterial = migrated.keyMaterial;
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

async function clickSignInSubmit(page: Page) {
  await page
    .getByRole('dialog', { name: 'Sign in' })
    .getByRole('button', { name: 'Sign in to sync' })
    .click();
}

async function setEditorFieldSynchronously(
  page: Page,
  label: 'Note title' | 'Note body',
  value: string
) {
  await page.getByLabel(label).evaluate((field, nextValue) => {
    const editorField = field as HTMLInputElement | HTMLTextAreaElement;
    editorField.value = nextValue;
    editorField.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function openProfileMenu(page: Page) {
  const trigger = page.getByRole('button', { name: 'Profile and settings' });
  await expect(trigger).toBeVisible();
  await trigger.hover();
  await trigger.click();
  await expect(
    page.getByRole('menu', { name: 'Profile and settings menu' })
  ).toBeVisible();
}

async function expectFieldsInVerticalOrder(
  fields: Array<{ name: string; locator: ReturnType<Page['getByLabel']> }>
) {
  const boxes = await Promise.all(
    fields.map(async ({ name, locator }) => {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`${name} field is not visible`);
      return { name, top: box.y };
    })
  );

  for (let index = 1; index < boxes.length; index += 1) {
    expect(
      boxes[index].top,
      `${boxes[index].name} should appear below ${boxes[index - 1].name}`
    ).toBeGreaterThan(boxes[index - 1].top);
  }
}

async function waitForDraftEditorReady(page: Page) {
  await expect(page.getByLabel('Note title')).toBeVisible();
  await expect(page.getByLabel('Note body')).toBeVisible();
}

test.beforeEach(async ({ page, request }, testInfo) => {
  if (!testsWithoutRemoteTokenSetup.has(testInfo.title)) {
    token = await loginForToken(request);
  }

  if (testsWithoutPreloadedSession.has(testInfo.title)) {
    await page.addInitScript((deviceId) => {
      localStorage.setItem('author-device-id', deviceId);
    }, localDeviceId);
    return;
  }

  await page.addInitScript(
    ({ deviceId, authToken, username, keyMaterial, keyMaterialStorageKey }) => {
      localStorage.setItem('author-device-id', deviceId);
      localStorage.setItem('author-token', authToken);
      localStorage.setItem('author-username', username);
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

test('renames notebooks and keeps their notes before delete', async ({
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
  await expect(
    page.getByText(notebookNoteTitle, { exact: true })
  ).toBeVisible();
});

test('keeps a stored online session synced from local edits', async ({
  page,
  request
}) => {
  await page.goto('/');
  await waitForVisibleSyncedStatus(page);

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
  await waitForVisibleSyncedStatus(page);

  const titleText = `Reloaded local note ${Date.now()}`;
  const bodyText = 'Still here after a browser reload';

  await page.getByLabel('Note title').fill(titleText);
  await page.getByLabel('Note body').fill(bodyText);
  await expectBrowserStoredEncryptedNote(page, titleText, bodyText);

  await page.reload();
  await hoverMenusThroughBridge(page);
  const reloadedNote = page
    .getByRole('complementary', { name: 'Notes' })
    .getByRole('button')
    .filter({ hasText: titleText })
    .first();
  await expect(reloadedNote).toBeVisible();

  await reloadedNote.click();
  await expect(page.getByLabel('Note body')).toHaveValue(bodyText);
});

test('recovers editor text when reload interrupts the debounced save', async ({
  page
}) => {
  await page.goto('/');
  await waitForDraftEditorReady(page);

  const titleText = `Interrupted reload note ${Date.now()}`;
  const bodyText = 'Recovered from the synchronous editor recovery snapshot';

  await setEditorFieldSynchronously(page, 'Note title', titleText);
  await setEditorFieldSynchronously(page, 'Note body', bodyText);
  const recovery = await page.evaluate(() =>
    localStorage.getItem('author-editor-recovery-v1')
  );
  expect(recovery).toContain(titleText);
  expect(recovery).toContain(bodyText);
  await page.reload();

  await expect(page.getByLabel('Note title')).toHaveValue(titleText);
  await expect(page.getByLabel('Note body')).toHaveValue(bodyText);
  await expectBrowserStoredEncryptedNote(page, titleText, bodyText);
});

test('logs in from the profile menu when no session is stored', async ({
  page
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem('author-token');
    localStorage.removeItem('author-username');
    localStorage.removeItem('author-display-name');
    localStorage.removeItem('author-session-expires-at');
    localStorage.removeItem('author-encryption-key-material-v1');
    sessionStorage.removeItem('author-encryption-key-material-v1');
  });

  await page.goto('/');
  await waitForDraftEditorReady(page);
  await openProfileMenu(page);
  await page.getByRole('menuitem', { name: 'Sign in to sync' }).click();
  const loginDialog = page.getByRole('dialog', { name: 'Sign in' });
  await loginDialog.getByLabel('Username').fill(loginUsername);
  await loginDialog.getByLabel('Password', { exact: true }).fill(loginPassword);
  await clickSignInSubmit(page);

  await expect(loginDialog).toBeHidden({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('author-username')))
    .toBe(loginUsername);
  await expect.poll(() => browserEncryptionKeyMaterial(page)).not.toBe('');

  await openProfileMenu(page);
  await expect(
    page.getByRole('menuitem', { name: 'Log out and lock' })
  ).toBeVisible();
  await page.getByRole('menuitem', { name: 'Log out and lock' }).click();

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('author-username')))
    .toBeNull();
  await expect.poll(() => browserEncryptionKeyMaterial(page)).toBe('');
  await expect(page.getByRole('dialog', { name: 'Sign in' })).toBeVisible();
});

test('signs up and manages trusted-device sign-in without ending the active session', async ({
  context,
  page
}, testInfo) => {
  const signupDeviceId = `e2e-signup-device-${testInfo.retry}`;
  const signupUsername = `e2e-signup-${testInfo.retry}-${Date.now()}`;
  const signupEmail = `${signupUsername}@example.com`;
  const signupPassword = 'e2e-signup-password';
  let signedUpUser = {
    username: signupUsername,
    email: signupEmail,
    displayName: null as string | null,
    twoFactorEnabled: false
  };
  let trustedDevice = {
    deviceId: signupDeviceId,
    deviceName: 'This browser',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    current: true
  };
  await page.close();
  const signupPage = await context.newPage();

  await signupPage.addInitScript((deviceId) => {
    localStorage.setItem('author-device-id', deviceId);
  }, signupDeviceId);
  await signupPage.route('**/api/config', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        apiBaseUrl: 'http://127.0.0.1:5179',
        remote: { enabled: false, configured: false },
        signup: {
          enabled: true,
          emailRequired: true,
          emailAllowListRequired: true
        }
      })
    });
  });
  await signupPage.route('**/api/auth/signup', async (route) => {
    const body = route.request().postDataJSON() as {
      username: string;
      email: string;
      displayName?: string | null;
      device: { id: string; name: string };
    };
    signedUpUser = {
      username: body.username,
      email: body.email,
      displayName: body.displayName ?? null,
      twoFactorEnabled: false
    };
    trustedDevice = {
      deviceId: body.device.id,
      deviceName: body.device.name,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      current: true
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'signup-session-token',
        user: signedUpUser,
        device: body.device,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString()
      })
    });
  });
  await signupPage.route('**/api/account/trusted-devices/**', async (route) => {
    trustedDevice = { ...trustedDevice, current: false };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ user: signedUpUser, trustedDevices: [] })
    });
  });
  await signupPage.route('**/api/account', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        user: signedUpUser,
        trustedDevices: trustedDevice.current ? [trustedDevice] : []
      })
    });
  });
  await signupPage.route('**/api/sync/push', async (route) => {
    const body = route.request().postDataJSON() as {
      device?: { id: string; name: string };
    };
    if (body.device?.id === trustedDevice.deviceId) {
      trustedDevice = {
        ...trustedDevice,
        deviceName: body.device.name,
        lastUsedAt: new Date().toISOString()
      };
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        accepted: [],
        conflicts: [],
        serverTime: new Date().toISOString()
      })
    });
  });
  await signupPage.route('**/api/sync/pull', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        notes: [],
        notebooks: [],
        devices: [],
        deletedNoteIds: [],
        deletedNotebookIds: [],
        deletedDeviceIds: [],
        serverTime: new Date().toISOString(),
        serverRevision: 0
      })
    });
  });
  await signupPage.route('**/api/sync/status', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        remote: {
          enabled: false,
          state: 'disabled',
          pendingSince: null,
          lastStartedAt: null,
          lastSyncedAt: null,
          lastError: null
        }
      })
    });
  });

  await signupPage.goto('/');

  await waitForDraftEditorReady(signupPage);
  await openProfileMenu(signupPage);
  await signupPage.getByRole('menuitem', { name: 'Sign in to sync' }).click();
  const authDialog = signupPage.getByRole('dialog');
  await authDialog.getByRole('tab', { name: 'Sign up' }).click();
  const signupUsernameField = authDialog.getByLabel('Username');
  const signupEmailField = authDialog.getByLabel('Email');
  const signupPasswordField = authDialog.getByLabel('Password', {
    exact: true
  });
  const signupConfirmPasswordField = authDialog.getByLabel('Confirm password');
  await expectFieldsInVerticalOrder([
    { name: 'Username', locator: signupUsernameField },
    { name: 'Email', locator: signupEmailField },
    { name: 'Password', locator: signupPasswordField },
    { name: 'Confirm password', locator: signupConfirmPasswordField }
  ]);
  await signupUsernameField.fill(signupUsername);
  await signupEmailField.fill(signupEmail);
  await signupPasswordField.fill(signupPassword);
  await signupConfirmPasswordField.fill(signupPassword);
  await authDialog.getByRole('button', { name: 'Create account' }).click();

  await expect(authDialog).toBeHidden();
  await expect
    .poll(() =>
      signupPage.evaluate(() => localStorage.getItem('author-username'))
    )
    .toBe(signupUsername);
  await expect
    .poll(() => browserEncryptionKeyMaterial(signupPage))
    .toEqual(expect.any(String));

  await signupPage
    .getByRole('button', { name: 'Profile and settings' })
    .click();
  await signupPage.getByRole('menuitem', { name: 'Settings' }).click();
  const settingsDialog = signupPage.getByRole('dialog', { name: 'Settings' });
  const trustedDevices = settingsDialog.locator(
    '[aria-label="Trusted devices"]'
  );
  await expect(
    trustedDevices.getByText(
      'Removing trust stops future 2FA-code sign-in without a password. It does not log out an active session on that device.'
    )
  ).toBeVisible();
  await expect(trustedDevices.getByText('This browser')).toBeVisible();

  await trustedDevices
    .getByRole('button', { name: 'Remove trusted sign-in for This browser' })
    .click();

  await expect(trustedDevices.getByText('No trusted devices')).toBeVisible();
  await expect
    .poll(() =>
      signupPage.evaluate(() => localStorage.getItem('author-username'))
    )
    .toBe(signupUsername);
});

test('keeps local drafts when signing in and then syncs them remote', async ({
  page,
  request
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem('author-token');
    localStorage.removeItem('author-username');
    localStorage.removeItem('author-display-name');
    localStorage.removeItem('author-session-expires-at');
    localStorage.removeItem('author-encryption-key-material-v1');
    sessionStorage.removeItem('author-encryption-key-material-v1');
  });

  await page.goto('/');
  await waitForDraftEditorReady(page);

  const titleText = `Local before login ${Date.now()}`;
  const bodyText = 'This local draft must survive account sign-in';
  await page.getByLabel('Note title').fill(titleText);
  await page.getByLabel('Note body').fill(bodyText);
  await expectBrowserStoredEncryptedNote(page, titleText, bodyText);

  await openProfileMenu(page);
  await page.getByRole('menuitem', { name: 'Sign in to sync' }).click();
  const loginDialog = page.getByRole('dialog', { name: 'Sign in' });
  await loginDialog.getByLabel('Username').fill(loginUsername);
  await loginDialog.getByLabel('Password', { exact: true }).fill(loginPassword);
  await clickSignInSubmit(page);

  await expect(loginDialog).toBeHidden({ timeout: 30_000 });
  await hoverMenusThroughBridge(page);
  await expect(page.getByText(titleText, { exact: true })).toBeVisible();
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

test('exports Markdown without closing settings', async ({ page }) => {
  await page.goto('/');
  await openProfileMenu(page);
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await expect(page.getByText('Markdown', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Markdown ZIP' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^author-.*-md-frontmatter\.zip$/
  );
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
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
  await waitForVisibleSyncedStatus(page);

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
    isFavorite: false,
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
  await waitForVisibleSyncedStatus(page);

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

  await dialog.getByRole('button', { name: 'Keep This browser' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await pullRemoteNotes(request)).find(
          (note) => note.title === 'Browser sync note'
        )?.body ?? null,
      { timeout: 15_000 }
    )
    .toBe('Local browser version');
});

test('has no serious app-shell accessibility violations @a11y', async ({
  page
}) => {
  await page.goto('/');
  await waitForDraftEditorReady(page);

  const results = await new AxeBuilder({ page }).include('body').analyze();
  const violations = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? '')
  );

  expect(
    violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target)
    }))
  ).toEqual([]);
});

test('keeps the editor usable on a narrow mobile viewport @mobile', async ({
  page
}) => {
  await page.goto('/');
  await waitForDraftEditorReady(page);

  const titleText = `Mobile viewport note ${Date.now()}`;
  const bodyText = 'Written on the narrow browser project';

  await page.getByLabel('Note title').fill(titleText);
  await page.getByLabel('Note body').fill(bodyText);
  await expect(page.getByLabel('Note body')).toHaveValue(bodyText);
  await expectBrowserStoredEncryptedNote(page, titleText, bodyText);
});
