import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api'
import { useDeck } from '@/stores/deck'

/**
 * Refresh the PRs a list shows from GitHub (`POST /prs/resync-many`: by node id, plus new dependency
 * targets their descriptions name and their Jira issues), not a full sync. Shift-click: full sync.
 */
export function useListResync() {
  const deck = useDeck()
  const resyncing = ref(false)

  async function resync(ids: string[], e?: MouseEvent) {
    if (e?.shiftKey) return void deck.sync()
    const known = ids.filter((id) => deck.byId.has(id))
    if (!known.length || resyncing.value) return
    resyncing.value = true
    try {
      const totals = { prs: 0, added: 0, jira: 0, releases: 0, errors: [] as string[] }
      // The route takes up to 500 at a time
      for (let i = 0; i < known.length; i += 500) {
        let r: Awaited<ReturnType<typeof api.resyncPrs>> | undefined
        if (!(await deck.mutate(async () => void (r = await api.resyncPrs(known.slice(i, i + 500)))))) return
        totals.prs += r!.prs
        totals.added += r!.added
        totals.jira += r!.jira
        totals.releases += r!.releases ?? 0
        totals.errors.push(...r!.errors)
      }
      const parts = [`${totals.prs} PRs`, totals.added && `${totals.added} new dependency target${totals.added === 1 ? '' : 's'}`, totals.releases && `${totals.releases} release contents`, totals.jira && `${totals.jira} Jira issues`]
        .filter(Boolean)
        .join(', ')
      if (totals.errors.length) toast.warning(`Refreshed ${parts}`, { description: totals.errors[0] })
      else toast.success('List refreshed', { description: parts })
    } finally {
      resyncing.value = false
    }
  }
  return { resyncing, resync }
}
