import type { Overview, PlanItem, PlanRelease, ReleasePlan } from '../../shared/types.ts'
import { deletePlannedRelease, listPlannedReleases, listPrs, listReleaseDecisions, movePlannedDecisions } from './db.ts'
import { integrationBranches } from './flow.ts'
import { buildOverview } from './model.ts'

/**
 * Release planner: for each repo that integrates on a branch (dev), the PRs merged into it that are
 * not released yet, and what each needs (`PlanItem.outcome`):
 * - shipping: an open release already ships it (a dev → master release ships everything in dev)
 * - pick: exactly one release branch can take it and nothing blocks it: cherry-pick it there
 * - decide: a hard fact needs my answer (more than one release branch could take it, a dev → master
 *   release is open next to a release branch, a dependency isn't met); notes (Jira To Do, a flag off)
 *   are shown but don't make it a decision
 * - held / skipped: what I decided (a "put it in X" decision lapses once X is no longer open)
 * - waiting: no open release takes it yet
 * Only PRs whose base is the repo's integration branch count: feature-branch and trunk / tag repos
 * have nothing to cherry-pick. Used by GET /releases/plan, the prompt (releasePrompt.ts) and MCP.
 */
export function buildReleasePlans(overview: Overview = buildOverview()): ReleasePlan[] {
  const integration = integrationBranches(listPrs().map((s) => s.pr))
  const plannedAll = listPlannedReleases()
  const jiraByKey = new Map(overview.jira.map((j) => [j.key, j]))
  const flagByKey = new Map(overview.flags.map((f) => [f.key, f]))
  const byId = new Map(overview.prs.map((p) => [p.id, p]))
  const plans: ReleasePlan[] = []

  for (const [repoLower, integ] of integration) {
    const repoPrs = overview.prs.filter((p) => p.repo.toLowerCase() === repoLower)
    if (!repoPrs.length) continue
    const open = repoPrs.filter((p) => p.flow === 'release' && p.state === 'OPEN')
    // A planned release whose PR now exists (same branch) becomes that PR: my decisions follow it
    const planned = plannedAll.filter((r) => r.repo.toLowerCase() === repoLower)
    for (const r of planned) {
      const pr = repoPrs.find((p) => p.state !== 'CLOSED' && p.headRef === r.branch)
      if (pr) (movePlannedDecisions(r.id, pr.id), deletePlannedRelease(r.id))
    }
    const decisions = listReleaseDecisions()
    const releases: PlanRelease[] = [
      ...open.map((p): PlanRelease => ({ id: p.id, number: p.number, title: p.title, head: p.headRef, base: p.baseRef, mode: p.headRef.toLowerCase() === integ.toLowerCase() ? 'includes' : 'branch' })),
      ...planned
        .filter((r) => !repoPrs.some((p) => p.state !== 'CLOSED' && p.headRef === r.branch))
        .map((r): PlanRelease => ({ id: r.id, number: 0, title: r.title, head: r.branch, base: r.base, mode: 'planned' })),
    ]
    const includes = releases.filter((r) => r.mode === 'includes')
    // Releases work is cherry-picked into: open release branches and the ones I planned
    const branches = releases.filter((r) => r.mode !== 'includes')
    const ref = (r: PlanRelease) => (r.mode === 'planned' ? `\`${r.head}\` (planned)` : `\`${r.head}\` (#${r.number})`)

    const merged = repoPrs.filter((p) => p.state === 'MERGED' && !p.flow && p.baseRef.toLowerCase() === integ.toLowerCase() && !p.release?.released)
    if (!merged.length && !releases.length) continue

    const items: PlanItem[] = merged.map((p) => {
      const decision = decisions.get(p.id) ?? null
      const live = decision && (decision.decision !== 'release' || releases.some((r) => r.id === decision.releaseId)) ? decision : null
      const jira = p.jiraKeys.map((k) => ({ key: k, status: jiraByKey.get(k)?.status ?? null, category: jiraByKey.get(k)?.statusCategory ?? null }))
      const notes = [
        ...jira.filter((j) => j.category === 'new').map((j) => `${j.key} is still ${j.status ?? 'To Do'}`),
        ...p.flags.flatMap((k) => {
          const env = flagByKey.get(k)?.envs[0]
          return env && !env.on ? [`Flag ${k} is off in ${env.key}`] : []
        }),
      ]
      const unmet = p.dependsOn.filter((e) => !e.satisfied).map((e) => `Waits for ${e.to} to be ${e.kind === 'release' ? 'released' : 'merged'}`)
      const base: PlanItem = {
        prId: p.id,
        number: p.number,
        title: p.title,
        author: p.author.login,
        mergedAt: p.mergedAt,
        mergeCommitSha: p.mergeCommitSha,
        jira,
        outcome: 'waiting',
        target: null,
        reasons: [],
        notes,
        question: null,
        options: [],
        decision: live,
        order: 0,
        locked: false,
        prereqIssues: [],
      }
      // Already in a release branch's contents (picked there): fixed. In a dev → master release's: it ships
      // with that one, but it can still go out earlier on its own branch (my decision moves it)
      // A release branch that has it wins over the dev → master release that also does (both list it)
      const ships = p.shipsIn.filter((s) => s.state !== 'CLOSED')
      const isBranch = (id: string) => (byId.get(id)?.headRef.toLowerCase() ?? integ.toLowerCase()) !== integ.toLowerCase()
      const picked = ships.find((s) => s.state === 'MERGED' || isBranch(s.id))
      if (picked) return { ...base, outcome: 'shipping', target: picked.id, locked: true }
      const openShip = ships[0]
      // A dev → master release ships everything in dev: a Hold can't keep it out, so it doesn't apply then
      if (openShip && (!live || live.decision !== 'release')) return { ...base, outcome: 'shipping', target: openShip.id, decision: null }
      if (live?.decision === 'hold' && !includes.length) return { ...base, outcome: 'held' }
      if (live?.decision === 'skip') return { ...base, outcome: 'skipped', target: includes[0]?.id ?? null }
      if (live?.decision === 'release') {
        const r = releases.find((x) => x.id === live.releaseId)!
        return { ...base, outcome: r.mode === 'includes' ? 'shipping' : 'pick', target: r.id }
      }
      if (!releases.length) return { ...base, outcome: 'waiting', notes: [...notes, 'No release is open for this repo; it goes in the next one'] }

      const options: PlanItem['options'] = branches.map((r) => ({ key: `release:${r.id}`, label: `Cherry-pick into ${ref(r)}`, decision: 'release', releaseId: r.id }))
      // Hold only while no dev → master release is open (that one ships everything in dev regardless)
      if (!includes.length) options.push({ key: 'hold', label: 'Hold it for a later release', decision: 'hold', releaseId: null })
      if (includes.length) options.push({ key: 'skip', label: `Only ship it with ${ref(includes[0]!)}, no cherry-pick`, decision: 'skip', releaseId: null })

      // dev → master open: whatever is in dev ships with it
      if (includes.length && !branches.length) {
        return { ...base, outcome: 'shipping', target: includes[0]!.id, notes: [...notes, `In ${integ}, so ${ref(includes[0]!)} ships it`] }
      }
      const reasons: string[] = [...unmet]
      if (includes.length && branches.length)
        reasons.push(`${ref(includes[0]!)} ships it from ${integ}; ${branches.length === 1 ? ref(branches[0]!) : `${branches.length} release branches`} only if it's cherry-picked`)
      if (branches.length > 1) reasons.push(`${branches.length} release branches are open: ${branches.map(ref).join(', ')}`)
      if (!reasons.length) return { ...base, outcome: 'pick', target: branches[0]!.id }
      const question = includes.length && branches.length === 1 ? `Also cherry-pick #${p.number} into ${ref(branches[0]!)}?` : `Which release should #${p.number} go into?`
      return { ...base, outcome: 'decide', reasons, question, options }
    })

    // Cherry-pick order: prerequisites first (dependencies between these PRs), then by merge time
    const ids = new Set(items.map((i) => i.prId))
    const prereqs = (id: string) => (byId.get(id)?.dependsOn ?? []).map((e) => e.to).filter((t) => ids.has(t))
    const byMerge = [...items].sort((a, b) => (a.mergedAt ?? '').localeCompare(b.mergedAt ?? ''))
    const placed = new Set<string>()
    let n = 0
    const visit = (it: PlanItem, path = new Set<string>()) => {
      if (placed.has(it.prId) || path.has(it.prId)) return
      path.add(it.prId)
      for (const pre of prereqs(it.prId)) visit(items.find((x) => x.prId === pre)!, path)
      placed.add(it.prId)
      it.order = ++n
    }
    byMerge.forEach((it) => visit(it))

    // My order (positions from dragging in the plan board) within each release; Dispatch's order otherwise
    const picks = items.filter((i) => i.outcome === 'pick')
    const groups = new Map<string, PlanItem[]>()
    for (const it of [...picks].sort((a, b) => a.order - b.order)) groups.set(it.target!, [...(groups.get(it.target!) ?? []), it])
    let seq = 0
    for (const g of groups.values()) {
      g.sort((a, b) => (a.decision?.position ?? 1e9 + a.order) - (b.decision?.position ?? 1e9 + b.order))
      for (const it of g) it.order = ++seq
    }
    for (const it of items.filter((i) => i.outcome !== 'pick').sort((a, b) => a.order - b.order)) it.order = ++seq
    items.sort((a, b) => a.order - b.order)

    // Splitting by hand can break dependencies: say so on the card (it stays my call)
    const itemById = new Map(items.map((i) => [i.prId, i]))
    for (const it of picks)
      for (const pre of prereqs(it.prId)) {
        const p = itemById.get(pre)!
        if (p.outcome === 'pick' && p.target === it.target && p.order > it.order) {
          it.notes.push(`Picked before its prerequisite #${p.number}`)
          it.prereqIssues.push(p.number)
        } else if (p.outcome !== 'shipping' && !(p.outcome === 'pick' && p.target === it.target)) {
          it.notes.push(`Its prerequisite #${p.number} isn't going into this release`)
          it.prereqIssues.push(p.number)
        }
      }

    const counts = { shipping: 0, pick: 0, decide: 0, held: 0, skipped: 0, waiting: 0 } as ReleasePlan['counts']
    for (const it of items) counts[it.outcome]++
    const repo = repoPrs[0]!.repo
    plans.push({ repo, integration: integ, releases, items, counts })
  }
  // Repos with something to do first
  return plans.sort((a, b) => b.counts.decide + b.counts.pick - (a.counts.decide + a.counts.pick) || a.repo.localeCompare(b.repo))
}

/** One repo's plan (case-insensitive owner/name) */
export function releasePlanFor(repo: string, overview?: Overview): ReleasePlan | null {
  return buildReleasePlans(overview).find((p) => p.repo.toLowerCase() === repo.toLowerCase()) ?? null
}

