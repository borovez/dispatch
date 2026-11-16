import type { LinkedPr, LinkedPrs } from '../../shared/types.ts'
import { getSettings, listJira, listLinkedPrs, pruneLinkedPrs, setLinkedPrs } from './db.ts'
import { searchPrsMentioning } from './github.ts'
import { devPullRequests } from './jira.ts'
import { accountForOwner } from './sync.ts'

/**
 * PRs naming a Jira issue beyond the ones Dispatch syncs (older merged PRs, other people's, untracked
 * repos). Stored per issue (linked_prs) so the Jira list can show them; the panel asks live
 * (GET /jira/:key/linked-prs, which stores too) and the sync fills in a few issues at a time.
 */
/** GitHub search per account (its orgs, else the owners of tracked repos) and Jira's development panel, merged by PR */
export async function findLinkedPrs(key: string): Promise<LinkedPrs> {
  const s = getSettings()
  const errors: string[] = []
  const tasks: Promise<LinkedPr[]>[] = []
  for (const acc of s.github?.accounts ?? []) {
    if (!acc.token) continue
    const owners = acc.orgs.length
      ? acc.orgs
      : [...new Set([...(acc.login ? [acc.login] : []), ...s.trackedRepos.filter((r) => accountForOwner(s.github!.accounts, r.split('/')[0])?.id === acc.id).map((r) => r.split('/')[0])])]
    if (!owners.length) continue
    tasks.push(searchPrsMentioning(acc, key, owners).catch((e) => (errors.push(`GitHub (${acc.label}): ${(e as Error).message}`), [])))
  }
  if (s.jira?.apiToken)
    tasks.push(devPullRequests(s.jira, key).catch((e) => (errors.push(`Jira development panel: ${(e as Error).message}`), [])))
  const byId = new Map<string, LinkedPr>()
  for (const list of await Promise.all(tasks))
    for (const pr of list) {
      const prev = byId.get(pr.id)
      // GitHub's copy wins (live state, exact title); sources add up
      byId.set(pr.id, prev ? { ...(prev.sources.includes('github') ? prev : pr), sources: [...new Set([...prev.sources, ...pr.sources])] } : pr)
    }
  const rank = { OPEN: 0, MERGED: 1, CLOSED: 2 }
  const prs = [...byId.values()].sort((a, b) => rank[a.state] - rank[b.state] || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  const fetchedAt = new Date().toISOString()
  // Keep what was found unless every source failed (a network blip shouldn't wipe the list)
  if (!errors.length || prs.length || tasks.length > errors.length) setLinkedPrs(key, prs, fetchedAt)
  return { prs, errors, fetchedAt }
}

const DAY = 86400_000
/** Per sync: GitHub's search has tight rate limits, so a few issues each time, oldest check first */
const PER_SYNC = 15

/**
 * Sync step: issues never checked first, then open ones last checked over a day ago, done ones over a
 * week ago. Three at a time. Returns how many were checked.
 */
export async function syncLinkedPrs(errors: string[]): Promise<number> {
  const issues = listJira().filter((i) => !i.parentOnly)
  pruneLinkedPrs(new Set(issues.map((i) => i.key)))
  const checked = new Map(listLinkedPrs().map((l) => [l.key, Date.parse(l.fetchedAt) || 0]))
  const now = Date.now()
  const due = issues
    .filter((i) => {
      const at = checked.get(i.key)
      return at === undefined || now - at > (i.statusCategory === 'done' ? 7 * DAY : DAY)
    })
    .sort((a, b) => (checked.get(a.key) ?? 0) - (checked.get(b.key) ?? 0))
    .slice(0, PER_SYNC)
  let next = 0
  const failed: string[] = []
  const worker = async () => {
    while (next < due.length) {
      const key = due[next++].key
      try {
        const r = await findLinkedPrs(key)
        if (r.errors.length) failed.push(`${key}: ${r.errors[0]}`)
      } catch (e) {
        failed.push(`${key}: ${(e as Error).message}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  if (failed.length) errors.push(`Linked PRs: ${failed[0]}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ''}`)
  return due.length
}
