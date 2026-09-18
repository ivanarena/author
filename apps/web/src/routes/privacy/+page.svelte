<script lang="ts">
  import { resolve } from '$app/paths';

  const updated = 'September 18, 2026';
</script>

<svelte:head>
  <title>Privacy | Author</title>
  <meta
    name="description"
    content="Privacy notice for Author and its encrypted sync model."
  />
</svelte:head>

<main class="legal-page">
  <a href={resolve('/')} class="legal-back">Author</a>
  <h1>Privacy</h1>
  <p class="legal-updated">Updated {updated}</p>

  <section>
    <h2>Service operator</h2>
    <p>
      Author is self-hostable software. The operator of the instance you use
      chooses its server, database, logs, backups, retention, account access,
      and legal policy. The upstream source project does not automatically
      receive data from independent self-hosted instances. Ask your operator for
      the policy that applies to their deployment.
    </p>
  </section>

  <section>
    <h2>Encrypted content</h2>
    <p>
      Note titles, note bodies, and notebook names are encrypted on your device
      before sync using a local account keyring. The server stores only an
      encrypted keyring wrapper that can be unlocked by your password-derived
      key material or by a recovery kit and recovery code you save separately.
      This is an encrypted-sync design for routine storage, not a hardened
      zero-knowledge or zero-trust service.
    </p>
  </section>

  <section>
    <h2>Sync metadata</h2>
    <p>
      The server stores encrypted payloads plus metadata required to make sync
      work: record ids, notebook assignments, device ids, timestamps, versions,
      sync state, deletion markers, and stable encrypted-name hashes used for
      conflict and duplicate checks.
    </p>
  </section>

  <section>
    <h2>Local recovery snapshots</h2>
    <p>
      The browser can keep encrypted local note snapshots before edits and Trash
      or restore actions so you can restore a previous version on that device.
      These snapshots stay in the local browser database, are not synced as
      separate records, and are removed when a note is permanently deleted.
    </p>
  </section>

  <section>
    <h2>Account data</h2>
    <p>
      Account records include your username, email address, optional profile
      picture, legacy display name if one already exists, password verifier
      data, encrypted keyring wrappers, sessions, and device labels needed to
      operate login and sync. Profile pictures are not end-to-end encrypted and
      are visible to the server operator. Passwords and recovery codes are not
      stored in plaintext.
    </p>
  </section>

  <section>
    <h2>Operator access</h2>
    <p>
      Server operators and administrators may be able to see account records,
      profile pictures, sessions, device labels, sync metadata, logs, and
      encrypted blobs. They do not receive plaintext note content during normal
      sync, but users should still trust the app build, browser or Android
      device, server runtime, and backup handling they choose to use.
    </p>
  </section>

  <section>
    <h2>Controls</h2>
    <p>
      You can export Markdown, upload or remove your profile picture, change
      your password, sign out, or delete your account from Settings. You can
      also download an E2EE recovery kit; keep that kit and its recovery code
      separate from each other. If you lose both password access and recovery
      material, encrypted note content may not be recoverable. Deleted synced
      content is retained only as needed for trash cleanup and conflict-safe
      sync.
    </p>
  </section>
</main>
