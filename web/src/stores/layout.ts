import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { ActionKind, Bucket, PrView } from '@shared/types'

export type PanelType = 'prs' | 'chains' | 'slack' | 'jira' | 'releases'
export type PrSort = 'urgency' | 'updated' | 'created' | 'repo' | 'size'
export type SortDir = 'asc' | 'desc'

export interface PrFilter {
  buckets?: Bucket[]
  actions?: ActionKind[]
  mine?: boolean
  repo?: string
  query?: string
}

/** One drop zone of the Overview grid (see `zones`) */
export interface DashZone {
  key: string
  /** Row it belongs to; a full-width panel is a row of its own */
  seg: number
  col: 'left' | 'right' | 'full'
  panels: PanelConfig[]
}

export interface PanelConfig {
  id: string
  type: PanelType
  title: string
  visible: boolean
  collapsed: boolean
  pinned: boolean
  width: 'half' | 'full'
  /** Half-width panels: which Overview column. Unset: they alternate left/right as they come */
  column?: 'left' | 'right'
  sort: PrSort | 'newest' | 'oldest'
  dir: SortDir
  limit: number
  filter: PrFilter
  /** Built-in panels can be hidden but not deleted */
  builtin: boolean
}

export interface UiPrefs {
  version: 1
  panels: PanelConfig[]
  /** Per-page view state: list sort/grouping, drawer width etc. */
  views: Record<string, Record<string, unknown>>
  /** Side drawer width in px */
  drawerWidth: number
  /** Side panel stays open when clicking outside it */
  panelPinned?: boolean
  /** Compact rows */
  dense: boolean
}

const panel = (p: Partial<PanelConfig> & Pick<PanelConfig, 'id' | 'type' | 'title'>): PanelConfig => ({
  visible: true,
  collapsed: false,
  pinned: false,
  width: 'half',
  sort: 'urgency',
  dir: 'desc',
  limit: 12,
  filter: {},
  builtin: true,
  ...p,
})

export const DEFAULT_PANELS: PanelConfig[] = [
  panel({ id: 'action', type: 'prs', title: 'Needs my action', filter: { buckets: ['action'] }, pinned: true, width: 'full' }),
  panel({ id: 'slack', type: 'slack', title: 'Slack inbox', sort: 'newest' }),
  panel({ id: 'chains', type: 'chains', title: 'Dependency chains' }),
  panel({ id: 'releases', type: 'releases', title: 'Releases' }),
  panel({ id: 'blocked', type: 'prs', title: 'Blocked by dependencies', filter: { buckets: ['blocked'] } }),
  panel({ id: 'waiting', type: 'prs', title: 'Waiting on others', filter: { buckets: ['waiting'] }, sort: 'updated' }),
  panel({ id: 'jira', type: 'jira', title: 'My Jira tasks', sort: 'updated' }),
  panel({ id: 'watching', type: 'prs', title: 'Team PRs', filter: { buckets: ['watching'] }, sort: 'updated', collapsed: true }),
]

const DEFAULT_PREFS: UiPrefs = { version: 1, panels: DEFAULT_PANELS, views: {}, drawerWidth: 560, dense: false }

const URGENCY: ActionKind[] = [
  'review',
  'fix_ci',
  'address_feedback',
  'resolve_conflicts',
  'merge',
  'release',
  'finish_draft',
  'wait_deps',
  'awaiting_release',
  'wait_review',
  'none',
  'done',
]

export function sortPrs(prs: PrView[], sort: string, dir: SortDir): PrView[] {
  const sign = dir === 'asc' ? 1 : -1
  const key = (p: PrView): number | string => {
    switch (sort) {
      case 'updated':
        return p.updatedAt
      case 'created':
        return p.createdAt
      case 'repo':
        return `${p.repo}#${String(p.number).padStart(6, '0')}`
      case 'size':
        return p.additions + p.deletions
      default:
        // urgency: lower index = more urgent, so invert for "desc"
        return -URGENCY.indexOf(p.action.kind)
    }
  }
  return [...prs].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const ka = key(a)
    const kb = key(b)
    const c = ka < kb ? -1 : ka > kb ? 1 : 0
    return c * sign || b.updatedAt.localeCompare(a.updatedAt)
  })
}

export function filterPrs(prs: PrView[], f: PrFilter): PrView[] {
  const q = f.query?.toLowerCase().trim()
  return prs.filter(
    (p) =>
      (!f.buckets?.length || f.buckets.includes(p.bucket)) &&
      (!f.actions?.length || f.actions.includes(p.action.kind)) &&
      (!f.mine || p.isMine) &&
      (!f.repo || p.repo === f.repo) &&
      (!q || `${p.id} ${p.title} ${p.headRef} ${p.author.login} ${p.jiraKeys.join(' ')}`.toLowerCase().includes(q)),
  )
}

export const useLayout = defineStore('layout', () => {
  const prefs = ref<UiPrefs>(structuredClone(DEFAULT_PREFS))
  const loaded = ref(false)

  async function load() {
    try {
      const res = await fetch('/api/prefs')
      const saved = (await res.json()) as Partial<UiPrefs>
      if (saved?.version === 1) {
        // Merge so new built-in panels show up after upgrades
        const ids = new Set(saved.panels?.map((p) => p.id))
        prefs.value = {
          ...DEFAULT_PREFS,
          ...saved,
          panels: [...(saved.panels ?? []), ...DEFAULT_PANELS.filter((p) => !ids.has(p.id))],
        }
      }
    } catch {
      /* offline – keep defaults */
    }
    loaded.value = true
  }

  let saveTimer: number | undefined
  watch(
    prefs,
    (v) => {
      if (!loaded.value) return
      clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => {
        fetch('/api/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
      }, 400)
    },
    { deep: true },
  )

  /** Pinned first, then user order. */
  const orderedPanels = computed(() => {
    const ps = prefs.value.panels
    return [...ps.filter((p) => p.pinned), ...ps.filter((p) => !p.pinned)]
  })

  const update = (id: string, patch: Partial<PanelConfig>) => {
    const p = prefs.value.panels.find((x) => x.id === id)
    if (p) Object.assign(p, patch)
  }

  /**
   * The Overview as zones: a full-width panel is a zone of its own; a run of half-width panels between
   * them is a row of two column zones (left, right), each a stack of panels.
   */
  const zones = computed(() => {
    const out: DashZone[] = []
    let row: { left: DashZone; right: DashZone; n: number } | null = null
    let seg = 0
    for (const p of orderedPanels.value) {
      if (!p.visible) continue
      if (p.width === 'full') {
        row = null
        out.push({ key: p.id, seg: seg++, col: 'full', panels: [p] })
        continue
      }
      if (!row) {
        row = { left: { key: `${p.id}-l`, seg, col: 'left', panels: [] }, right: { key: `${p.id}-r`, seg, col: 'right', panels: [] }, n: 0 }
        seg++
        out.push(row.left, row.right)
      }
      row[p.column ?? (row.n % 2 ? 'right' : 'left')].panels.push(p)
      row.n++
    }
    return out
  })

  /**
   * Moves a panel next to another one (`where` it), into `column` when it's half width. It takes the
   * pinned state of the panel it lands next to. Columns worked out so far are saved first so the
   * other panels stay where they are.
   */
  function place(fromId: string, refId: string, where: 'before' | 'after', column?: 'left' | 'right') {
    if (fromId === refId) {
      if (column) update(fromId, { column })
      return
    }
    for (const z of zones.value) if (z.col !== 'full') for (const p of z.panels) p.column ??= z.col
    const ps = [...orderedPanels.value]
    const from = ps.findIndex((p) => p.id === fromId)
    if (from < 0) return
    const [p] = ps.splice(from, 1)
    const to = ps.findIndex((x) => x.id === refId)
    if (to < 0) return
    p.pinned = ps[to].pinned
    ps.splice(where === 'before' ? to : to + 1, 0, p)
    if (column && p.width === 'half') p.column = column
    prefs.value.panels = ps
  }

  function addPanel(type: PanelType, title: string, filter: PrFilter = {}) {
    const id = `custom-${Date.now().toString(36)}`
    prefs.value.panels.push(panel({ id, type, title, filter, builtin: false, sort: type === 'slack' ? 'newest' : 'urgency' }))
    return id
  }

  const removePanel = (id: string) => (prefs.value.panels = prefs.value.panels.filter((p) => p.id !== id))
  const reset = () => (prefs.value = { ...prefs.value, panels: structuredClone(DEFAULT_PANELS) })

  /**
   * Per-view state saved with the prefs. The returned object reads and writes through to
   * prefs.views[name] on every access, so it stays live when the saved prefs load (or reset) after a
   * component asked for it, and keys added to `defaults` later get their default.
   */
  function view<T extends Record<string, unknown>>(name: string, defaults: T): T {
    const current = () => {
      const v = (prefs.value.views[name] ??= structuredClone(defaults)) as Record<string, unknown>
      for (const k of Object.keys(defaults)) if (!(k in v)) v[k] = structuredClone(defaults[k])
      return v
    }
    current()
    return new Proxy({} as T, {
      get: (_, k) => current()[k as string],
      set: (_, k, value) => ((current()[k as string] = value), true),
      has: (_, k) => k in current(),
      ownKeys: () => Reflect.ownKeys(current()),
      getOwnPropertyDescriptor: (_, k) => ({ ...Reflect.getOwnPropertyDescriptor(current(), k), configurable: true }),
      deleteProperty: (_, k) => delete current()[k as string],
    })
  }

  return { prefs, loaded, orderedPanels, zones, load, update, place, addPanel, removePanel, reset, view }
})
