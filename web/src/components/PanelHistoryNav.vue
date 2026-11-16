<script setup lang="ts">
import { computed } from 'vue'
import { useEventListener } from '@vueuse/core'
import { PhArrowLeft, PhArrowRight } from '@phosphor-icons/vue'
import { useDeck, type PanelRef } from '@/stores/deck'
import { LAYER_OPEN } from '@/composables/escape'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Back / forward through what the side panel showed since it opened (PRs, Jira issues, Slack
 * messages). Also Alt+← / Alt+→ and the mouse's back / forward buttons while a panel is open.
 */
const deck = useDeck()
const back = computed(() => deck.panelBack.at(-1) ?? null)
const forward = computed(() => deck.panelForward.at(-1) ?? null)

/** "PR org/repo#12: title", "LDW-12: summary", "Slack: Name: text" */
function describe(r: PanelRef | null): string {
  if (!r) return ''
  if (r.kind === 'pr') {
    const p = deck.byId.get(r.id)
    return p ? `${r.id}: ${p.title}` : r.id
  }
  if (r.kind === 'jira') {
    const j = deck.overview?.jira.find((x) => x.key === r.id)
    return j?.summary ? `${r.id}: ${j.summary}` : r.id
  }
  const s = deck.overview?.slack.find((x) => x.id === r.id)
  return s ? `Slack · ${s.userName}: ${s.text.slice(0, 60)}${s.text.length > 60 ? '…' : ''}` : 'Slack message'
}

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || document.querySelector(LAYER_OPEN)) return
  e.preventDefault()
  deck.panelGo(e.key === 'ArrowLeft' ? -1 : 1)
})
// Mouse back / forward buttons (3, 4): the panel's history, not the page's
// (only when there's somewhere to go; otherwise the browser's own back / forward still works)
const canGo = (e: MouseEvent) => (e.button === 3 ? !!back.value : e.button === 4 ? !!forward.value : false)
useEventListener(window, 'mouseup', (e: MouseEvent) => {
  if (!canGo(e)) return
  e.preventDefault()
  deck.panelGo(e.button === 3 ? -1 : 1)
})
useEventListener(window, 'mousedown', (e: MouseEvent) => canGo(e) && e.preventDefault())
</script>

<template>
  <div v-if="back || forward" class="flex items-center">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-sm" aria-label="Back" :disabled="!back" @click="deck.panelGo(-1)"><PhArrowLeft /></Button>
      </TooltipTrigger>
      <TooltipContent class="max-w-80">
        <span class="line-clamp-2">Back to {{ describe(back) }}</span>
        <span class="opacity-70">Alt+←</span>
      </TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-sm" aria-label="Forward" :disabled="!forward" @click="deck.panelGo(1)"><PhArrowRight /></Button>
      </TooltipTrigger>
      <TooltipContent class="max-w-80">
        <span class="line-clamp-2">Forward to {{ describe(forward) }}</span>
        <span class="opacity-70">Alt+→</span>
      </TooltipContent>
    </Tooltip>
  </div>
</template>
