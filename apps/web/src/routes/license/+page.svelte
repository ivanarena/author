<script lang="ts">
  import { resolve } from '$app/paths';

  const updated = 'May 8, 2026';
</script>

<svelte:head>
  <title>License | Author Notes</title>
  <meta name="description" content="MIT License for Author Notes." />
</svelte:head>

<main class="legal-page">
  <a href={resolve('/')} class="legal-back">Author Notes</a>
  <h1>License</h1>
  <p class="legal-updated">Updated {updated}</p>

  <section>
    <h2>MIT License</h2>
    <p>Copyright (c) 2026 Author Notes contributors</p>
  </section>

  <section>
    <h2>Permission</h2>
    <p>
      Permission is hereby granted, free of charge, to any person obtaining a
      copy of this software and associated documentation files to deal in the
      software without restriction, including without limitation the rights to
      use, copy, modify, merge, publish, distribute, sublicense, and sell copies
      of the software.
    </p>
  </section>

  <section>
    <h2>Condition</h2>
    <p>
      The copyright notice and permission notice must be included in all copies
      or substantial portions of the software.
    </p>
  </section>

  <section>
    <h2>Warranty</h2>
    <p>
      The software is provided as-is, without warranty of any kind, express or
      implied, including warranties of merchantability, fitness for a particular
      purpose, and noninfringement.
    </p>
  </section>
</main>
