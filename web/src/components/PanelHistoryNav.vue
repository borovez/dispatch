<script setup lang="ts">
import { isTyping } from '@/lib/typing'
import { computed, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { PhArrowLeft, PhArrowRight, PhClockCounterClockwise } from '@phosphor-icons/vue'
import { useDeck, type PanelRef } from '@/stores/deck'
import { LAYER_OPEN } from '@/composables/escape'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ITEM_KIND } from '@/utils/itemKinds'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import PanelItemCard from './PanelItemCard.vue'

/**
 * Back / forward through what the side panel showed since it opened (PRs, Jira issues, Slack
 * messages). Also Alt+← / Alt+→ and the mouse's back / forward buttons while a panel is open.
 * The history button lists every entry (forward ones above the current, back ones below, like a
 * browser's history menu); picking one jumps there, hovering shows its details (`PanelItemCard`).
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

/** Short title and a muted line under it, for the history menu */
function parts(r: PanelRef): { title: string; sub: string } {
  if (r.kind === 'pr') return { title: deck.byId.get(r.id)?.title ?? r.id, sub: r.id.replace(/^[^/]+\//, '') }
  if (r.kind === 'jira') return { title: deck.jiraByKey.get(r.id)?.summary ?? r.id, sub: r.id }
  const m = deck.overview?.slack.find((x) => x.id === r.id)
  return { title: m ? m.text.replace(/\s+/g, ' ') : 'Slack message', sub: m ? `${m.userName} · ${m.channelName}` : '' }
}
/** Nearest first in each direction: steps is how far panelJump goes */
const forwardItems = computed(() => [...deck.panelForward].reverse().map((r, i) => ({ r, steps: i + 1 })).reverse())
const backItems = computed(() => [...deck.panelBack].reverse().map((r, i) => ({ r, steps: -(i + 1) })))
const key = (r: PanelRef) => `${r.kind}:${r.id}`
/** Recently opened items not already in this panel's history (or shown now): opening one adds a step */
const recentItems = computed(() => {
  const seen = new Set([...deck.panelBack, ...deck.panelForward, ...(deck.currentPanel ? [deck.currentPanel] : [])].map(key))
  return deck.recentPanels.filter((r) => !seen.has(key(r))).slice(0, 10)
})
/**
 * One preview card beside the menu for the highlighted entry (mouse or arrow keys), rather than a
 * hover card per entry: those stacked up when the pointer moved quickly and didn't close.
 */
const menuOpen = ref(false)
const shown = ref<{ item: PanelRef; top: number; left: number } | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | undefined
function preview(e: Event, r: PanelRef) {
  const el = e.currentTarget as HTMLElement
  clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    const menu = el.closest('[role=menu]')?.getBoundingClientRect()
    if (!menu || !menuOpen.value) return
    const row = el.getBoundingClientRect()
    const W = 360
    // Left of the menu (the panel sits on the right); right of it when there's no room
    const left = menu.left - W - 8 >= 8 ? menu.left - W - 8 : Math.min(menu.right + 8, innerWidth - W - 8)
    shown.value = { item: r, top: Math.max(8, Math.min(row.top, innerHeight - 340)), left }
  }, shown.value ? 60 : 250)
}
watch(menuOpen, (o) => {
  if (o) return
  clearTimeout(previewTimer)
  shown.value = null
})
function openRecent(r: PanelRef) {
  if (r.kind === 'pr') deck.selectedId = r.id
  else if (r.kind === 'jira') deck.selectedJiraKey = r.id
  else deck.selectedSlackId = r.id
}

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  if (isTyping(e.target) || document.querySelector(LAYER_OPEN)) return
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
  <div class="flex items-center">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-sm" aria-label="Back" :disabled="!back" @click="deck.panelGo(-1)"><PhArrowLeft /></Button>
      </TooltipTrigger>
      <TooltipContent class="max-w-80">
        <component :is="ITEM_KIND[back.kind].icon" v-if="back" :size="14" class="shrink-0" />
        <span class="line-clamp-2">{{ back ? `Back to ${describe(back)}` : 'Back' }}</span>
        <span class="opacity-70">Alt+←</span>
      </TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="ghost" size="icon-sm" aria-label="Forward" :disabled="!forward" @click="deck.panelGo(1)"><PhArrowRight /></Button>
      </TooltipTrigger>
      <TooltipContent class="max-w-80">
        <component :is="ITEM_KIND[forward.kind].icon" v-if="forward" :size="14" class="shrink-0" />
        <span class="line-clamp-2">{{ forward ? `Forward to ${describe(forward)}` : 'Forward' }}</span>
        <span class="opacity-70">Alt+→</span>
      </TooltipContent>
    </Tooltip>
    <!-- Tooltip around the whole menu: nested inside it, the menu's trigger anchored to the tooltip and the menu was never positioned -->
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="inline-flex">
          <DropdownMenu v-model:open="menuOpen">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" aria-label="History"><PhClockCounterClockwise /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-80 p-0">
              <ScrollArea class="[&>[data-slot=scroll-area-viewport]]:max-h-96">
                <div class="p-1">
                  <template v-if="forwardItems.length">
                    <DropdownMenuLabel class="text-xs text-muted-foreground">Forward</DropdownMenuLabel>
                    <template v-for="it in forwardItems" :key="`f${it.steps}`">
                      <DropdownMenuItem class="items-start gap-2" @select="deck.panelJump(it.steps)" @pointerenter="preview($event, it.r)" @focus="preview($event, it.r)">
                          <component :is="ITEM_KIND[it.r.kind].icon" class="mt-0.5 shrink-0 text-muted-foreground" />
                          <span class="min-w-0 flex-1">
                            <span class="block truncate">{{ parts(it.r).title }}</span>
                            <span class="block truncate font-mono text-[11px] text-muted-foreground">{{ parts(it.r).sub }}</span>
                          </span>
                        </DropdownMenuItem>
                    </template>
                    <DropdownMenuSeparator />
                  </template>
                  <template v-if="deck.currentPanel">
                    <DropdownMenuLabel class="text-xs text-muted-foreground">Now</DropdownMenuLabel>
                    <div class="flex items-start gap-2 rounded-sm bg-accent/60 px-2 py-1.5 text-sm">
                      <component :is="ITEM_KIND[deck.currentPanel.kind].icon" class="mt-0.5 size-4 shrink-0 text-primary" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate font-medium">{{ parts(deck.currentPanel).title }}</span>
                        <span class="block truncate font-mono text-[11px] text-muted-foreground">{{ parts(deck.currentPanel).sub }}</span>
                      </span>
                    </div>
                  </template>
                  <template v-if="backItems.length">
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel class="text-xs text-muted-foreground">Back</DropdownMenuLabel>
                    <template v-for="it in backItems" :key="`b${it.steps}`">
                      <DropdownMenuItem class="items-start gap-2" @select="deck.panelJump(it.steps)" @pointerenter="preview($event, it.r)" @focus="preview($event, it.r)">
                          <component :is="ITEM_KIND[it.r.kind].icon" class="mt-0.5 shrink-0 text-muted-foreground" />
                          <span class="min-w-0 flex-1">
                            <span class="block truncate">{{ parts(it.r).title }}</span>
                            <span class="block truncate font-mono text-[11px] text-muted-foreground">{{ parts(it.r).sub }}</span>
                          </span>
                        </DropdownMenuItem>
                    </template>
                  </template>
                  <template v-if="recentItems.length">
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel class="text-xs text-muted-foreground">Recently opened</DropdownMenuLabel>
                    <template v-for="r in recentItems" :key="`r${key(r)}`">
                      <DropdownMenuItem class="items-start gap-2" @select="openRecent(r)" @pointerenter="preview($event, r)" @focus="preview($event, r)">
                          <component :is="ITEM_KIND[r.kind].icon" class="mt-0.5 shrink-0 text-muted-foreground" />
                          <span class="min-w-0 flex-1">
                            <span class="block truncate">{{ parts(r).title }}</span>
                            <span class="block truncate font-mono text-[11px] text-muted-foreground">{{ parts(r).sub }}</span>
                          </span>
                        </DropdownMenuItem>
                    </template>
                  </template>
                </div>
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </TooltipTrigger>
      <TooltipContent>History: what the panel showed this session, and recently opened items</TooltipContent>
    </Tooltip>
    <!-- Preview of the highlighted entry, beside the menu -->
    <Teleport to="body">
      <div
        v-if="menuOpen && shown"
        class="pointer-events-none fixed z-[60] w-[360px] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
        :style="{ top: `${shown.top}px`, left: `${shown.left}px` }"
        data-no-link-preview
      >
        <PanelItemCard :key="`${shown.item.kind}:${shown.item.id}`" :item="shown.item" preview-only />
      </div>
    </Teleport>
  </div>
</template>
