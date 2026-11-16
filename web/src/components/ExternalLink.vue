<script setup lang="ts">
import { computed, type HTMLAttributes } from 'vue'
import { PhArrowSquareOut } from '@phosphor-icons/vue'
import { cn } from '@/lib/utils'
import { externalHint, siteName } from '@/lib/external'

/**
 * A link that leaves Dispatch (new tab, or the browser in the Mac app). Shows ↗ after its content
 * (`icon`: 'hover' reserves the space and fades it in, 'always', 'none' when the content already
 * says it) and a tooltip naming the site ("label · Opens GitHub in a new tab ↗"). Clicks never reach
 * the row it sits in. Anything that opens in Dispatch is not an ExternalLink and is never underlined.
 */
const props = withDefaults(
  defineProps<{
    href?: string | null
    icon?: 'hover' | 'always' | 'none'
    /** Shown before the hint in the tooltip, e.g. the full repo name */
    label?: string
    /** Overrides the site worked out from the URL */
    site?: string
    class?: HTMLAttributes['class']
  }>(),
  { icon: 'hover' },
)
const title = computed(() => [props.label, externalHint(props.href, props.site ?? siteName(props.href))].filter(Boolean).join(' · '))
</script>

<template>
  <a
    :href="href ?? undefined"
    target="_blank"
    rel="noopener"
    :title="title"
    :class="cn('group/ext inline-flex min-w-0 items-center gap-1 hover:underline hover:underline-offset-2', props.class)"
    @click.stop
  >
    <slot />
    <PhArrowSquareOut
      v-if="icon !== 'none'"
      aria-hidden="true"
      class="size-[1.1em] shrink-0 text-muted-foreground"
      :class="icon === 'hover' && 'opacity-0 transition-opacity group-hover/ext:opacity-100 group-focus-visible/ext:opacity-100'"
    />
  </a>
</template>
