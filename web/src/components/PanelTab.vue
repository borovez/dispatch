<script setup lang="ts">
import { isTyping } from '@/lib/typing'
import { computed } from 'vue'
import { useEventListener } from '@vueuse/core'
import { PhArrowCounterClockwise } from '@phosphor-icons/vue'
import { useDeck, type PanelRef } from '@/stores/deck'
import { LAYER_OPEN } from '@/composables/escape'
import { ITEM_KIND } from '@/utils/itemKinds'
import KindIcon from './KindIcon.vue'

/**
 * While no side panel is open: a slim tab on the right edge. Hovering (or focusing) slides out the last
 * item closed, which a click (or Alt+→) reopens with its back / forward history, and the few opened
 * before it.
 */
const deck = useDeck()
const show = computed(() => !deck.currentPanel && deck.recentPanels.length > 0)
const last = computed(() => deck.recentPanels[0])
const earlier = computed(() => deck.recentPanels.slice(1, 6))

/** Title and a short line under it */
function label(r: PanelRef): { title: string; sub: string } {
  if (r.kind === 'pr') {
    const p = deck.byId.get(r.id)
    return { title: p?.title ?? r.id, sub: r.id.replace(/^[^/]+\//, '') }
  }
  if (r.kind === 'jira') return { title: deck.jiraByKey.get(r.id)?.summary ?? r.id, sub: r.id }
  const s = deck.overview?.slack.find((x) => x.id === r.id)
  return { title: s ? s.text.replace(/\s+/g, ' ').slice(0, 90) : 'Slack message', sub: s ? `${s.userName} · ${s.channelName}` : '' }
}

// Alt+→ reopens the last item (in an open panel it moves forward)
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!show.value || !e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.key !== 'ArrowRight') return
  if (isTyping(e.target) || document.querySelector(LAYER_OPEN)) return
  e.preventDefault()
  deck.reopenPanel()
})
</script>

<template>
  <div
    v-if="show && last"
    class="group pointer-events-none fixed top-1/2 right-0 z-30 flex -translate-y-1/2 items-center max-sm:hidden"
  >
    <!-- Slides out on hover / focus of the tab; the wrapper ignores the pointer, so the hidden card's
         area doesn't open it, and the card takes the pointer only while shown -->
    <div
      class="pointer-events-none w-72 translate-x-4 rounded-l-xl border border-r-0 bg-popover py-1.5 pl-1.5 text-popover-foreground opacity-0 shadow-lg transition-all duration-150 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100"
    >
      <p class="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <PhArrowCounterClockwise :size="12" /> Reopen
        <span class="flex-1" />
        <span class="font-normal tracking-normal normal-case">Alt+→</span>
      </p>
      <button
        class="flex w-full items-start gap-2 rounded-l-lg bg-accent/60 px-2 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        :title="`Reopen this ${ITEM_KIND[last.kind].label.toLowerCase()}`"
        @click="deck.reopenPanel()"
      >
        <KindIcon :kind="last.kind" class="size-5 [&_svg]:size-3" />
        <span class="min-w-0 flex-1">
          <span class="line-clamp-2 text-sm leading-snug font-medium">{{ label(last).title }}</span>
          <span class="block truncate font-mono text-[11px] text-muted-foreground">{{ label(last).sub }}</span>
        </span>
      </button>
      <template v-if="earlier.length">
        <p class="px-2 pt-2 pb-1 text-[11px] text-muted-foreground">Earlier</p>
        <button
          v-for="r in earlier"
          :key="`${r.kind}:${r.id}`"
          class="flex w-full items-center gap-2 rounded-l-md px-2 py-1 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          @click="deck.reopenPanel(r)"
        >
          <component :is="ITEM_KIND[r.kind].icon" :size="13" class="shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">{{ label(r).title }}</span>
        </button>
      </template>
    </div>
    <!-- The tab itself; while the card is out it runs the card's full height as its right edge, flush -->
    <button
      class="pointer-events-auto flex h-20 w-2 items-center justify-center rounded-l-md bg-primary/40 transition-all group-focus-within:h-auto group-focus-within:self-stretch group-focus-within:rounded-none group-focus-within:bg-primary group-hover:h-auto group-hover:w-1.5 group-hover:self-stretch group-hover:rounded-none group-hover:bg-primary focus-visible:outline-none"
      :aria-label="`Reopen ${label(last).title}`"
      @click="deck.reopenPanel()"
    />
  </div>
</template>
