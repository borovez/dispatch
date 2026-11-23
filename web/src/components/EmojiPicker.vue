<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PhSmiley } from '@phosphor-icons/vue'
import { searchEmoji, type EmojiItem } from '@/composables/slackEmoji'
import { useLayout } from '@/stores/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Toolbar emoji button: a popover with a search box and a grid (Slack's names and the workspace's custom
 * emoji; recently used first). Arrows move through the grid from the search box, Enter picks. Emits the
 * pick; the caller inserts it (at the caret) and gets focus back with `@close-auto-focus`.
 */
const emit = defineEmits<{ pick: [e: EmojiItem]; closeAutoFocus: [e: Event] }>()

const COLS = 8
const open = ref(false)
const query = ref('')
const active = ref(0)
const grid = ref<HTMLElement | null>(null)
const v = useLayout().view('emoji-picker', { recent: [] as string[] })

const results = computed(() => searchEmoji(query.value))
/** Recently used, when not searching (by name; ones that no longer exist drop out) */
const recent = computed(() => {
  if (query.value.trim()) return []
  const byName = new Map(searchEmoji('').map((e) => [e.name, e]))
  return v.recent.map((n) => byName.get(n)).filter((e): e is EmojiItem => !!e)
})
/** Everything in grid order (recent, then the rest), for the keys */
const cells = computed(() => [...recent.value, ...results.value])
const shown = computed(() => cells.value[active.value] ?? null)

watch(query, () => (active.value = 0))
watch(open, (o) => {
  if (!o) return
  query.value = ''
  active.value = 0
})

function pick(e: EmojiItem) {
  v.recent = [e.name, ...v.recent.filter((n) => n !== e.name)].slice(0, 16)
  open.value = false
  emit('pick', e)
}

function onKey(e: KeyboardEvent) {
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key]
  if (step) {
    e.preventDefault()
    const n = cells.value.length
    if (!n) return
    active.value = Math.min(n - 1, Math.max(0, active.value + step))
    nextTick(() => grid.value?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' }))
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (shown.value) pick(shown.value)
  }
}
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span class="inline-flex">
        <Popover v-model:open="open">
          <PopoverTrigger as-child>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Insert emoji" @mousedown.prevent><PhSmiley /></Button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-80 gap-0 p-0" @close-auto-focus="(e: Event) => emit('closeAutoFocus', e)">
            <div class="border-b p-2">
              <Input v-model="query" placeholder="Search emoji" class="h-8 text-sm" aria-label="Search emoji" @keydown="onKey" />
            </div>
            <ScrollArea class="[&>[data-slot=scroll-area-viewport]]:max-h-64">
              <div ref="grid" class="p-1.5" role="grid" aria-label="Emoji">
                <template v-for="(section, si) in [{ label: 'Recent', items: recent, offset: 0 }, { label: query.trim() ? 'Results' : 'All', items: results, offset: recent.length }]" :key="si">
                  <template v-if="section.items.length">
                    <p v-if="recent.length" class="px-1 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">{{ section.label }}</p>
                    <div class="grid grid-cols-8">
                      <button
                        v-for="(e, i) in section.items"
                        :key="`${si}:${e.name}`"
                        type="button"
                        role="gridcell"
                        :title="`:${e.name}:`"
                        :aria-label="e.name"
                        :data-active="section.offset + i === active || undefined"
                        :class="['flex size-9 items-center justify-center rounded-md text-xl leading-none transition-colors hover:bg-accent', section.offset + i === active && 'bg-accent ring-1 ring-primary ring-inset']"
                        @mouseenter="active = section.offset + i"
                        @click="pick(e)"
                      >
                        <img v-if="e.url" :src="e.url" :alt="e.name" loading="lazy" class="size-6 object-contain" />
                        <template v-else>{{ e.char }}</template>
                      </button>
                    </div>
                  </template>
                </template>
                <p v-if="!cells.length" class="px-2 py-6 text-center text-sm text-muted-foreground">No emoji match “{{ query }}”.</p>
              </div>
            </ScrollArea>
            <div class="flex h-9 items-center gap-2 border-t px-3 text-sm">
              <template v-if="shown">
                <img v-if="shown.url" :src="shown.url" :alt="shown.name" class="size-5 object-contain" />
                <span v-else class="text-lg leading-none">{{ shown.char }}</span>
                <span class="truncate text-muted-foreground">:{{ shown.name }}:</span>
              </template>
            </div>
          </PopoverContent>
        </Popover>
      </span>
    </TooltipTrigger>
    <TooltipContent>Emoji <span class="opacity-70">or type :name</span></TooltipContent>
  </Tooltip>
</template>
