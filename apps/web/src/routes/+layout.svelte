<script lang="ts">
  import '@fontsource-variable/dm-sans/index.css';
  import '@fontsource-variable/newsreader/opsz.css';
  // Static instances for manuscripts: Firefox prints variable fonts as
  // outlines, which leaves PDFs without selectable or searchable text.
  import '@fontsource/newsreader/400.css';
  import '@fontsource/newsreader/700.css';
  import '../styles.css';
</script>

<slot />
