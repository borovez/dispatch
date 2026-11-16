<script setup lang="ts">
import { onEscape } from '@/composables/escape'
import { computed, nextTick, ref, watch } from 'vue'
import { onKeyStroke, unrefElement, useElementSize, useEventListener } from '@vueuse/core'
import { MarkerType, Panel, Position, VueFlow, useVueFlow, type Connection, type Edge, type EdgeMouseEvent, type Node, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ControlButton, Controls } from '@vue-flow/controls'
import dagre from '@dagrejs/dagre'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@/components/flowTheme.css'
import { PhArrowArcLeft, PhArrowArcRight, PhArrowsClockwise, PhArrowsCounterClockwise, PhArrowsDownUp, PhCheckCircle, PhClock, PhCircleNotch, PhPlus, PhBuildings, PhGraph, PhHandGrabbing, PhTrash, PhX } from '@phosphor-icons/vue'
import type { DepEdge, DependencyKind, PrView } from '@shared/types'
import { useDeck } from '@/stores/deck'
import { cn } from '@/lib/utils'
import { useDependencies } from '@/composables/dependencies'
import { useLayout } from '@/stores/layout'
import GraphNode, { CARD_W, cardHeight, type GraphNodeData } from '@/components/GraphNode.vue'
import FilterChips from '@/components/FilterChips.vue'
import ViewMenu, { type ViewSection } from '@/components/ViewMenu.vue'
import PrPicker from '@/components/PrPicker.vue'
import Kbd from '@/components/Kbd.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import RepoSelect from '@/components/RepoSelect.vue'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const deck = useDeck()
const deps = useDependencies()
// Escape: the PR drawer closes first (its own handler), then the edge panel
onEscape(() => {
  if (deck.selectedId) return false
  if (pending.value) return (pending.value = null), true
  if (selectedEdge.value) return (selectedEdge.value = null), true
  if (adding.value) return (adding.value = false), true
  return false
})
const layout = useLayout()
/** View options in the View menu, and their defaults (Reset view) */
const VIEW_DEFAULTS = {
  org: '',
  repo: '',
  hideDone: true,
  mineOnly: false,
  /** Also show open PRs that have no dependencies yet, so new links can be drawn to them */
  showUnlinked: false,
}
const v = layout.view('graph', { ...VIEW_DEFAULTS, newKind: 'merge' as DependencyKind })

const NODE_W = CARD_W
const nodeHeight = (id: string) => cardHeight(deck.byId.get(id), deck.jiraByKey)
const SOURCE_LABEL: Record<DepEdge['source'], string> = { manual: 'Added manually', body: 'From PR description', jira: 'From Jira "is blocked by"' }
const ORG_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--merged)', 'var(--info)']

const ownerOf = (id: string) => id.split('/')[0]
const repoOf = (id: string) => id.split('#')[0]

const allEdges = computed(() => deck.overview?.edges ?? [])
const orgs = computed(() => {
  const ids = new Set<string>([...deck.prs.map((p) => p.id), ...allEdges.value.flatMap((e) => [e.from, e.to])])
  return [...new Set([...ids].map(ownerOf))].sort()
})
const orgColor = computed(() => new Map(orgs.value.map((o, i) => [o, ORG_COLORS[i % ORG_COLORS.length]])))

const viewSections = computed<ViewSection[]>(() => [
  { type: 'filter', key: 'org', label: 'Org', icon: PhBuildings, allLabel: 'All orgs', options: orgs.value.map((o) => ({ value: o, label: o })), mono: true },
  { type: 'check', key: 'hideDone', label: 'Hide finished chains' },
  { type: 'check', key: 'mineOnly', label: 'Only chains with my PRs' },
  { type: 'check', key: 'showUnlinked', label: 'Show unlinked PRs (to draw links)' },
])
/** Active filters that aren't otherwise visible in the toolbar */
const chips = computed(() => [
  ...(v.org ? [{ key: 'org', label: v.org, clear: () => (v.org = '') }] : []),
])
// A repo outside the chosen org would hide everything
watch(() => v.org, (org) => org && v.repo && ownerOf(v.repo) !== org && (v.repo = ''))

const inOrg = (id: string) => !v.org || ownerOf(id) === v.org

/** Chains after the org / finished / mine filters, before focusing on a repo */
const scopedChains = computed(() =>
  (deck.overview?.chains ?? []).filter(
    (c) => (!v.hideDone || !c.done) && (!v.mineOnly || c.prs.some((id) => deck.byId.get(id)?.isMine)) && c.prs.some(inOrg),
  ),
)
const unlinkedPrs = computed(() => {
  if (!v.showUnlinked) return []
  const inChains = new Set(scopedChains.value.flatMap((c) => c.prs))
  return deck.prs.filter((p) => p.state === 'OPEN' && !inChains.has(p.id) && inOrg(p.id) && (!v.mineOnly || p.isMine)).map((p) => p.id)
})

/** Repo tabs: repos with PRs in the chains shown, counted by open PRs */
const repoTabs = computed(() => {
  const counts = new Map<string, { key: string; repo: string; count: number }>()
  for (const id of new Set([...scopedChains.value.flatMap((c) => c.prs.filter(inOrg)), ...unlinkedPrs.value])) {
    const repo = deck.byId.get(id)?.repo ?? repoOf(id)
    const t = counts.get(repo.toLowerCase()) ?? { key: repo.toLowerCase(), repo, count: 0 }
    t.count += Number(deck.byId.get(id)?.state === 'OPEN')
    counts.set(t.key, t)
  }
  return [...counts.values()].sort((a, b) => a.repo.localeCompare(b.repo))
})
/** '' = all repos; a saved repo that has nothing left falls back to all */
const activeRepo = computed(() => (v.repo && repoTabs.value.some((t) => t.key === v.repo.toLowerCase()) ? v.repo.toLowerCase() : 'all'))
const inFocus = (id: string) => activeRepo.value === 'all' || (deck.byId.get(id)?.repo ?? repoOf(id)).toLowerCase() === activeRepo.value

const visibleChains = computed(() => scopedChains.value.filter((c) => c.prs.some(inFocus)))

const nextSteps = computed(() => new Set(visibleChains.value.map((c) => c.nextStep).filter(Boolean) as string[]))

/** PRs from other repos shown only because they link to the focused repo's PRs */
const linkedIds = computed(() => {
  if (activeRepo.value === 'all') return new Set<string>()
  const chainIds = new Set(visibleChains.value.flatMap((c) => c.prs))
  const own = new Set([...chainIds].filter(inFocus))
  const linked = new Set<string>()
  for (const e of allEdges.value) {
    if (own.has(e.from) && chainIds.has(e.to) && !own.has(e.to)) linked.add(e.to)
    if (own.has(e.to) && chainIds.has(e.from) && !own.has(e.from)) linked.add(e.from)
  }
  return linked
})

const nodeIds = computed(() => {
  const ids = new Set(activeRepo.value === 'all' ? visibleChains.value.flatMap((c) => c.prs) : visibleChains.value.flatMap((c) => c.prs.filter(inFocus)))
  for (const id of linkedIds.value) ids.add(id)
  for (const id of unlinkedPrs.value) if (inFocus(id)) ids.add(id)
  return [...ids]
})

const visibleEdges = computed(() => {
  const ids = new Set(nodeIds.value)
  return allEdges.value.filter((e) => ids.has(e.from) && ids.has(e.to))
})

/** Dagre LR layout. Prerequisites on the left, dependents to the right. */
const positions = computed(() => {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of nodeIds.value) g.setNode(id, { width: NODE_W, height: nodeHeight(id) })
  for (const e of visibleEdges.value) g.setEdge(e.to, e.from)
  dagre.layout(g)
  return new Map(nodeIds.value.map((id) => {
    const n = g.node(id)
    return [id, { x: n.x - NODE_W / 2, y: n.y - n.height / 2 }]
  }))
})

const nodes = computed<Node<GraphNodeData>[]>(() =>
  nodeIds.value.map((id) => ({
    id,
    type: 'pr',
    position: positions.value.get(id)!,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { id, pr: deck.byId.get(id) ?? null, color: orgColor.value.get(ownerOf(id)) ?? 'var(--muted-foreground)', isNext: nextSteps.value.has(id), linked: linkedIds.value.has(id) },
    // Cards always above edges (hovered edges are raised above other edges only)
    zIndex: 10,
    class: path.value && !path.value.nodes.has(id) ? 'is-dimmed' : undefined,
  })),
)

/** Hovering a card highlights its whole chain: everything it waits on and everything waiting on it */
const hoverNode = ref<string | null>(null)
const path = computed(() => {
  const start = hoverNode.value
  if (!start) return null
  const nodes = new Set([start])
  const edges = new Set<string>()
  for (const dir of ['up', 'down'] as const) {
    const queue: string[] = [start]
    while (queue.length) {
      const n = queue.shift()!
      for (const e of visibleEdges.value) {
        const [from, to] = dir === 'up' ? [e.from, e.to] : [e.to, e.from]
        if (from !== n) continue
        edges.add(edgeKey(e))
        if (!nodes.has(to)) (nodes.add(to), queue.push(to))
      }
    }
  }
  return { nodes, edges }
})

const edgeKey = (e: DepEdge) => `${e.kind}:${e.to}->${e.from}`
const hoveredEdge = ref<string | null>(null)
const selectedEdge = ref<DepEdge | null>(null)
/** Where the edge was clicked, relative to the graph: its card opens there */
/** Where the edge was clicked, in graph coordinates: the card stays there while the graph pans and zooms */
const edgeAt = ref<{ x: number; y: number } | null>(null)

const nodeSet = computed(() => new Set(nodeIds.value))
const removing = computed(() => new Set(deps.writing.value.filter((w) => w.op === 'remove').map((w) => `${w.from}>${w.to}`)))
const WRITING_EDGE = {
  style: { stroke: 'var(--muted-foreground)', strokeWidth: 2, strokeDasharray: '4 4', opacity: 0.6 },
  markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted-foreground)', width: 16, height: 16 },
  labelStyle: { fill: 'var(--muted-foreground)', fontSize: '11px' },
  labelBgStyle: { fill: 'var(--card)' },
  labelBgPadding: [4, 2] as [number, number],
  labelBgBorderRadius: 4,
}
const edges = computed<Edge[]>(() => [
  ...(pending.value
    ? [{
        id: 'pending',
        source: pending.value.to,
        target: pending.value.from,
        type: 'smoothstep',
        animated: true,
        zIndex: 6,
        style: { stroke: 'var(--primary)', strokeWidth: 3, strokeDasharray: '4 4' },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--primary)', width: 16, height: 16 },
        selectable: false,
      } satisfies Edge]
    : []),
  // Links being written: grey and moving until GitHub / Dispatch answers
  ...deps.writing.value
    .filter((w) => w.op === 'add' && nodeSet.value.has(w.from) && nodeSet.value.has(w.to) && !visibleEdges.value.some((e) => e.from === w.from && e.to === w.to))
    .map((w) => ({
      id: `adding:${w.from}>${w.to}`,
      source: w.to,
      target: w.from,
      type: 'smoothstep',
      animated: true,
      zIndex: 6,
      label: 'Adding…',
      ...WRITING_EDGE,
      selectable: false,
    }) satisfies Edge),
  ...visibleEdges.value.map((e) => {
    const key = edgeKey(e)
    if (removing.value.has(`${e.from}>${e.to}`))
      return { id: key, source: e.to, target: e.from, type: 'smoothstep', animated: true, zIndex: 6, label: 'Removing…', ...WRITING_EDGE, data: e } satisfies Edge
    const picked = !!selectedEdge.value && edgeKey(selectedEdge.value) === key
    // The picked edge is primary, thicker and glows (.is-picked); the others fade while it's open
    const color = picked ? 'var(--primary)' : e.satisfied ? 'var(--success)' : 'var(--warning)'
    const onPath = path.value?.edges.has(key)
    const active = hoveredEdge.value === key || picked || onPath
    const dimmed = (path.value && !onPath) || (hoveredEdge.value && hoveredEdge.value !== key) || (selectedEdge.value && !picked && hoveredEdge.value !== key)
    return {
      id: key,
      source: e.to,
      target: e.from,
      type: 'smoothstep',
      animated: !!active || (!e.satisfied && nextSteps.value.has(e.to)),
      zIndex: picked ? 6 : active ? 5 : 0,
      class: picked ? 'is-picked' : undefined,
      style: {
        stroke: color,
        strokeWidth: picked ? 4 : active ? 3 : 1.75,
        strokeDasharray: e.kind === 'release' ? '6 4' : undefined,
        opacity: dimmed ? 0.15 : active || !e.satisfied ? 1 : 0.55,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      data: e,
    }
  }),
])

const { fitView, viewport } = useVueFlow('dep-graph')
const graphBox = ref<InstanceType<typeof Card> | null>(null)
const { width: graphW, height: graphH } = useElementSize(graphBox)
// Re-fit when the set of nodes changes (filters, new links), not on every poll
watch(
  () => nodeIds.value.join('|'),
  () => resetView(),
)
/** The position and zoom the graph opens with (also the Reset view button) */
async function resetView() {
  await nextTick()
  setTimeout(() => fitView({ padding: 0.15, maxZoom: 1.25, duration: 200 }), 50)
}

function onNodeClick({ node }: NodeMouseEvent) {
  if (deck.byId.has(node.id)) deck.selectedId = node.id
  else {
    const [repo, n] = node.id.split('#')
    window.open(`https://github.com/${repo}/pull/${n}`, '_blank', 'noopener')
  }
}
function onEdgeClick({ edge, event }: EdgeMouseEvent) {
  selectedEdge.value = edge.data as DepEdge
  const box = (unrefElement(graphBox) as HTMLElement | undefined)?.getBoundingClientRect()
  const ev = event as MouseEvent
  const vp = viewport.value
  edgeAt.value = box && 'clientX' in ev ? { x: (ev.clientX - box.left - vp.x) / vp.zoom, y: (ev.clientY - box.top - vp.y) / vp.zoom } : null
}
/**
 * The edge card beside the clicked point, following it as the graph pans and zooms. It flips to the
 * left of the point when there's no room on the right, and is always kept inside the graph area.
 */
const edgeCard = ref<HTMLElement | null>(null)
const { width: edgeCardW, height: edgeCardH } = useElementSize(edgeCard)
const edgeCardStyle = computed(() => cardAt(edgeAt.value, edgeCardW.value || 320, edgeCardH.value || 300))
/** Beside a point in graph coordinates, flipped / clamped to stay inside the graph area */
function cardAt(at: { x: number; y: number } | null, w: number, h: number) {
  if (!at) return { top: '12px', right: '12px' }
  const vp = viewport.value
  const x = at.x * vp.zoom + vp.x
  const y = at.y * vp.zoom + vp.y
  const W = graphW.value || 1200
  const H = graphH.value || 800
  const clamp = (v: number, max: number) => Math.min(Math.max(8, v), Math.max(8, max))
  const left = clamp(x + 16 + w > W - 8 ? x - 16 - w : x + 16, W - w - 8)
  const top = clamp(y - 24, H - h - 8)
  return { left: `${left}px`, top: `${top}px` }
}
/** Right-click on an edge: the same card as a click (see the dependency, remove it), not the browser menu */
function onEdgeContextMenu(e: EdgeMouseEvent) {
  e.event.preventDefault()
  onEdgeClick(e)
}
// Hover tooltip: HTML above the canvas (an SVG edge label sits under the nodes and gets clipped)
const tip = ref<{ x: number; y: number; text: string } | null>(null)
function onEdgeHover({ edge, event }: EdgeMouseEvent) {
  hoveredEdge.value = edge.id
  const e = edge.data as DepEdge
  const m = event as MouseEvent
  tip.value = {
    x: m.clientX,
    y: m.clientY,
    text: `${e.kind === 'release' ? 'Needs release' : 'Needs merge'} · ${SOURCE_LABEL[e.source]}${e.satisfied ? ' · satisfied' : ''}`,
  }
}
function onEdgeLeave() {
  hoveredEdge.value = null
  tip.value = null
}

/** Any dependency write running: controls are disabled until it finishes */
const busy = deps.busy

/** Where the pointer was last released over the graph: a dropped link asks its question there */
let dropAt: { x: number; y: number } | null = null
useEventListener(window, 'pointerup', (e: PointerEvent) => {
  const box = (unrefElement(graphBox) as HTMLElement | undefined)?.getBoundingClientRect()
  const vp = viewport.value
  dropAt = box ? { x: (e.clientX - box.left - vp.x) / vp.zoom, y: (e.clientY - box.top - vp.y) / vp.zoom } : null
}, { capture: true })

/**
 * Drag from prerequisite (right handle) to dependent (left handle). The link isn't made yet: a card at
 * the drop point asks whether the dependent waits for a merge or a release (M / R, Escape cancels).
 */
const pending = ref<{ from: string; to: string; at: { x: number; y: number } | null } | null>(null)
const pendingCard = ref<HTMLElement | null>(null)
const { width: pendingW, height: pendingH } = useElementSize(pendingCard)
const pendingStyle = computed(() => cardAt(pending.value?.at ?? null, pendingW.value || 288, pendingH.value || 140))
/** Why the dropped pair can't be linked, if it can't */
const pendingProblem = computed(() => {
  const p = pending.value
  if (!p) return null
  if (allEdges.value.some((e) => e.from === p.from && e.to === p.to)) return 'Already depends on it'
  if (allEdges.value.some((e) => e.from === p.to && e.to === p.from)) return 'The other PR already waits on this one (would loop)'
  return null
})
function onConnect(c: Connection) {
  if (!c.source || !c.target || c.source === c.target || busy.value) return
  selectedEdge.value = null
  pending.value = { from: c.target, to: c.source, at: dropAt }
}
async function confirmPending(kind: DependencyKind) {
  const p = pending.value
  if (!p || pendingProblem.value || busy.value) return
  v.newKind = kind
  pending.value = null
  await deps.add(p.from, p.to, kind)
}
// Cmd/Ctrl+Z undoes the last dependency change, Shift+Cmd/Ctrl+Z (or Ctrl+Y) redoes it
onKeyStroke(['z', 'Z', 'y'], (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
  const redo = e.key === 'y' || e.shiftKey
  if (e.key === 'y' && e.metaKey) return
  e.preventDefault()
  void (redo ? deps.redo() : deps.undo())
})
onKeyStroke(['m', 'r'], (e) => {
  if (!pending.value || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
  confirmPending(e.key === 'r' ? 'release' : 'merge')
})

async function deleteSelected() {
  const e = selectedEdge.value
  if (!e || !deps.canRemove(e) || busy.value) return
  if (await deps.remove(e)) selectedEdge.value = null
}

// "Add dependency" form: pick the waiting PR and its prerequisite by title, repo or number
const adding = ref(false)
const addFrom = ref('')
const addTo = ref('')
/** Reasons a prerequisite can't be picked for the chosen waiting PR */
const prereqReason = (p: PrView) =>
  allEdges.value.some((e) => e.from === addFrom.value && e.to === p.id) ? 'already a prerequisite' : allEdges.value.some((e) => e.from === p.id && e.to === addFrom.value) ? 'waits on it (would loop)' : null
/** Reasons a waiting PR can't be picked for the chosen prerequisite */
const dependentReason = (p: PrView) =>
  !addTo.value ? null : allEdges.value.some((e) => e.from === p.id && e.to === addTo.value) ? 'already waits on it' : allEdges.value.some((e) => e.from === addTo.value && e.to === p.id) ? 'it waits on this (would loop)' : null
const swapAdd = () => ([addFrom.value, addTo.value] = [addTo.value, addFrom.value])
/** "x#1 will wait until y#2 is merged", once both are picked (PR ids only; a typed URL shows as typed) */
const addPreview = computed(() => {
  const ok = (s: string) => /^[^/\s]+\/[^#\s]+#\d+$/.test(s)
  return ok(addFrom.value) && ok(addTo.value) ? { from: shortRef(addFrom.value), to: shortRef(addTo.value) } : null
})
// One panel in the corner at a time
watch(adding, (a) => a && (selectedEdge.value = null))
watch(selectedEdge, (e) => e && (adding.value = false))
async function addFromForm() {
  if (!addFrom.value || !addTo.value || busy.value) return
  if (await deps.add(addFrom.value, addTo.value, v.newKind)) {
    addTo.value = ''
    adding.value = false
  }
}

// Drop the selection when the edge disappears after a reload
watch(edges, (es) => {
  if (selectedEdge.value && !es.some((e) => e.id === edgeKey(selectedEdge.value!))) selectedEdge.value = null
})

const titleOf = (id: string) => deck.byId.get(id)?.title
const prOf = (id: string): PrView | undefined => deck.byId.get(id)
/** repo#123 without the org (the card is narrow; the full id is the tooltip) */
const repoName = (id: string) => (deck.byId.get(id)?.repo ?? id.split('#')[0]).split('/')[1] ?? id
const shortRef = (id: string) => `${repoName(id)}#${id.split('#')[1]}`
const openOnGitHub = (id: string) => window.open(`https://github.com/${id.split('#')[0]}/pull/${id.split('#')[1]}`, '_blank', 'noopener')
/** Where a PR in the edge card stands: open, merged, released */
function stateLabel(id: string): { label: string; tone: 'success' | 'merged' | 'muted' | 'warning' } | null {
  const p = deck.byId.get(id)
  if (!p) return null
  if (p.state === 'OPEN') return { label: p.isDraft ? 'Draft' : 'Open', tone: p.isDraft ? 'muted' : 'success' }
  if (p.state === 'CLOSED') return { label: 'Closed', tone: 'muted' }
  return p.release?.released ? { label: 'Released', tone: 'merged' } : { label: 'Merged', tone: 'merged' }
}
const legendOrgs = computed(() => [...new Set(nodeIds.value.map(ownerOf))].sort())
const hasAnyEdges = computed(() => allEdges.value.length > 0)
</script>

<template>
  <div class="h-page flex flex-col gap-3">
    <!-- One repo at a time, with the PRs in other repos its PRs depend on or block -->
    <div class="flex items-center gap-2">
      <RepoSelect v-if="repoTabs.length > 1" :model-value="activeRepo" :tabs="repoTabs" @update:model-value="(r) => (v.repo = r === 'all' ? '' : r)" />
      <FilterChips :chips="chips" />
      <span class="flex-1" />
      <div class="flex shrink-0 items-center">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Resync links" :disabled="deck.syncRunning" @click="deck.sync()">
              <PhArrowsClockwise :class="{ 'animate-spin': deck.syncRunning }" />
            </Button>
          </TooltipTrigger>
          <TooltipContent class="max-w-72">{{ deck.syncRunning ? 'Syncing…' : 'Resync: fetch PR descriptions and Jira links again for new or changed dependencies' }}</TooltipContent>
        </Tooltip>
        <span class="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Undo" :disabled="!deps.canUndo.value || busy" @click="deps.undo()"><PhArrowArcLeft /></Button>
          </TooltipTrigger>
          <TooltipContent class="max-w-80">{{ deps.undoLabel.value }} <span class="opacity-70">⌘Z</span></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Redo" :disabled="!deps.canRedo.value || busy" @click="deps.redo()"><PhArrowArcRight /></Button>
          </TooltipTrigger>
          <TooltipContent class="max-w-80">{{ deps.redoLabel.value }} <span class="opacity-70">⇧⌘Z</span></TooltipContent>
        </Tooltip>
      </div>
      <Button variant="outline" size="sm" :class="adding && 'bg-accent'" @click="adding = !adding"><PhPlus /> Add dependency</Button>
      <ViewMenu :state="v" :sections="viewSections" :defaults="VIEW_DEFAULTS" />
    </div>

    <Card ref="graphBox" class="relative min-h-0 flex-1 overflow-hidden py-0">
      <VueFlow
        id="dep-graph"
        class="dep-graph"
        :nodes="nodes"
        :edges="edges"
        :nodes-draggable="true"
        :nodes-connectable="true"
        :nodes-focusable="false"
        :elements-selectable="true"
        :delete-key-code="null"
        :min-zoom="0.2"
        :max-zoom="2"
        fit-view-on-init
        @node-click="onNodeClick"
        @edge-click="onEdgeClick"
        @edge-context-menu="onEdgeContextMenu"
        @edge-mouse-enter="onEdgeHover"
        @edge-mouse-move="onEdgeHover"
        @edge-mouse-leave="onEdgeLeave"
        @pane-click="(selectedEdge = null), (pending = null)"
        @node-mouse-enter="({ node }) => (hoverNode = node.id)"
        @node-mouse-leave="hoverNode = null"
        @connect="onConnect"
      >
        <template #node-pr="p">
          <GraphNode :data="p.data" :selected="p.selected" />
        </template>

        <Background :gap="18" :size="1.2" />
        <Controls position="bottom-left" :show-interactive="false" :show-fit-view="false">
          <ControlButton title="Reset view" aria-label="Reset view" @click="resetView"><PhArrowsCounterClockwise /></ControlButton>
        </Controls>

        <Panel v-if="legendOrgs.length" position="top-left" class="graph-panel flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-xs">
          <span v-if="linkedIds.size" class="flex items-center gap-1.5 text-muted-foreground">
            <span class="size-2.5 rounded-sm border border-dashed border-muted-foreground" />other repos
          </span>
          <span v-for="o in legendOrgs" :key="o" class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-sm" :style="{ background: orgColor.get(o) }" />{{ o }}
          </span>
          <span class="flex items-center gap-1.5 text-muted-foreground">
            <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" stroke-width="1.75" /></svg>merge
          </span>
          <span class="flex items-center gap-1.5 text-muted-foreground">
            <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" stroke-width="1.75" stroke-dasharray="6 4" /></svg>release
          </span>
        </Panel>

        <!-- How to link two cards (hidden while a dropped link asks merge / release) -->
        <Panel v-if="!pending && nodeIds.length > 1" position="bottom-center" class="graph-panel pointer-events-none flex items-center gap-1.5 select-none px-2.5 py-1.5 text-xs text-muted-foreground">
          <PhHandGrabbing :size="14" />Drag from a card's right dot to another card's left dot to link them
        </Panel>

        <Panel v-if="adding" position="top-right" class="graph-panel nodrag nopan nowheel w-96 p-0 text-sm shadow-lg">
          <!-- Same order as the dependency card: 1 goes first, 2 waits for it -->
          <form @submit.prevent="addFromForm">
            <div class="flex items-center gap-2 px-3 pt-2.5">
              <span class="font-semibold">Add dependency</span>
              <span class="flex-1" />
              <Button type="button" variant="ghost" size="icon-xs" class="-mr-1" aria-label="Close" @click="adding = false"><PhX /></Button>
            </div>
            <div class="space-y-3 p-3">
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground">Waits for the other PR to be</span>
                <span class="flex-1" />
                <ToggleGroup :model-value="v.newKind" type="single" variant="outline" size="sm" @update:model-value="(k) => k && (v.newKind = k as DependencyKind)">
                  <ToggleGroupItem value="merge">merged</ToggleGroupItem>
                  <ToggleGroupItem value="release">released</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <label class="block space-y-1.5">
                <span class="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  <span class="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] text-foreground tabular-nums">1</span>
                  {{ v.newKind === 'release' ? 'Release first' : 'Merge first' }}
                </span>
                <PrPicker v-model="addTo" :exclude="addFrom" :disabled-reason="prereqReason" placeholder="The PR that goes first" class="h-8" :disabled="busy" required />
              </label>
              <div class="-my-1.5 flex justify-center">
                <Button type="button" variant="ghost" size="xs" class="text-muted-foreground" :disabled="busy || (!addFrom && !addTo)" title="Swap the two PRs" @click="swapAdd">
                  <PhArrowsDownUp /> Swap
                </Button>
              </div>
              <label class="block space-y-1.5">
                <span class="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  <span class="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] text-foreground tabular-nums">2</span>
                  Then this one
                </span>
                <PrPicker v-model="addFrom" :exclude="addTo" :disabled-reason="dependentReason" placeholder="The PR that waits" class="h-8" :disabled="busy" required />
              </label>
              <p v-if="addPreview" class="flex items-start gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs leading-snug text-muted-foreground">
                <PhClock :size="14" weight="fill" class="mt-px shrink-0 text-warning" />
                <span><span class="font-medium text-foreground">{{ addPreview.from }}</span> will wait until <span class="font-medium text-foreground">{{ addPreview.to }}</span> is {{ v.newKind === 'release' ? 'released' : 'merged' }}.</span>
              </p>
            </div>
            <div class="flex items-center gap-2 border-t px-3 py-2">
              <span class="min-w-0 flex-1 text-xs text-muted-foreground">
                {{ deck.overview?.dependencyWrites.description ? `Written into ${addPreview ? addPreview.from : 'the waiting PR'}'s description${deck.overview?.dependencyWrites.bothSides ? ' (and Blocks: on the other)' : ''}` : 'Kept in Dispatch only' }}
              </span>
              <Button type="submit" size="sm" :disabled="busy || !addFrom || !addTo">
                <PhCircleNotch v-if="busy" class="animate-spin" /><PhPlus v-else /> Add
              </Button>
            </div>
          </form>
        </Panel>

        <!-- A dropped link: merge or release? -->
        <div v-if="pending" ref="pendingCard" class="graph-panel nodrag nopan nowheel absolute z-20 w-72 p-0 text-sm shadow-lg" :style="pendingStyle" @click.stop @pointerdown.stop>
          <div class="flex items-center gap-2 px-3 pt-2.5">
            <span class="font-semibold">New dependency</span>
            <span class="flex-1" />
            <Button variant="ghost" size="icon-xs" class="-mr-1" aria-label="Cancel" @click="pending = null"><PhX /></Button>
          </div>
          <p class="px-3 pt-1.5 text-xs leading-snug text-muted-foreground">
            <span class="font-mono font-medium text-foreground">{{ shortRef(pending.from) }}</span> waits until
            <span class="font-mono font-medium text-foreground">{{ shortRef(pending.to) }}</span> is…
          </p>
          <p v-if="pendingProblem" class="px-3 pt-2 text-xs text-destructive">{{ pendingProblem }}</p>
          <div class="grid grid-cols-2 gap-2 p-3">
            <Button size="sm" :variant="v.newKind === 'merge' ? 'default' : 'outline'" :disabled="busy || !!pendingProblem" @click="confirmPending('merge')">
              Merged <Kbd class="ml-auto">M</Kbd>
            </Button>
            <Button size="sm" :variant="v.newKind === 'release' ? 'default' : 'outline'" :disabled="busy || !!pendingProblem" @click="confirmPending('release')">
              Released <Kbd class="ml-auto">R</Kbd>
            </Button>
          </div>
          <p class="border-t px-3 py-2 text-xs text-muted-foreground">
            {{ deck.overview?.dependencyWrites.description ? `Written into ${shortRef(pending.from)}'s description${deck.overview?.dependencyWrites.bothSides ? ' (and Blocks: on the other)' : ''}` : 'Kept in Dispatch only' }}
          </p>
        </div>
        <div v-if="selectedEdge" ref="edgeCard" class="graph-panel nodrag nopan nowheel absolute z-10 w-80 p-0 text-sm shadow-lg" :style="edgeCardStyle" @click.stop @pointerdown.stop>
          <!-- One sentence says what the link means; then the two PRs top to bottom, prerequisite first -->
          <div class="flex items-center gap-2 px-3 pt-2.5">
            <span class="font-semibold">Dependency</span>
            <Badge variant="muted" class="h-4 px-1.5 text-[10px]">{{ selectedEdge.kind === 'release' ? 'release' : 'merge' }}</Badge>
            <span class="flex-1" />
            <Button variant="ghost" size="icon-xs" class="-mr-1" aria-label="Close" @click="selectedEdge = null"><PhX /></Button>
          </div>
          <div class="flex items-start gap-2 border-b px-3 pt-1.5 pb-2.5">
            <component :is="selectedEdge.satisfied ? PhCheckCircle : PhClock" :size="16" weight="fill" :class="cn('mt-0.5 shrink-0', selectedEdge.satisfied ? 'text-success' : 'text-warning')" />
            <p class="min-w-0 flex-1 leading-snug text-muted-foreground">
              <template v-if="selectedEdge.satisfied">
                <span class="font-medium text-foreground">{{ shortRef(selectedEdge.to) }}</span> is {{ selectedEdge.kind === 'release' ? 'released' : 'merged' }}, so
                <span class="font-medium text-foreground">{{ shortRef(selectedEdge.from) }}</span> isn't waiting on it any more.
              </template>
              <template v-else>
                <span class="font-medium text-foreground">{{ shortRef(selectedEdge.from) }}</span> waits until
                <span class="font-medium text-foreground">{{ shortRef(selectedEdge.to) }}</span> is {{ selectedEdge.kind === 'release' ? 'released' : 'merged' }}.
              </template>
            </p>
          </div>
          <div class="space-y-1 p-2">
            <button
              v-for="(side, i) in [
                { id: selectedEdge.to, role: selectedEdge.kind === 'release' ? 'Release first' : 'Merge first' },
                { id: selectedEdge.from, role: 'Then this one' },
              ]"
              :key="side.id"
              type="button"
              class="relative block w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent"
              :title="side.id"
              @click="prOf(side.id) ? (deck.selectedId = side.id) : openOnGitHub(side.id)"
            >
              <span class="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                <span class="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] text-foreground tabular-nums">{{ i + 1 }}</span>
                {{ side.role }}
                <span class="flex-1" />
                <Badge v-if="stateLabel(side.id)" :variant="stateLabel(side.id)!.tone" class="h-4 px-1.5 text-[10px] normal-case">{{ stateLabel(side.id)!.label }}</Badge>
              </span>
              <span class="mt-1 block font-mono text-xs"><span class="text-muted-foreground">{{ repoName(side.id) }}</span> <span class="text-primary">#{{ side.id.split('#')[1] }}</span></span>
              <span class="block truncate">{{ titleOf(side.id) ?? (selectedEdge.missing && i === 0 ? 'Not synced yet' : '') }}</span>
            </button>
          </div>
          <div class="flex items-center gap-2 border-t px-3 py-2">
            <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground" :title="selectedEdge.note ?? ''">{{ SOURCE_LABEL[selectedEdge.source] }}</span>
            <Button v-if="deps.canRemove(selectedEdge)" variant="ghost" size="sm" class="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive" :disabled="busy" @click="deleteSelected">
              <PhCircleNotch v-if="busy" class="animate-spin" /><PhTrash v-else />Remove
            </Button>
            <span v-else class="text-xs text-muted-foreground">Remove it in Jira</span>
          </div>
        </div>

      </VueFlow>

      <div v-if="!nodeIds.length" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <PhGraph :size="40" weight="duotone" class="text-primary" />
        <div class="text-sm font-medium text-foreground">{{ hasAnyEdges ? 'No chains match these filters' : 'No dependencies yet' }}</div>
        <p class="max-w-md text-xs">
          <template v-if="hasAnyEdges">Try another repo tab, clearing the org filter or showing finished chains.</template>
          <template v-else>
            Add <code class="font-mono">Depends on: owner/repo#123</code> to a PR description, link Jira issues with "is blocked by", or turn on
            <span class="font-medium">Unlinked PRs</span> and drag from one card's right handle to another's left handle.
          </template>
        </p>
      </div>
      <Teleport to="body">
      <div
        v-if="tip"
        class="pointer-events-none fixed z-50 w-max max-w-xs -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md"
        :style="{ left: `${tip.x}px`, top: `${tip.y - 10}px` }"
      >
        {{ tip.text }}
      </div>
      </Teleport>
    </Card>
  </div>
</template>
