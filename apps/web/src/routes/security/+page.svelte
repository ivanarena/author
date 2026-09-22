<script lang="ts">
  import { resolve } from '$app/paths';

  const updated = 'September 17, 2026';
</script>

<svelte:head>
  <title>Security Model | author</title>
  <meta
    name="description"
    content="Security model for author's local-first encrypted sync design."
  />
</svelte:head>

<main class="legal-page">
  <a href={resolve('/')} class="legal-back">author</a>
  <h1>Security Model</h1>
  <p class="legal-updated">Updated {updated}</p>

  <section>
    <h2>Supported claim</h2>
    <p>
      author encrypts synced note titles, note bodies, notebook names, account
      keyrings, browser note-history snapshots, and browser editor crash
      recovery on the client. Sync is local-first: edits are saved to the device
      before the network is asked to push or pull anything.
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
      author is not a hardened zero-knowledge web service. A compromised app
      origin, malicious deployed JavaScript bundle, browser exploit, or XSS bug
      can read passwords, local key material, active sessions, and decrypted
      notes while the app is running.
    </p>
  </section>

  <section>
    <h2>Recovery model</h2>
    <p>
      Account keyrings can be wrapped by password-derived material and by a
      recovery kit. Browser note history and editor crash recovery store
      encrypted local snapshots before edits, Trash moves, and restore actions.
      Those snapshots stay on that device and are deleted when a note is
      permanently deleted.
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
    <h2>Self-hosting</h2>
    <p>
      Self-hosted operators control the deployed source, TLS endpoint, server
      secrets, database, backups, logs, and update process. Publishing source
      code improves inspectability but does not make a running web bundle
      immutable or independently audited. Use tagged releases, verify release
      artifacts, protect backups and secrets, and test restores.
    </p>
  </section>

  <section>
    <h2>Claims not made</h2>
    <p>
      author does not claim audited cryptography, enterprise-grade E2EE,
      hardened zero-knowledge delivery, key transparency, reproducible signed
      web bundles, or protection from malicious hosted web code. Those claims
      require independent review and distribution hardening beyond the current
      release process.
    </p>
  </section>
</main>
