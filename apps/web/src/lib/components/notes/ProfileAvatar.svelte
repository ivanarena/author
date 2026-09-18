<script lang="ts">
  import { UserRound } from '@lucide/svelte';

  let {
    src = '',
    size = 32,
    iconSize = Math.round(size * 0.58),
    label = 'Profile picture'
  }: {
    src?: string;
    size?: number;
    iconSize?: number;
    label?: string;
  } = $props();
</script>

<span class="profile-avatar" style={`--profile-avatar-size: ${size}px`}>
  {#if src}
    <img {src} alt={label} />
  {:else}
    <UserRound size={iconSize} strokeWidth={1.7} aria-hidden="true" />
  {/if}
</span>

<style>
  .profile-avatar {
    display: inline-grid;
    width: var(--profile-avatar-size);
    height: var(--profile-avatar-size);
    overflow: hidden;
    place-items: center;
    flex: 0 0 auto;
    border: 1px solid var(--line-strong);
    background: var(--field);
    color: var(--text);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
