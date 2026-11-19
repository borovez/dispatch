import { ref, type Component } from 'vue'
import { toast } from 'vue-sonner'
import { PhArrowCounterClockwise, PhEye, PhPencilLine, PhXCircle } from '@phosphor-icons/vue'
import type { PrStateChange, PrStateTarget, PrView } from '@shared/types'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'

export interface PrStateOption {
  to: PrStateTarget
  label: string
  icon: Component
  /** Asks first (ClosePrDialog) */
  confirm?: boolean
}

/** The states a PR can move to from here (merging stays on GitHub) */
export function prStateOptions(pr: Pick<PrView, 'state' | 'isDraft'>): PrStateOption[] {
  if (pr.state === 'MERGED') return []
  if (pr.state === 'CLOSED') return [{ to: 'open', label: 'Reopen', icon: PhArrowCounterClockwise }]
  return [
    pr.isDraft ? { to: 'ready', label: 'Ready for review', icon: PhEye } : { to: 'draft', label: 'Convert to draft', icon: PhPencilLine },
    { to: 'closed', label: 'Close…', icon: PhXCircle, confirm: true },
  ]
}

/** PRs whose state change is in flight (buttons show busy, a second click does nothing) */
const busy = ref(new Set<string>())

/**
 * Change a PR's state on GitHub (PR panel, PR menu). Close asks first (`deck.closePr` → ClosePrDialog);
 * the rest run at once. The toast carries the warnings (e.g. ready while a prerequisite isn't merged).
 */
export function usePrState() {
  const deck = useDeck()
  async function change(pr: Pick<PrView, 'id'>, to: PrStateTarget, confirmed = false) {
    if (to === 'closed' && !confirmed) return void (deck.closePr = pr.id)
    if (busy.value.has(pr.id)) return
    busy.value = new Set(busy.value).add(pr.id)
    let res: PrStateChange | null = null
    try {
      await deck.mutate(async () => (res = await api.setPrState(pr.id, to)))
    } finally {
      const next = new Set(busy.value)
      next.delete(pr.id)
      busy.value = next
    }
    const r = res as PrStateChange | null
    if (!r) return
    if (r.warnings.length) toast.warning(r.message, { description: r.warnings.join('\n') })
    else toast.success(r.message)
  }
  return { change, options: prStateOptions, busy: (id: string) => busy.value.has(id) }
}
