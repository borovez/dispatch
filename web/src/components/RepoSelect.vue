<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PhCaretUpDown, PhCheck, PhGitBranch } from '@phosphor-icons/vue'
import { useListNav } from '@/composables/listNav'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'

/**
 * One repo at a time, or "All repos" (dependency and release graphs, Releases page). A popover with a search
 * box (every word must appear in owner/name), arrows and Enter; counts sit on the right.
 */
const props = defineProps<{ tabs: { key: string; repo: string; count: number }[] }>()
const model = defineModel<string>({ required: true })
const picked = computed(() => props.tabs.find((t) => t.key === model.value) ?? null)

const name = (repo: string) => repo.split('/')[1] ?? repo
const owner = (repo: string) => (repo.includes('/') ? repo.split('/')[0] : '')
const COUNT = 'rounded-full bg-muted px-1.5 text-xs leading-5 text-muted-foreground tabular-nums'

const open = ref(false)
const q = ref('')
const active = ref(0)
const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<InstanceType<typeof Input> | null>(null)
type Row = { key: string; repo: string | null; count: number | null }
/** Matching repos, then "All repos" (kept while searching, so it's always one Enter away) */
const rows = computed<Row[]>(() => {
  const words = q.value.toLowerCase().split(/\s+/).filter(Boolean)
  const repos = props.tabs.filter((t) => words.every((w) => t.repo.toLowerCase().includes(w)))
  return [...repos.map((t) => ({ key: t.key, repo: t.repo, count: t.count })), { key: 'all', repo: null, count: null }]
})
watch(q, () => (active.value = 0))
watch(open, (o) => {
  if (!o) return
  q.value = ''
  active.value = Math.max(0, rows.value.findIndex((r) => r.key === model.value))
  void nextTick(() => {
    ;(inputEl.value?.$el as HTMLInputElement | undefined)?.focus()
    listEl.value?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  })
})
const nav = useListNav({ items: () => rows.value, active, container: () => listEl.value })
function pick(key: string) {
  model.value = key
  open.value = false
}
function onKey(e: KeyboardEvent) {
  if (nav.onArrow(e)) return
  if (e.key === 'Enter') {
    e.preventDefault()
    const r = rows.value[active.value]
    if (r) pick(r.key)
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button type="button" variant="outline" size="sm" class="w-56 max-w-full shrink justify-between gap-2 px-2.5 font-normal" aria-label="Repository">
        <PhGitBranch class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-left">{{ picked ? name(picked.repo) : 'All repos' }}</span>
        <span v-if="picked" :class="COUNT">{{ picked.count }}</span>
        <PhCaretUpDown class="shrink-0 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-64 gap-0 p-0" @open-auto-focus.prevent>
      <div class="border-b p-1.5">
        <Input ref="inputEl" v-model="q" class="h-8 text-sm" placeholder="Search repos…" aria-label="Search repos" @keydown="onKey" />
      </div>
      <ScrollArea class="[&>[data-slot=scroll-area-viewport]]:max-h-72">
        <ul ref="listEl" class="py-1" role="listbox" aria-label="Repository">
          <li
            v-for="(r, i) in rows"
            :key="r.key"
            role="option"
            :aria-selected="r.key === model"
            :title="r.repo ?? undefined"
            :data-active="i === active || undefined"
            :class="
              cn(
                'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                i === active && 'bg-accent',
                r.key === model && 'bg-primary/10 text-primary',
                !r.repo && 'mt-1 border-t pt-2',
              )
            "
            @mouseenter="active = i"
            @click="pick(r.key)"
          >
            <template v-if="r.repo">
              <span class="min-w-0 truncate">{{ name(r.repo) }}</span>
              <span v-if="q && owner(r.repo)" class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{{ owner(r.repo) }}</span>
              <span v-else class="flex-1" />
              <span :class="COUNT">{{ r.count }}</span>
            </template>
            <span v-else class="flex-1">All repos</span>
            <PhCheck :class="cn('shrink-0', r.key !== model && 'invisible')" />
          </li>
        </ul>
        <p v-if="rows.length === 1 && q" class="px-3 pb-2 text-xs text-muted-foreground">No repo matches “{{ q }}”.</p>
      </ScrollArea>
    </PopoverContent>
  </Popover>
</template>
