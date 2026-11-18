<script setup lang="ts">
import RefreshButton from '@/components/RefreshButton.vue'
import JiraBulkStatus from '@/components/JiraBulkStatus.vue'
import StickyToolbar from '@/components/StickyToolbar.vue'
import { computed, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api'
import { onEscape } from '@/composables/escape'
import ActionBar from '@/components/ActionBar.vue'
import Kbd from '@/components/Kbd.vue'
import { PhCheck, PhListChecks, PhMinus, PhCircleHalf, PhKanban, PhMagnifyingGlass, PhNotePencil } from '@phosphor-icons/vue'
import type { LinkedPr, JiraIssueView, PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useLayout, type SortDir } from '@/stores/layout'
import { priorityRank, statusRank } from '@/utils/jiraOrder'
import CollapseAllButton from '@/components/CollapseAllButton.vue'
import FilterChips from '@/components/FilterChips.vue'
import GroupCard from '@/components/GroupCard.vue'
import ViewMenu, { type ViewSection } from '@/components/ViewMenu.vue'
import JiraRow from '@/components/JiraRow.vue'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const deck = useDeck()
const layout = useLayout()

/** One row per Jira key: from my JQL results and from keys found in PR titles, branches and descriptions. */
interface Item {
  key: string
  project: string
  issue: JiraIssueView | null
  prs: PrView[]
  /** PRs naming it that Dispatch doesn't sync (Overview linkedPrs): links to GitHub */
  links: LinkedPr[]
  mine: boolean
  done: boolean
  updated: string
}

type Scope = 'all' | 'mine' | 'linked' | 'unlinked'
const SCOPES: { value: Scope; label: string; match: (i: Item) => boolean }[] = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'mine', label: 'Mine', match: (i) => i.mine },
  { value: 'linked', label: 'With PRs', match: (i) => i.prs.length + i.links.length > 0 },
  { value: 'unlinked', label: 'No PRs', match: (i) => i.prs.length + i.links.length === 0 },
]
const CATEGORIES = [
  { value: 'new', label: 'To do' },
  { value: 'indeterminate', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

/** View options in the View menu, and their defaults (Reset view) */
const VIEW_DEFAULTS = {
  project: '',
  category: '',
  showDone: false,
  group: 'status' as 'none' | 'status' | 'project' | 'parent',
  sort: 'priority' as 'priority' | 'updated' | 'key',
  dir: 'desc' as SortDir,
}
const v = layout.view('jira', { query: '', scope: 'mine' as Scope, ...VIEW_DEFAULTS })
const viewSections = computed<ViewSection[]>(() => [
  { type: 'filter', key: 'project', label: 'Project', icon: PhKanban, allLabel: 'All projects', options: projects.value.map((p) => ({ value: p, label: p })), mono: true },
  ...(deck.overview?.configured.jira
    ? [{ type: 'filter', key: 'category', label: 'Status', icon: PhCircleHalf, allLabel: 'Any status', options: CATEGORIES } as ViewSection]
    : []),
  {
    type: 'radio',
    key: 'group',
    label: 'Group by',
    options: [
      { value: 'status', label: 'Status' },
      { value: 'project', label: 'Project' },
      { value: 'parent', label: 'Parent / epic' },
      { value: 'none', label: 'None' },
    ],
  },
  {
    type: 'radio',
    key: 'sort',
    label: 'Sort by',
    options: [
      { value: 'priority', label: 'Priority' },
      { value: 'updated', label: 'Updated' },
      { value: 'key', label: 'Key' },
    ],
  },
  { type: 'dir', key: 'dir' },
  { type: 'check', key: 'showDone', label: 'Show done' },
])
/** Active filters that aren't otherwise visible in the toolbar */
const chips = computed(() => [
  ...(v.project ? [{ key: 'project', label: v.project, clear: () => (v.project = '') }] : []),
  ...(v.category ? [{ key: 'category', label: CATEGORIES.find((c) => c.value === v.category)?.label ?? v.category, clear: () => (v.category = '') }] : []),
])
const collapsed = layout.view('jira-collapsed', {} as Record<string, boolean | undefined>)

const items = computed<Item[]>(() => {
  const keys = new Map<string, PrView[]>()
  // A moved issue's old key (PLAT-158 → GROW-1333) joins its new key's row
  const moved = deck.overview?.jiraMoved ?? {}
  for (const p of deck.prs) for (const k0 of p.jiraKeys) {
    const k = moved[k0] ?? k0
    if (!keys.get(k)?.includes(p)) keys.set(k, [...(keys.get(k) ?? []), p])
  }
  for (const j of deck.overview?.jira ?? []) if (!j.parentOnly && !keys.has(j.key)) keys.set(j.key, [])
  const linked = deck.overview?.linkedPrs ?? {}
  return [...keys].map(([key, synced]) => {
    const issue = deck.jiraByKey.get(key) ?? null
    // Found by GitHub search / Jira: synced ones join the PR rows, the rest are links
    const found = (linked[key] ?? []).filter((l) => !synced.some((p) => p.id === l.id))
    const prs = [...synced, ...found.flatMap((l) => deck.byId.get(l.id) ?? [])]
    const links = found.filter((l) => !deck.byId.has(l.id))
    const updated = [issue?.updated ?? '', ...prs.map((p) => p.updatedAt)].sort().at(-1)!
    return {
      key,
      project: key.split('-')[0],
      issue,
      prs,
      links,
      mine: !!issue?.isMine || prs.some((p) => p.isMine),
      done: issue ? issue.statusCategory === 'done' : prs.every((p) => p.state !== 'OPEN'),
      updated,
    }
  })
})
const projects = computed(() => [...new Set(items.value.map((i) => i.project))].sort())

/** Every filter except the scope tab, so each tab can show its count */
const base = computed(() => {
  const q = v.query.toLowerCase().trim()
  return items.value.filter(
    (i) =>
      (v.showDone || !i.done) &&
      (!v.project || i.project === v.project) &&
      (!v.category || i.issue?.statusCategory === v.category) &&
      (!q ||
        [i.key, i.issue?.summary, i.issue?.assignee?.displayName, i.issue?.status, ...i.prs.map((p) => `${p.id} ${p.title}`), ...i.links.map((l) => `${l.id} ${l.title}`)]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  )
})
const scopeCount = (s: (typeof SCOPES)[number]) => base.value.filter(s.match).length

const filtered = computed(() => {
  const scope = SCOPES.find((s) => s.value === v.scope) ?? SCOPES[0]
  const sign = v.dir === 'asc' ? 1 : -1
  // Priority: highest first (then most recently updated), so "descending" means most urgent first
  const cmp = (a: Item, b: Item) =>
    v.sort === 'key'
      ? a.key.localeCompare(b.key, undefined, { numeric: true })
      : v.sort === 'priority'
        ? priorityRank(b.issue?.priority) - priorityRank(a.issue?.priority) || a.updated.localeCompare(b.updated)
        : a.updated.localeCompare(b.updated)
  return base.value.filter(scope.match).sort((a, b) => cmp(a, b) * sign)
})

/** Refresh button: re-read the issues the list shows from Jira (all of them, 500 at a time) */
const refreshing = ref(false)
async function refreshShown(e: MouseEvent) {
  if (e.shiftKey) return void deck.sync()
  const keys = filtered.value.map((i) => i.key)
  if (!keys.length || refreshing.value) return
  refreshing.value = true
  try {
    let total = 0
    const missing: string[] = []
    for (let i = 0; i < keys.length; i += 500) {
      let r: Awaited<ReturnType<typeof api.jiraRefreshMany>> | undefined
      if (!(await deck.mutate(async () => void (r = await api.jiraRefreshMany(keys.slice(i, i + 500)))))) return
      total += r!.issues
      missing.push(...r!.missing)
    }
    if (missing.length) toast.warning(`Refreshed ${total} issues`, { description: `Not found in Jira: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}` })
    else toast.success('List refreshed', { description: `${total} issues` })
  } finally {
    refreshing.value = false
  }
}

/** Issues loaded from Jira (keys only seen in PRs have no workflow to move) */
const bulkKeys = (list: Item[]) => list.filter((i) => i.issue).map((i) => i.key)

// Selection for bulk actions (in memory): row checkboxes, Shift-click for a range, Select all per group
const canBulk = computed(() => !!deck.overview?.configured.jira)
const selected = reactive(new Set<string>())
/** Selected and still shown (filters can hide some), in list order */
const selectedKeys = computed(() => bulkKeys(groups.value.flatMap((g) => g.items)).filter((k) => selected.has(k)))
const hiddenSelected = computed(() => selected.size - selectedKeys.value.length)
let anchor: string | null = null
function toggleSelect(key: string, e: MouseEvent) {
  const order = bulkKeys(groups.value.flatMap((g) => g.items))
  const on = !selected.has(key)
  const a = anchor ? order.indexOf(anchor) : -1
  const b = order.indexOf(key)
  const range = e.shiftKey && a >= 0 && b >= 0 ? order.slice(Math.min(a, b), Math.max(a, b) + 1) : [key]
  for (const k of range) on ? selected.add(k) : selected.delete(k)
  anchor = key
}
const groupState = (items: Item[]) => {
  const keys = bulkKeys(items)
  const n = keys.filter((k) => selected.has(k)).length
  return n === 0 ? 'none' : n === keys.length ? 'all' : 'some'
}
function toggleGroup(items: Item[]) {
  const all = groupState(items) === 'all'
  for (const k of bulkKeys(items)) all ? selected.delete(k) : selected.add(k)
}
// Escape clears the selection (a side panel closes first)
onEscape(() => {
  if (deck.currentPanel || !selected.size) return false
  selected.clear()
  return true
})
const groups = computed(() => {
  if (v.group === 'none') return [{ key: 'all', label: 'Jira issues', items: filtered.value, category: '' }]
  const map = new Map<string, { label: string; rank: string; items: Item[]; category: string }>()
  for (const i of filtered.value) {
    const [key, label, rank] =
      v.group === 'project'
        ? [i.project, i.project, i.project]
        : v.group === 'parent'
          ? i.issue?.parent
            ? [i.issue.parent.key, `${i.issue.parent.key} · ${i.issue.parent.summary}`, `0${i.issue.parent.key}`]
            : ['~none', 'No parent', '1']
          : i.issue
            ? [i.issue.status, i.issue.status, `${statusRank(i.issue.status, i.issue.statusCategory).toFixed(1).padStart(4, '0')}${i.issue.status}`]
            : ['~unknown', 'Not loaded from Jira', '99']
    const g = map.get(key) ?? { label, rank, items: [], category: v.group === 'status' ? (i.issue?.statusCategory ?? '') : '' }
    g.items.push(i)
    map.set(key, g)
  }
  return [...map].sort(([, a], [, b]) => a.rank.localeCompare(b.rank, undefined, { numeric: true })).map(([key, g]) => ({ key, ...g }))
})

// Done groups start collapsed; Expand / Collapse all applies to the groups shown
const isCollapsed = (g: { key: string; category: string }) => collapsed[g.key] ?? g.category === 'done'
const allCollapsed = computed(() => groups.value.length > 0 && groups.value.every(isCollapsed))
const toggleAll = () => {
  const to = !allCollapsed.value
  for (const g of groups.value) collapsed[g.key] = to
}
const DOT: Record<string, string> = { new: 'bg-muted-foreground', indeterminate: 'bg-info', done: 'bg-success' }
</script>

<template>
  <!-- Width cap on the children, not the page, so the scrollbar sits at the far right -->
  <div class="flex flex-col gap-4 *:max-w-6xl">
    <Alert v-if="deck.overview && !deck.overview.configured.jira">
      <PhKanban />
      <AlertTitle>Jira isn't connected yet</AlertTitle>
      <AlertDescription>Keys found in your PRs are listed below. Connect Jira for status, assignee, your own tasks and transitions.</AlertDescription>
      <AlertAction>
        <Button size="sm" as-child><RouterLink to="/settings">Connect Jira</RouterLink></Button>
      </AlertAction>
    </Alert>

    <StickyToolbar content-class="max-w-6xl">
      <!-- @container: buttons go icon-only when this row is narrow -->
      <div class="@container flex flex-wrap items-center gap-2">
        <div class="relative min-w-24 flex-1 sm:max-w-64">
          <PhMagnifyingGlass class="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" :size="14" />
          <Input v-model="v.query" type="search" placeholder="Search key, summary, assignee, PR…" class="h-8 pl-8" />
        </div>
        <Tabs v-model="v.scope">
          <TabsList>
            <TabsTrigger v-for="s in SCOPES" :key="s.value" :value="s.value" :count="scopeCount(s)">{{ s.label }}</TabsTrigger>
          </TabsList>
        </Tabs>
        <FilterChips :chips="chips" />
        <span class="flex-1" />
        <!-- Re-read the issues shown from Jira; Shift-click: full sync -->
        <RefreshButton
          v-if="deck.overview?.configured.jira"
          :label="`Refresh the ${filtered.length} issues shown`"
          full-sync
          :busy="refreshing || deck.syncRunning"
          :disabled="!filtered.length"
          :refreshed-at="filtered.map((i) => i.issue?.fetchedAt)"
          @click="refreshShown"
        />
        <CollapseAllButton v-if="groups.length > 1" :collapsed="allCollapsed" @toggle="toggleAll" />
        <ViewMenu :state="v" :sections="viewSections" :defaults="VIEW_DEFAULTS" />
        <Button v-if="deck.overview?.configured.jira" size="sm" @click="deck.composer = { mode: 'create' }"><PhNotePencil /> <span class="@max-3xl:sr-only">New issue</span></Button>
      </div>
    </StickyToolbar>

    <!-- The page scrolls (native scrollbar at the window edge, like Settings) -->
    <div class="space-y-4">
        <GroupCard
          v-for="g in groups"
          :key="g.key"
          :collapsed="isCollapsed(g)"
          :label="g.label"
          :count="g.items.length"
          @update:collapsed="(c: boolean) => (collapsed[g.key] = c)"
        >
          <template v-if="canBulk && bulkKeys(g.items).length" #actions>
            <!-- Select the group: checked all, a dash for some -->
            <Checkbox
              :model-value="groupState(g.items) === 'all' ? true : groupState(g.items) === 'some' ? 'indeterminate' : false"
              :aria-label="`Select every issue in ${g.label}`"
              :title="groupState(g.items) === 'all' ? 'Deselect all' : 'Select all'"
              class="mr-1 data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground"
              @click.stop="toggleGroup(g.items)"
            >
              <template #default="{ state }"><PhMinus v-if="state === 'indeterminate'" /><PhCheck v-else /></template>
            </Checkbox>
          </template>
          <template v-if="g.category" #label>
            <span class="flex items-center gap-2"><span class="size-2 shrink-0 rounded-full" :class="DOT[g.category] ?? 'bg-muted-foreground'" />{{ g.label }}</span>
          </template>
          <div>
            <JiraRow
              v-for="i in g.items"
              :key="i.key"
              :issue-key="i.key"
              :issue="i.issue"
              :prs="i.prs"
              :links="i.links"
              :dense="layout.prefs.dense"
              :selected="canBulk && i.issue ? selected.has(i.key) : undefined"
              :selecting="selected.size > 0"
              @toggle-select="toggleSelect(i.key, $event)"
            />
          </div>
        </GroupCard>
        <div v-if="!filtered.length" class="py-16 text-center text-muted-foreground">No Jira issues match.</div>
    </div>

    <!-- Bulk actions: only while issues are selected -->
    <ActionBar v-if="selectedKeys.length">
      <Checkbox :model-value="true" aria-label="Deselect all" title="Deselect all" @click="selected.clear()" />
      <span class="text-foreground">{{ selectedKeys.length }} selected</span>
      <span v-if="hiddenSelected" class="text-xs">({{ hiddenSelected }} more hidden by filters, left out)</span>
      <template #actions>
        <Button variant="ghost" size="sm" @click="selected.clear()">Clear <Kbd>Esc</Kbd></Button>
        <JiraBulkStatus :keys="selectedKeys" context="The issues you selected." @finished="selected.clear()">
          <template #trigger>
            <Button size="sm"><PhListChecks /> Change status…</Button>
          </template>
        </JiraBulkStatus>
      </template>
    </ActionBar>
  </div>
</template>
