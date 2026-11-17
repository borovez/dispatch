import { PhCheckCircle, PhCircle, PhCircleDashed, PhClock, PhQuestion, PhXCircle } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import type { BadgeVariants } from '@/components/ui/badge'
import { ACTION_TONE } from '@/utils/format'

export type StatusTone = NonNullable<BadgeVariants['variant']>
export interface PrStatus {
  tone: StatusTone
  label: string
  icon: unknown
}

/**
 * Where a PR stands, for dependency chains and lists: released / merged green, merged but not in a
 * release yet blue, closed muted, else its action (primary when it is the next step).
 */
export function prStatus(pr: PrView | null | undefined, next = false): PrStatus {
  if (!pr) return { tone: 'muted', label: 'Not synced', icon: PhQuestion }
  if (pr.state === 'CLOSED') return { tone: 'muted', label: 'Closed without merging', icon: PhXCircle }
  if (pr.state === 'MERGED') {
    if (pr.release && !pr.release.released) return { tone: 'info', label: 'Merged, awaiting release', icon: PhClock }
    return { tone: 'success', label: pr.release?.released ? 'Released' : 'Merged', icon: PhCheckCircle }
  }
  if (next) return { tone: 'primary', label: pr.action.label, icon: PhCircle }
  return { tone: ACTION_TONE[pr.action.kind], label: pr.action.label, icon: PhCircleDashed }
}
