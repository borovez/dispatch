<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import { PhArrowRight, PhCheckCircle, PhCircleNotch, PhListChecks, PhWarningCircle } from '@phosphor-icons/vue'
import { api } from '@/api'
import { clearTransitions, transitionsFor } from '@/composables/jiraTransitions'
import { useDeck } from '@/stores/deck'
import { jiraTone } from '@/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

/**
 * Moves several Jira issues to one status (e.g. everything a release ships → Done). Pick the target
 * from the statuses the issues can reach, review each issue (current → target, already there, or no
 * way there from its status), untick any, confirm. Runs one at a time and shows each result.
 */
const props = defineProps<{ keys: string[]; /** A sentence before the instructions, e.g. "The Jira issues this release ships." */ context?: string }>()
/** Closed after the moves ran (e.g. to clear a selection) */
const emit = defineEmits<{ finished: [] }>()
const deck = useDeck()

type Transition = Awaited<ReturnType<typeof api.transitions>>[number]
const open = ref(false)
const loading = ref(false)
const transitions = reactive<Record<string, Transition[] | string>>({})
const target = ref('')
const picked = reactive<Record<string, boolean>>({})
const results = reactive<Record<string, 'ok' | string>>({})
const running = ref(false)
const done = ref(false)

const CATEGORY_ORDER = ['done', 'indeterminate', 'new']
async function onOpen(v: boolean) {
  open.value = v
  if (!v) {
    if (done.value) emit('finished')
    return
  }
  done.value = false
  for (const k of Object.keys(results)) delete results[k]
  loading.value = true
  await Promise.all(
    props.keys.map(async (k) => {
      try {
        transitions[k] = await transitionsFor(k, deck.jiraByKey.get(k))
      } catch (e) {
        transitions[k] = (e as Error).message
      }
    }),
  )
  loading.value = false
  // Default: the first status in the "done" category the issues can reach
  if (!targets.value.some((t) => t.key === target.value)) target.value = targets.value[0]?.key ?? ''
  repick()
}

/** Statuses any of the issues can move to, done first */
const targets = computed(() => {
  const by = new Map<string, { key: string; name: string; category: string; count: number }>()
  for (const k of props.keys) {
    const list = transitions[k]
    if (!Array.isArray(list)) continue
    for (const t of new Map(list.map((t) => [t.to.toLowerCase(), t])).values()) {
      const key = t.to.toLowerCase()
      const e = by.get(key) ?? { key, name: t.to, category: t.toCategory, count: 0 }
      e.count++
      by.set(key, e)
    }
  }
  return [...by.values()].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || b.count - a.count || a.name.localeCompare(b.name))
})
const targetName = computed(() => targets.value.find((t) => t.key === target.value)?.name ?? '')

const rows = computed(() =>
  props.keys.map((key) => {
    const issue = deck.jiraByKey.get(key)
    const list = transitions[key]
    const error = typeof list === 'string' ? list : undefined
    const t = Array.isArray(list) ? list.find((x) => x.to.toLowerCase() === target.value) : undefined
    const already = issue?.status.toLowerCase() === target.value
    return { key, issue, error, transition: t, state: already ? 'already' : t ? 'move' : error ? 'error' : 'none' } as const
  }),
)
const movable = computed(() => rows.value.filter((r) => r.state === 'move'))
const chosen = computed(() => movable.value.filter((r) => picked[r.key]))

function repick() {
  for (const r of rows.value) picked[r.key] = r.state === 'move'
}
function pickTarget(key: string) {
  target.value = key
  repick()
}

async function run() {
  running.value = true
  const list = chosen.value
  await deck.mutate(async () => {
    for (const r of list) {
      try {
        await api.transition(r.key, r.transition!.id)
        results[r.key] = 'ok'
      } catch (e) {
        results[r.key] = (e as Error).message
      }
    }
    clearTransitions()
  })
  const failed = list.filter((r) => results[r.key] !== 'ok').length
  if (failed) toast.error(`${failed} of ${list.length} couldn't move to ${targetName.value}`)
  else toast.success(`${list.length} issue${list.length === 1 ? '' : 's'} → ${targetName.value}`)
  running.value = false
  done.value = true
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpen">
    <DialogTrigger as-child>
      <!-- #trigger: one button element to use instead -->
      <slot name="trigger">
        <Button variant="ghost" size="xs" class="text-muted-foreground" :title="`Change the status of all ${keys.length} issues`" @click.stop>
          <PhListChecks /> Change status…
        </Button>
      </slot>
    </DialogTrigger>
    <!-- grid-cols-1 (minmax(0,1fr)): long summaries truncate instead of widening the dialog -->
    <DialogContent class="grid-cols-1 sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Change status of {{ keys.length }} Jira issues</DialogTitle>
        <DialogDescription>
          {{ context ? `${context} ` : '' }}Pick a status, check the list, then confirm. Each issue moves through its own workflow; untick any to leave it as it is.
        </DialogDescription>
      </DialogHeader>

      <div v-if="loading" class="flex items-center gap-2 py-6 text-sm text-muted-foreground"><PhCircleNotch class="animate-spin" /> Loading transitions…</div>
      <template v-else>
        <div v-if="targets.length" class="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          <Button
            v-for="t in targets"
            :key="t.key"
            size="xs"
            :variant="t.key === target ? 'default' : 'outline'"
            :disabled="running || done"
            @click="pickTarget(t.key)"
          >
            {{ t.name }} <span class="opacity-70 tabular-nums">{{ t.count }}</span>
          </Button>
        </div>
        <p v-else class="text-sm text-muted-foreground">None of these issues has a transition available.</p>

        <ScrollArea class="rounded-lg border [&>[data-slot=scroll-area-viewport]]:max-h-80">
          <ul class="divide-y">
            <li v-for="r in rows" :key="r.key" class="flex items-center gap-2 px-3 py-2 text-sm" :class="r.state !== 'move' && 'text-muted-foreground'">
              <Checkbox
                :model-value="!!picked[r.key]"
                :disabled="r.state !== 'move' || running || done"
                :aria-label="`Move ${r.key}`"
                @update:model-value="picked[r.key] = !!$event"
              />
              <span class="shrink-0 font-mono text-xs font-medium">{{ r.key }}</span>
              <span class="min-w-0 flex-1 truncate" :title="r.issue?.summary">{{ r.issue?.summary }}</span>
              <Badge v-if="r.issue" :variant="jiraTone(r.issue.statusCategory)" class="shrink-0">{{ r.issue.status }}</Badge>
              <template v-if="r.state === 'move'">
                <PhArrowRight class="shrink-0" :size="12" />
                <Badge :variant="jiraTone(r.transition!.toCategory)" class="shrink-0">{{ r.transition!.to }}</Badge>
              </template>
              <span v-else-if="r.state === 'already'" class="shrink-0 text-xs">already there</span>
              <span v-else-if="r.state === 'error'" class="shrink-0 text-xs text-destructive" :title="r.error">couldn't load</span>
              <span v-else class="shrink-0 text-xs" :title="`Its workflow has no transition to ${targetName} from ${r.issue?.status ?? 'its status'}`">no way there</span>
              <PhCheckCircle v-if="results[r.key] === 'ok'" weight="fill" class="shrink-0 text-success" :size="16" />
              <PhWarningCircle v-else-if="results[r.key]" weight="fill" class="shrink-0 text-destructive" :size="16" :title="results[r.key]" />
            </li>
          </ul>
        </ScrollArea>
      </template>

      <DialogFooter>
        <Button variant="outline" @click="onOpen(false)">{{ done ? 'Close' : 'Cancel' }}</Button>
        <Button v-if="!done" :disabled="loading || running || !chosen.length" @click="run">
          <PhCircleNotch v-if="running" class="animate-spin" />
          Move {{ chosen.length }} issue{{ chosen.length === 1 ? '' : 's' }} to {{ targetName || '…' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
