import type { ReleaseTrain } from '@shared/types'
import type { BadgeVariants } from '@/components/ui/badge'
import { useDeck } from '@/stores/deck'
import { ACTION_TONE } from '@/utils/format'

export type Tone = NonNullable<BadgeVariants['variant']>

/** A tone as a solid bar (the train list's left edge) */
export const STATUS_BAR: Partial<Record<Tone, string>> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  merged: 'bg-merged',
  info: 'bg-info',
  primary: 'bg-primary',
}
/** A tone as a soft fill (the Trains tab's step numbers) */
export const STATUS_SOFT: Partial<Record<Tone, string>> = {
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/15 text-destructive',
  merged: 'bg-merged/15 text-merged',
  info: 'bg-info/15 text-info',
  primary: 'bg-primary/15 text-primary',
}

/**
 * Where a release stands, for colour coding: merged, waiting on an earlier release of its train that
 * isn't merged, ready to merge (green), else the PR's next action (CI / conflicts red, ...). Without a
 * train (null) the train check is skipped.
 */
export function useReleaseStatus() {
  const deck = useDeck()
  return (train: ReleaseTrain | null, id: string): { tone: Tone; label: string; title?: string } => {
    const pr = deck.byId.get(id)
    if (!pr) return { tone: 'muted', label: 'Not synced' }
    if (pr.state === 'MERGED') return { tone: 'merged', label: 'Merged' }
    if (pr.state === 'CLOSED') return { tone: 'muted', label: 'Closed' }
    const waiting = (train?.links ?? []).filter((l) => l.kind === 'order' && l.to === id && deck.byId.get(l.from)?.state !== 'MERGED').map((l) => l.from)
    if (waiting.length)
      return { tone: 'warning', label: `Waits for ${waiting.length === 1 ? 'an earlier release' : `${waiting.length} earlier releases`}`, title: waiting.join('\n') }
    if (pr.action.kind === 'merge') return { tone: 'success', label: 'Ready to merge' }
    return { tone: ACTION_TONE[pr.action.kind], label: pr.action.label, title: pr.action.detail ?? undefined }
  }
}
