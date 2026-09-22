<script lang="ts">
  import { resolve } from '$app/paths';

  const updated = 'September 17, 2026';
</script>

<svelte:head>
  <title>License | author</title>
  <meta name="description" content="MIT License for author." />
</svelte:head>

<main class="legal-page">
  <a href={resolve('/')} class="legal-back">author</a>
  <h1>License</h1>
  <p class="legal-updated">Updated {updated}</p>

  <section>
    <h2>MIT License</h2>
    <p>Copyright (c) 2026 author contributors</p>
  </section>

  <section>
    <h2>Permission</h2>
    <p>
      Permission is hereby granted, free of charge, to any person obtaining a
      copy of this software and associated documentation files (the “Software”),
      to deal in the Software without restriction, including without limitation
      the rights to use, copy, modify, merge, publish, distribute, sublicense,
      and/or sell copies of the Software, and to permit persons to whom the
      Software is furnished to do so, subject to the following conditions:
    </p>
    <p>
      The above copyright notice and this permission notice shall be included in
      all copies or substantial portions of the Software.
    </p>
  </section>

  <section>
    <h2>Warranty and liability</h2>
    <p>
      THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
      IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
      FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
      THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
      LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
      FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
      DEALINGS IN THE SOFTWARE.
    </p>
  </section>

  <section>
    <h2>Third-party software</h2>
    <p>
      Third-party dependencies and fonts retain their own licenses. See the
      <a
        href="https://github.com/ivanarena/author/blob/main/THIRD_PARTY_NOTICES.md"
        rel="noreferrer"
        target="_blank">third-party notices</a
      >
      and the exact dependency inventory in the
      <a
        href="https://github.com/ivanarena/author"
        rel="noreferrer"
        target="_blank">source repository</a
      >.
    </p>
  </section>
</main>
