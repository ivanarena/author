<script lang="ts">
  import { resolve } from '$app/paths';

  const updated = 'September 17, 2026';
</script>

<svelte:head>
  <title>Terms | author</title>
  <meta name="description" content="Terms for using author." />
</svelte:head>

<main class="legal-page">
  <a href={resolve('/')} class="legal-back">author</a>
  <h1>Terms</h1>
  <p class="legal-updated">Updated {updated}</p>

  <section>
    <h2>Self-hosted instances</h2>
    <p>
      author is open-source, self-hostable software. The operator of an
      independent instance is responsible for that service's availability,
      account policy, legal terms, privacy notice, backups, and support. These
      upstream project terms are not a substitute for an operator-specific
      agreement.
    </p>
  </section>

  <section>
    <h2>Your notes</h2>
    <p>
      You keep ownership of the notes and notebooks you create. You are
      responsible for the content you store and for remembering the account
      password that unlocks encrypted data. If you create an E2EE recovery kit,
      you are responsible for storing the kit and recovery code separately.
      author is not offered as a hardened zero-knowledge or zero-trust service.
    </p>
  </section>

  <section>
    <h2>Acceptable use</h2>
    <p>
      Do not use author to store or share unlawful, abusive, infringing, or
      harmful material. You are responsible for complying with laws and rights
      that apply to the content you create, import, export, or sync.
    </p>
  </section>

  <section>
    <h2>Service limits</h2>
    <p>
      author is provided as-is. Sync, import, export, and cleanup features
      should be verified with your own backups before relying on them for
      critical records.
    </p>
  </section>

  <section>
    <h2>Account controls</h2>
    <p>
      Settings includes profile edits, password changes, Markdown export, sign
      out, recovery kit download, and account deletion. Account deletion removes
      the synced account data controlled by this service, but independent
      backups or exported files you created remain your responsibility.
    </p>
  </section>

  <section>
    <h2>Open source</h2>
    <p>
      The project is licensed under the MIT License. Third-party dependencies
      keep their own licenses.
    </p>
  </section>
</main>
