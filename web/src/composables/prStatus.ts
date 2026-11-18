import { PhCheckCircle, PhCircle, PhCircleDashed, PhClock, PhQuestion, PhXCircle } from '@phosphor-icons/vue'
import type { PrView } from '@shared/types'
import type { BadgeVariants } from '@/components/ui/badge'
import { actionTone } from '@/utils/format'

export type StatusTone = NonNullable<BadgeVariants['variant']>
export interface PrStatus {
  tone: StatusTone
  label: string
  icon: unknown
}

/**
 * Where a PR stands, for dependency chains and lists: released / merged green, merged but not in a
 * release yet blue, closed muted, marked done green, else its action (primary when it is the next step).
 */
export function prStatus(pr: PrView | null | undefined, next = false): PrStatus {
  if (!pr) return { tone: 'muted', label: 'Not synced', icon: PhQuestion }
  if (pr.state === 'CLOSED') return { tone: 'muted', label: 'Closed without merging', icon: PhXCircle }
  // Marked done by me (e.g. a release that isn't needed): done, whatever it was waiting for
  if (pr.markedDone) return { tone: 'success', label: 'Done', icon: PhCheckCircle }
  if (pr.state === 'MERGED') {
    if (pr.release && !pr.release.released) return { tone: 'info', label: 'Merged, awaiting release', icon: PhClock }
    return { tone: 'success', label: pr.release?.released ? 'Released' : 'Merged', icon: PhCheckCircle }
  }
  if (next) return { tone: 'primary', label: pr.action.label, icon: PhCircle }
  return { tone: actionTone(pr), label: pr.action.label, icon: PhCircleDashed }
}
