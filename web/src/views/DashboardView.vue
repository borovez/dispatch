<script setup lang="ts">
import ChainStep from '@/components/ChainStep.vue'
import { modClickHint, wantsExternal } from '@/lib/external'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhLinkSimple, PhCaretRight, PhEye, PhPlus, PhRocketLaunch, PhSlidersHorizontal, PhWarning } from '@phosphor-icons/vue'
import { isUnreleased } from '@/utils/releaseFlow'
import { useReleaseNav } from '@/composables/releaseNav'
import { useReleaseFlags } from '@/composables/flags'
import type { PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { filterPrs, sortPrs, useLayout, type PanelConfig, type PanelType } from '@/stores/layout'
import { jiraTone } from '@/utils/format'
import { type PrFocus } from '@/utils/prFocus'
import DashPanel from '@/components/DashPanel.vue'
import PrListPopover from '@/components/PrListPopover.vue'
import PrRow from '@/components/PrRow.vue'
import SlackList from '@/components/SlackList.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

const deck = useDeck()
const layout = useLayout()

const PR_SORTS = [
  { value: 'urgency', label: 'Urgency' },
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'repo', label: 'Repo' },
  { value: 'size', label: 'Size' },
]
const TIME_SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

const prsFor = (p: PanelConfig): PrView[] => sortPrs(filterPrs(deck.prs, p.filter), p.sort, p.dir)
const slackNew = computed(() => (deck.overview?.slack ?? []).filter((i) => i.status === 'new'))
const slackFor = (p: PanelConfig) => (p.sort === 'oldest' ? [...slackNew.value].reverse() : slackNew.value)
const myJira = computed(() => (deck.overview?.jira ?? []).filter((j) => j.isMine && j.statusCategory !== 'done'))
const openChains = computed(() => (deck.overview?.chains ?? []).filter((c) => !c.done))
/** Releases panel: open releases, hotfixes not back in dev, my merged work not in a release yet */
const shipNextIds = computed(() => new Set((deck.overview?.trains ?? []).map((t) => t.next).filter(Boolean)))
// "Ship next" releases first
const openReleases = computed(() =>
  deck.prs.filter((p) => p.flow === 'release' && p.state === 'OPEN').sort((a, b) => Number(shipNextIds.value.has(b.id)) - Number(shipNextIds.value.has(a.id))),
)
const needsBackmerge = computed(() => deck.prs.filter((p) => p.flow === 'hotfix' && p.state === 'MERGED' && p.backmerge && !p.backmerge.backmerged))
const myUnreleased = computed(() => deck.prs.filter((p) => p.isMine && isUnreleased(p)))
const releaseNav = useReleaseNav()
const flagsOf = useReleaseFlags()
const releasesView = layout.view('releases', { tab: 'releases' as string })

function itemsFor(p: PanelConfig): number {
  if (p.type === 'prs') return prsFor(p).length
  if (p.type === 'slack') return slackNew.value.length
  if (p.type === 'jira') return myJira.value.length
  if (p.type === 'releases') return openReleases.value.length + needsBackmerge.value.length
  return openChains.value.length
}


/*
 * Panel drag & drop. The grid is zones (layout.zones): a full-width panel, or a row of two column
 * stacks. While dragging, the point picks the nearest zone (so empty space under a short column or
 * below the grid counts), then the spot in it; a primary line shows where the panel will land.
 */
const pageEl = ref<HTMLElement>()
const gridEl = ref<HTMLElement>()
const draggingId = ref<string | null>(null)
interface DropSpot {
  ref: string
  where: 'before' | 'after'
  column?: 'left' | 'right'
  line: { top: number; left: number; width: number }
}
const spot = ref<DropSpot | null>(null)
const GAP = 16

function onDragStart(e: DragEvent) {
  draggingId.value = (e.target as HTMLElement).closest<HTMLElement>('[data-panel-id]')?.dataset.panelId ?? null
}
function endDrag() {
  draggingId.value = null
  spot.value = null
}
/** Distance from a point to a rect (0 inside) */
const dist = (r: DOMRect, x: number, y: number) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
const panelRect = (id: string) => gridEl.value?.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)?.getBoundingClientRect()
const orderOf = (id: string) => layout.orderedPanels.findIndex((p) => p.id === id)

function onDragOver(e: DragEvent) {
  const id = draggingId.value
  const grid = gridEl.value
  const dragged = layout.prefs.panels.find((p) => p.id === id)
  if (!id || !grid || !dragged) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  const x = e.clientX
  const y = e.clientY
  const g = grid.getBoundingClientRect()
  const zones = layout.zones
  const els = [...grid.querySelectorAll<HTMLElement>('[data-zone]')]
  if (!els.length) return
  const el = els.reduce((a, b) => (dist(b.getBoundingClientRect(), x, y) < dist(a.getBoundingClientRect(), x, y) ? b : a))
  const zone = zones[Number(el.dataset.zone)]
  const z = el.getBoundingClientRect()
  const at = (top: number, left: number, right: number) => ({ top: top - g.top, left: left - g.left, width: right - left })
  // Two columns from lg (matches the grid's lg:grid-cols-2)
  const wide = window.matchMedia('(min-width: 1024px)').matches
  const mid = g.left + g.width / 2

  // Full-width panels go between rows
  if (dragged.width === 'full') {
    const row = els.filter((o) => zones[Number(o.dataset.zone)].seg === zone.seg).map((o) => o.getBoundingClientRect())
    const top = Math.min(...row.map((r) => r.top))
    const bottom = Math.max(...row.map((r) => r.bottom))
    const ids = zones.filter((o) => o.seg === zone.seg).flatMap((o) => o.panels.map((p) => p.id)).sort((a, b) => orderOf(a) - orderOf(b))
    const before = y < (top + bottom) / 2
    spot.value = { ref: before ? ids[0] : ids[ids.length - 1], where: before ? 'before' : 'after', line: at(before ? top - GAP / 2 : bottom + GAP / 2, g.left, g.right) }
    return
  }

  // Half width beside a full-width panel: above or below it, on the side the pointer is
  if (zone.col === 'full') {
    const column = wide && x >= mid ? 'right' : 'left'
    const [left, right] = !wide ? [g.left, g.right] : column === 'left' ? [g.left, mid - GAP / 2] : [mid + GAP / 2, g.right]
    const before = y < (z.top + z.bottom) / 2
    spot.value = { ref: zone.panels[0].id, where: before ? 'before' : 'after', column, line: at(before ? z.top - GAP / 2 : z.bottom + GAP / 2, left, right) }
    return
  }

  // In a column: before the first panel whose middle is below the pointer, else at the end
  const column = zone.col
  const others = zone.panels.filter((p) => p.id !== id)
  for (const p of others) {
    const r = panelRect(p.id)
    if (r && y < (r.top + r.bottom) / 2) {
      spot.value = { ref: p.id, where: 'before', column, line: at(r.top - GAP / 2, z.left, z.right) }
      return
    }
  }
  const last = others[others.length - 1]
  if (last) {
    const r = panelRect(last.id)!
    spot.value = { ref: last.id, where: 'after', column, line: at(r.bottom + GAP / 2, z.left, z.right) }
    return
  }
  // Empty column: next to any panel of the row (the column decides where it shows)
  const rowIds = zones.filter((o) => o.seg === zone.seg).flatMap((o) => o.panels.map((p) => p.id)).filter((p) => p !== id)
  spot.value = { ref: rowIds[rowIds.length - 1] ?? id, where: 'after', column, line: at(z.top, z.left, z.right) }
}
function onDragLeave(e: DragEvent) {
  if (!pageEl.value?.contains(e.relatedTarget as Node | null)) spot.value = null
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  const id = draggingId.value
  if (id && spot.value) layout.place(id, spot.value.ref, spot.value.where, spot.value.column)
  endDrag()
}
const hidden = computed(() => layout.prefs.panels.filter((p) => !p.visible))

const stats = computed(() => deck.overview?.stats)
interface Tile {
  label: string
  value: number
  cls: string
  hint?: string
  /** Opens the PR page with this quick filter, or another page */
  focus?: PrFocus
  to?: string
  /** Releases page tab to open */
  tab?: 'releases'
}
const tiles = computed<Tile[]>(() => {
  const s = stats.value
  const next = openReleases.value.find((r) => shipNextIds.value.has(r.id))
  return [
    { label: 'Needs action', value: s?.action ?? 0, cls: 'text-primary', focus: 'action' },
    { label: 'Review requests', value: s?.reviewRequests ?? 0, cls: '', focus: 'review' },
    { label: 'Blocked', value: s?.blocked ?? 0, cls: 'text-warning', focus: 'blocked' },
    { label: 'My open PRs', value: s?.mine ?? 0, cls: '', focus: 'mine' },
    {
      label: 'Unresolved conversations',
      value: s?.myThreads ?? 0,
      cls: s?.myThreads ? 'text-warning' : '',
      hint: s?.myThreads ? `on ${s.myThreadPrs} of my PRs` : undefined,
      focus: 'threads',
    },
    { label: 'Slack to handle', value: s?.slackNew ?? 0, cls: '', to: '/slack' },
    {
      label: 'Open releases',
      value: openReleases.value.length,
      // Hotfixes missing from dev matter most; else what ships next
      cls: needsBackmerge.value.length ? 'text-warning' : '',
      hint: needsBackmerge.value.length ? `${needsBackmerge.value.length} hotfix(es) not in dev` : next ? `next: ${next.repo.split('/')[1]}#${next.number}` : undefined,
      to: '/releases',
      // Always the list of releases, whichever tab was used last
      tab: 'releases',
    },
  ]
})
const router = useRouter()
const prsView = layout.view('prs', {} as { focus?: PrFocus | ''; scope?: string; query?: string; repo?: string })
/** My Jira rows open the Jira panel; Cmd/Ctrl-click (the link's default) opens Jira */
function openJiraRow(e: MouseEvent, key: string) {
  if (wantsExternal(e)) return
  e.preventDefault()
  deck.selectedJiraKey = key
}

function openTile(t: Tile) {
  if (t.focus) {
    // Show exactly what the tile counts: clear the scope tab, search and repo filter
    Object.assign(prsView, { focus: t.focus, scope: 'all', query: '', repo: '' })
    router.push('/prs')
  } else if (t.to) {
    if (t.tab) releasesView.tab = t.tab
    router.push(t.to)
  }
}

function addPanel(type: PanelType) {
  const titles: Record<PanelType, string> = { prs: 'Custom PR list', slack: 'Slack', jira: 'Jira', chains: 'Chains', releases: 'Releases' }
  layout.addPanel(type, titles[type], type === 'prs' ? { mine: true } : {})
}
const stateOf = (id: string) => deck.byId.get(id)
const stepDone = (id: string) => stateOf(id)?.state === 'MERGED' && (stateOf(id)?.release?.released ?? true)
</script>

<template>
  <div ref="pageEl" class="space-y-4" :class="draggingId && 'pb-24'" @dragstart="onDragStart" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop" @dragend="endDrag">
    <div class="flex min-h-8 flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <template v-if="hidden.length">
        Hidden:
        <Button v-for="p in hidden" :key="p.id" variant="ghost" size="xs" @click="layout.update(p.id, { visible: true })">
          <PhEye /> {{ p.title }}
        </Button>
      </template>
      <span class="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm"><PhSlidersHorizontal /> Customize</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-64">
          <DropdownMenuLabel>Panels</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            v-for="p in layout.prefs.panels"
            :key="p.id"
            :model-value="p.visible"
            @select.prevent
            @update:model-value="layout.update(p.id, { visible: !!$event })"
          >
            {{ p.title }}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><PhPlus /> Add panel</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem @select="addPanel('prs')">PR list (filterable)</DropdownMenuItem>
              <DropdownMenuItem @select="addPanel('slack')">Slack inbox</DropdownMenuItem>
              <DropdownMenuItem @select="addPanel('jira')">Jira tasks</DropdownMenuItem>
              <DropdownMenuItem @select="addPanel('releases')">Releases</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuCheckboxItem v-model="layout.prefs.dense" @select.prevent>Compact rows</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="layout.reset()">Reset layout</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      <button
        v-for="t in tiles"
        :key="t.label"
        type="button"
        class="group rounded-xl text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        @click="openTile(t)"
      >
      <Card class="h-full gap-0 py-3 transition-colors group-hover:bg-accent">
        <CardContent class="px-4">
          <div class="truncate text-xs text-muted-foreground" :title="t.label">{{ t.label }}</div>
          <div class="flex items-baseline gap-2">
            <span class="text-2xl font-semibold tabular-nums" :class="t.cls">{{ t.value }}</span>
            <span v-if="t.hint" class="truncate text-xs text-muted-foreground">{{ t.hint }}</span>
          </div>
        </CardContent>
      </Card>
      </button>
    </div>

    <div ref="gridEl" class="relative grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div
        v-for="(z, zi) in layout.zones"
        :key="z.key"
        :data-zone="zi"
        :class="['flex min-w-0 flex-col gap-4', z.col === 'full' && 'lg:col-span-2', !z.panels.length && 'max-lg:hidden']"
      >
      <DashPanel
        v-for="p in z.panels"
        :key="p.id"
        :panel="p"
        :dragging="draggingId === p.id"
        :count="itemsFor(p)"
        :sort-options="p.type === 'prs' ? PR_SORTS : p.type === 'slack' ? TIME_SORTS : undefined"
      >
        <template v-if="p.type === 'prs'" #menu>
          <DropdownMenuSeparator />
          <DropdownMenuLabel class="text-xs text-muted-foreground">Filter</DropdownMenuLabel>
          <DropdownMenuCheckboxItem :model-value="!!p.filter.mine" @select.prevent @update:model-value="p.filter.mine = !!$event">Only mine</DropdownMenuCheckboxItem>
          <div class="space-y-1.5 px-2 pb-2">
            <Input class="h-7 text-xs" :model-value="p.filter.repo ?? ''" list="dash-repos" placeholder="Repo (any)" @change="p.filter.repo = ($event.target as HTMLInputElement).value || undefined" @keydown.stop />
            <datalist id="dash-repos"><option v-for="r in deck.repos" :key="r" :value="r" /></datalist>
            <Input class="h-7 text-xs" :model-value="p.filter.query ?? ''" placeholder="Text filter…" @change="p.filter.query = ($event.target as HTMLInputElement).value" @keydown.stop />
          </div>
        </template>

        <template #default>
          <!-- PR lists -->
          <template v-if="p.type === 'prs'">
            <PrRow v-for="pr in prsFor(p).slice(0, p.limit)" :key="pr.id" :pr="pr" :compact="layout.prefs.dense" />
            <div v-if="!prsFor(p).length" class="p-6 text-center text-sm text-muted-foreground">Nothing here 🎉</div>
            <Button v-else-if="prsFor(p).length > p.limit" variant="ghost" size="xs" class="w-full" as-child>
              <RouterLink to="/prs">{{ prsFor(p).length - p.limit }} more…</RouterLink>
            </Button>
          </template>

          <!-- Slack -->
          <template v-else-if="p.type === 'slack'">
            <div v-if="!deck.overview?.configured.slack" class="p-6 text-center text-sm text-muted-foreground">
              Slack isn't connected. <RouterLink to="/settings" class="text-primary hover:underline">Set it up</RouterLink>
            </div>
            <SlackList :items="slackFor(p).slice(0, p.limit)" class="-m-1.5" />
            <div v-if="deck.overview?.configured.slack && !slackNew.length" class="p-6 text-center text-sm text-muted-foreground">Inbox zero</div>
          </template>

          <!-- Jira -->
          <template v-else-if="p.type === 'jira'">
            <div v-if="!deck.overview?.configured.jira" class="p-6 text-center text-sm text-muted-foreground">
              Jira isn't connected. <RouterLink to="/settings" class="text-primary hover:underline">Set it up</RouterLink>
            </div>
            <a
              v-for="j in myJira.slice(0, p.limit)"
              :key="j.key"
              :href="j.url"
              target="_blank"
              rel="noopener"
              :title="`Open in Dispatch · ${modClickHint(j.url)}`"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent"
              @click="openJiraRow($event, j.key)"
            >
              <img v-if="j.typeIconUrl" :src="j.typeIconUrl" class="size-4" alt="" />
              <span class="font-mono text-xs">{{ j.key }}</span>
              <span class="flex-1 truncate">{{ j.summary }}</span>
              <PrListPopover v-if="j.prs.length" :ids="j.prs" :placeholder="`Go to a PR for ${j.key}…`" />
              <Badge :variant="jiraTone(j.statusCategory)">{{ j.status }}</Badge>
            </a>
          </template>

          <!-- Releases -->
          <template v-else-if="p.type === 'releases'">
            <div v-if="!openReleases.length && !needsBackmerge.length && !myUnreleased.length" class="p-6 text-center text-sm text-muted-foreground">
              No open releases or hotfixes waiting.
            </div>
            <section v-if="openReleases.length">
              <h4 class="px-3 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">Open releases</h4>
              <PrRow v-for="r in openReleases.slice(0, p.limit)" :key="r.id" :pr="r" compact :flags="flagsOf(r.id)">
                <template #badges>
                  <Badge v-if="shipNextIds.has(r.id)" variant="primary">Ship next</Badge>
                  <Badge variant="count" :title="`${deck.releaseById.get(r.id)?.items.length ?? 0} PR(s) in this release`">{{ deck.releaseById.get(r.id)?.items.length ?? 0 }}</Badge>
                </template>
              </PrRow>
            </section>
            <section v-if="needsBackmerge.length">
              <h4 class="flex items-center gap-1.5 px-3 pt-2 pb-0.5 text-xs font-medium text-warning"><PhWarning :size="13" weight="fill" />Hotfixes not back in dev</h4>
              <PrRow v-for="h in needsBackmerge.slice(0, p.limit)" :key="h.id" :pr="h" compact />
            </section>
            <button
              v-if="myUnreleased.length"
              class="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              @click="releaseNav.openReleases(myUnreleased[0].id)"
            >
              <PhRocketLaunch :size="15" class="text-muted-foreground" />
              <span class="flex-1">{{ myUnreleased.length }} of my merged PR(s) aren't in a release yet</span>
              <PhCaretRight :size="13" class="text-muted-foreground" />
            </button>
            <Button variant="ghost" size="xs" class="w-full" as-child><RouterLink to="/releases">Open Releases</RouterLink></Button>
          </template>

          <!-- Chains -->
          <template v-else-if="p.type === 'chains'">
            <div v-if="!openChains.length" class="p-4 text-sm text-muted-foreground">
              No cross-PR dependencies yet. Add one from a PR's detail panel, or write
              <code class="rounded bg-muted px-1 text-xs">Depends on: org/repo#12</code> in a PR description.
            </div>
            <!-- One block per chain, divided, each headed by a chain icon, its repos and progress -->
            <div class="divide-y">
              <div v-for="c in openChains.slice(0, p.limit)" :key="c.id" class="space-y-2 px-3 py-3 first:pt-2 last:pb-2">
                <div class="flex items-center gap-2 text-xs text-muted-foreground">
                  <PhLinkSimple :size="14" class="shrink-0 text-primary" />
                  <span class="min-w-0 truncate">{{ c.repos.join(' · ') }}</span>
                  <span class="flex-1" />
                  <span class="shrink-0 tabular-nums" :title="`${c.prs.filter(stepDone).length} of ${c.prs.length} steps merged (and released where needed)`">
                    {{ c.prs.filter(stepDone).length }} of {{ c.prs.length }} done
                  </span>
                </div>
                <ol class="flex flex-wrap items-center gap-1 text-xs">
                  <li v-for="(id, i) in c.prs" :key="id" class="flex max-w-full min-w-0 items-center gap-1">
                    <span v-if="i" class="text-muted-foreground">→</span>
                    <ChainStep :id="id" :next="id === c.nextStep" :step="i + 1" :of="c.prs.length" />
                  </li>
                </ol>
              </div>
            </div>
          </template>
        </template>
      </DashPanel>
      </div>
      <!-- Where the dragged panel will land -->
      <div
        v-if="spot"
        class="pointer-events-none absolute z-20 h-0.5 -translate-y-1/2 rounded-full bg-primary ring-2 ring-primary/25 before:absolute before:top-1/2 before:-left-1 before:size-2 before:-translate-y-1/2 before:rounded-full before:bg-primary"
        :style="{ top: `${spot.line.top}px`, left: `${spot.line.left}px`, width: `${spot.line.width}px` }"
      />
    </div>

  </div>
</template>
