import { computed, reactive } from 'vue'
import { toast } from 'vue-sonner'
import type { DepEdge, DependencyKind } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'

/** Writes in flight, shared by every caller ("from>to"), so the same dependency isn't written twice at once */
const pending = reactive(new Set<string>())
/** What those writes are, so views can draw them (a grey link being added, a grey link being removed) */
const inFlight = reactive(new Map<string, { op: 'add' | 'remove'; from: string; to: string; kind: DependencyKind }>())

/** A dependency added or removed, for undo / redo (shared by the graph, the PR panel and release trains) */
export interface DepChange {
  op: 'add' | 'remove'
  from: string
  to: string
  kind: DependencyKind
}
const history = reactive({ undo: [] as DepChange[], redo: [] as DepChange[] })
const MAX_HISTORY = 30
type Via = 'undo' | 'redo' | undefined
const verb = (c: DepChange) => `${c.op === 'add' ? 'Added' : 'Removed'} ${c.from} → ${c.to} (${c.kind})`

/**
 * Add / remove dependencies. With "write to description" on (Settings), the server edits the dependent PR's
 * description on GitHub; if that fails the dependency is kept in Dispatch only, and the toast says why.
 * One write per pair at a time; adding one that already exists does nothing.
 */
export function useDependencies() {
  const deck = useDeck()
  const keyOf = (from: string, to: string) => `${from}>${to}`
  /** Any dependency write running (for disabling add / remove controls) */
  const busy = computed(() => pending.size > 0)
  const isPending = (from: string, to: string) => pending.has(keyOf(from, to))

  /** After a change: new ones go on the undo stack (and clear redo); undo / redo move it across */
  function record(c: DepChange, via: Via) {
    const target = via === 'undo' ? history.redo : history.undo
    target.push(c)
    if (target.length > MAX_HISTORY) target.shift()
    if (!via) history.redo.length = 0
  }
  /** The toast's Undo / Redo button */
  const actionFor = (via: Via) => (via === 'undo' ? { label: 'Redo', onClick: () => void redo() } : { label: 'Undo', onClick: () => void undo() })

  async function add(from: string, to: string, kind: DependencyKind, via?: Via): Promise<boolean> {
    const key = keyOf(from, to)
    if (pending.has(key)) return false
    const existing = deck.overview?.edges.find((e) => e.from === from && e.to === to)
    if (existing && existing.kind === kind) {
      toast.info('That dependency already exists', { description: `${from} already waits for ${to}` })
      return false
    }
    pending.add(key)
    inFlight.set(key, { op: 'add', from, to, kind })
    try {
      let res: Awaited<ReturnType<typeof api.addDep>> | undefined
      const ok = await deck.mutate(async () => void (res = await api.addDep(from, to, kind)))
      if (!ok || !res) return false
      record({ op: 'add', from, to, kind }, via)
      const action = actionFor(via)
      const where = [res.written && from, res.writtenOther && to].filter(Boolean).join(' and ')
      if (where && !res.error) toast.success(res.written && res.writtenOther ? 'Dependency added to both PR descriptions' : 'Dependency added to the PR description', { description: where, action })
      else if (where) toast.warning(`Dependency added to ${where}`, { description: `Couldn't edit the other description: ${res.error}`, action })
      else if (res.error) toast.warning('Dependency saved in Dispatch only', { description: `Couldn't edit the descriptions: ${res.error}`, action })
      else toast.success('Dependency added', { description: `${from} waits for ${to}`, action })
      return true
    } finally {
      pending.delete(key)
      inFlight.delete(key)
    }
  }

  /** Manual ones are deleted here; ones from the description are taken out of it on GitHub */
  const canRemove = (e: DepEdge) => e.id != null || e.source === 'body'
  async function remove(e: DepEdge, via?: Via): Promise<boolean> {
    const key = keyOf(e.from, e.to)
    if (pending.has(key)) return false
    pending.add(key)
    inFlight.set(key, { op: 'remove', from: e.from, to: e.to, kind: e.kind })
    try {
      const ok = await deck.mutate(() => (e.id != null ? api.removeDep(e.id) : api.removeDepFromDescription(e.from, e.to)))
      if (!ok) return false
      record({ op: 'remove', from: e.from, to: e.to, kind: e.kind }, via)
      toast.success(e.id != null ? 'Dependency removed' : 'Removed from the PR descriptions', { description: `${e.from} no longer waits for ${e.to}`, action: actionFor(via) })
      return true
    } finally {
      pending.delete(key)
      inFlight.delete(key)
    }
  }

  /** Does the opposite of a change: removes what was added, adds back what was removed */
  async function invert(c: DepChange, via: 'undo' | 'redo'): Promise<boolean> {
    const op = via === 'undo' ? (c.op === 'add' ? 'remove' : 'add') : c.op
    if (op === 'add') return add(c.from, c.to, c.kind, via)
    const edge = deck.overview?.edges.find((e) => e.from === c.from && e.to === c.to)
    if (!edge || !canRemove(edge)) {
      toast.info(`Nothing to ${via}`, { description: edge ? `${c.from} → ${c.to} comes from Jira and can't be removed here` : `${c.from} → ${c.to} is already gone` })
      return false
    }
    return remove(edge, via)
  }
  async function step(via: 'undo' | 'redo'): Promise<boolean> {
    const stack = via === 'undo' ? history.undo : history.redo
    const c = stack.at(-1)
    if (!c || busy.value) return false
    stack.pop()
    const ok = await invert(c, via)
    if (!ok) stack.push(c)
    return ok
  }
  const undo = () => step('undo')
  const redo = () => step('redo')
  const canUndo = computed(() => history.undo.length > 0)
  const canRedo = computed(() => history.redo.length > 0)
  /** "Undo: Added a#1 → b#2 (merge)" for tooltips */
  const undoLabel = computed(() => (history.undo.at(-1) ? `Undo: ${verb(history.undo.at(-1)!)}` : 'Nothing to undo'))
  const redoLabel = computed(() => (history.redo.at(-1) ? `Redo: ${verb(history.redo.at(-1)!)}` : 'Nothing to redo'))

  /** Writes in flight, for drawing them */
  const writing = computed(() => [...inFlight.values()])

  return { add, remove, canRemove, busy, isPending, writing, undo, redo, canUndo, canRedo, undoLabel, redoLabel }
}
