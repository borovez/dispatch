import { defineStore } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import type { JiraFieldValue, Overview, PrView, SyncState } from '@shared/types'
import { useLayout } from './layout'

/** An item shown in the side panel */
export interface PanelRef {
  kind: 'pr' | 'slack' | 'jira'
  id: string
}

/** What the Jira composer opens on */
export type ComposerTarget =
  | {
      mode: 'create'
      projectKey?: string
      summary?: string
      description?: string
      values?: Record<string, JiraFieldValue>
      /** Context for Claude: a PR, a Slack message (also marked done on create) */
      prId?: string
      slackItemId?: string
    }
  | { mode: 'edit'; key: string }
import { toast } from 'vue-sonner'
import { api } from '@/api'
import { clearTransitions } from '@/composables/jiraTransitions'

export const useDeck = defineStore('deck', () => {
  const overview = ref<Overview | null>(null)
  const loading = ref(false)
  const syncing = ref(false)
  const error = ref<string | null>(null)
  const selectedId = ref<string | null>(null)
  /** Slack item shown in the side panel; only one side panel is open at a time */
  const selectedSlackId = ref<string | null>(null)
  /** Jira issue shown in the side panel */
  const selectedJiraKey = ref<string | null>(null)
  // One side panel at a time: opening one closes the others
  const panels = [selectedId, selectedSlackId, selectedJiraKey]
  for (const p of panels) watch(p, (v) => v && panels.forEach((o) => o !== p && (o.value = null)))

  // ---- Side panel history: back / forward through the PRs, Jira issues and Slack messages opened
  // this session (in memory: kept when the panel closes, gone when the app closes; 50 each way).
  const panelKinds = ['pr', 'slack', 'jira'] as const
  const currentPanel = computed<PanelRef | null>(() => {
    const i = panels.findIndex((p) => p.value)
    return i < 0 ? null : { kind: panelKinds[i], id: panels[i].value! }
  })
  const panelBack = ref<PanelRef[]>([])
  const panelForward = ref<PanelRef[]>([])
  /** Set while a change shouldn't add a history entry (back/forward themselves, arrow keys) */
  let historyMode: 'push' | 'replace' | 'travel' = 'push'
  const showPanel = (r: PanelRef) => (panels[panelKinds.indexOf(r.kind)].value = r.id)
  const same = (a: PanelRef | null, b: PanelRef | null) => !!a && !!b && a.kind === b.kind && a.id === b.id
  // ---- Recently opened items (newest first, saved with the view prefs), for reopening one while the
  // panel is closed (PanelTab, Alt+→)
  const recentState = useLayout().view('recent-panels', { items: [] as PanelRef[] })
  const recentPanels = computed(() => recentState.items)
  /** The item shown when the panel closed: the next item opened goes back to it */
  let lastShown: PanelRef | null = null
  watch(currentPanel, (now) => {
    if (now) recentState.items = [now, ...recentState.items.filter((r) => !same(r, now))].slice(0, 15)
  })
  /** Reopen an item from the recent list (the history carries on: Back still works) */
  function reopenPanel(r: PanelRef | undefined = recentState.items[0]) {
    if (!r || currentPanel.value) return
    showPanel(r)
  }

  watch(currentPanel, (now, before) => {
    const mode = historyMode
    historyMode = 'push'
    // Closing keeps the history; the item shown becomes Back for whatever opens next
    if (!now) {
      if (before) lastShown = before
      return
    }
    const prev = before ?? lastShown
    lastShown = null
    if (mode !== 'push' || !prev || same(now, prev)) return
    panelBack.value = [...panelBack.value, prev].slice(-50)
    panelForward.value = []
  })
  function panelGo(dir: -1 | 1) {
    const from = dir < 0 ? panelBack : panelForward
    const to = dir < 0 ? panelForward : panelBack
    const target = from.value.at(-1)
    const now = currentPanel.value
    if (!target || !now) return
    from.value = from.value.slice(0, -1)
    to.value = [...to.value, now].slice(-50)
    historyMode = 'travel'
    showPanel(target)
    void nextTick(() => (historyMode = 'push'))
  }
  /** Open something in the panel without a history entry (moving through a list) */
  function replacePanel(fn: () => void) {
    historyMode = 'replace'
    fn()
    // Nothing changed (same item): don't let the flag leak into the next change
    void nextTick(() => (historyMode = 'push'))
  }
  /** Jira issue composer: a new issue (optionally pre-filled) or an existing one to edit */
  const composer = ref<ComposerTarget | null>(null)
  /** PR whose title and description are open in the PR writer */
  const prWriter = ref<string | null>(null)
  /** Jira issue whose AI-agent prompt is open */
  const agentPromptKey = ref<string | null>(null)
  /** The setup prompt dialog (a brief for an AI agent to walk through connecting everything) */
  const setupPromptOpen = ref(false)

  const prs = computed(() => overview.value?.prs ?? [])
  const byId = computed(() => new Map(prs.value.map((p) => [p.id, p])))
  /** What each release PR ships, by release PR id */
  const releaseById = computed(() => new Map((overview.value?.releases ?? []).map((r) => [r.prId, r])))
  const selectedSlack = computed(() => (overview.value?.slack ?? []).find((i) => i.id === selectedSlackId.value) ?? null)
  const selected = computed<PrView | null>(() => (selectedId.value ? byId.value.get(selectedId.value) ?? null : null))
  /** Issues by key; an old key of a moved issue (overview.jiraMoved) finds the issue under its new key */
  const jiraByKey = computed(() => {
    const m = new Map((overview.value?.jira ?? []).map((j) => [j.key, j]))
    for (const [old, now] of Object.entries(overview.value?.jiraMoved ?? {})) if (!m.has(old) && m.has(now)) m.set(old, m.get(now)!)
    return m
  })
  /** LaunchDarkly flags by key */
  const flagByKey = computed(() => new Map((overview.value?.flags ?? []).map((f) => [f.key, f])))
  const repos = computed(() => [...new Set(prs.value.map((p) => p.repo))].sort())

  async function load() {
    loading.value = true
    try {
      overview.value = await api.overview()
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  /** Live sync progress (steps), polled while a sync runs: mine, the background one or the MCP's */
  const syncStatus = ref<SyncState | null>(null)
  const syncRunning = computed(() => syncing.value || !!syncStatus.value?.running)
  let statusTimer: number | undefined
  function watchSync() {
    if (statusTimer) return
    const tick = async () => {
      try {
        syncStatus.value = await api.syncStatus()
      } catch {
        /* keep the last state */
      }
      if (syncing.value || syncStatus.value?.running) statusTimer = window.setTimeout(tick, 700)
      else {
        statusTimer = undefined
        load() // a background sync finished: show its results
      }
    }
    statusTimer = window.setTimeout(tick, 300)
  }
  // A sync someone else started (auto-sync, MCP) shows up in the overview: follow it
  watch(
    () => overview.value?.sync,
    (s) => {
      if (!s) return
      if (!syncStatus.value?.running) syncStatus.value = s
      if (s.running && !syncing.value) watchSync()
    },
  )

  async function sync() {
    if (syncRunning.value) return
    syncing.value = true
    watchSync()
    try {
      overview.value = await api.sync()
      syncStatus.value = overview.value.sync
      clearTransitions() // workflows may have changed; refetch on next open
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      syncing.value = false
    }
  }

  /**
   * Run a write, then reload (mutations change derived state: blocked, actions, chains).
   * Errors become a toast; `success` (if given) too. Resolves to whether the write worked.
   */
  async function mutate(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
    try {
      await fn()
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
    if (success) toast.success(success)
    await load()
    return true
  }

  let timer: number | undefined
  function startPolling() {
    clearInterval(timer)
    timer = window.setInterval(() => !syncRunning.value && load(), 60_000)
  }

  return { overview, loading, syncing, syncStatus, syncRunning, error, selectedId, selectedSlackId, selectedSlack, selectedJiraKey, panelBack, panelForward, panelGo, replacePanel, currentPanel, recentPanels, reopenPanel, composer, prWriter, agentPromptKey, setupPromptOpen, prs, byId,
    releaseById, selected, jiraByKey, flagByKey, repos, load, sync, mutate, startPolling }
})
