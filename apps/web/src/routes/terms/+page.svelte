<script lang="ts">
  import { resolve } from '$app/paths';

  const updated = 'May 21, 2026';
</script>

<svelte:head>
  <title>Terms | Author</title>
  <meta name="description" content="Terms for using Author." />
</svelte:head>

<main class="legal-page">
  <a href={resolve('/')} class="legal-back">Author</a>
  <h1>Terms</h1>
  <p class="legal-updated">Updated {updated}</p>

  <section>
    <h2>Your notes</h2>
    <p>
      You keep ownership of the notes and notebooks you create. You are
      responsible for the content you store and for remembering the account
      password that unlocks encrypted data. There is no recovery key in this
      simple-login encryption model, and Author is not offered as a hardened
      zero-knowledge or zero-trust service.
    </p>
  </section>

  <section>
    <h2>Acceptable use</h2>
    <p>
      Do not use Author to store or share unlawful, abusive, infringing, or
      harmful material. You are responsible for complying with laws and rights
      that apply to the content you create, import, export, or sync.
    </p>
  </section>

  <section>
    <h2>Service limits</h2>
    <p>
      Author is provided as-is. Sync, import, export, and cleanup features
      should be verified with your own backups before relying on them for
      critical records.
    </p>
  </section>

  <section>
    <h2>Account controls</h2>
    <p>
      Settings includes profile edits, password changes, Markdown export, sign
      out, and account deletion. Account deletion removes the synced account
      data controlled by this service, but independent backups or exported files
      you created remain your responsibility.
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
