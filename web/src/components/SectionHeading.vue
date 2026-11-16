<script setup lang="ts">
import { ref } from 'vue'
import { useStuck } from '@/composables/stuck'
import { PhArrowsInLineVertical, PhArrowsOutLineVertical, PhCaretRight } from '@phosphor-icons/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A list section's heading: the caret on the left folds the whole section away; the button on the right
 * collapses or expands every card in it (`cardsCollapsed` says which it does now). It sticks under the
 * page toolbar (`--sticky-top`) with the page background, edge to edge over <main>'s padding like the toolbar; the page sets `--section-h` to its height
 * (2.5rem) so card headings (GroupCard) stick below it.
 */
defineProps<{ label: string; count?: number; cardsCollapsed?: boolean; cardsToggle?: boolean }>()
const hidden = defineModel<boolean>('hidden', { default: false })
const emit = defineEmits<{ toggleCards: [] }>()
const el = ref<HTMLElement>()
/** A bottom border once stuck, like the toolbar */
const stuck = useStuck(el)
</script>

<template>
  <div
    ref="el"
    class="sticky top-(--sticky-top,--spacing(14)) z-[15] -mx-4 flex h-10 items-center gap-2 border-b bg-background bg-linear-to-r from-muted/30 to-muted/30 px-4 transition-colors lg:-mx-6 lg:px-6"
    :class="!stuck && 'border-transparent'"
  >
    <button
      type="button"
      class="-ml-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      :aria-expanded="!hidden"
      @click="hidden = !hidden"
    >
      <PhCaretRight :size="14" weight="bold" class="shrink-0 transition-transform" :class="!hidden && 'rotate-90'" />
      <span class="truncate">{{ label }}</span>
      <Badge v-if="count != null" variant="count">{{ count }}</Badge>
    </button>
    <span class="flex-1" />
    <Tooltip v-if="cardsToggle && !hidden">
      <TooltipTrigger as-child>
        <Button variant="outline" size="icon-sm" :aria-label="cardsCollapsed ? 'Expand all in this section' : 'Collapse all in this section'" @click="emit('toggleCards')">
          <PhArrowsOutLineVertical v-if="cardsCollapsed" /><PhArrowsInLineVertical v-else />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{{ cardsCollapsed ? 'Expand all in this section' : 'Collapse all in this section' }}</TooltipContent>
    </Tooltip>
  </div>
</template>
