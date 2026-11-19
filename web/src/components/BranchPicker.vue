<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { PhCaretUpDown, PhCheck, PhCircleNotch, PhGitBranch } from '@phosphor-icons/vue'
import { api } from '@/api'
import { useListNav } from '@/composables/listNav'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'

/**
 * Searchable branch dropdown for a repo (GET /repos/branches: default branch first). With `defaultOnLoad`, an
 * empty value is set to the repo's default branch (main / master) once the list arrives.
 */
const props = defineProps<{ repo: string; defaultOnLoad?: boolean; class?: string }>()
const model = defineModel<string>({ required: true })

const branches = ref<string[]>([])
const defaultBranch = ref('')
const loading = ref(false)
const error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await api.repoBranches(props.repo)
    branches.value = r.branches
    defaultBranch.value = r.default
    if (props.defaultOnLoad && !model.value) model.value = r.default
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}
watch(() => props.repo, load, { immediate: true })

const open = ref(false)
const q = ref('')
const active = ref(0)
const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<InstanceType<typeof Input> | null>(null)
const matches = computed(() => {
  const words = q.value.toLowerCase().split(/\s+/).filter(Boolean)
  return branches.value.filter((b) => words.every((w) => b.toLowerCase().includes(w))).slice(0, 200)
})
watch(q, () => (active.value = 0))
watch(open, (o) => {
  if (!o) return
  q.value = ''
  active.value = Math.max(0, matches.value.indexOf(model.value))
  void nextTick(() => (inputEl.value?.$el as HTMLInputElement | undefined)?.focus())
})
const nav = useListNav({ items: () => matches.value, active, container: () => listEl.value })
function pick(b: string) {
  model.value = b
  open.value = false
}
function onKey(e: KeyboardEvent) {
  if (nav.onArrow(e)) return
  if (e.key === 'Enter') {
    e.preventDefault()
    const b = matches.value[active.value]
    if (b) pick(b)
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button type="button" variant="outline" :class="cn('h-8 justify-between gap-1.5 px-2 font-mono text-xs font-normal', props.class)" :title="`Branch it's cut from and merges into: ${model || 'pick one'}`">
        <PhGitBranch class="shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-left">{{ model || 'Base branch' }}</span>
        <PhCircleNotch v-if="loading" class="shrink-0 animate-spin text-muted-foreground" />
        <PhCaretUpDown v-else class="shrink-0 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-72 gap-0 p-0" @open-auto-focus.prevent>
      <div class="border-b p-1.5">
        <Input ref="inputEl" v-model="q" class="h-8 text-xs" placeholder="Search branches…" @keydown="onKey" />
      </div>
      <p v-if="error" class="px-3 py-2 text-xs text-destructive">{{ error }}</p>
      <p v-else-if="loading && !branches.length" class="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><PhCircleNotch class="animate-spin" /> Loading branches…</p>
      <p v-else-if="!matches.length" class="px-3 py-2 text-xs text-muted-foreground">No branch matches.</p>
      <ScrollArea v-else class="[&>[data-slot=scroll-area-viewport]]:max-h-64">
        <ul ref="listEl" class="p-1">
          <li
            v-for="(b, i) in matches"
            :key="b"
            :data-active="i === active || undefined"
            :class="cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-mono text-xs', i === active && 'bg-accent', b === model && 'text-primary')"
            @mouseenter="active = i"
            @click="pick(b)"
          >
            <span class="min-w-0 flex-1 truncate">{{ b }}</span>
            <Badge v-if="b === defaultBranch" variant="muted" class="font-sans">default</Badge>
            <PhCheck v-if="b === model" class="shrink-0" />
          </li>
        </ul>
      </ScrollArea>
    </PopoverContent>
  </Popover>
</template>
