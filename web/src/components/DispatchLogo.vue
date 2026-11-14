<script setup lang="ts">
/** The Dispatch mark without its tile (web/public/icons/icon.svg): three lines merging into one arrow, in currentColor */
defineProps<{ size?: number }>()
</script>

<template>
  <svg :width="size ?? 22" :height="size ?? 22" viewBox="76 64 384 384" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
      <path d="M150 140c70 0 90 116 170 116M150 372c70 0 90-116 170-116M104 256h232" />
    </g>
    <g fill="currentColor">
      <circle cx="150" cy="140" r="28" />
      <circle cx="150" cy="372" r="28" />
      <circle cx="104" cy="256" r="28" />
      <path d="M316 196a14 14 0 0 1 22-11l92 60a14 14 0 0 1 0 22l-92 60a14 14 0 0 1-22-11z" />
    </g>
  </svg>
</template>
