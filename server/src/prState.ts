import type { PrRecord, PrStateChange, PrStateTarget } from '../../shared/types.ts'
import { getSettings, listPrs, updatePrData } from './db.ts'
import { fetchPrsByNodeId, GithubError, setPrState } from './github.ts'
import { buildOverview } from './model.ts'
import { accountForOwner } from './sync.ts'

const DONE: Record<PrStateTarget, string> = {
  ready: 'Marked {pr} ready for review',
  draft: 'Converted {pr} to a draft',
  closed: 'Closed {pr}',
  open: 'Reopened {pr}',
}

/** Why a PR can't go to that state, or null when it can */
export function stateRefusal(pr: Pick<PrRecord, 'state' | 'isDraft'>, to: PrStateTarget): string | null {
  if (pr.state === 'MERGED') return 'It is merged'
  if (to === 'open') return pr.state === 'CLOSED' ? null : 'It is already open'
  if (pr.state === 'CLOSED') return 'It is closed; reopen it first'
  if (to === 'ready' && !pr.isDraft) return 'It is already ready for review'
  if (to === 'draft' && pr.isDraft) return 'It is already a draft'
  return null
}

/**
 * Change a PR's state on GitHub (PUT /api/prs/state, MCP set_pr_state), then re-read it so its action and
 * bucket follow at once. Warnings: marking ready (or reopening) while a prerequisite isn't merged / released
 * yet, and closing a PR others wait on. They don't block the change.
 */
export async function changePrState(prId: string, to: PrStateTarget): Promise<PrStateChange> {
  const stored = listPrs().find((p) => p.pr.id === prId)?.pr
  if (!stored) throw new Error(`Unknown PR ${prId}`)
  const ref = `${stored.repo.split('/')[1]}#${stored.number}`
  const refusal = stateRefusal(stored, to)
  if (refusal) throw new Error(`Can't change ${ref}: ${refusal.toLowerCase()}`)
  const accounts = getSettings().github.accounts.filter((a) => a.token)
  const acc = accounts.find((a) => a.id === stored.accountId) ?? accountForOwner(accounts, stored.owner)
  if (!acc) throw new Error('No GitHub account for this PR')

  try {
    await setPrState(acc, stored, to)
  } catch (e) {
    const status = e instanceof GithubError ? e.status : undefined
    const msg = (e as Error).message
    if (status === 403 || status === 404 || /resource not accessible|must have (push|write)/i.test(msg))
      throw new Error(`GitHub account ${acc.login ?? acc.label} can't change PRs in ${stored.repo}: it needs write access (fine-grained token: Pull requests, Read and write; classic: repo). ${msg}`.replace(/\s+/g, ' '))
    throw e
  }

  // GitHub has it now; store its copy (falls back to the change itself if the read fails)
  const { prs } = await fetchPrsByNodeId(acc, [stored.nodeId]).catch(() => ({ prs: [] as PrRecord[] }))
  const pr: PrRecord = prs[0] ?? { ...stored, isDraft: to === 'draft' ? true : to === 'ready' ? false : stored.isDraft, state: to === 'closed' ? 'CLOSED' : to === 'open' ? 'OPEN' : stored.state }
  updatePrData(pr)

  const warnings: string[] = []
  const o = buildOverview()
  const view = o.prs.find((p) => p.id === prId)
  const name = (id: string) => {
    const [repo, n] = id.split('#')
    return `${repo.split('/')[1]}#${n}`
  }
  if (view && (to === 'ready' || to === 'open')) {
    for (const e of view.dependsOn.filter((d) => !d.satisfied))
      warnings.push(`Still waits for ${name(e.to)} to be ${e.kind === 'release' ? 'released' : 'merged'}${e.missing ? ' (not synced)' : ''}`)
  }
  if (view && to === 'closed') {
    const waiting = view.dependents.filter((d) => !d.satisfied).map((d) => name(d.from))
    if (waiting.length) warnings.push(`${waiting.join(', ')} ${waiting.length === 1 ? 'waits' : 'wait'} on this PR`)
  }
  return { pr, message: DONE[to].replace('{pr}', ref), warnings }
}
