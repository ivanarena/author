<script lang="ts">
  import { Eye, EyeOff } from '@lucide/svelte';

  let {
    id,
    label,
    value,
    autocomplete,
    minlength,
    onValue
  }: {
    id: string;
    label: string;
    value: string;
    autocomplete: 'current-password' | 'new-password';
    minlength?: number;
    onValue: (value: string) => void;
  } = $props();
  let visible = $state(false);
</script>

<div class="field-row">
  <label for={id}>{label}</label>
  <div class="password-field">
    <input
      {id}
      type={visible ? 'text' : 'password'}
      {value}
      {autocomplete}
      {minlength}
      oninput={(event) =>
        onValue((event.currentTarget as HTMLInputElement).value)}
    />
    <button
      class="icon-button mini password-toggle"
      type="button"
      title={visible ? 'Hide password' : 'Show password'}
      aria-label={visible ? 'Hide password' : 'Show password'}
      aria-pressed={visible}
      onclick={() => (visible = !visible)}
    >
      {#if visible}
        <EyeOff size={14} strokeWidth={1.8} />
      {:else}
        <Eye size={14} strokeWidth={1.8} />
      {/if}
    </button>
  </div>
</div>
