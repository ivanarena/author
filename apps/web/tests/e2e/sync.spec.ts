import { createHmac, randomBytes } from 'node:crypto';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  ENCRYPTION_UPGRADE_REQUIRED_MESSAGE,
  decryptNoteFields,
  decryptText,
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

function signupInvitation(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      email: email.toLowerCase(),
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      nonce: randomBytes(16).toString('base64url')
    })
  ).toString('base64url');
  const signature = createHmac('sha256', 'e2e-server-secret')
    .update(`author:signup-invitation:v1:${payload}`)
    .digest('base64url');
  return `invite:v1:${payload}:${signature}`;
}

const testsWithoutPreloadedSession = new Set([
  'recovers editor text when reload interrupts the debounced save @cross-browser',
  'logs in from the profile menu when no session is stored',
  'signs up with the real API and logs in again with the same password',
  'keeps local drafts when signing in and then syncs them remote'
]);

const testsWithoutRemoteTokenSetup = new Set([
  'recovers editor text when reload interrupts the debounced save @cross-browser',
  'logs in from the profile menu when no session is stored',
  'signs up with the real API and logs in again with the same password'
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

async function browserEditorRecovery(page: Page): Promise<{
  title: string;
  body: string;
} | null> {
  return await page.evaluate(
    () =>
      new Promise<{ title: string; body: string } | null>((resolve, reject) => {
        const request = indexedDB.open('author');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('editorRecovery', 'readonly');
          const get = transaction
            .objectStore('editorRecovery')
            .get('author-editor-recovery-v1');
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            resolve(
              get.result
                ? { title: get.result.title, body: get.result.body }
                : null
            );
            db.close();
          };
        };
      })
  );
}

async function browserDecryptedEditorRecovery(page: Page): Promise<{
  title: string;
  body: string;
} | null> {
  const [stored, keyMaterial] = await Promise.all([
    browserEditorRecovery(page),
    browserEncryptionKeyMaterial(page)
  ]);
  if (!stored || !keyMaterial) return null;
  return {
    title: await decryptText(
      stored.title,
      keyMaterial,
      'editor-recovery:v2:title'
    ),
    body: await decryptText(stored.body, keyMaterial, 'editor-recovery:v2:body')
  };
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

async function setInputValueWithoutInputEvent(locator: Locator, value: string) {
  await locator.evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('Expected an input element');
    }
    element.value = nextValue;
  }, value);
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

async function loginForDeviceToken(
  request: APIRequestContext,
  device: { id: string; name: string }
): Promise<string> {
  const challengeResponse = await request.post('/api/auth/challenge', {
    data: {
      username: loginUsername,
      purpose: 'login',
      clientNonce: randomAuthNonce()
    }
  });
  expect(challengeResponse.ok()).toBe(true);
  const challenge = await challengeResponse.json();
  const response = await request.post('/api/auth/login', {
    data: {
      username: loginUsername,
      proof: (await authProofFromPassword(loginPassword, challenge)).proof,
      device
    }
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { token: string }).token;
}

async function pushRemoteNote(
  request: APIRequestContext,
  note: RemoteNote,
  baseVersion: number,
  device = { id: 'e2e-remote-device', name: 'E2E remote' }
) {
  const encryptedNote = await encryptNoteFields(note, e2eKeyMaterial);
  const remoteToken = await loginForDeviceToken(request, device);
  const response = await request.post('/api/sync/push', {
    headers: { authorization: `Bearer ${remoteToken}` },
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
  const keyringChallengeResponse = await request.post('/api/auth/challenge', {
    headers: { authorization: `Bearer ${body.token}` },
    data: {
      purpose: 'keyring_update',
      clientNonce: randomAuthNonce()
    }
  });
  expect(keyringChallengeResponse.ok()).toBe(true);
  const keyringChallenge = await keyringChallengeResponse.json();
  const keyringProof = await authProofFromPassword(
    loginPassword,
    keyringChallenge
  );
  const keyringUpdate = await request.patch('/api/account', {
    headers: { authorization: `Bearer ${body.token}` },
    data: {
      e2eeKeyring: migrated.e2eeKeyring,
      expectedE2eeKeyringHash: null,
      proof: keyringProof.proof
    }
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

test('updates note list pressed states from visible actions', async ({
  page
}) => {
  await page.goto('/');
  await waitForVisibleSyncedStatus(page);
  await hoverMenusThroughBridge(page);

  const stateId = Date.now();
  const notebookName = `Pressed state ${stateId}`;
  await page.getByRole('button', { name: 'New notebook' }).click();
  await page.getByPlaceholder('Notebook name').fill(notebookName);
  await page.getByRole('button', { name: 'Create notebook' }).click();
  await expect(
    page.getByRole('button', { name: notebookName, exact: true })
  ).toBeVisible();

  const firstTitle = `Pressed first ${stateId}`;
  const secondTitle = `Pressed second ${stateId}`;
  await page.getByLabel('Note title').fill(firstTitle);
  await page.getByLabel('Note body').fill('First note for state checks');
  await expectBrowserStoredEncryptedNote(
    page,
    firstTitle,
    'First note for state checks'
  );

  const notesPanel = page.getByRole('complementary', { name: 'Notes' });
  await notesPanel.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByLabel('Note title')).toHaveValue('');
  await page.getByLabel('Note title').fill(secondTitle);
  await page.getByLabel('Note body').fill('Second note for state checks');
  await expectBrowserStoredEncryptedNote(
    page,
    secondTitle,
    'Second note for state checks'
  );

  await notesPanel
    .getByRole('searchbox', { name: 'Search notes' })
    .fill(`${stateId}`);
  await expect(notesPanel.getByRole('listitem')).toHaveCount(2);

  await hoverMenusThroughBridge(page);
  const firstRow = notesPanel.getByRole('listitem').filter({
    hasText: firstTitle
  });
  await expect(firstRow).toBeVisible();
  await firstRow.hover();
  await expect(
    firstRow.getByRole('button', { name: 'Add to Favorites' })
  ).toHaveAttribute('aria-pressed', 'false');
  await firstRow.getByRole('button', { name: 'Add to Favorites' }).click();
  await expect(
    firstRow.getByRole('button', { name: 'Remove from Favorites' })
  ).toHaveAttribute('aria-pressed', 'true');

  await notesPanel.getByLabel('Select all visible notes').check();
  await expect(
    notesPanel.getByLabel('Deselect all visible notes')
  ).toBeChecked();
  await expect(
    notesPanel.getByRole('button', { name: 'Move selected to notebook' })
  ).toBeVisible();
  await expect(notesPanel.getByText('2 selected')).toBeVisible();

  await notesPanel
    .getByRole('button', { name: 'Move selected to notebook' })
    .click();
  let notebookMenu = page.getByRole('menu', {
    name: 'Selected note notebooks'
  });
  await expect(notebookMenu).toBeVisible();
  await expect(
    notebookMenu.getByRole('menuitemcheckbox', { name: 'Unfiled' })
  ).toHaveAttribute('aria-checked', 'false');
  await expect(
    notebookMenu.getByRole('menuitemcheckbox', { name: notebookName })
  ).toHaveAttribute('aria-checked', 'false');
  await notebookMenu
    .getByRole('menuitemcheckbox', { name: notebookName })
    .click();

  await expect(firstRow.getByText(notebookName)).toBeVisible();
  await notesPanel
    .getByRole('button', { name: 'Move selected to notebook' })
    .click();
  notebookMenu = page.getByRole('menu', { name: 'Selected note notebooks' });
  await expect(
    notebookMenu.getByRole('menuitemcheckbox', { name: 'Unfiled' })
  ).toHaveAttribute('aria-checked', 'false');
  await expect(
    notebookMenu.getByRole('menuitemcheckbox', { name: notebookName })
  ).toHaveAttribute('aria-checked', 'true');
});

test('updates note history selected version pressed state', async ({
  page
}) => {
  await page.goto('/');
  await waitForVisibleSyncedStatus(page);

  const titleText = `History pressed ${Date.now()}`;
  const firstBody = 'First body saved before history opens';
  const secondBody = 'Second body saved before history opens';
  const thirdBody = 'Third body keeps history available';

  await page.getByLabel('Note title').fill(titleText);
  await page.getByLabel('Note body').fill(firstBody);
  await expectBrowserStoredEncryptedNote(page, titleText, firstBody);
  await page.getByLabel('Note body').fill(secondBody);
  await expectBrowserStoredEncryptedNote(page, titleText, secondBody);
  await page.getByLabel('Note body').fill(thirdBody);
  await expectBrowserStoredEncryptedNote(page, titleText, thirdBody);

  await page.getByRole('button', { name: 'Note history' }).click();
  const historyDialog = page.getByRole('dialog', { name: 'Note history' });
  await expect(historyDialog).toBeVisible();

  const secondSnapshot = historyDialog.getByRole('button', {
    name: new RegExp(secondBody)
  });
  const firstSnapshot = historyDialog.getByRole('button', {
    name: new RegExp(firstBody)
  });

  await expect(secondSnapshot).toHaveAttribute('aria-pressed', 'true');
  await expect(firstSnapshot).toHaveAttribute('aria-pressed', 'false');
  await firstSnapshot.click();
  await expect(firstSnapshot).toHaveAttribute('aria-pressed', 'true');
  await expect(secondSnapshot).toHaveAttribute('aria-pressed', 'false');
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

test('shows local IndexedDB notes after a browser reload @cross-browser', async ({
  page
}) => {
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

test('recovers editor text when reload interrupts the debounced save @cross-browser', async ({
  page
}) => {
  await page.clock.install();
  await page.goto('/');
  await waitForDraftEditorReady(page);
  await page.clock.pauseAt(Date.now() + 1_000);

  const titleText = `Interrupted reload note ${Date.now()}`;
  const bodyText = 'Recovered from the encrypted editor recovery snapshot';

  await setEditorFieldSynchronously(page, 'Note title', titleText);
  await setEditorFieldSynchronously(page, 'Note body', bodyText);
  await expect
    .poll(() => browserDecryptedEditorRecovery(page))
    .toEqual({ title: titleText, body: bodyText });
  const encryptedRecovery = await browserEditorRecovery(page);
  expect(encryptedRecovery?.title).not.toContain(titleText);
  expect(encryptedRecovery?.body).not.toContain(bodyText);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('author-editor-recovery-v1'))
    )
    .toBeNull();
  await page.reload({ waitUntil: 'commit' });
  await page.clock.resume();

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

test('signs up with the real API and logs in again with the same password', async ({
  browser,
  context,
  page
}, testInfo) => {
  const signupDeviceId = `e2e-signup-device-${testInfo.retry}`;
  const loginDeviceId = `e2e-signup-login-device-${testInfo.retry}`;
  const signupUsername = `e2e-signup-${testInfo.retry}-${Date.now()}`;
  const signupEmail = `e2e-signup-${testInfo.retry}@example.com`;
  const signupPassword = 'e2e-signup-password';
  const noteTitle = `Signup relogin note ${Date.now()}`;
  const noteBody = 'Created after signup and decrypted after relogin';
  await page.close();
  const signupPage = await context.newPage();

  await signupPage.addInitScript((deviceId) => {
    localStorage.setItem('author-device-id', deviceId);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () =>
          localStorage.getItem('author-e2e-clipboard') ?? '',
        writeText: async (value: string) => {
          localStorage.setItem('author-e2e-clipboard', value);
        }
      }
    });
  }, signupDeviceId);

  await signupPage.goto('/');

  await waitForDraftEditorReady(signupPage);
  await openProfileMenu(signupPage);
  await signupPage.getByRole('menuitem', { name: 'Sign in to sync' }).click();
  const authDialog = signupPage.getByRole('dialog', { name: 'Sign in' });
  await authDialog.getByRole('tab', { name: 'Sign up' }).click();
  const signupDialog = signupPage.getByRole('dialog', {
    name: 'Create account'
  });
  const signupUsernameField = signupDialog.getByLabel('Username');
  const signupEmailField = signupDialog.getByLabel('Email');
  const signupInvitationField = signupDialog.getByLabel('Invitation code');
  const signupPasswordField = signupDialog.getByLabel('Password', {
    exact: true
  });
  const signupConfirmPasswordField =
    signupDialog.getByLabel('Confirm password');
  await expectFieldsInVerticalOrder([
    { name: 'Username', locator: signupUsernameField },
    { name: 'Email', locator: signupEmailField },
    { name: 'Invitation code', locator: signupInvitationField },
    { name: 'Password', locator: signupPasswordField },
    { name: 'Confirm password', locator: signupConfirmPasswordField }
  ]);
  await signupUsernameField.fill(signupUsername);
  await signupEmailField.fill(signupEmail);
  await signupInvitationField.fill(signupInvitation(signupEmail));
  await setInputValueWithoutInputEvent(signupPasswordField, signupPassword);
  await setInputValueWithoutInputEvent(
    signupConfirmPasswordField,
    signupPassword
  );
  await signupDialog.getByRole('button', { name: 'Create account' }).click();

  await expect(signupDialog).toBeHidden();
  const recoveryDialog = signupPage.getByRole('dialog', {
    name: 'Save recovery key'
  });
  await expect(recoveryDialog).toBeVisible();
  const recoveryKeyField = recoveryDialog.locator('#signup-recovery-key');
  await expect(recoveryKeyField).toHaveValue(/^author-recovery-v1-/);
  const recoveryDone = recoveryDialog.getByRole('button', { name: 'Done' });
  await expect(recoveryDone).toBeDisabled();
  await recoveryDialog
    .getByRole('button', { name: 'Copy recovery key' })
    .click();
  await expect
    .poll(() =>
      signupPage.evaluate(() => localStorage.getItem('author-e2e-clipboard'))
    )
    .toMatch(/^author-recovery-v1-/);
  await recoveryDialog
    .getByRole('button', { name: 'Hide recovery key' })
    .click();
  await expect(recoveryKeyField).toHaveAttribute('type', 'password');
  await recoveryDialog
    .getByRole('button', { name: 'Show recovery key' })
    .click();
  await expect(recoveryKeyField).toHaveAttribute('type', 'text');
  const recoveryDownload = signupPage.waitForEvent('download');
  await recoveryDialog
    .getByRole('button', { name: 'Save recovery kit' })
    .click();
  expect((await recoveryDownload).suggestedFilename()).toBe(
    'author-recovery-kit.json'
  );
  await expect(recoveryDone).toBeDisabled();
  await recoveryDialog
    .getByRole('checkbox', { name: /I saved the recovery key and kit/ })
    .check();
  await expect(recoveryDone).toBeEnabled();
  await recoveryDone.click();
  await expect(recoveryDialog).toBeHidden();
  await expect
    .poll(() =>
      signupPage.evaluate(() => localStorage.getItem('author-username'))
    )
    .toBe(signupUsername);
  await expect
    .poll(() => browserEncryptionKeyMaterial(signupPage))
    .not.toBe('');
  const signupMaterial = await browserEncryptionKeyMaterial(signupPage);
  expect(signupMaterial).toMatch(/^keyring:v1:/);
  await expect(
    signupPage.getByText(ENCRYPTION_UPGRADE_REQUIRED_MESSAGE)
  ).toHaveCount(0);

  await signupPage.getByLabel('Note title').fill(noteTitle);
  await signupPage.getByLabel('Note body').fill(noteBody);
  await expectBrowserStoredEncryptedNote(
    signupPage,
    noteTitle,
    noteBody,
    signupMaterial
  );
  await waitForVisibleSyncedStatus(signupPage);

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

  const accountPanelOverflow = await settingsDialog.evaluate(
    (dialog) => dialog.scrollWidth > dialog.clientWidth + 1
  );
  expect(accountPanelOverflow).toBe(false);

  await settingsDialog
    .getByRole('button', { name: 'Enable authenticator 2FA' })
    .click();
  const totpForm = settingsDialog.getByRole('form', {
    name: 'Two-factor authentication'
  });
  await expect(
    totpForm.getByText('Authenticator 2FA', { exact: true })
  ).toBeVisible();
  await expect(totpForm.getByLabel('Authenticator secret')).toHaveValue(
    /^[A-Z2-7]+$/
  );
  const totpOverflow = await totpForm.evaluate(
    (form) => form.scrollWidth > form.clientWidth + 1
  );
  expect(totpOverflow).toBe(false);
  await totpForm.getByRole('button', { name: 'Cancel' }).click();

  await trustedDevices
    .getByRole('button', { name: 'Remove trusted sign-in for This browser' })
    .click();

  await expect(trustedDevices.getByText('No trusted devices')).toBeVisible();
  await expect
    .poll(() =>
      signupPage.evaluate(() => localStorage.getItem('author-username'))
    )
    .toBe(signupUsername);

  const loginContext = await browser.newContext();
  try {
    const loginPage = await loginContext.newPage();
    await loginPage.addInitScript((deviceId) => {
      localStorage.setItem('author-device-id', deviceId);
    }, loginDeviceId);

    await loginPage.goto('/');
    await waitForDraftEditorReady(loginPage);
    await openProfileMenu(loginPage);
    await loginPage.getByRole('menuitem', { name: 'Sign in to sync' }).click();
    const loginDialog = loginPage.getByRole('dialog', { name: 'Sign in' });
    await loginDialog.getByLabel('Username').fill(signupUsername);
    await loginDialog
      .getByLabel('Password', { exact: true })
      .fill(signupPassword);
    await clickSignInSubmit(loginPage);

    await expect(loginDialog).toBeHidden({ timeout: 30_000 });
    await expect
      .poll(() =>
        loginPage.evaluate(() => localStorage.getItem('author-username'))
      )
      .toBe(signupUsername);
    await expect
      .poll(() => browserEncryptionKeyMaterial(loginPage), {
        timeout: 30_000
      })
      .toBe(signupMaterial);
    await expect(
      loginPage.getByText(ENCRYPTION_UPGRADE_REQUIRED_MESSAGE)
    ).toHaveCount(0);
    await expectBrowserStoredEncryptedNote(
      loginPage,
      noteTitle,
      noteBody,
      signupMaterial
    );
  } finally {
    await loginContext.close();
  }
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

  await page.getByRole('button', { name: 'Export Markdown ZIP' }).click();
  await expect(page.getByText('All notebooks', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
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

test('keeps stepwise typing visible while a delayed note sync finishes stale', async ({
  page,
  request
}) => {
  const titleText = `Stepwise local edit ${Date.now()}`;
  let sawFirstNotePush: () => void = () => undefined;
  const firstNotePushStarted = new Promise<void>((resolve) => {
    sawFirstNotePush = resolve;
  });
  let delayedFirstNotePush = false;

  await page.route('**/api/sync/push', async (route) => {
    let hasNotes = false;
    try {
      const payload = JSON.parse(route.request().postData() ?? '{}') as {
        notes?: unknown[];
      };
      hasNotes = Array.isArray(payload.notes) && payload.notes.length > 0;
    } catch {
      // Ignore non-JSON probes; they are not note pushes.
    }

    if (hasNotes && !delayedFirstNotePush) {
      delayedFirstNotePush = true;
      sawFirstNotePush();
      await page.waitForTimeout(700);
    }
    await route.continue();
  });

  await page.goto('/');
  await waitForVisibleSyncedStatus(page);

  const title = page.getByLabel('Note title');
  const body = page.getByLabel('Note body');
  const chunks = [
    'First chunk',
    ' typed while sync is delayed',
    ' and this newest local text must remain'
  ];

  await title.fill(titleText);
  await body.pressSequentially(chunks[0], { delay: 10 });
  await expect(body).toHaveValue(chunks[0]);
  await expectBrowserStoredEncryptedNote(page, titleText, chunks[0]);
  await Promise.race([
    firstNotePushStarted,
    page.waitForTimeout(10_000).then(() => {
      throw new Error('Timed out waiting for the first note sync push');
    })
  ]);

  let expectedBody = chunks[0];
  for (const chunk of chunks.slice(1)) {
    expectedBody += chunk;
    await body.pressSequentially(chunk, { delay: 10 });
    await expect(body).toHaveValue(expectedBody);
  }

  await expectBrowserStoredEncryptedNote(page, titleText, expectedBody);
  await expect
    .poll(
      async () =>
        (await pullRemoteNotes(request)).find(
          (note) => note.title === titleText
        )?.body ?? null,
      { timeout: 15_000 }
    )
    .toBe(expectedBody);
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
  const phoneDevice = { id: 'e2e-phone-device', name: 'E2E Phone' };
  const phoneToken = await loginForDeviceToken(request, phoneDevice);
  const encryptedPhoneEdit = await encryptNoteFields(phoneEdit, e2eKeyMaterial);
  const remotePush = await request.post('/api/sync/push', {
    headers: { authorization: `Bearer ${phoneToken}` },
    data: {
      device: phoneDevice,
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

test('has no serious app-shell accessibility violations @a11y @cross-browser', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForDraftEditorReady(page);

  await openProfileMenu(page);
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"]'))
      )
    )
    .toBe(true);
  for (let index = 0; index < 20; index += 1) await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]'))
    )
  ).toBe(true);

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
  await expect(page.locator('.editor-meta-strip span').first()).toHaveCSS(
    'white-space',
    'normal'
  );

  const titleText = `Mobile viewport note ${Date.now()}`;
  const bodyText = 'Written on the narrow browser project';

  await page.getByLabel('Note title').fill(titleText);
  await page.getByLabel('Note body').fill(bodyText);
  await expect(page.getByLabel('Note body')).toHaveValue(bodyText);
  await expectBrowserStoredEncryptedNote(page, titleText, bodyText);
});
