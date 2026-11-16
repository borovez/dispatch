<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { cn } from '@/lib/utils'
import { useStuck } from '@/composables/stuck'

/**
 * A list page's toolbar that stays under the app header while the page scrolls. It reaches out over
 * <main>'s padding with the page's own background, always the full width (it ignores a parent's
 * `*:max-w-*` cap) (-my-2 keeps the page's spacing; use it in a flex
 * column with gap, not space-y), and gets a bottom border once it is stuck. While
 * mounted it sets `--sticky-top` on the root (header + toolbar height), so sticky things further down
 * (e.g. Slack's day headings) sit under it.
 */
/** contentClass: caps the controls (e.g. `max-w-6xl` to line up with a capped list) while the bar spans the page */
defineProps<{ class?: string; contentClass?: string }>()
const el = ref<HTMLElement>()
const stuck = useStuck(el)
let ro: ResizeObserver | undefined

onMounted(() => {
  const root = document.documentElement
  ro = new ResizeObserver(() => root.style.setProperty('--sticky-top', `${56 + (el.value?.offsetHeight ?? 0)}px`))
  if (el.value) ro.observe(el.value)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  document.documentElement.style.removeProperty('--sticky-top')
})
</script>

<template>
  <div
    ref="el"
    :class="cn(
      'sticky top-14 z-20 -mx-4 -my-2 max-w-none! bg-background bg-linear-to-r from-muted/30 to-muted/30 px-4 py-2 lg:-mx-6 lg:px-6',
      stuck && 'border-b shadow-sm',
      $props.class,
    )"
  >
    <div :class="cn('space-y-2', contentClass)">
      <slot />
    </div>
  </div>
</template>
