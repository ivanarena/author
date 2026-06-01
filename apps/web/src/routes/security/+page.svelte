<script lang="ts">
  import { resolve } from '$app/paths';

  const updated = 'June 1, 2026';
</script>

<svelte:head>
  <title>Security Model | Author</title>
  <meta
    name="description"
    content="Security model for Author's local-first encrypted sync design."
  />
</svelte:head>

<main class="legal-page">
  <a href={resolve('/')} class="legal-back">Author</a>
  <h1>Security Model</h1>
  <p class="legal-updated">Updated {updated}</p>

  <section>
    <h2>Supported claim</h2>
    <p>
      Author encrypts synced note titles, note bodies, notebook names, account
      keyrings, and browser note-history snapshots on the client. Sync is
      local-first: edits are saved to the device before the network is asked to
      push or pull anything.
    </p>
  </section>

  <section>
    <h2>What the server stores</h2>
    <p>
      The server stores encrypted note fields, encrypted notebook names, an
      encrypted account keyring wrapper, authentication records, tombstones,
      version rows, and sync metadata. Metadata such as ids, timestamps,
      versions, device ids, notebook assignments, deletion markers, and stable
      field hashes remains visible so sync, conflicts, cleanup, and repair can
      work predictably.
    </p>
  </section>

  <section>
    <h2>Browser limits</h2>
    <p>
      Author is not a hardened zero-knowledge web service. A compromised app
      origin, malicious deployed JavaScript bundle, browser exploit, or XSS bug
      can read passwords, local key material, active sessions, and decrypted
      notes while the app is running.
    </p>
  </section>

  <section>
    <h2>Recovery model</h2>
    <p>
      Account keyrings can be wrapped by password-derived material and by a
      recovery kit. Browser note history stores encrypted local snapshots before
      edits, Trash moves, and restore actions. Those snapshots stay on that
      device and are deleted when a note is permanently deleted.
    </p>
  </section>

  <section>
    <h2>Conflict safety</h2>
    <p>
      The sync server accepts writes only against the current remote base
      version, or when the remote content is identical. Stale writes, remote
      deletes, and duplicate active notebook names become explicit conflicts
      instead of silent overwrites.
    </p>
  </section>

  <section>
    <h2>Claims not made</h2>
    <p>
      Author does not claim audited cryptography, enterprise-grade E2EE,
      hardened zero-knowledge delivery, key transparency, reproducible signed
      web bundles, or protection from malicious hosted web code. Those claims
      require independent review and distribution hardening beyond the current
      release process.
    </p>
  </section>
</main>
