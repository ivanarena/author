<script lang="ts">
  import { resolve } from '$app/paths';

  const updated = 'May 20, 2026';
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
    <h2>Encrypted content</h2>
    <p>
      Note titles, note bodies, and notebook names are encrypted on your device
      before sync using Argon2id key material derived from your login password.
      Author does not add a recovery key or a separate encryption passphrase, so
      the same simple login flow unlocks synced content on your own devices.
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
    <h2>Account data</h2>
    <p>
      Account records include your username, legacy display name if one already
      exists, password verifier data, sessions, and device labels needed to
      operate login and sync. Passwords are not stored in plaintext.
    </p>
  </section>

  <section>
    <h2>Operator access</h2>
    <p>
      Server operators and administrators may be able to see account records,
      sessions, device labels, sync metadata, logs, and encrypted blobs. They
      should not be able to read encrypted note titles, note bodies, or notebook
      names without the account password.
    </p>
  </section>

  <section>
    <h2>Controls</h2>
    <p>
      You can export Markdown, change your password, sign out, or delete your
      account from Settings. If you forget the account password, encrypted note
      content cannot be recovered by the service. Deleted synced content is
      retained only as needed for trash cleanup and conflict-safe sync.
    </p>
  </section>
</main>
