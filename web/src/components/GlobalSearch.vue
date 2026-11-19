<script setup lang="ts">
import { ScrollArea } from '@/components/ui/scroll-area'
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import {
  PhArrowsClockwise,
  PhCircleNotch,
  PhNotePencil,
  PhDesktop,
  PhGauge,
  PhGear,
  PhGitPullRequest,
  PhGraph,
  PhKanban,
  PhMagnifyingGlass,
  PhMoon,
  PhSlackLogo,
  PhRocketLaunch,
  PhSun,
  PhTimer,
} from '@phosphor-icons/vue'
import { api } from '@/api'
import type { JiraIssue } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { useTheme } from '@/composables/theme'
import { LAYER_OPEN } from '@/composables/escape'
import { jiraTone, timeAgo, actionTone } from '@/utils/format'
import { cn } from '@/lib/utils'
import { useListNav } from '@/composables/listNav'
import RepoName from './RepoName.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

/**
 * Search everything from the top bar: PRs, Jira issues, Slack messages, pages and actions, grouped.
 * Opens with "/" (outside text fields) or Cmd/Ctrl+K. Every typed word must match.
 */
const deck = useDeck()
const router = useRouter()
const theme = useTheme()
const open = ref(false)
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')
  const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
  if (cmdK || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !document.querySelector(LAYER_OPEN))) {
    // Cmd/Ctrl+K in the Markdown editor is "insert link"; leave it there
    if (cmdK && typing) return
    e.preventDefault()
    open.value = true
  }
})
watch(open, async (o) => {
  if (!o) return
  query.value = ''
  active.value = 0
  live.value = new Map()
  // Pick up what the server stored since the last poll (issues created here or through the MCP)
  if (!deck.syncRunning) deck.load()
  await nextTick()
  input.value?.focus()
})

interface Result {
  key: string
  icon?: Component
  /** Main text and an optional secondary line */
  label: string
  detail?: string
  /** PR id for RepoName, or a badge */
  prId?: string
  badge?: { text: string; variant: string }
  run: () => void
}
interface Group {
  label: string
  results: Result[]
  /** Best match in the group; searched groups are ordered by it (an exact Jira key puts Jira first) */
  best?: number
}

const LIMIT = 6
const terms = computed(() => query.value.toLowerCase().split(/\s+/).filter(Boolean))
/** 0 = no match; higher = better. Every term must appear in the haystack; exact key/number hits rank first. */
function score(haystack: string, exact: string[] = []): number {
  if (!terms.value.length) return 1
  const h = haystack.toLowerCase()
  if (!terms.value.every((t) => h.includes(t))) return 0
  const q = query.value.toLowerCase().trim().replace(/^#/, '')
  return exact.some((x) => x.toLowerCase() === q) ? 3 : exact.some((x) => x.toLowerCase().startsWith(q)) ? 2 : 1
}
function top<T>(items: T[], scoreOf: (t: T) => number): { items: T[]; best: number } {
  const hits = items
    .map((t) => [t, scoreOf(t)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIMIT)
  return { items: hits.map(([t]) => t), best: hits[0]?.[1] ?? 0 }
}

/** Jira: synced issues plus keys only seen on PRs */
const localJira = computed(() => {
  const keys = new Map<string, JiraIssue | null>((deck.overview?.jira ?? []).map((j) => [j.key, j] as const))
  for (const p of deck.prs) for (const k of p.jiraKeys) if (!keys.has(k)) keys.set(k, null)
  return keys
})
/**
 * Issues Jira returned for this palette session's queries but the sync hasn't stored (created since,
 * or not mine). They join the candidates and go through the same matching, so an answer for an older
 * query still shows while it matches, and nothing flickers between keystrokes.
 */
const live = ref(new Map<string, JiraIssue>())
const jiraHits = computed(() => {
  const all = new Map(localJira.value)
  for (const [k, j] of live.value) if (!all.get(k)) all.set(k, j)
  return top([...all], ([k, j]) => score(`${k} ${j?.summary ?? ''} ${j?.assignee?.displayName ?? ''} ${j?.status ?? ''}`, [k]))
})

/**
 * Ask Jira when the synced issues don't fill the group: 3+ characters (or a key), 350 ms after typing
 * stops, the previous request aborted. The server caches each query for a minute.
 */
const liveBusy = ref(false)
let liveTimer = 0
let liveCtrl: AbortController | null = null
watch(
  () => query.value.trim(),
  (q) => {
    clearTimeout(liveTimer)
    liveCtrl?.abort()
    liveBusy.value = false
    const isKey = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(q)
    if (!open.value || !deck.overview?.configured.jira || (q.length < 3 && !isKey)) return
    if (jiraHits.value.items.length >= LIMIT && !(isKey && !jiraHits.value.items.some(([k]) => k === q.toUpperCase()))) return
    liveBusy.value = true
    liveTimer = window.setTimeout(async () => {
      const ctrl = (liveCtrl = new AbortController())
      try {
        const { issues } = await api.jiraSearch(q, ctrl.signal)
        const next = new Map(live.value)
        for (const i of issues) next.set(i.key, i)
        live.value = next
      } catch {
        // aborted by the next keystroke, or Jira failed: the synced results stand
      } finally {
        if (liveCtrl === ctrl) liveBusy.value = false
      }
    }, 350)
  },
)

const PAGES = [
  { to: '/', label: 'Overview', icon: PhGauge },
  { to: '/prs', label: 'Pull requests', icon: PhGitPullRequest },
  { to: '/slack', label: 'Slack inbox', icon: PhSlackLogo },
  { to: '/graph', label: 'Dependencies', icon: PhGraph },
  { to: '/releases', label: 'Releases and hotfixes', icon: PhRocketLaunch },
  { to: '/jira', label: 'Jira tasks', icon: PhKanban },
  { to: '/settings', label: 'Settings', icon: PhGear },
]

const groups = computed<Group[]>(() => {
  const out: Group[] = []
  const searching = terms.value.length > 0

  if (searching) {
    // (searched groups are sorted by their best match below)
    const prs = top(deck.prs, (p) =>
      score(`${p.id} ${p.repo}#${p.number} ${p.title} ${p.headRef} ${p.author.login} ${p.jiraKeys.join(' ')}`, [`${p.number}`, p.id, `${p.repo}#${p.number}`]),
    )
    out.push({
      label: 'Pull requests',
      best: prs.best,
      results: prs.items.map((p) => ({
        key: `pr:${p.id}`,
        label: p.title,
        prId: p.id,
        badge: { text: p.action.label, variant: actionTone(p) },
        run: () => (deck.selectedId = p.id),
      })),
    })

    const issues = jiraHits.value
    out.push({
      label: 'Jira issues',
      best: issues.best,
      results: issues.items.map(([k, j]) => ({
        key: `jira:${k}`,
        icon: PhKanban,
        label: `${k}  ${j?.summary ?? ''}`.trim(),
        detail: localJira.value.get(k) ? undefined : live.value.has(k) ? 'Found in Jira, not synced yet' : undefined,
        badge: j ? { text: j.status, variant: jiraTone(j.statusCategory) } : undefined,
        run: () => {
          deck.selectedJiraKey = k
          // Store it, so the panel has its fields and it stays searchable
          if (live.value.has(k) && !localJira.value.get(k)) deck.mutate(() => api.jiraRefresh(k))
        },
      })),
    })

    const slack = top(deck.overview?.slack ?? [], (i) => score(`${i.text} ${i.userName} ${i.channelName}`))
    out.push({
      label: 'Slack messages',
      best: slack.best,
      results: slack.items.map((i) => ({
        key: `slack:${i.id}`,
        icon: PhSlackLogo,
        label: i.text.replace(/\s+/g, ' ').slice(0, 120),
        detail: `${i.userName} · ${i.channelName} · ${timeAgo(i.postedAt)}`,
        run: () => {
          if (router.currentRoute.value.path !== '/slack') router.push('/slack')
          deck.selectedSlackId = i.id
        },
      })),
    })
  }

  out.sort((a, b) => (b.best ?? 0) - (a.best ?? 0))
  out.push({
    label: 'Pages',
    results: PAGES.filter((p) => score(p.label) > 0).map((p) => ({ key: `page:${p.to}`, icon: p.icon, label: p.label, run: () => router.push(p.to) })),
  })
  const auto = deck.overview?.autoSync
  const actions: Result[] = [
    { key: 'act:sync', icon: PhArrowsClockwise, label: 'Sync now', run: () => deck.sync() },
    ...(deck.overview?.configured.jira
      ? [{ key: 'act:jira-new', icon: PhNotePencil, label: 'New Jira issue', run: () => (deck.composer = { mode: 'create' }) }]
      : []),
    ...(auto
      ? [
          {
            key: 'act:auto',
            icon: PhTimer,
            label: auto.enabled ? 'Turn auto-sync off' : 'Turn auto-sync on',
            run: () => deck.mutate(() => api.setAutoSync(!auto.enabled), auto.enabled ? 'Auto-sync off' : 'Auto-sync on'),
          },
        ]
      : []),
    { key: 'act:light', icon: PhSun, label: 'Theme: light', run: () => (theme.value = 'light') },
    { key: 'act:dark', icon: PhMoon, label: 'Theme: dark', run: () => (theme.value = 'dark') },
    { key: 'act:system', icon: PhDesktop, label: 'Theme: system', run: () => (theme.value = 'auto') },
  ]
  out.push({ label: 'Actions', results: actions.filter((a) => score(a.label) > 0) })
  return out.filter((g) => g.results.length)
})

const flat = computed(() => groups.value.flatMap((g) => g.results))
watch(query, () => (active.value = 0))
// Rows arriving from Jira keep the highlighted row where it is (a new query starts at the top)
let flatQuery = ''
watch(flat, (now, before) => {
  if (query.value !== flatQuery) return void (flatQuery = query.value)
  const k = before?.[active.value]?.key
  const i = k ? now.findIndex((r) => r.key === k) : -1
  if (i >= 0) active.value = i
})

function pick(r: Result) {
  open.value = false
  r.run()
}
const nav = useListNav({ items: () => flat.value, active, container: () => list.value })
function onKey(e: KeyboardEvent) {
  if (nav.onArrow(e)) return
  if (e.key === 'Enter') {
    e.preventDefault()
    const r = flat.value[active.value]
    if (r) pick(r)
  }
}
const indexOf = (r: Result) => flat.value.indexOf(r)
</script>

<template>
  <Button variant="outline" size="sm" class="w-72 justify-start gap-2 text-muted-foreground max-lg:w-48 max-md:w-auto" @click="open = true">
    <PhMagnifyingGlass /> <span class="max-md:hidden">Search…</span>
    <kbd class="ml-auto rounded border px-1.5 font-mono text-[10px] max-md:hidden">/</kbd>
  </Button>

  <Dialog v-model:open="open">
    <DialogContent class="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl" :show-close-button="false">
      <DialogTitle class="sr-only">Search</DialogTitle>
      <DialogDescription class="sr-only">Search pull requests, Jira issues, Slack messages, pages and actions</DialogDescription>
      <div class="flex items-center gap-2 border-b px-4">
        <PhMagnifyingGlass class="text-muted-foreground" />
        <input
          ref="input"
          v-model="query"
          type="text"
          placeholder="Search PRs, Jira issues, Slack messages, pages…"
          class="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          aria-label="Search"
          @keydown="onKey"
        />
        <kbd class="rounded border px-1.5 font-mono text-[10px] text-muted-foreground">esc</kbd>
      </div>
      <ScrollArea class="[&>[data-slot=scroll-area-viewport]]:max-h-[60vh]">
      <div ref="list" class="p-2" role="listbox">
        <section v-for="g in groups" :key="g.label" class="mb-1">
          <h3 class="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{{ g.label }}</h3>
          <button
            v-for="r in g.results"
            :key="r.key"
            type="button"
            role="option"
            :aria-selected="indexOf(r) === active"
            :data-active="indexOf(r) === active || undefined"
            :class="cn('flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm', indexOf(r) === active && 'bg-accent')"
            @mousemove="active = indexOf(r)"
            @click="pick(r)"
          >
            <component :is="r.icon" v-if="r.icon" class="size-4 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <RepoName v-if="r.prId" :id="r.prId" class="max-w-[45%] font-mono text-xs" />
                <span class="truncate">{{ r.label }}</span>
              </div>
              <div v-if="r.detail" class="truncate text-xs text-muted-foreground">{{ r.detail }}</div>
            </div>
            <Badge v-if="r.badge" :variant="r.badge.variant as never" class="shrink-0">{{ r.badge.text }}</Badge>
          </button>
        </section>
        <p v-if="liveBusy" class="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <PhCircleNotch class="animate-spin" /> Searching Jira…
        </p>
        <p v-else-if="!flat.length" class="py-10 text-center text-sm text-muted-foreground">No results for “{{ query }}”</p>
      </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
</template>
