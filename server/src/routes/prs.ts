import { checkBackmerge, computeReleaseContents } from '../releases.ts'
import { adfToMarkdown } from '../../../shared/adf.ts'
import { z } from 'zod'
import type { GithubAccount, PrRecord } from '../../../shared/types.ts'
import { listPrs, getSettings, listJira, setMeta, setPrBody, upsertJira, setPrTitle, updatePrData, upsertPr, listReleaseContents } from '../db.ts'
import { draftPrText } from '../ai.ts'
import { keepDeclarations } from '../prWriter.ts'
import { claudeMdGuide } from '../guides.ts'
import { fetchPrsByNodeId, fetchPrsByRef, getPrText, prCommits, prDetail, prTemplate, updatePrText } from '../github.ts'
import { getIssueDetail, fetchIssuesByKey } from '../jira.ts'
import { buildOverview } from '../model.ts'
import { extractJiraKeys, parseBodyDependencies, parsePrId } from '../refs.ts'
import { accountForOwner } from '../sync.ts'
import { api, bad, Images } from './shared.ts'

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
  await Promise.all(
    [...byAccount].map(async ([acc, nodeIds]) => {
      const r = await fetchPrsByNodeId(acc, nodeIds)
      fresh.push(...r.prs)
      errors.push(...r.errors.map((e) => `[${acc.label}] ${e}`))
      for (const pr of r.prs) updatePrData(pr)
      for (const pr of r.prs) await checkBackmerge(acc, pr) // merged hotfixes: in dev yet?
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
  return c.json({ prs: fresh.length, added, jira: jiraCount, errors })
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
api.put('/prs/text', async (c) => {
  const input = z.object({ prId: z.string(), title: z.string().trim().min(1).optional(), body: z.string().optional() }).parse(await c.req.json())
  const { pr, acc } = prAccount(input.prId)
  await updatePrText(acc, pr.repo, pr.number, { title: input.title, body: input.body })
  if (input.title !== undefined) setPrTitle(pr.id, input.title)
  if (input.body !== undefined) setPrBody(pr.id, input.body)
  return c.json({ ok: true })
})
