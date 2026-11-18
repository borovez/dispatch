import { testLaunchDarkly } from '../launchdarkly.ts'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { AiProvider, Settings } from '../../../shared/types.ts'
import { DB_PATH, getSettings, saveSettings } from '../db.ts'
import { envCredentials, testAi } from '../ai.ts'
import { buildSetupPrompt } from '../setupPrompt.ts'
import { connectGhCli, maskSettings, updateSettings } from '../settingsPatch.ts'
import { claudeBin } from '../claudeCode.ts'
import { slackAuthTest } from '../slack.ts'
import { whoAmI } from '../github.ts'
import { jiraMyself, listProjects, projectIssueTypes } from '../jira.ts'
import { repoCatalog } from '../repoCatalog.ts'
import { api, bad } from './shared.ts'

/** Settings and the setup helpers (connection tests, MCP command, setup prompt) */
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
  const mcpEntry = fileURLToPath(new URL('../mcp.ts', import.meta.url))
  const tsx = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url))
  const fallbackTsx = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url))
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
