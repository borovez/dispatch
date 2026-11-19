import { randomUUID } from 'node:crypto'
import { checkBackmerge, computeReleaseContents } from '../releases.ts'
import { buildReleasePlans, releasePlanFor } from '../releasePlan.ts'
import { buildReleasePrompt, plannedReleaseBody } from '../releasePrompt.ts'
import { adfToMarkdown } from '../../../shared/adf.ts'
import { z } from 'zod'
import type { ActionKind, GithubAccount, PrRecord } from '../../../shared/types.ts'
import { ACTION_LABELS } from '../../../shared/types.ts'
import { listPrs, getSettings, listJira, setMeta, setPrBody, upsertJira, setPrTitle, updatePrData, upsertPr, listReleaseContents, setDoneAction, setReleaseDecision, listPlannedReleases, savePlannedRelease, deletePlannedRelease, clearReleasePlan } from '../db.ts'
import { draftPrText } from '../ai.ts'
import { keepDeclarations } from '../prWriter.ts'
import { claudeMdGuide } from '../guides.ts'
import { fetchPrsByNodeId, fetchPrsByRef, getPrText, prCommits, prDetail, prTemplate, updatePrText, branchExists, createPull, listBranches } from '../github.ts'
import { getIssueDetail, fetchIssuesByKey } from '../jira.ts'
import { buildOverview } from '../model.ts'
import { extractJiraKeys, parseBodyDependencies, parsePrId } from '../refs.ts'
import { accountForOwner } from '../sync.ts'
import { api, bad, Images } from './shared.ts'
import { changePrState } from '../prState.ts'

/** Pull requests: detail, resync / fetch, release contents, notes; the PR writer */
// ---------- PR detail (panel: description, files) ----------
api.get('/prs/detail', async (c) => {
  const id = c.req.query('id') ?? ''
  const stored = listPrs().find((s) => s.pr.id === id)
  if (!stored) throw bad('Unknown PR')
  const accounts = getSettings().github.accounts.filter((a) => a.token)
  const acc = accounts.find((a) => a.id === stored.pr.accountId) ?? accountForOwner(accounts, stored.pr.owner)
  if (!acc) throw bad('No GitHub account for this PR')
  return c.json(await prDetail(acc, stored.pr.repo, stored.pr.number))
})

/** Re-read one PR from GitHub now (and what it ships, for a release PR) without a full sync */
api.post('/prs/resync', async (c) => {
  const { id } = await c.req.json<{ id: string }>()
  const stored = listPrs().find((s) => s.pr.id === id)
  if (!stored) throw bad('Unknown PR')
  const accounts = getSettings().github.accounts.filter((a) => a.token)
  const acc = accounts.find((a) => a.id === stored.pr.accountId) ?? accountForOwner(accounts, stored.pr.owner)
  if (!acc) throw bad('No GitHub account for this PR')
  const { prs, errors } = await fetchPrsByNodeId(acc, [stored.pr.nodeId])
  if (!prs[0]) throw bad(errors[0] ?? 'GitHub returned nothing for this PR')
  updatePrData(prs[0])
  if (listReleaseContents().some((r) => r.prId === id)) await computeReleaseContents(acc, prs[0])
  await checkBackmerge(acc, prs[0])
  return c.json(prs[0])
})

/**
 * Resync just these PRs (e.g. the ones on the dependency graph): their GitHub data (descriptions, so new
 * or removed Depends on / Blocks lines), PRs their descriptions now name that aren't stored yet, and the
 * Jira issues they reference (for "is blocked by" links). Much lighter than a full sync.
 */
/**
 * Fetch a PR Dispatch doesn't have (e.g. a chain step named only by a Blocks: line, shown as "not
 * synced") and store it, so its panel opens. Kept like a dependency target.
 */
api.post('/prs/fetch', async (c) => {
  const { id } = z.object({ id: z.string() }).parse(await c.req.json())
  const ref = parsePrId(id)
  if (!ref) throw bad('Not a PR id (owner/repo#number)')
  const accounts = getSettings().github.accounts.filter((a) => a.token)
  const acc = accountForOwner(accounts, ref.owner)
  if (!acc) throw bad(`No GitHub account can read ${ref.owner}`)
  const [pr] = await fetchPrsByRef(acc, [ref])
  if (!pr) throw bad(`GitHub has no PR ${id} this account can see`)
  upsertPr(pr, ['dependency'], new Date().toISOString())
  return c.json(pr)
})

api.post('/prs/resync-many', async (c) => {
  const { ids } = z.object({ ids: z.array(z.string()).max(500) }).parse(await c.req.json())
  const settings = getSettings()
  const accounts = settings.github.accounts.filter((a) => a.token)
  const stored = new Map(listPrs().map((s) => [s.pr.id, s.pr]))
  const errors: string[] = []
  const byAccount = new Map<GithubAccount, string[]>()
  for (const id of new Set(ids)) {
    const pr = stored.get(id)
    if (!pr) continue
    const acc = accounts.find((a) => a.id === pr.accountId) ?? accountForOwner(accounts, pr.owner)
    if (acc) byAccount.set(acc, [...(byAccount.get(acc) ?? []), pr.nodeId])
  }
  const fresh: PrRecord[] = []
  // Release PRs: what they ship is recomputed too when open or changed (the Releases page refresh)
  const releaseIds = new Set(listReleaseContents().map((r) => r.prId))
  let releases = 0
  await Promise.all(
    [...byAccount].map(async ([acc, nodeIds]) => {
      const r = await fetchPrsByNodeId(acc, nodeIds)
      fresh.push(...r.prs)
      errors.push(...r.errors.map((e) => `[${acc.label}] ${e}`))
      for (const pr of r.prs) updatePrData(pr)
      for (const pr of r.prs) await checkBackmerge(acc, pr) // merged hotfixes: in dev yet?
      for (const pr of r.prs)
        if (releaseIds.has(pr.id) && (pr.state === 'OPEN' || stored.get(pr.id)?.updatedAt !== pr.updatedAt)) {
          const rc = await computeReleaseContents(acc, pr)
          if (rc.error) errors.push(`${pr.id}: ${rc.error}`)
          else releases++
        }
    }),
  )

  // Dependency targets the descriptions now name that Dispatch doesn't have yet
  const missing = [...new Set(fresh.flatMap((pr) => parseBodyDependencies(pr.body, pr.repo, pr.id).map((d) => d.to)))].filter((id) => !stored.has(id))
  const refsByAccount = new Map<GithubAccount, { owner: string; name: string; number: number }[]>()
  for (const id of missing) {
    const ref = parsePrId(id)
    const acc = ref && accountForOwner(accounts, ref.owner)
    if (ref && acc) refsByAccount.set(acc, [...(refsByAccount.get(acc) ?? []), ref])
  }
  let added = 0
  const now = new Date().toISOString()
  await Promise.all(
    [...refsByAccount].map(([acc, refs]) =>
      fetchPrsByRef(acc, refs).then(
        (prs) => prs.forEach((pr) => (upsertPr(pr, ['dependency'], now), added++)),
        (e) => errors.push(`[${acc.label}] dependency fetch: ${(e as Error).message}`),
      ),
    ),
  )

  // Their Jira issues ("is blocked by" links)
  let jiraCount = 0
  const jira = settings.jira
  if (jira?.apiToken) {
    const keys = new Set<string>()
    for (const pr of fresh) {
      let k = extractJiraKeys([pr.title, pr.headRef], jira.projectKeys)
      if (!k.length) k = extractJiraKeys([pr.body], jira.projectKeys)
      k.forEach((x) => keys.add(x))
    }
    if (keys.size)
      try {
        const { issues } = await fetchIssuesByKey(jira, [...keys])
        issues.forEach(upsertJira)
        jiraCount = issues.length
      } catch (e) {
        errors.push(`Jira: ${(e as Error).message}`)
      }
  }
  return c.json({ prs: fresh.length, added, jira: jiraCount, releases, errors })
})

// ---------- Release planner ----------
/** A decision's release: an open release PR, or a release I planned */
function checkReleaseTarget(id: string | null | undefined) {
  if (id?.startsWith('planned:')) {
    if (!listPlannedReleases().some((r) => r.id === id)) throw bad('That planned release no longer exists')
    return
  }
  const open = listPrs().find((s) => s.pr.id === id)?.pr
  if (!open || open.state !== 'OPEN') throw bad('releaseId must be an open release PR or a planned release')
}
const BRANCH = z.string().min(1).max(200).regex(/^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]+(?<![./])$/, 'Not a valid branch name')

/** Plan a separate release (a branch off `base` that the agent creates and fills) */
api.post('/releases/planned', async (c) => {
  const body = z.object({ repo: z.string().min(3), branch: BRANCH, base: BRANCH, title: z.string().min(1).max(200) }).parse(await c.req.json())
  const repo = listPrs().find((s) => s.pr.repo.toLowerCase() === body.repo.toLowerCase())?.pr.repo
  if (!repo) throw bad(`Unknown repo ${body.repo}`)
  if (listPrs().some((s) => s.pr.repo === repo && s.pr.state === 'OPEN' && s.pr.headRef === body.branch)) throw bad(`A PR from ${body.branch} is already open`)
  if (listPlannedReleases().some((r) => r.repo === repo && r.branch === body.branch)) throw bad(`${body.branch} is already planned`)
  const r = { id: `planned:${randomUUID()}`, repo, branch: body.branch, base: body.base, title: body.title, createdAt: new Date().toISOString() }
  savePlannedRelease(r)
  return c.json(r)
})
/** Rename a planned release (branch, base, title) */
api.put('/releases/planned', async (c) => {
  const body = z.object({ id: z.string().startsWith('planned:'), branch: BRANCH, base: BRANCH, title: z.string().min(1).max(200) }).parse(await c.req.json())
  const r = listPlannedReleases().find((x) => x.id === body.id)
  if (!r) throw bad('That planned release no longer exists')
  savePlannedRelease({ ...r, branch: body.branch, base: body.base, title: body.title })
  return c.json({ ok: true })
})
/** A repo's branches, default first (the planned release form's base picker); cached 5 min */
const branchCache = new Map<string, { at: number; data: { default: string; branches: string[] } }>()
api.get('/repos/branches', async (c) => {
  const repo = z.string().regex(/^[^/\s]+\/[^/\s]+$/).parse(c.req.query('repo'))
  const hit = branchCache.get(repo.toLowerCase())
  if (hit && Date.now() - hit.at < 5 * 60_000) return c.json(hit.data)
  const accounts = getSettings().github.accounts.filter((a) => a.token)
  const acc = accountForOwner(accounts, repo.split('/')[0]!)
  if (!acc) throw bad(`No GitHub account for ${repo}`)
  const data = await listBranches(acc, repo)
  branchCache.set(repo.toLowerCase(), { at: Date.now(), data })
  return c.json(data)
})
/** Drop a planned release (the PRs in it go back to undecided) */
api.delete('/releases/planned', async (c) => {
  const { id } = z.object({ id: z.string().startsWith('planned:') }).parse(await c.req.json())
  deletePlannedRelease(id)
  return c.json({ ok: true })
})
/** Open the release PR for a planned release whose branch is pushed: title, and a body listing what ships */
api.post('/releases/planned/open-pr', async (c) => {
  const { id } = z.object({ id: z.string().startsWith('planned:') }).parse(await c.req.json())
  const r = listPlannedReleases().find((x) => x.id === id)
  if (!r) throw bad('That planned release no longer exists')
  const accounts = getSettings().github.accounts.filter((a) => a.token)
  const acc = accountForOwner(accounts, r.repo.split('/')[0]!)
  if (!acc) throw bad(`No GitHub account for ${r.repo}`)
  if (!(await branchExists(acc, r.repo, r.branch)))
    throw bad(`${r.branch} isn't on GitHub yet: let Claude create and push it (Copy prompt), then open the PR`)
  const plan = releasePlanFor(r.repo)
  const items = plan?.items.filter((i) => i.target === r.id) ?? []
  const created = await createPull(acc, r.repo, { head: r.branch, base: r.base, title: r.title, body: plannedReleaseBody(r, items) })
  // Pull it in now, so the plan shows the real PR (and my decisions move to it)
  const prs = await fetchPrsByRef(acc, [{ owner: r.repo.split('/')[0]!, name: r.repo.split('/')[1]!, number: created.number }])
  for (const pr of prs) upsertPr(pr, ['authored'], new Date().toISOString())
  return c.json(created)
})

/** Every repo's plan, or one (`?repo=owner/name`) */
api.get('/releases/plan', (c) => {
  const repo = c.req.query('repo')
  if (!repo) return c.json(buildReleasePlans())
  const plan = releasePlanFor(repo)
  if (!plan) throw bad(`No plan for ${repo}: it doesn't integrate on a branch like dev`)
  return c.json(plan)
})
/** Decide where a PR merged into dev goes (`decision: null` clears it) */
api.put('/releases/decision', async (c) => {
  const body = z
    .object({ prId: z.string().min(1), decision: z.enum(['release', 'hold', 'skip']).nullable(), releaseId: z.string().nullish(), note: z.string().max(500).nullish() })
    .parse(await c.req.json())
  if (body.decision === 'release') checkReleaseTarget(body.releaseId)
  setReleaseDecision(body.prId, body.decision ? { decision: body.decision, releaseId: body.decision === 'release' ? body.releaseId : null, note: body.note } : null)
  return c.json({ ok: true })
})
/** The plan board: these PRs, in this order, go into `releaseId` (a release PR), or are held / skipped */
api.put('/releases/arrange', async (c) => {
  const body = z
    .object({ prIds: z.array(z.string().min(1)).max(500), decision: z.enum(['release', 'hold', 'skip']), releaseId: z.string().nullish() })
    .parse(await c.req.json())
  if (body.decision === 'release') checkReleaseTarget(body.releaseId)
  body.prIds.forEach((id, i) => setReleaseDecision(id, { decision: body.decision, releaseId: body.decision === 'release' ? body.releaseId : null, position: i + 1 }))
  return c.json({ ok: true })
})
/** Start a repo's plan over: my decisions and order, and its planned releases (GitHub is untouched) */
api.delete('/releases/plan', async (c) => {
  const { repo } = z.object({ repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/) }).parse(await c.req.json())
  return c.json(clearReleasePlan(repo))
})
/** Brief for an agent to carry out a repo's plan (`?text=1`: plain text) */
api.get('/releases/plan/prompt', async (c) => {
  const repo = c.req.query('repo') ?? ''
  const prompt = await buildReleasePrompt(repo)
  if (!prompt) throw bad(`No plan for ${repo}`)
  return c.req.query('text') ? c.text(prompt) : c.json({ prompt })
})

// ---------- Release contents ----------
api.post('/releases/refresh', async (c) => {
  const { id } = await c.req.json<{ id: string }>()
  const stored = listPrs().find((s) => s.pr.id === id)
  if (!stored) throw bad('Unknown PR')
  const accounts = getSettings().github.accounts.filter((a) => a.token)
  const acc = accounts.find((a) => a.id === stored.pr.accountId) ?? accountForOwner(accounts, stored.pr.owner)
  if (!acc) throw bad('No GitHub account for this PR')
  const r = await computeReleaseContents(acc, stored.pr)
  if (r.error) throw bad(r.error)
  return c.json(r)
})

// ---------- Per-PR notes / pins ----------
/** Mark a PR's current action as done (with `action`: the one shown, e.g. backmerge), or undo it (`action: null`) */
api.put('/prs/done', async (c) => {
  const { id, action } = await c.req.json<{ id: string; action: string | null }>()
  if (!id) throw bad('id is required')
  if (action !== null && !(action in ACTION_LABELS)) throw bad('Unknown action')
  setDoneAction(id, action as ActionKind | null)
  return c.json({ ok: true })
})

api.put('/prs/meta', async (c) => {
  const { id, note, pinned } = await c.req.json<{ id: string; note: string | null; pinned: boolean }>()
  setMeta(id, note?.trim() || null, !!pinned)
  return c.json({ ok: true })
})

// ---------- PR writer: Claude rewrites a PR's title and description ----------

function prAccount(prId: string) {
  const s = getSettings()
  const stored = listPrs().find((p) => p.pr.id === prId)?.pr
  if (!stored) throw bad(`Unknown PR ${prId}`)
  const accounts = s.github.accounts.filter((a) => a.token)
  const acc = accounts.find((a) => a.id === stored.accountId) ?? accountForOwner(accounts, stored.owner)
  if (!acc) throw bad('No GitHub account for this PR')
  return { pr: stored, acc }
}

/** Title and description as they are on GitHub now (the editor starts from these) */
api.get('/prs/text', async (c) => {
  const { pr, acc } = prAccount(c.req.query('id') ?? '')
  return c.json(await getPrText(acc, pr.repo, pr.number))
})

api.post('/prs/rewrite', async (c) => {
  const input = z
    .object({ prId: z.string(), prompt: z.string().default(''), current: z.object({ title: z.string(), body: z.string() }), images: Images })
    .parse(await c.req.json())
  if (!input.prompt.trim()) throw bad('Tell Claude what to write or change')
  const s = getSettings()
  const { pr, acc } = prAccount(input.prId)
  const stop = new AbortController()
  const out = (c.env as { outgoing?: import('node:http').ServerResponse } | undefined)?.outgoing
  out?.on('close', () => !out.writableFinished && stop.abort())

  const view = buildOverview().prs.find((p) => p.id === pr.id)
  const [template, claudeMd, detail, commits] = await Promise.all([
    prTemplate(acc, pr.repo, pr.baseRef).catch(() => null),
    claudeMdGuide(pr.repo, 'pr').catch(() => null),
    prDetail(acc, pr.repo, pr.number).catch(() => null),
    prCommits(acc, pr.repo, pr.number).catch(() => []),
  ])
  // Linked Jira issues with their descriptions (first three)
  const jiraKeys = view?.jiraKeys ?? []
  const cached = new Map(listJira().map((j) => [j.key, j]))
  const jira = await Promise.all(
    jiraKeys.slice(0, 3).map(async (key) => {
      const j = cached.get(key)
      const detail = s.jira?.apiToken ? await getIssueDetail(s.jira, key, 0).catch(() => null) : null
      return { key, summary: j?.summary ?? '', status: j?.status ?? '', url: j?.url ?? '', description: adfToMarkdown(detail?.description) }
    }),
  )
  const facts = [
    ...(view?.dependsOn ?? []).map((d) => `Depends on ${d.to} (${d.kind === 'release' ? 'needs its release' : 'needs it merged'}${d.satisfied ? ', done' : ''})`),
    ...(view?.dependents ?? []).map((d) => `${d.from} waits for this PR (${d.kind})`),
    ...(view?.flags ?? []).map((f) => `Feature flag: ${f}`),
  ]
  const draft = await draftPrText(
    s.ai,
    {
      pr: { id: pr.id, title: pr.title, base: pr.baseRef, head: pr.headRef, author: pr.author.login },
      prompt: input.prompt,
      current: input.current,
      claudeMd,
      template,
      files: detail?.files ?? [],
      commits,
      jira,
      facts,
      images: input.images,
    },
    stop.signal,
  )
  // Never lose a dependency or flag line the description had
  const { body, kept } = keepDeclarations(input.current.body, draft.body, pr.repo, pr.id)
  return c.json({
    title: draft.title,
    body,
    rationale: draft.rationale,
    used: { claudeMd: !!claudeMd, template: template?.path ?? null, files: detail?.files.length ?? 0, commits: commits.length, jira: jiraKeys.slice(0, 3) },
    kept,
  })
})

/** Save a PR's title and/or description to GitHub */
/** Ready for review / back to draft / close / reopen on GitHub (merging stays on GitHub) */
api.put('/prs/state', async (c) => {
  const { prId, to } = z.object({ prId: z.string(), to: z.enum(['ready', 'draft', 'closed', 'open']) }).parse(await c.req.json())
  try {
    return c.json(await changePrState(prId, to))
  } catch (e) {
    throw bad((e as Error).message)
  }
})

api.put('/prs/text', async (c) => {
  const input = z.object({ prId: z.string(), title: z.string().trim().min(1).optional(), body: z.string().optional() }).parse(await c.req.json())
  const { pr, acc } = prAccount(input.prId)
  await updatePrText(acc, pr.repo, pr.number, { title: input.title, body: input.body })
  if (input.title !== undefined) setPrTitle(pr.id, input.title)
  if (input.body !== undefined) setPrBody(pr.id, input.body)
  return c.json({ ok: true })
})
