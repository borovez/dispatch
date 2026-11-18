<script setup lang="ts">
import ItemContextMenu from './ItemContextMenu.vue'
import { usePrMenu } from '@/composables/itemMenus'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { PhCircleNotch, PhDotsSixVertical, PhGraph, PhTrash } from '@phosphor-icons/vue'
import type { DepEdge, PrView, ReleaseTrain } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useDependencies } from '@/composables/dependencies'
import { useReleaseNav } from '@/composables/releaseNav'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import RepoName from './RepoName.vue'
import PrPicker from './PrPicker.vue'
import FlagStatus from './FlagStatus.vue'
import { useReleaseFlags } from '@/composables/flags'
import { STATUS_BAR as BAR, useReleaseStatus } from '@/composables/trainStatus'

/**
 * A release's train (PR panel): the releases in shipping order as a list. Drag a release to reorder;
 * the drop is shown as a plan first (which descriptions gain or lose a "Depends on:" line) and only
 * written on Apply. Each consecutive pair gets a merge dependency (the later release waits for the
 * earlier); direct dependencies that contradict the new order are removed. Merged releases stay first,
 * and an order that comes from the releases' contents (not a direct dependency) can't be reversed.
 * Rows are colour coded (bar + badge): merged, ready to merge, waiting on an earlier release, blocked
 * (CI, conflicts), else the PR's next action.
 */
const props = defineProps<{ train: ReleaseTrain; releaseId: string }>()
const deck = useDeck()
const prMenu = usePrMenu()
const deps = useDependencies()
const busy = deps.busy
const nav = useReleaseNav()
const flagsOf = useReleaseFlags()
const releaseStatus = useReleaseStatus()

const ordered = computed(() => props.train.links.some((l) => l.kind === 'order'))
const isOpen = (id: string) => deck.byId.get(id)?.state === 'OPEN'
/** A direct dependency between two releases (either way), as stored on the dependent */
const directEdge = (dependent: string, prereq: string): DepEdge | undefined => deck.byId.get(dependent)?.dependsOn.find((e) => e.to === prereq)
const orderLinks = computed(() => props.train.links.filter((l) => l.kind === 'order'))

/** The list as shown: the train's order, or the dragged order while its plan is open */
const draft = ref<string[] | null>(null)
watch(
  () => props.train.releases.join(),
  () => (draft.value = null),
)
const shown = computed(() => draft.value ?? props.train.releases)

const statusOf = (id: string) => releaseStatus(props.train, id)

/** Each row: the release, its relation to the panel's release and why */
const rows = computed(() =>
  shown.value.map((id) => {
    const pr = deck.byId.get(id)
    const before = orderLinks.value.find((l) => l.from === id && l.to === props.releaseId)
    const after = orderLinks.value.find((l) => l.from === props.releaseId && l.to === id)
    const direct = directEdge(props.releaseId, id) ?? directEdge(id, props.releaseId)
    const link = before ?? after
    const why = direct ? (direct.source === 'body' ? 'set in the PR description' : 'added in Dispatch') : (link?.reasons[0] ?? '')
    const shared = props.train.links.find((l) => l.kind === 'jira' && [l.from, l.to].includes(id) && [l.from, l.to].includes(props.releaseId))
    // Open, and nothing in the train has to ship first: its number is only a suggestion
    const free = isOpen(id) && !orderLinks.value.some((l) => l.to === id)
    return { id, pr, self: id === props.releaseId, before, after, direct, why, shared, movable: isOpen(id), status: statusOf(id), free }
  }),
)

// ---------- Plan: what the new order takes ----------
interface Plan {
  remove: DepEdge[]
  add: { waiting: string; first: string }[]
}
const plan = ref<Plan | null>(null)

/** The changes for an order, or the reason it can't be done */
function planFor(order: string[]): Plan | string {
  const pos = new Map(order.map((id, i) => [id, i]))
  // Merged releases have shipped: none may come after an open one
  const firstOpen = order.findIndex(isOpen)
  const lateMerged = firstOpen < 0 ? undefined : order.slice(firstOpen).find((id) => !isOpen(id))
  if (lateMerged) return `${lateMerged} is already merged, so it stays ahead of the open releases`
  const remove: DepEdge[] = []
  for (const l of orderLinks.value) {
    if (pos.get(l.from)! < pos.get(l.to)!) continue
    const e = directEdge(l.to, l.from)
    if (e && deps.canRemove(e)) remove.push(e)
    else return `${l.from} has to ship before ${l.to}: ${l.reasons[0] ?? 'their contents depend on each other'}`
  }
  const add: Plan['add'] = []
  for (let i = 1; i < order.length; i++) {
    const [first, waiting] = [order[i - 1], order[i]]
    // Already in this order (directly or through their contents), or merged: nothing to write
    if (orderLinks.value.some((l) => l.from === first && l.to === waiting) || !isOpen(waiting)) continue
    add.push({ waiting, first })
  }
  return { remove, add }
}

const applying = ref(false)
async function apply() {
  const p = plan.value
  if (!p) return
  applying.value = true
  let ok = true
  for (const e of p.remove) ok = (await deps.remove(e)) && ok
  for (const a of p.add) ok = (await deps.add(a.waiting, a.first, 'merge')) && ok
  applying.value = false
  plan.value = null
  draft.value = null
  if (!ok) toast.warning('Not every change went through', { description: 'The train shows what was saved.' })
}
function cancel() {
  plan.value = null
  draft.value = null
}

// ---------- Drag to reorder (handle only), with a line where it lands ----------
const dragging = ref<string | null>(null)
/** Insert before this index (length = at the end) */
const dropAt = ref<number | null>(null)
const listEl = ref<HTMLElement>()
function onDragStart(e: DragEvent, id: string) {
  dragging.value = id
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', id)
}
function onDragOver(e: DragEvent) {
  if (!dragging.value || !listEl.value) return
  e.preventDefault()
  const items = [...listEl.value.querySelectorAll<HTMLElement>('[data-train-row]')]
  const i = items.findIndex((el) => {
    const r = el.getBoundingClientRect()
    return e.clientY < r.top + r.height / 2
  })
  dropAt.value = i < 0 ? items.length : i
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  const id = dragging.value
  const at = dropAt.value
  endDrag()
  if (!id || at == null) return
  const order = shown.value.filter((x) => x !== id)
  const from = shown.value.indexOf(id)
  order.splice(at > from ? at - 1 : at, 0, id)
  if (order.join() === props.train.releases.join()) return cancel()
  const p = planFor(order)
  if (typeof p === 'string') return void toast.error("Can't ship them in that order", { description: p })
  if (!p.add.length && !p.remove.length) return
  draft.value = order
  plan.value = p
}
function endDrag() {
  dragging.value = null
  dropAt.value = null
}

const remove = (e: DepEdge) => deps.remove(e)

// Order against any open release, also outside the train
const otherRelease = ref('')
const isRelease = (p: PrView) => p.flow === 'release' && p.state === 'OPEN'
const orderedReason = (p: PrView) =>
  orderLinks.value.some((l) => [l.from, l.to].includes(p.id) && [l.from, l.to].includes(props.releaseId)) ? 'already ordered' : null
async function shipAfterPicked() {
  if (otherRelease.value && (await deps.add(props.releaseId, otherRelease.value, 'merge'))) otherRelease.value = ''
}
const canEdit = computed(() => props.train.releases.filter(isOpen).length > 1)
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      <span v-if="!ordered">No shipping order yet: these releases ship the same Jira issues.</span>
      <span v-else-if="train.cycle" class="text-warning">These releases wait on each other in a circle; the order is a best guess.</span>
      <span v-if="canEdit">Drag a release to change the order.</span>
      <span class="flex-1" />
      <Button variant="ghost" size="xs" class="text-muted-foreground" title="The Trains graph, framing this release" @click="nav.openTrainGraph(releaseId)">
        <PhGraph /> Show in graph
      </Button>
    </div>

    <!-- The train in shipping order -->
    <ol ref="listEl" class="relative rounded-lg border" @dragover="onDragOver" @drop="onDrop" @dragleave.self="dropAt = null">
      <li
        v-for="(r, i) in rows"
        :key="r.id"
        data-train-row
        class="relative flex min-w-0 items-start gap-2 px-2 py-2 text-sm transition-opacity"
        :class="[i > 0 && 'border-t', r.self && 'bg-primary/5', dragging === r.id && 'opacity-40']"
        :draggable="canEdit && r.movable && !plan"
        @dragstart="onDragStart($event, r.id)"
        @dragend="endDrag"
      >
        <!-- Status colour -->
        <span class="pointer-events-none absolute inset-y-1.5 left-0 w-1 rounded-r-full" :class="BAR[r.status.tone] ?? 'bg-muted-foreground/30'" />
        <!-- Where the dragged release lands -->
        <span v-if="dropAt === i" class="pointer-events-none absolute inset-x-2 -top-px z-10 h-0.5 rounded-full bg-primary" />
        <span v-if="dropAt === rows.length && i === rows.length - 1" class="pointer-events-none absolute inset-x-2 -bottom-px z-10 h-0.5 rounded-full bg-primary" />
        <span
          class="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/60"
          :class="canEdit && r.movable && !plan ? 'cursor-grab hover:bg-accent hover:text-foreground active:cursor-grabbing' : 'invisible'"
          :title="r.movable ? 'Drag to change the order' : undefined"
        >
          <PhDotsSixVertical :size="14" />
        </span>
        <span v-if="ordered" class="mt-0.5 w-4 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{{ i + 1 }}.</span>
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex min-w-0 items-center gap-2">
            <ItemContextMenu as="span" :entries="() => prMenu.byId(r.id)">
              <button class="min-w-0 font-mono text-xs text-primary hover:underline" :title="`Open ${r.id}`" @click="deck.selectedId = r.id">
                <RepoName :id="r.id" no-title />
              </button>
            </ItemContextMenu>
            <FlagStatus :keys="flagsOf(r.id)" class="[&_svg]:size-3" />
            <Badge v-if="r.self" variant="outline" class="h-4 px-1 text-[10px]">this release</Badge>
            <Badge v-if="train.next === r.id && !draft" variant="primary" class="h-4 px-1 text-[10px]">ship next</Badge>
            <span class="flex-1" />
            <Badge :variant="r.status.tone" class="h-5 shrink-0 px-1.5 text-[11px]" :title="r.status.title">{{ r.status.label }}</Badge>
          </div>
          <div class="truncate text-xs text-muted-foreground" :title="r.pr?.title">{{ r.pr?.title }}</div>
          <div v-if="r.free && ordered && i > 0 && !draft" class="text-xs text-success">Waits for nothing in this train: can ship any time</div>
          <div v-if="!r.self && !draft" class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span v-if="r.before || r.after" class="min-w-0 truncate" :title="(r.before ?? r.after)!.reasons.join('\n')">
              {{ r.before ? 'Ships before' : 'Ships after' }} this release · {{ r.why }}
            </span>
            <span v-else-if="r.shared" class="min-w-0 truncate">{{ r.shared.reasons.join('; ') }}</span>
            <span class="flex-1" />
            <Button
              v-if="r.direct && (r.before || r.after) && deps.canRemove(r.direct)"
              size="xs"
              variant="ghost"
              class="h-6 text-muted-foreground"
              :disabled="busy"
              :title="r.direct.source === 'body' ? 'Takes the line out of the PR description' : 'Removes the dependency'"
              @click="remove(r.direct)"
            >
              <PhCircleNotch v-if="deps.isPending(r.direct.from, r.direct.to)" class="animate-spin" /><PhTrash v-else />Remove order
            </Button>
          </div>
        </div>
      </li>
    </ol>

    <!-- The dropped order, before anything is written -->
    <div v-if="plan" class="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
      <p class="font-medium">Ship in this order?</p>
      <ul class="space-y-1 text-xs">
        <li v-for="e in plan.remove" :key="`r${e.from}${e.to}`" class="flex gap-1.5">
          <span class="text-destructive">−</span>
          <span>{{ e.source === 'body' ? 'Takes' : 'Removes' }} <code>Depends on: {{ e.to }}</code> {{ e.source === 'body' ? `out of ${e.from}'s description` : `(${e.from}, added in Dispatch)` }}</span>
        </li>
        <li v-for="a in plan.add" :key="`a${a.waiting}${a.first}`" class="flex gap-1.5">
          <span class="text-success">+</span>
          <span>Adds <code>Depends on: {{ a.first }}</code> to {{ a.waiting }}'s description</span>
        </li>
      </ul>
      <div class="flex justify-end gap-2">
        <Button size="sm" variant="outline" :disabled="applying" @click="cancel">Cancel</Button>
        <Button size="sm" :disabled="applying" @click="apply"><PhCircleNotch v-if="applying" class="animate-spin" /> Apply</Button>
      </div>
    </div>

    <!-- Order against a release that isn't in the train yet -->
    <form v-if="isOpen(releaseId) && !plan" class="flex items-center gap-2" @submit.prevent="shipAfterPicked">
      <PrPicker
        v-model="otherRelease"
        :exclude="releaseId"
        :filter="isRelease"
        :disabled-reason="orderedReason"
        :disabled="busy"
        placeholder="Ship this after another release… (search open releases)"
        class="h-8 min-w-0 flex-1"
      />
      <Button type="submit" size="sm" variant="outline" :disabled="busy || !otherRelease">
        <PhCircleNotch v-if="busy" class="animate-spin" /> Ship after it
      </Button>
    </form>
  </div>
</template>
