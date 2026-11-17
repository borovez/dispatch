import { computeReleaseContents } from './releases.ts'
import { setTodoDoneInSlack } from './slack.ts'
import { testLaunchDarkly } from './launchdarkly.ts'
import { linkPreview } from './linkPreview.ts'
import { editDescription, withBlocks, withDependency, withoutBlocks, withoutDependency } from './bodyDeps.ts'
import { Hono } from 'hono'
import { adfToMarkdown } from '../../shared/adf.ts'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { AiProvider, GithubAccount, LinkedPrs, PrRecord, JiraFieldKind, JiraFieldOption, Settings } from '../../shared/types.ts'
import {
  addJiraMoved,
  listPrs,
  addManualDep,
  DB_PATH,
  getSettings,
  getSyncState,
  getSlackItem,
  getUiPrefs,
  listJira,
  removeManualDep,
  replaceJira,
  saveSettings,
  saveUiPrefs,
  setMeta,
  setPrBody,
  setSlackStatus,
  setSlackPinned,
  upsertJira,
  setPrTitle,
  updatePrData,
  upsertPr,
  listReleaseContents,
} from './db.ts'
import { draftJiraIssue, draftPrText, envCredentials, testAi } from './ai.ts'
import { keepDeclarations } from './prWriter.ts'
import { buildAgentPrompt } from './agentPrompt.ts'
import { buildSlackPrompt } from './slackPrompt.ts'
import { buildSetupPrompt } from './setupPrompt.ts'
import { connectGhCli, maskSettings, updateSettings } from './settingsPatch.ts'
import { startUpdate, updateStatus, VERSION } from './updates.ts'
import { claudeMdGuide } from './guides.ts'
import { claudeBin } from './claudeCode.ts'
import { messagesAround, threadReplies, postMessage, replyInThread, userProfile, slackAuthTest, threadContext } from './slack.ts'
import { fetchPrsByNodeId, fetchPrsByRef, getPrText, ghCliToken, listRepos, prCommits, prDetail, prFileNames, prTemplate, updatePrText, whoAmI } from './github.ts'
import {
  addAttachments,
  addComment,
  hasAttachmentRefs,
  resolveAttachmentRefs,
  composeCreate,
  composeUpdate,
  createMeta,
  editable,
  fieldOptions,
  getIssue,
  getIssueDetail,
  getTransitions,
  jiraMyself,
  listProjects,
  projectIssueTypes,
  transition,
  fetchIssuesByKey,
} from './jira.ts'
import { findLinkedPrs } from './linkedPrs.ts'
import { buildOverview } from './model.ts'
import { extractJiraKeys, normaliseRef, parseBodyDependencies, parsePrId } from './refs.ts'
import { accountForOwner, runSync, syncSlack } from './sync.ts'
import { repoCatalog } from './repoCatalog.ts'

export const api = new Hono()

api.onError((err, c) => {
  console.error('[api]', err.message)
  return c.json({ error: err.message }, (err as { status?: number }).status === 400 ? 400 : 500)
})

const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 })

/** Tokens never leave the server. */

api.get('/health', (c) => c.json({ ok: true, version: VERSION }))

/** Whether a newer release is out, and whether this install can update itself (`?refresh=1` checks GitHub now) */
api.get('/update', async (c) => c.json(await updateStatus(c.req.query('refresh') === '1')))
/** Pull, install, rebuild and restart in the background; the app reloads when /health reports the new version */
api.post('/update', async (c) => {
  await startUpdate()
  return c.json({ started: true })
})

api.get('/overview', (c) => c.json(buildOverview()))

api.post('/sync', async (c) => {
  await runSync()
  return c.json(buildOverview())
})

/** Progress of the running sync (or the last one), polled by the header while syncing */
api.get('/sync/status', (c) => c.json(getSyncState()))

/** Header toggle: switch background sync on/off without sending the whole settings object */
api.put('/sync/auto', async (c) => {
  const { enabled } = (await c.req.json()) as { enabled: boolean }
  const s = getSettings()
  saveSettings({ ...s, sync: { ...s.sync, auto: !!enabled } })
  return c.json({ enabled: !!enabled })
})

// ---------- Settings ----------
api.get('/settings', (c) => c.json(maskSettings(getSettings())))

/** Change some non-secret settings (the same patch as the MCP `update_settings` tool); returns what changed */
api.patch('/settings', async (c) => {
  const changes = updateSettings(await c.req.json())
  return c.json({ changes, settings: maskSettings(getSettings()) })
})

api.put('/settings', async (c) => {
  const incoming = (await c.req.json()) as Settings
  const current = getSettings()
  // Blank token = keep the stored one
  incoming.github.accounts = incoming.github.accounts.map((a) => {
    const prev = current.github.accounts.find((p) => p.id === a.id)
    const { hasToken: _h, ...rest } = a
    return { ...rest, id: a.id || randomUUID(), token: a.token || prev?.token || '' }
  })
  if (incoming.jira) {
    const { hasToken: _h, ...rest } = incoming.jira
    incoming.jira = { ...rest, baseUrl: rest.baseUrl.replace(/\/+$/, ''), apiToken: rest.apiToken || current.jira?.apiToken || '' }
  }
  if (incoming.launchdarkly) {
    const { hasToken: _h, ...rest } = incoming.launchdarkly
    incoming.launchdarkly = {
      ...rest,
      baseUrl: (rest.baseUrl || 'https://app.launchdarkly.com').replace(/\/+$/, ''),
      apiToken: rest.apiToken || current.launchdarkly?.apiToken || '',
    }
  }
  if (incoming.slack) {
    const { hasToken: _h, ...rest } = incoming.slack
    const token = rest.token || current.slack?.token || ''
    let { userId, teamUrl } = rest
    if (token && (token !== current.slack?.token || !userId)) {
      const me = await slackAuthTest(token)
      userId = me.userId
      teamUrl = me.url
    }
    incoming.slack = { ...rest, token, userId, teamUrl }
  }
  {
    const { hasKey, ...rest } = incoming.ai ?? { apiKey: '', model: '' }
    // Blank key = keep the stored one, unless the client says there is no key any more (removed)
    const apiKey = rest.apiKey || (hasKey === false ? '' : current.ai.apiKey || '')
    incoming.ai = { ...rest, apiKey, model: rest.model || 'claude-opus-5-5' }
  }
  incoming.trackedRepos = [...new Set(incoming.trackedRepos.map((r) => r.trim().toLowerCase()).filter(Boolean))]
  incoming.releaseRefs = Object.fromEntries(
    Object.entries(incoming.releaseRefs ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()]).filter(([, v]) => v),
  )
  saveSettings(incoming)
  return c.json(maskSettings(getSettings()))
})

// ---------- Setup helpers ----------
api.post('/setup/github/test', async (c) => {
  const { token, accountId } = await c.req.json<{ token?: string; accountId?: string }>()
  const t = token || getSettings().github.accounts.find((a) => a.id === accountId)?.token
  if (!t) throw bad('No token given')
  return c.json(await whoAmI(t))
})

/** Create (or refresh) an account from `gh auth token`. */
api.post('/setup/github/gh-cli', async (c) => {
  const { me, settings } = await connectGhCli()
  return c.json({ ...me, settings: maskSettings(settings) })
})

/** Every repo the accounts can see (all their orgs), kept an hour; `?refresh=1` lists again */
api.get('/setup/github/repo-catalog', async (c) => c.json(await repoCatalog(c.req.query('refresh') === '1')))

/** Credentials from the Settings form (a blank token keeps the stored one) */
async function draftJira(c: { req: { json: <T>() => Promise<T> } }) {
  const body = await c.req.json<{ baseUrl: string; email: string; apiToken?: string; project?: string }>()
  const stored = getSettings().jira
  const cfg = {
    baseUrl: body.baseUrl,
    email: body.email,
    apiToken: body.apiToken || stored?.apiToken || '',
    projectKeys: [],
    myJql: '',
    create: { projectKey: '', issueType: 'Task', assignToMe: false },
  }
  if (!cfg.apiToken) throw bad('No API token given')
  return { cfg, project: body.project }
}

api.post('/setup/jira/test', async (c) => c.json(await jiraMyself((await draftJira(c)).cfg)))

/** Every project the account can create issues in: Settings picks which ones Dispatch uses */
api.post('/setup/jira/projects', async (c) => c.json(await listProjects((await draftJira(c)).cfg, { all: true })))

/** Issue types of one project, for the default type */
api.post('/setup/jira/issue-types', async (c) => {
  const { cfg, project } = await draftJira(c)
  if (!project) throw bad('project is required')
  return c.json(await projectIssueTypes(cfg, project))
})

/** Command for wiring the MCP server into Claude Code. */
api.get('/setup/ai', (c) => c.json({ env: envCredentials(), claudeCode: claudeBin() }))
api.post('/setup/ai/test', async (c) => {
  const { apiKey, model, provider } = await c.req.json<{ apiKey?: string; model?: string; provider?: AiProvider }>()
  const stored = getSettings().ai
  return c.json(await testAi({ provider: provider ?? stored.provider, apiKey: apiKey || stored.apiKey, model: model || stored.model }))
})

api.get('/setup/mcp', (c) => {
  const mcpEntry = fileURLToPath(new URL('./mcp.ts', import.meta.url))
  const tsx = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))
  const fallbackTsx = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url))
  return c.json({
    node: process.execPath,
    entry: mcpEntry,
    dbPath: DB_PATH,
    tsxCandidates: [tsx, fallbackTsx],
  })
})

/** A brief for an AI agent to walk me through setting Dispatch up (status, where tokens come from; no secrets) */
api.get('/setup/prompt', async (c) => {
  const prompt = await buildSetupPrompt(new URL(c.req.url).origin)
  // ?text=1: plain text, for `claude "$(curl -s …)"` in a terminal
  return c.req.query('text') ? c.text(prompt) : c.json({ prompt })
})

// ---------- Dependencies ----------
const DepInput = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['merge', 'release']).default('merge'),
  note: z.string().nullish(),
})

/** Edit one synced PR's description on GitHub; returns false when the PR isn't synced (nothing to edit) */
async function editPrBody(id: string, edit: (body: string, repo: string) => string): Promise<boolean> {
  const stored = listPrs().find((s) => s.pr.id === id)
  if (!stored) return false
  const accounts = getSettings().github.accounts.filter((a) => a.token)
  const acc = accounts.find((a) => a.id === stored.pr.accountId) ?? accountForOwner(accounts, stored.pr.owner)
  if (!acc) throw new Error(`No GitHub account for ${id}`)
  const body = await editDescription(acc, stored.pr.repo, stored.pr.number, (b) => edit(b, stored.pr.repo))
  if (body !== null) setPrBody(id, body)
  return true
}
/** "owner/Repo#12" with the repo's real casing when synced */
const refFor = (id: string) => {
  const p = listPrs().find((s) => s.pr.id === id)?.pr
  return p ? `${p.repo}#${p.number}` : id
}

api.post('/deps', async (c) => {
  const d = DepInput.parse(await c.req.json())
  const from = normaliseRef(d.from)
  const to = normaliseRef(d.to)
  if (!from || !to) throw bad('Use owner/repo#123 or a GitHub PR URL')
  if (from === to) throw bad('A PR cannot depend on itself')
  const settings = getSettings()
  if (!settings.dependencies.writeToDescription) {
    const id = addManualDep(from, to, d.kind, d.note ?? null)
    return c.json({ id, from, to, written: false })
  }
  // The dependent PR's description gets "Depends on: <to>"; with writeBothSides the prerequisite's gets "Blocks: <from>"
  let written = false
  let writtenOther = false
  const warnings: string[] = []
  try {
    written = await editPrBody(from, (b, repo) => withDependency(b, repo, from, to, refFor(to), d.kind))
  } catch (e) {
    warnings.push(`${from}: ${(e as Error).message}`)
  }
  if (settings.dependencies.writeBothSides)
    try {
      writtenOther = await editPrBody(to, (b, repo) => withBlocks(b, repo, to, from, refFor(from), d.kind))
    } catch (e) {
      warnings.push(`${to}: ${(e as Error).message}`)
    }
  // Neither description holds it: keep it in Dispatch
  const id = written || writtenOther ? undefined : addManualDep(from, to, d.kind, d.note ?? null)
  return c.json({ id, from, to, written, writtenOther, error: warnings.join('; ') || undefined })
})

api.delete('/deps/:id', (c) => c.json({ removed: removeManualDep(Number(c.req.param('id'))) }))

/** Remove a dependency that comes from PR descriptions: out of the dependent's "Depends on" and the prerequisite's "Blocks" */
api.post('/deps/remove-from-description', async (c) => {
  const { from, to } = await c.req.json<{ from: string; to: string }>()
  const errors: string[] = []
  for (const [id, edit] of [
    [from, (b: string, repo: string) => withoutDependency(b, repo, to)],
    [to, (b: string, repo: string) => withoutBlocks(b, repo, from)],
  ] as const)
    try {
      await editPrBody(id, edit)
    } catch (e) {
      errors.push(`${id}: ${(e as Error).message}`)
    }
  if (errors.length) throw bad(errors.join('; '))
  return c.json({ removed: true })
})

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
    }),
  )
  for (const pr of fresh) updatePrData(pr)

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

// ---------- Jira issue detail (side panel) ----------
/** Re-read one issue from Jira into the cache (e.g. a parent the sync didn't fetch) */
api.post('/jira/:key/refresh', async (c) => {
  // An issue the sync didn't fetch stays off the Jira page list (parentOnly)
  const asked = c.req.param('key').toUpperCase()
  const issue = { ...(await getIssue(jiraCfg(), asked)), parentOnly: true }
  upsertJira(issue)
  // Moved issue (Jira answers the old key with the new one): remember it, so the old key resolves
  if (issue.key !== asked) addJiraMoved({ [asked]: issue.key })
  return c.json(issue)
})

api.get('/jira/:key/detail', async (c) => {
  const cfg = getSettings().jira
  if (!cfg?.apiToken) throw bad('Jira not configured')
  return c.json(await getIssueDetail(cfg, c.req.param('key')))
})

// ---------- PRs naming a Jira issue (beyond the synced ones) ----------
/** Per key, 10 minutes; `?refresh=1` skips it */
const linkedCache = new Map<string, { at: number; value: Promise<LinkedPrs> }>()
api.get('/jira/:key/linked-prs', async (c) => {
  const key = c.req.param('key').toUpperCase()
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw bad('Not a Jira key')
  const hit = linkedCache.get(key)
  if (hit && !c.req.query('refresh') && Date.now() - hit.at < 10 * 60_000) return c.json(await hit.value)
  const value = findLinkedPrs(key)
  linkedCache.set(key, { at: Date.now(), value })
  value.catch(() => linkedCache.delete(key))
  return c.json(await value)
})

// ---------- Link hover card ----------
api.get('/link-preview', async (c) => {
  const url = c.req.query('url') ?? ''
  if (!/^https?:\/\//i.test(url) || url.length > 2048) throw bad('Not a web link')
  return c.json(await linkPreview(url))
})

// ---------- Jira transitions ----------
api.get('/jira/:key/transitions', async (c) => {
  const cfg = getSettings().jira
  if (!cfg?.apiToken) throw bad('Jira not configured')
  return c.json(await getTransitions(cfg, c.req.param('key')))
})

api.post('/jira/:key/transitions', async (c) => {
  const cfg = getSettings().jira
  if (!cfg?.apiToken) throw bad('Jira not configured')
  const { id } = await c.req.json<{ id: string }>()
  const key = c.req.param('key')
  const updated = await transition(cfg, key, id)
  const all = listJira()
  const prev = all.find((i) => i.key === key)
  replaceJira(
    all.map((i) => (i.key === key ? { ...updated, isMine: prev?.isMine ?? false } : i)),
    new Date().toISOString(),
  )
  return c.json(updated)
})

api.post('/setup/slack/test', async (c) => {
  const { token } = await c.req.json<{ token?: string }>()
  const t = token || getSettings().slack?.token
  if (!t) throw bad('No Slack token given')
  return c.json(await slackAuthTest(t))
})

api.post('/setup/launchdarkly/test', async (c) => {
  const body = await c.req.json<{ apiToken?: string; baseUrl?: string; projectKey: string }>()
  const stored = getSettings().launchdarkly
  const cfg = {
    apiToken: body.apiToken || stored?.apiToken || '',
    baseUrl: (body.baseUrl || 'https://app.launchdarkly.com').replace(/\/+$/, ''),
    projectKey: body.projectKey,
    environments: [],
  }
  if (!cfg.apiToken) throw bad('No API token given')
  if (!cfg.projectKey) throw bad('No project key given')
  return c.json(await testLaunchDarkly(cfg))
})

// ---------- UI prefs ----------
api.get('/prefs', (c) => c.json(getUiPrefs()))
api.put('/prefs', async (c) => {
  saveUiPrefs(await c.req.json())
  return c.json({ ok: true })
})

// ---------- Slack inbox ----------
api.put('/slack/:id/status', async (c) => {
  const { status } = await c.req.json<{ status: 'new' | 'done' | 'dismissed' }>()
  const id = c.req.param('id')
  const item = getSlackItem(id)
  setSlackStatus(id, status)
  // Todos (marked with a reaction) get the done reaction in Slack too, or lose it when reopened
  const cfg = getSettings().slack
  if (cfg?.token && item?.kind === 'todo' && status !== 'dismissed' && item.status !== status) {
    try {
      const reaction = await setTodoDoneInSlack(cfg, item, status === 'done')
      return c.json({ ok: true, slack: reaction ? { reaction, done: status === 'done' } : null })
    } catch (e) {
      return c.json({ ok: true, slack: null, warning: (e as Error).message })
    }
  }
  return c.json({ ok: true, slack: null })
})

api.put('/slack/:id/pin', async (c) => {
  const { pinned } = await c.req.json<{ pinned: boolean }>()
  const id = c.req.param('id')
  if (!getSlackItem(id)) return c.json({ error: 'Unknown Slack item' }, 404)
  setSlackPinned(id, !!pinned)
  return c.json({ ok: true })
})

api.get('/slack/:id/thread', async (c) => {
  const cfg = getSettings().slack
  const item = getSlackItem(c.req.param('id'))
  if (!cfg?.token || !item) throw bad('Unknown Slack item')
  return c.text(await threadContext(cfg, item))
})

/** Ask Claude to draft a Jira issue from the Slack message + its thread + my extra context. */
api.get('/slack/:id/around', async (c) => {
  const s = getSettings()
  const item = getSlackItem(c.req.param('id'))
  if (!s.slack?.token || !item) throw bad('Unknown Slack item')
  const n = (q: string | undefined) => Math.min(50, Math.max(0, Number(q ?? 2) || 0))
  return c.json(await messagesAround(s.slack, item, n(c.req.query('before')), n(c.req.query('after'))))
})

/** A message's thread replies, for expanding it in the conversation view */
api.get('/slack/:id/thread-replies', async (c) => {
  const s = getSettings()
  const item = getSlackItem(c.req.param('id'))
  const ts = c.req.query('ts')
  if (!s.slack?.token || !item || !ts) throw bad('Unknown Slack item')
  return c.json(await threadReplies(s.slack, item, ts))
})

/** Reply as me: into a message's thread (`threadTs`) or straight into the conversation */
/** Slack page's refresh: just the Slack inbox, not a full sync */
api.post('/slack/refresh', async (c) => {
  const slack = getSettings().slack
  if (!slack?.token) throw bad('Slack not connected')
  const errors: string[] = []
  const items = await syncSlack(slack, errors)
  return c.json({ items, errors })
})

api.post('/slack/:id/reply', async (c) => {
  const s = getSettings()
  const item = getSlackItem(c.req.param('id'))
  if (!s.slack?.token || !item) throw bad('Unknown Slack item')
  const body = z.object({ text: z.string().trim().min(1), threadTs: z.string().nullish() }).parse(await c.req.json())
  await postMessage(s.slack, item, body.text, body.threadTs)
  return c.json({ ok: true })
})

api.get('/slack/users/:id', async (c) => {
  const s = getSettings()
  if (!s.slack?.token) throw bad('Slack is not connected')
  return c.json(await userProfile(s.slack, c.req.param('id')))
})

/** A Markdown brief of the conversation around a Slack item, to paste into any AI chat */
api.get('/slack/:id/prompt', async (c) => {
  const item = getSlackItem(c.req.param('id'))
  if (!item) throw bad('Unknown Slack item')
  const n = (q: string | undefined) => (q === undefined ? undefined : Number(q) || 0)
  return c.json({ prompt: await buildSlackPrompt(item, n(c.req.query('before')), n(c.req.query('after'))) })
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

// ---------- Jira composer ----------

const jiraCfg = () => {
  const s = getSettings()
  if (!s.jira?.apiToken) throw bad('Jira not configured')
  return s.jira
}
const FieldValue = z.union([z.string(), z.array(z.string()), z.number(), z.null()])
/** Pasted images: up to 10, ~10 MB each (base64) */
const Images = z
  .array(z.object({ name: z.string().max(200), type: z.string().regex(/^image\//), data: z.string().max(14_000_000) }))
  .max(10)
  .default([])

/** The projects chosen in Settings → Jira (all when none are chosen) */
api.get('/jira/projects', async (c) => c.json(await listProjects(jiraCfg())))

api.get('/jira/meta', async (c) => {
  const project = c.req.query('project')
  if (!project) throw bad('project is required')
  return c.json(await createMeta(jiraCfg(), project, c.req.query('type') || undefined))
})

api.get('/jira/options', async (c) => {
  const { kind, project, q, issue, field } = c.req.query()
  if (!kind || !project) throw bad('kind and project are required')
  return c.json(await fieldOptions(jiraCfg(), kind as JiraFieldKind, { project, q, issueKey: issue || undefined, field }))
})

/** A copy-paste prompt for an AI agent to implement the issue, with links to all its context */
api.get('/jira/:key/agent-prompt', async (c) => c.json({ prompt: await buildAgentPrompt(c.req.param('key')) }))

api.get('/jira/:key/editable', async (c) => c.json(await editable(jiraCfg(), c.req.param('key'))))

api.post('/jira/issues', async (c) => {
  const input = z
    .object({
      projectKey: z.string().min(1),
      issueTypeId: z.string().min(1),
      summary: z.string().trim().min(1),
      description: z.string().default(''),
      values: z.record(z.string(), FieldValue).default({}),
      slackItemId: z.string().nullish(),
      replyInThread: z.boolean().default(false),
      attachments: Images,
    })
    .parse(await c.req.json())
  const s = getSettings()
  const item = input.slackItemId ? getSlackItem(input.slackItemId) : null
  // Created from Slack: a link back to the message at the end of the description
  const description = item?.permalink ? `${input.description.trim()}\n\n---\nSource: [Slack message from ${item.userName}](${item.permalink})` : input.description
  // Images in the description are uploaded after the issue exists, then linked into it
  const inline = hasAttachmentRefs(description)
  let issue = await composeCreate(jiraCfg(), { ...input, description: inline ? resolveAttachmentRefs(description, []) : description })
  // The issue exists even if an upload fails: report it instead of failing the create
  let attachError: string | null = null
  try {
    const uploaded = await addAttachments(jiraCfg(), issue.key, input.attachments)
    if (inline && uploaded.length) issue = await composeUpdate(jiraCfg(), issue.key, { description: resolveAttachmentRefs(description, uploaded) })
  } catch (e) {
    attachError = (e as Error).message
  }
  upsertJira({ ...issue, isMine: issue.assignee?.accountId === (await jiraMyself(jiraCfg()).catch(() => null))?.accountId })
  let replied = false
  if (item) {
    setSlackStatus(item.id, 'done', issue.key)
    if (input.replyInThread && s.slack?.token) {
      await replyInThread(s.slack, item, `Tracked in Jira: <${issue.url}|${issue.key}> – ${issue.summary}`)
      replied = true
    }
  }
  return c.json({ ...issue, replied, attachError })
})

/** Claude writes (or reworks) the issue in the composer, from your request, the context and the writing guides */
api.post('/jira/draft', async (c) => {
  const s = getSettings()
  const cfg = jiraCfg()
  const input = z
    .object({
      projectKey: z.string().min(1),
      issueTypeId: z.string(),
      fieldKeys: z.array(z.string()).default([]),
      prompt: z.string().default(''),
      current: z.object({ summary: z.string(), description: z.string(), values: z.record(z.string(), FieldValue) }),
      context: z.object({ prId: z.string().nullish(), slackItemId: z.string().nullish(), repo: z.string().nullish() }).default({}),
      images: Images,
      issueKey: z.string().nullish(),
    })
    .parse(await c.req.json())
  if (!input.prompt.trim()) throw bad('Tell Claude what to write or change')
  // Stop Claude when the browser cancels (Stop button) or goes away
  const stop = new AbortController()
  const out = (c.env as { outgoing?: import('node:http').ServerResponse } | undefined)?.outgoing
  out?.on('close', () => !out.writableFinished && stop.abort())
  c.req.raw.signal?.addEventListener('abort', () => stop.abort(), { once: true })
  // Editing: the issue's own editable fields and types; creating: the project's create fields
  const meta = input.issueKey
    ? await editable(cfg, input.issueKey).then((e) => ({ fields: e.fields, issueTypes: e.issueTypes, issueTypeId: input.issueTypeId || e.issueTypeId }))
    : await createMeta(cfg, input.projectKey, input.issueTypeId || undefined)
  const fields = meta.fields.filter((f) => input.fieldKeys.includes(f.key))
  // Choices for fields searched on Jira: open epics for parent, the board's active and future sprints
  const choices: Record<string, JiraFieldOption[]> = Object.fromEntries(
    await Promise.all(
      fields
        .filter((f) => f.kind === 'parent' || f.kind === 'sprint')
        .map(async (f) => [f.key, await fieldOptions(cfg, f.kind, { project: input.projectKey }).catch(() => [])] as const),
    ),
  )

  // Context: a PR (description and changed files), a Slack thread, the repo's CLAUDE.md
  const accounts = s.github.accounts.filter((a) => a.token)
  const stored = input.context.prId ? listPrs().find((p) => p.pr.id === input.context.prId)?.pr : undefined
  const pr = stored
    ? {
        id: stored.id,
        title: stored.title,
        branch: stored.headRef,
        body: stored.body,
        files: await (async () => {
          const acc = accounts.find((a) => a.id === stored.accountId) ?? accountForOwner(accounts, stored.owner)
          return acc ? prFileNames(acc, stored.repo, stored.number).catch(() => []) : []
        })(),
      }
    : null
  const item = input.context.slackItemId ? getSlackItem(input.context.slackItemId) : null
  const slack = item && s.slack?.token ? { channel: item.channelName, permalink: item.permalink, thread: await threadContext(s.slack, item) } : null
  const repo = input.context.repo || stored?.repo || null
  const claudeMd = repo ? await claudeMdGuide(repo).catch(() => null) : null
  const guide = cfg.guides?.[input.projectKey]?.trim() || null
  // Editing: the latest comments and the PRs that name this issue
  const issue = input.issueKey
    ? await (async () => {
        const key = input.issueKey!
        const detail = await getIssueDetail(cfg, key, 8).catch(() => null)
        const named = new RegExp(`\\b${key.replace('-', '\\-')}\\b`, 'i')
        const prs = listPrs()
          .map((p) => p.pr)
          .filter((p) => named.test(`${p.title} ${p.headRef} ${p.body}`))
          .slice(0, 4)
          .map((p) => ({ id: p.id, title: p.title, body: p.body }))
        return {
          key,
          comments: (detail?.comments ?? []).map((c) => ({ author: c.author, created: c.created, body: adfToMarkdown(c.body) })),
          prs,
        }
      })()
    : null

  const draft = await draftJiraIssue(s.ai, {
    projectKey: input.projectKey,
    issueTypes: meta.issueTypes.filter((t) => !t.subtask),
    issueTypeId: meta.issueTypeId,
    fields,
    choices,
    prompt: input.prompt,
    current: input.current,
    guide,
    claudeMd: repo && claudeMd ? { repo, text: claudeMd } : null,
    pr,
    slack,
    images: input.images,
    issue,
  }, stop.signal)
  return c.json({
    ...draft,
    used: { guide: !!guide, claudeMd: claudeMd ? repo : null, pr: pr?.id ?? null, slack: !!slack, comments: issue?.comments.length ?? 0, linkedPrs: issue?.prs.length ?? 0 },
  })
})

api.put('/jira/issues/:key', async (c) => {
  const changes = z
    .object({
      summary: z.string().trim().min(1).optional(),
      description: z.string().optional(),
      issueTypeId: z.string().optional(),
      values: z.record(z.string(), FieldValue).optional(),
      attachments: Images,
      /** Markdown comment posted with the change (e.g. what Claude changed) */
      comment: z.string().optional(),
    })
    .parse(await c.req.json())
  const { attachments, comment, ...fieldChanges } = changes
  // Upload first, so images in the new description can point at them
  const uploaded = await addAttachments(jiraCfg(), c.req.param('key'), attachments)
  if (fieldChanges.description !== undefined && hasAttachmentRefs(fieldChanges.description))
    fieldChanges.description = resolveAttachmentRefs(fieldChanges.description, uploaded)
  const issue = await composeUpdate(jiraCfg(), c.req.param('key'), fieldChanges)
  if (comment?.trim()) await addComment(jiraCfg(), c.req.param('key'), comment)
  upsertJira(issue)
  return c.json(issue)
})

